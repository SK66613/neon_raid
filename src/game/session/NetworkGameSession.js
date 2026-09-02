import { GameSession, SessionStatus } from './GameSession.js';
import { MULTIPLAYER_PROTOCOL_VERSION, validateCommand, validateServerMessage } from '../network/protocol.js';

const ROOM_ID = /^[0-9a-f]{64}$/;
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));

export class NetworkGameSession extends GameSession {
  #status = SessionStatus.CONNECTING;
  #socket = null;
  #snapshot = null;
  #events = [];
  #outbound = [];
  #desired = { move: null, fire: null };
  #seq = 0;
  #info;
  #abortedMatches = new Set();
  #explicitClose = false;

  constructor({ roomId = null } = {}) {
    super();
    this.#info = { roomId, connectionId: null, slot: null, capacity: null, matchId: null,
      peerCount: 0, lastServerTick: null, lastAckSeq: null };
  }

  async connect({ mode = 'join', roomId = this.#info.roomId, origin,
    fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket, onRoomCreated } = {}) {
    if (!origin) origin = globalThis.location?.origin;
    if (!origin) throw this.#fail('An API origin is required.');
    if (mode === 'create') {
      if (typeof fetchImpl !== 'function') throw this.#fail('Fetch is unavailable.');
      let response;
      try { response = await fetchImpl(new URL('/api/rooms', origin), { method: 'POST' }); }
      catch { throw this.#fail('Room creation failed.'); }
      if (!response?.ok) throw this.#fail('Room creation failed.');
      let body; try { body = await response.json(); } catch { throw this.#fail('Room response was not JSON.'); }
      if (!body || !ROOM_ID.test(body.roomId) || body.capacity !== 2
        || Object.keys(body).some(key => !['roomId', 'capacity'].includes(key))) throw this.#fail('Room response was malformed.');
      roomId = body.roomId; this.#info.roomId = roomId;
      onRoomCreated?.(roomId);
    }
    if (!ROOM_ID.test(roomId ?? '')) throw this.#fail('Room ID is malformed.');
    if (typeof WebSocketImpl !== 'function') throw this.#fail('WebSocket is unavailable.');
    const url = new URL(`/api/rooms/${encodeURIComponent(roomId)}/ws`, origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    try { this.#socket = new WebSocketImpl(url.href); } catch { throw this.#fail('WebSocket connection failed.'); }
    this.#listen('open', () => { if (this.#status === SessionStatus.CONNECTING) this.#status = SessionStatus.WAITING; });
    this.#listen('message', event => this.#receive(event?.data));
    this.#listen('error', () => this.#disconnect('socket-error'));
    this.#listen('close', () => { if (!this.#explicitClose) this.#disconnect('socket-closed'); });
    return this;
  }

  submit(command) {
    if (!validateCommand(command) || ![SessionStatus.WAITING, SessionStatus.READY].includes(this.#status)) return false;
    if (this.#status === SessionStatus.READY && !this.#localPlayerAlive()) return false;
    const value = copy(command);
    if (value.type === 'move' || value.type === 'fire') {
      const previous = this.#desired[value.type];
      if (previous && JSON.stringify(previous) === JSON.stringify(value)) return true;
      this.#desired[value.type] = value;
      if (this.#status === SessionStatus.READY) this.#outbound.push(value);
      return true;
    }
    if (this.#status === SessionStatus.READY) this.#outbound.push(value);
    return true;
  }

  update(_dt) {
    if (this.#status !== SessionStatus.READY || this.#socket?.readyState !== 1 || !this.#info.matchId) return;
    if (!this.#localPlayerAlive()) { this.#outbound = []; return; }
    for (const command of this.#outbound.splice(0)) {
      const envelope = { version: MULTIPLAYER_PROTOCOL_VERSION, type: 'input', matchId: this.#info.matchId,
        seq: this.#seq++, command: copy(command) };
      this.#socket.send(JSON.stringify(envelope));
    }
  }

  getSnapshot() { return copy(this.#snapshot); }
  drainEvents() { const result = copy(this.#events); this.#events = []; return result; }
  getStatus() { return this.#status; }
  getConnectionInfo() { return copy(this.#info); }

  close() {
    if (this.#status === SessionStatus.CLOSED) return;
    this.#explicitClose = true; this.#outbound = []; this.#events = [];
    try { this.#socket?.close(1000, 'Session closed'); } catch {}
    this.#status = SessionStatus.CLOSED;
  }

  #listen(type, handler) {
    if (typeof this.#socket.addEventListener === 'function') this.#socket.addEventListener(type, handler);
    else this.#socket[`on${type}`] = handler;
  }

  #receive(payload) {
    if ([SessionStatus.ERROR, SessionStatus.CLOSED].includes(this.#status)) return;
    let parsed; try { parsed = JSON.parse(payload); } catch { this.#protocolError('invalid-json'); return; }
    const validation = validateServerMessage(parsed);
    if (!validation.ok) { this.#protocolError(validation.code); return; }
    const message = validation.value;
    if (message.type === 'welcome') {
      if (message.roomId !== this.#info.roomId) { this.#protocolError('room-mismatch'); return; }
      Object.assign(this.#info, { connectionId: message.connectionId, slot: message.slot, capacity: message.capacity });
      this.#status = SessionStatus.WAITING;
    } else if (message.type === 'roster') {
      this.#info.peerCount = message.players.length;
      if (this.#status === SessionStatus.COMPLETE && message.players.length < message.capacity) {
        if (this.#info.matchId) this.#abortedMatches.add(this.#info.matchId);
        this.#info.matchId = null; this.#info.lastServerTick = null;
        this.#snapshot = null; this.#outbound = []; this.#status = SessionStatus.WAITING;
      }
    } else if (message.type === 'state-frame') {
      this.#acceptFrame(message);
    } else if (message.type === 'input-ack') {
      if (message.matchId === this.#info.matchId
        && (this.#info.lastAckSeq === null || message.seq > this.#info.lastAckSeq)) this.#info.lastAckSeq = message.seq;
    } else if (message.type === 'match-aborted') {
      if (message.matchId !== this.#info.matchId) return;
      this.#abortedMatches.add(message.matchId); this.#info.matchId = null; this.#info.lastServerTick = null;
      this.#outbound = []; this.#status = SessionStatus.WAITING;
      this.#events.push({ type: 'match-aborted', reason: message.reason });
    } else if (message.type === 'error') {
      this.#events.push({ type: 'network-error', code: message.code, message: message.message });
    }
  }

  #acceptFrame(message) {
    if (this.#abortedMatches.has(message.matchId)) return;
    if (this.#info.matchId && message.matchId !== this.#info.matchId) return;
    const newMatch = !this.#info.matchId;
    if (newMatch && this.#status !== SessionStatus.WAITING) return;
    if (!newMatch && message.tick <= this.#info.lastServerTick) return;
    if (newMatch) {
      this.#info.matchId = message.matchId; this.#info.lastServerTick = null; this.#outbound = [];
      if (this.#desired.move) this.#outbound.push(copy(this.#desired.move));
      if (this.#desired.fire) this.#outbound.push(copy(this.#desired.fire));
    }
    this.#snapshot = copy(message.snapshot); this.#events.push(...copy(message.events));
    if (!this.#localPlayerAlive()) this.#outbound = [];
    this.#info.lastServerTick = message.tick;
    this.#status = message.snapshot.status === 'won' || message.snapshot.status === 'lost'
      ? SessionStatus.COMPLETE : SessionStatus.READY;
    if (this.#status === SessionStatus.COMPLETE) this.#outbound = [];
  }

  #protocolError(code) {
    this.#outbound = []; this.#status = SessionStatus.ERROR;
    this.#events.push({ type: 'network-error', code, message: 'Invalid server protocol message.' });
    try { this.#socket?.close(1002, 'Protocol error'); } catch {}
  }

  #disconnect(reason) {
    if (this.#explicitClose || this.#status === SessionStatus.CLOSED || this.#status === SessionStatus.ERROR) return;
    this.#outbound = []; this.#status = SessionStatus.ERROR;
    this.#events.push({ type: 'network-disconnected', reason });
  }

  #localPlayerAlive() {
    return this.#snapshot?.players?.find(player => player.slot === this.#info.slot)?.alive === true;
  }

  #fail(message) { this.#status = SessionStatus.ERROR; return new Error(message); }
}

export async function createNetworkGameSession(options = {}) {
  return new NetworkGameSession(options).connect(options);
}
