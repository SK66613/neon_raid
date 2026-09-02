import { RoomCoordinator, ROOM_CAPACITY } from './room/RoomCoordinator.js';
import { AuthoritativeMatchHost } from './room/AuthoritativeMatchHost.js';
import { MULTIPLAYER_TICK_DT } from '../src/game/multiplayer/config.js';
import { createSeededRng } from '../src/game/simulation/rng.js';
import {
  MAX_MULTIPLAYER_MESSAGE_BYTES, createErrorMessage, createInputAckMessage,
  createMatchAbortedMessage, createRosterMessage, createWelcomeMessage, validateInputMessage,
} from '../src/game/network/protocol.js';

const json = message => JSON.stringify(message);
const seedFrom = value => { let seed = 2166136261; for (const char of value) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619); return seed >>> 0; };
const isOpenSocket = socket => socket?.readyState === (globalThis.WebSocket?.OPEN ?? 1);

export class RaidRoom {
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.scheduler = options.scheduler ?? { setInterval: globalThis.setInterval.bind(globalThis), clearInterval: globalThis.clearInterval.bind(globalThis) };
    this.createMatchId = options.createMatchId ?? (() => crypto.randomUUID());
    this.createHost = options.createHost ?? (matchId => new AuthoritativeMatchHost({ matchId, rng: createSeededRng(seedFrom(matchId)) }));
    this.host = null;
    this.timer = null;
    this.failClosedStaleAttachments();
  }

  openSockets(excludedSocket = null) {
    return this.ctx.getWebSockets().filter(socket => socket !== excludedSocket && isOpenSocket(socket));
  }

  safeSend(socket, message) {
    if (!isOpenSocket(socket)) return false;
    try { socket.send(typeof message === 'string' ? message : json(message)); return true; } catch { return false; }
  }

  failClosedStaleAttachments() {
    const stale = this.ctx.getWebSockets().filter(socket => socket.deserializeAttachment()?.matchState === 'active');
    const staleMetadata = stale.map(socket => ({ socket, attachment: socket.deserializeAttachment() }));
    const matchIds = [...new Set(staleMetadata.map(({ attachment }) => attachment?.matchId).filter(Boolean))];
    for (const { socket } of staleMetadata) this.updateAttachment(socket, { matchId: null, matchState: 'waiting' });
    for (const matchId of matchIds) {
      const encoded = json(createMatchAbortedMessage(matchId, 'server-error'));
      for (const { socket, attachment } of staleMetadata) if (attachment?.matchId === matchId) this.safeSend(socket, encoded);
    }
  }

  coordinator() { return new RoomCoordinator(this.openSockets().map(socket => socket.deserializeAttachment()).filter(Boolean)); }

  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 });
    const coordinator = this.coordinator();
    if (coordinator.size >= ROOM_CAPACITY) return Response.json({ error: 'room-full', capacity: ROOM_CAPACITY }, { status: 409 });
    const connectionId = crypto.randomUUID();
    const joined = coordinator.join(connectionId);
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
    server.serializeAttachment({ ...joined.member, matchId: null, matchState: 'waiting' });
    this.ctx.acceptWebSocket(server);
    const roomId = new URL(request.url).searchParams.get('roomId');
    server.send(json(createWelcomeMessage(roomId, connectionId, joined.member.slot, ROOM_CAPACITY)));
    this.broadcastRoster();
    if (this.openSockets().length === ROOM_CAPACITY && !this.host) this.startMatch();
    return new Response(null, { status: 101, webSocket: client });
  }

  startMatch() {
    const participants = this.openSockets();
    if (this.host || this.timer || participants.length !== ROOM_CAPACITY) return;
    const matchId = this.createMatchId(); this.host = this.createHost(matchId);
    for (const socket of participants) this.updateAttachment(socket, { matchId, matchState: 'active' });
    this.broadcast(this.host.initialFrame());
    this.timer = this.scheduler.setInterval(() => this.runAuthoritativeTick(), MULTIPLAYER_TICK_DT * 1000);
  }

  runAuthoritativeTick() {
    if (!this.host) return;
    try {
      const frame = this.host.tick(); this.broadcast(frame);
      if (frame.snapshot.status === 'won' || frame.snapshot.status === 'lost') {
        this.stopTimer();
        for (const socket of this.ctx.getWebSockets()) this.updateAttachment(socket, { matchState: 'complete' });
      }
    } catch { this.abortMatch('server-error'); }
  }

  webSocketMessage(socket, payload) {
    if (typeof payload !== 'string') return this.sendError(socket, 'invalid-message', 'Text JSON messages are required.');
    if (new TextEncoder().encode(payload).byteLength > MAX_MULTIPLAYER_MESSAGE_BYTES) return this.sendError(socket, 'message-too-large', 'Message exceeds 4096 bytes.');
    let message; try { message = JSON.parse(payload); } catch { return this.sendError(socket, 'invalid-json', 'Message must be valid JSON.'); }
    const validation = validateInputMessage(message); if (!validation.ok) return this.sendError(socket, validation.code, 'Message was rejected.');
    const attachment = socket.deserializeAttachment();
    if (attachment?.matchState === 'active' && !this.host) {
      this.updateAttachment(socket, { matchId: null, matchState: 'waiting' });
      return this.sendError(socket, 'match-not-active', 'No authoritative match is active.');
    }
    if (!this.host || attachment?.matchState !== 'active') return this.sendError(socket, 'match-not-active', 'No authoritative match is active.');
    if (message.matchId !== this.host.getMatchId()) return this.sendError(socket, 'stale-match', 'Input belongs to another match.');
    const accepted = this.coordinator().acceptInput(attachment?.connectionId, message.seq);
    if (!accepted.ok) return this.sendError(socket, accepted.reason, 'Input sequence was rejected.');
    this.host.applyCommand(attachment.slot, message.command);
    socket.serializeAttachment({ ...attachment, ...accepted.member });
    socket.send(json(createInputAckMessage(message.matchId, message.seq)));
  }

  webSocketClose(socket, code, reason, wasClean) {
    try { socket.close(code, reason); } catch {}
    this.handleDeparture(socket);
  }
  webSocketError(socket) { try { socket.close(1011, 'WebSocket error'); } catch {} this.handleDeparture(socket); }
  handleDeparture(socket) {
    const attachment = socket.deserializeAttachment();
    if (attachment?.matchState === 'active') this.abortMatch('player-left', socket);
    else if (attachment?.matchState === 'complete') { this.stopTimer(); this.host = null; this.markWaiting(socket); }
    this.broadcastRoster(socket);
  }
  abortMatch(reason, excludedSocket = null) {
    const matchId = this.host?.getMatchId() ?? this.ctx.getWebSockets().map(s => s.deserializeAttachment()?.matchId).find(Boolean);
    this.stopTimer(); this.host = null;
    this.markWaiting(excludedSocket);
    if (matchId) this.broadcast(createMatchAbortedMessage(matchId, reason), excludedSocket);
  }
  markWaiting(excludedSocket = null) { for (const socket of this.ctx.getWebSockets()) if (socket !== excludedSocket) this.updateAttachment(socket, { matchId: null, matchState: 'waiting' }); }
  stopTimer() { if (this.timer !== null) this.scheduler.clearInterval(this.timer); this.timer = null; }
  updateAttachment(socket, patch) { socket.serializeAttachment({ ...socket.deserializeAttachment(), ...patch }); }
  sendError(socket, code, message) { socket.send(json(createErrorMessage(code, message))); }
  broadcast(message, excludedSocket = null) {
    const encoded = json(message);
    for (const socket of this.openSockets(excludedSocket)) this.safeSend(socket, encoded);
  }
  broadcastRoster(excludedSocket = null) {
    const sockets = this.openSockets(excludedSocket);
    const coordinator = new RoomCoordinator(sockets.map(socket => socket.deserializeAttachment()).filter(Boolean));
    const message = json(createRosterMessage(ROOM_CAPACITY, coordinator.roster()));
    for (const socket of sockets) this.safeSend(socket, message);
  }
}
