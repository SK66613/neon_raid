import { RoomCoordinator, ROOM_CAPACITY } from './room/RoomCoordinator.js';
import {
  MAX_MULTIPLAYER_MESSAGE_BYTES,
  createErrorMessage,
  createInputAckMessage,
  createRosterMessage,
  createWelcomeMessage,
  validateInputMessage,
} from '../src/game/network/protocol.js';

const json = (message) => JSON.stringify(message);

export class RaidRoom {
  constructor(ctx) {
    this.ctx = ctx;
  }

  coordinator() {
    const members = this.ctx.getWebSockets().map((socket) => socket.deserializeAttachment()).filter(Boolean);
    return new RoomCoordinator(members);
  }

  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 });
    }
    const coordinator = this.coordinator();
    if (coordinator.size >= ROOM_CAPACITY) {
      return Response.json({ error: 'room-full', capacity: ROOM_CAPACITY }, { status: 409 });
    }
    const connectionId = crypto.randomUUID();
    const joined = coordinator.join(connectionId);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment(joined.member);
    this.ctx.acceptWebSocket(server);
    const roomId = new URL(request.url).searchParams.get('roomId');
    server.send(json(createWelcomeMessage(roomId, connectionId, joined.member.slot, ROOM_CAPACITY)));
    this.broadcastRoster();
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket, payload) {
    if (typeof payload !== 'string') return this.sendError(socket, 'invalid-message', 'Text JSON messages are required.');
    if (new TextEncoder().encode(payload).byteLength > MAX_MULTIPLAYER_MESSAGE_BYTES) {
      return this.sendError(socket, 'message-too-large', 'Message exceeds 4096 bytes.');
    }
    let message;
    try { message = JSON.parse(payload); } catch { return this.sendError(socket, 'invalid-json', 'Message must be valid JSON.'); }
    const validation = validateInputMessage(message);
    if (!validation.ok) return this.sendError(socket, validation.code, 'Message was rejected.');
    const attachment = socket.deserializeAttachment();
    const coordinator = this.coordinator();
    const accepted = coordinator.acceptInput(attachment?.connectionId, message.seq);
    if (!accepted.ok) return this.sendError(socket, accepted.reason, 'Input sequence was rejected.');
    socket.serializeAttachment(accepted.member);
    socket.send(json(createInputAckMessage(message.seq)));
  }

  webSocketClose(socket) {
    this.broadcastRoster(socket);
  }

  webSocketError(socket) {
    try { socket.close(1011, 'WebSocket error'); } catch {}
    this.broadcastRoster(socket);
  }

  sendError(socket, code, message) { socket.send(json(createErrorMessage(code, message))); }

  broadcastRoster(excludedSocket = null) {
    const sockets = this.ctx.getWebSockets().filter((socket) => socket !== excludedSocket);
    const players = sockets.map((socket) => socket.deserializeAttachment()).filter(Boolean);
    const coordinator = new RoomCoordinator(players);
    const message = json(createRosterMessage(ROOM_CAPACITY, coordinator.roster()));
    for (const socket of sockets) socket.send(message);
  }
}
