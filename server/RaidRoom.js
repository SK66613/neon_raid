import { RoomCoordinator, ROOM_CAPACITY } from './room/RoomCoordinator.js';
import { AuthoritativeMatchHost } from './room/AuthoritativeMatchHost.js';
import { MULTIPLAYER_TICK_DT } from '../src/game/multiplayer/config.js';
import { createSeededRng } from '../src/game/simulation/rng.js';
import {
  MAX_MULTIPLAYER_MESSAGE_BYTES, createErrorMessage, createInputAckMessage,
  createMatchAbortedMessage, createResumeTicketMessage, createRosterMessage, createWelcomeMessage,
  validateInputMessage, validateResumeMessage,
} from '../src/game/network/protocol.js';

export const RECONNECT_GRACE_MS = 8000;
export const PENDING_RESUME_AUTH_MS = 2000;

const json = message => JSON.stringify(message);
const seedFrom = value => { let seed = 2166136261; for (const char of value) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619); return seed >>> 0; };
const isOpenSocket = socket => socket?.readyState === (globalThis.WebSocket?.OPEN ?? 1);

export class RaidRoom {
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.scheduler = options.scheduler ?? { setInterval: globalThis.setInterval.bind(globalThis), clearInterval: globalThis.clearInterval.bind(globalThis), setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) };
    this.now = options.now ?? (() => Date.now());
    this.createResumeToken = options.createResumeToken ?? (() => { const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join(''); });
    this.createMatchId = options.createMatchId ?? (() => crypto.randomUUID());
    this.createHost = options.createHost ?? (matchId => new AuthoritativeMatchHost({ matchId, rng: createSeededRng(seedFrom(matchId)) }));
    this.host = null;
    this.timer = null;
    this.reservations = new Map();
    this.pendingResumeAuth = new Map();
    this.failClosedStaleAttachments();
  }

  openSockets(excludedSocket = null) {
    return this.ctx.getWebSockets().filter(socket => socket !== excludedSocket && isOpenSocket(socket));
  }
  memberSockets(excludedSocket = null) { return this.openSockets(excludedSocket).filter(socket => socket.deserializeAttachment()?.socketType !== 'pending-resume'); }

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

  coordinator() { return new RoomCoordinator(this.memberSockets().map(socket => socket.deserializeAttachment()).filter(Boolean)); }

  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 });
    const url = new URL(request.url); const pendingResume = url.searchParams.get('resume') === '1';
    this.roomId = url.searchParams.get('roomId');
    if (pendingResume) {
      const matchId = this.host?.getMatchId();
      const resumable = matchId && [...this.reservations.values()].some(reservation => reservation.matchId === matchId);
      if (!resumable) return Response.json({ error: 'resume-unavailable' }, { status: 409 });
      if (this.pendingResumeAuth.size >= ROOM_CAPACITY) return Response.json({ error: 'too-many-resume-attempts' }, { status: 429 });
      const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server); server.serializeAttachment({ socketType: 'pending-resume' });
      const timeout = this.scheduler.setTimeout(() => this.retirePendingResume(server, 1008, 'Resume authentication timed out'), PENDING_RESUME_AUTH_MS);
      this.pendingResumeAuth.set(server, { matchId, timeout });
      return new Response(null, { status: 101, webSocket: client });
    }
    const occupied = [...this.memberSockets().map(socket => socket.deserializeAttachment()), ...this.reservations.values()];
    const coordinator = new RoomCoordinator(occupied);
    if (coordinator.size >= ROOM_CAPACITY) return Response.json({ error: 'room-full', capacity: ROOM_CAPACITY }, { status: 409 });
    const connectionId = crypto.randomUUID(); const joined = coordinator.join(connectionId);
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ ...joined.member, matchId: null, matchState: 'waiting', reconnectCapable: url.searchParams.get('reconnect') === '1', resumeToken: null });
    server.send(json(createWelcomeMessage(this.roomId, connectionId, joined.member.slot, ROOM_CAPACITY)));
    this.broadcastRoster();
    if (this.memberSockets().length === ROOM_CAPACITY && !this.host) this.startMatch();
    return new Response(null, { status: 101, webSocket: client });
  }

  startMatch() {
    const participants = this.memberSockets();
    if (this.host || this.timer || participants.length !== ROOM_CAPACITY) return;
    const matchId = this.createMatchId(); this.host = this.createHost(matchId);
    for (const socket of participants) {
      const attachment = socket.deserializeAttachment();
      const resumeToken = attachment.reconnectCapable ? this.createResumeToken() : null;
      this.updateAttachment(socket, { matchId, matchState: 'active', resumeToken });
      if (resumeToken) this.safeSend(socket, createResumeTicketMessage(matchId, attachment.connectionId, resumeToken, RECONNECT_GRACE_MS));
    }
    this.broadcast(this.host.initialFrame());
    this.timer = this.scheduler.setInterval(() => this.runAuthoritativeTick(), MULTIPLAYER_TICK_DT * 1000);
  }

  runAuthoritativeTick() {
    if (!this.host) return;
    try {
      const frame = this.host.tick(); this.broadcast(frame);
      if (frame.snapshot.status === 'won' || frame.snapshot.status === 'lost') {
        this.stopTimer();
        const matchId = this.host.getMatchId(), hadVacancy = [...this.reservations.values()].some(item => item.matchId === matchId);
        this.clearReservations(matchId);
        this.clearPendingResumes(matchId);
        for (const socket of this.memberSockets()) this.updateAttachment(socket, hadVacancy ? { matchId: null, matchState: 'waiting', resumeToken: null } : { matchState: 'complete', resumeToken: null });
        if (hadVacancy) this.host = null;
        this.broadcastRoster();
      }
    } catch { this.abortMatch('server-error'); }
  }

  webSocketMessage(socket, payload) {
    if (typeof payload !== 'string') return this.sendError(socket, 'invalid-message', 'Text JSON messages are required.');
    if (new TextEncoder().encode(payload).byteLength > MAX_MULTIPLAYER_MESSAGE_BYTES) return this.sendError(socket, 'message-too-large', 'Message exceeds 4096 bytes.');
    let message; try { message = JSON.parse(payload); } catch { return this.sendError(socket, 'invalid-json', 'Message must be valid JSON.'); }
    const initialAttachment = socket.deserializeAttachment();
    if (initialAttachment?.socketType === 'pending-resume') return this.handleResume(socket, message);
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
    this.handleDeparture(socket, code === 1000 && reason === 'Session closed');
  }
  webSocketError(socket) { try { socket.close(1011, 'WebSocket error'); } catch {} this.handleDeparture(socket); }
  handleDeparture(socket, intentional = false) {
    const attachment = socket.deserializeAttachment();
    if (attachment?.socketType === 'pending-resume') { this.retirePendingResume(socket); return; }
    if (attachment?.matchState === 'active' && attachment.reconnectCapable && attachment.resumeToken && !intentional) this.reserveDeparture(attachment);
    else if (attachment?.matchState === 'active') this.abortMatch('player-left', socket);
    else if (attachment?.matchState === 'complete') { this.stopTimer(); this.host = null; this.markWaiting(socket); }
    this.broadcastRoster(socket);
  }
  reserveDeparture(attachment) {
    if (this.reservations.has(attachment.connectionId) || !this.host || attachment.matchId !== this.host.getMatchId()) return;
    this.host.applyCommand(attachment.slot, { type: 'move', x: 0, y: 0 });
    this.host.applyCommand(attachment.slot, { type: 'fire', active: false });
    const reservation = { connectionId: attachment.connectionId, slot: attachment.slot, lastInputSeq: -1, matchId: attachment.matchId, resumeToken: attachment.resumeToken, deadline: this.now() + RECONNECT_GRACE_MS, timeout: null };
    reservation.timeout = this.scheduler.setTimeout(() => this.expireReservation(reservation.connectionId, reservation.matchId), RECONNECT_GRACE_MS);
    this.reservations.set(reservation.connectionId, reservation);
  }
  handleResume(socket, message) {
    const validation = validateResumeMessage(message);
    const reservation = validation.ok ? this.reservations.get(message.connectionId) : null;
    const valid = reservation && reservation.matchId === message.matchId && reservation.resumeToken === message.resumeToken
      && this.reservations.get(reservation.connectionId) === reservation
      && reservation.deadline > this.now() && this.host?.getMatchId() === reservation.matchId;
    if (!valid) {
      this.safeSend(socket, createErrorMessage('resume-rejected', 'Resume was rejected.'));
      return this.retirePendingResume(socket, 1008, 'Resume rejected');
    }
    this.clearPendingResumeTracking(socket);
    this.scheduler.clearTimeout(reservation.timeout); this.reservations.delete(reservation.connectionId);
    const resumeToken = this.createResumeToken();
    socket.serializeAttachment({ socketType: 'member', connectionId: reservation.connectionId, slot: reservation.slot, lastInputSeq: -1, matchId: reservation.matchId, matchState: 'active', reconnectCapable: true, resumeToken });
    this.safeSend(socket, createWelcomeMessage(this.roomId, reservation.connectionId, reservation.slot, ROOM_CAPACITY));
    this.safeSend(socket, createResumeTicketMessage(reservation.matchId, reservation.connectionId, resumeToken, RECONNECT_GRACE_MS));
    this.safeSend(socket, this.host.currentFrame()); this.broadcastRoster();
  }
  expireReservation(connectionId, matchId) {
    const reservation = this.reservations.get(connectionId);
    if (!reservation || reservation.matchId !== matchId) return;
    if (reservation.deadline > this.now()) return;
    this.abortMatch('player-left');
  }
  clearReservations(matchId = null) { for (const [id, reservation] of this.reservations) if (!matchId || reservation.matchId === matchId) { this.scheduler.clearTimeout(reservation.timeout); this.reservations.delete(id); } }
  clearPendingResumeTracking(socket) {
    const pending = this.pendingResumeAuth.get(socket);
    if (!pending) return false;
    this.scheduler.clearTimeout(pending.timeout); this.pendingResumeAuth.delete(socket); return true;
  }
  retirePendingResume(socket, code = null, reason = null) {
    if (!this.clearPendingResumeTracking(socket)) return;
    if (code !== null) try { socket.close(code, reason); } catch {}
  }
  clearPendingResumes(matchId = null) {
    for (const [socket, pending] of this.pendingResumeAuth) {
      if (!matchId || pending.matchId === matchId) this.retirePendingResume(socket, 1008, 'Resume unavailable');
    }
  }
  abortMatch(reason, excludedSocket = null) {
    const matchId = this.host?.getMatchId() ?? this.ctx.getWebSockets().map(s => s.deserializeAttachment()?.matchId).find(Boolean);
    this.stopTimer(); this.host = null; this.clearReservations(matchId); this.clearPendingResumes(matchId);
    this.markWaiting(excludedSocket);
    if (matchId) this.broadcast(createMatchAbortedMessage(matchId, reason), excludedSocket);
  }
  markWaiting(excludedSocket = null) { for (const socket of this.memberSockets()) if (socket !== excludedSocket) this.updateAttachment(socket, { matchId: null, matchState: 'waiting', resumeToken: null }); }
  stopTimer() { if (this.timer !== null) this.scheduler.clearInterval(this.timer); this.timer = null; }
  updateAttachment(socket, patch) { socket.serializeAttachment({ ...socket.deserializeAttachment(), ...patch }); }
  sendError(socket, code, message) { socket.send(json(createErrorMessage(code, message))); }
  broadcast(message, excludedSocket = null) {
    const encoded = json(message);
    for (const socket of this.memberSockets(excludedSocket)) this.safeSend(socket, encoded);
  }
  broadcastRoster(excludedSocket = null) {
    const sockets = this.memberSockets(excludedSocket);
    const coordinator = new RoomCoordinator(sockets.map(socket => socket.deserializeAttachment()).filter(Boolean));
    const message = json(createRosterMessage(ROOM_CAPACITY, coordinator.roster()));
    for (const socket of sockets) this.safeSend(socket, message);
  }
}
