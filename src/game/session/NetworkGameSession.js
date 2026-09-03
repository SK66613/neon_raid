import { GameSession, SessionStatus } from './GameSession.js';
import { createResumeMessage, MULTIPLAYER_PROTOCOL_VERSION, validateCommand, validateServerMessage } from '../network/protocol.js';
import { MULTIPLAYER_TICK_DT, PLAYER_CONFIG } from '../multiplayer/config.js';
import { calculateDash, integratePlayerMovement } from '../multiplayer/playerKinematics.js';

const ROOM_ID = /^[0-9a-f]{64}$/;
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const MAX_PRESENTATION_DT = 0.1;
const HARD_SNAP_DISTANCE = 72;
const REFLECTED_DASH_HARD_SNAP_DISTANCE = PLAYER_CONFIG.dashDistance * 0.75;
const SOFT_CORRECTION_RATE = 14;
const CORRECTION_EPSILON = 0.01;
const lerp = (from, to, alpha) => from + (to - from) * alpha;
export const RECONNECT_RETRY_DELAY_MS = 250;
export const RECONNECT_ATTEMPT_TIMEOUT_MS = 1500;
const defaultScheduler = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: id => globalThis.clearTimeout(id),
};

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
  #previousFrame = null;
  #currentFrame = null;
  #interpolationElapsed = 0;
  #predictedPlayer = null;
  #correction = { x: 0, y: 0 };
  #sentMovement = [];
  #resumeTicket = null;
  #scheduler;
  #WebSocketImpl = null;
  #origin = null;
  #deadline = null;
  #deadlineTimer = null;
  #retryTimer = null;
  #attemptTimer = null;
  #resumeWelcome = false;

  constructor({ roomId = null, scheduler = defaultScheduler } = {}) {
    super();
    this.#scheduler = scheduler;
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
    this.#WebSocketImpl = WebSocketImpl; this.#origin = origin;
    const url = new URL(`/api/rooms/${encodeURIComponent(roomId)}/ws`, origin);
    url.searchParams.set('reconnect', '1');
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    try { this.#socket = new WebSocketImpl(url.href); } catch { throw this.#fail('WebSocket connection failed.'); }
    this.#wireSocket(this.#socket, false);
    return this;
  }

  submit(command) {
    if (!validateCommand(command) || ![SessionStatus.WAITING, SessionStatus.READY, SessionStatus.RECONNECTING].includes(this.#status)) return false;
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

  update(dt) {
    if (this.#status !== SessionStatus.READY || this.#socket?.readyState !== 1 || !this.#info.matchId) return;
    if (!this.#localPlayerAlive()) { this.#outbound = []; this.#predictedPlayer = null; return; }
    for (const command of this.#outbound.splice(0)) {
      const envelope = { version: MULTIPLAYER_PROTOCOL_VERSION, type: 'input', matchId: this.#info.matchId,
        seq: this.#seq++, command: copy(command) };
      this.#socket.send(JSON.stringify(envelope));
      if (command.type === 'move' || command.type === 'dash') {
        this.#sentMovement.push({ seq: envelope.seq, command: copy(command) });
        if (command.type === 'move' && this.#predictedPlayer) {
          this.#predictedPlayer.moveX = command.x; this.#predictedPlayer.moveY = command.y;
        } else if (command.type === 'dash') this.#applyPredictedDash();
      }
    }
    this.#advancePresentation(dt);
  }

  getSnapshot() { return copy(this.#snapshot); }
  getRenderSnapshot() {
    if (!this.#snapshot) return null;
    const render = copy(this.#snapshot);
    const previous = this.#previousFrame;
    const alpha = previous ? Math.min(1, Math.max(0, this.#interpolationElapsed / MULTIPLAYER_TICK_DT)) : 1;
    const interpolateEntity = (entity, oldEntity) => {
      if (!oldEntity) return;
      entity.x = lerp(oldEntity.x, entity.x, alpha); entity.y = lerp(oldEntity.y, entity.y, alpha);
      if (Number.isFinite(entity.vx) && Number.isFinite(oldEntity.vx)) entity.vx = lerp(oldEntity.vx, entity.vx, alpha);
      if (Number.isFinite(entity.vy) && Number.isFinite(oldEntity.vy)) entity.vy = lerp(oldEntity.vy, entity.vy, alpha);
    };
    for (const player of render.players) {
      if (player.slot === this.#info.slot) {
        if (this.#predictedPlayer && player.alive) Object.assign(player, {
          x: this.#predictedPlayer.x + this.#correction.x, y: this.#predictedPlayer.y + this.#correction.y,
          vx: this.#predictedPlayer.vx, vy: this.#predictedPlayer.vy,
          lastDirection: this.#predictedPlayer.lastDirection, dashTimer: this.#predictedPlayer.dashTimer,
        });
      } else interpolateEntity(player, previous?.players.find(old => old.slot === player.slot));
    }
    interpolateEntity(render.boss, previous?.boss?.id === render.boss.id ? previous.boss : null);
    for (const key of ['bullets', 'enemyBullets']) {
      for (const entity of render[key]) interpolateEntity(entity, previous?.[key].find(old => old.id === entity.id));
    }
    return render;
  }
  drainEvents() { const result = copy(this.#events); this.#events = []; return result; }
  getStatus() { return this.#status; }
  getConnectionInfo() { return copy(this.#info); }

  close() {
    if (this.#status === SessionStatus.CLOSED) return;
    this.#explicitClose = true; this.#outbound = []; this.#events = []; this.#resumeTicket = null;
    this.#cancelReconnect(); this.#resetPresentation();
    const socket = this.#socket; this.#socket = null;
    try { socket?.close(1000, 'Session closed'); } catch {}
    this.#status = SessionStatus.CLOSED;
  }

  #wireSocket(socket, resume) {
    const listen = (type, handler) => {
      if (typeof socket.addEventListener === 'function') socket.addEventListener(type, handler);
      else socket[`on${type}`] = handler;
    };
    listen('open', () => {
      if (socket !== this.#socket) return;
      if (!resume) { if (this.#status === SessionStatus.CONNECTING) this.#status = SessionStatus.WAITING; return; }
      try { socket.send(JSON.stringify(createResumeMessage(this.#resumeTicket.matchId,
        this.#resumeTicket.connectionId, this.#resumeTicket.resumeToken))); }
      catch {
        this.#socket = null;
        try { socket.close(1000, 'Resume authentication failed'); } catch {}
        this.#attemptFailed();
      }
    });
    listen('message', event => { if (socket === this.#socket) this.#receive(event?.data, resume); });
    listen('error', () => this.#transportLost(socket, resume, 'socket-error'));
    listen('close', () => this.#transportLost(socket, resume, 'socket-closed'));
  }

  #receive(payload, resume = false) {
    if ([SessionStatus.ERROR, SessionStatus.CLOSED].includes(this.#status)) return;
    let parsed; try { parsed = JSON.parse(payload); } catch { this.#protocolError('invalid-json'); return; }
    const validation = validateServerMessage(parsed);
    if (!validation.ok) { this.#protocolError(validation.code); return; }
    const message = validation.value;
    if (message.type === 'welcome') {
      if (message.roomId !== this.#info.roomId) { this.#protocolError('room-mismatch'); return; }
      if (resume) {
        if (message.connectionId !== this.#info.connectionId || message.slot !== this.#info.slot
          || message.capacity !== this.#info.capacity) { this.#protocolError('resume-identity-mismatch'); return; }
        this.#resumeWelcome = true;
        return;
      }
      Object.assign(this.#info, { connectionId: message.connectionId, slot: message.slot, capacity: message.capacity });
      this.#status = SessionStatus.WAITING;
    } else if (message.type === 'resume-ticket') {
      if (!this.#info.connectionId || message.connectionId !== this.#info.connectionId
        || (this.#info.matchId && message.matchId !== this.#info.matchId)) {
        this.#protocolError('resume-ticket-mismatch'); return;
      }
      this.#resumeTicket = message;
    } else if (message.type === 'roster') {
      this.#info.peerCount = message.players.length;
      if (this.#status === SessionStatus.COMPLETE && message.players.length < message.capacity) {
        if (this.#info.matchId) this.#abortedMatches.add(this.#info.matchId);
        this.#info.matchId = null; this.#info.lastServerTick = null;
        this.#snapshot = null; this.#outbound = []; this.#resetPresentation(); this.#status = SessionStatus.WAITING;
      }
    } else if (message.type === 'state-frame') {
      this.#acceptFrame(message, resume);
    } else if (message.type === 'input-ack') {
      if (message.matchId === this.#info.matchId
        && (this.#info.lastAckSeq === null || message.seq > this.#info.lastAckSeq)) this.#info.lastAckSeq = message.seq;
    } else if (message.type === 'match-aborted') {
      if (message.matchId !== this.#info.matchId) return;
      this.#abortedMatches.add(message.matchId); this.#info.matchId = null; this.#info.lastServerTick = null;
      this.#resumeTicket = null; this.#outbound = []; this.#snapshot = null; this.#resetPresentation(); this.#status = SessionStatus.WAITING;
      this.#events.push({ type: 'match-aborted', reason: message.reason });
    } else if (message.type === 'error') {
      if (resume && message.code === 'resume-rejected') { this.#terminalDisconnect('resume-rejected'); return; }
      this.#events.push({ type: 'network-error', code: message.code, message: message.message });
    }
  }

  #acceptFrame(message, resume = false) {
    if (this.#abortedMatches.has(message.matchId)) return;
    if (this.#info.matchId && message.matchId !== this.#info.matchId) return;
    const newMatch = !this.#info.matchId;
    if (newMatch && this.#status !== SessionStatus.WAITING) return;
    if (newMatch && this.#resumeTicket && message.matchId !== this.#resumeTicket.matchId) {
      this.#protocolError('resume-ticket-match-mismatch'); return;
    }
    const resumeSync = resume && this.#status === SessionStatus.RECONNECTING && this.#resumeWelcome;
    if (resume && !resumeSync) { this.#protocolError('resume-sync-before-welcome'); return; }
    if (resumeSync && message.tick < this.#info.lastServerTick) { this.#protocolError('stale-resume-sync'); return; }
    if (!newMatch && (message.tick < this.#info.lastServerTick
      || (message.tick === this.#info.lastServerTick && !resumeSync))) return;
    if (newMatch) {
      this.#info.matchId = message.matchId; this.#info.lastServerTick = null; this.#outbound = [];
      this.#resetPresentation();
      if (this.#desired.move) this.#outbound.push(copy(this.#desired.move));
      if (this.#desired.fire) this.#outbound.push(copy(this.#desired.fire));
    }
    const oldVisible = resumeSync ? null : this.#visibleLocalPosition();
    this.#previousFrame = resumeSync ? null : this.#currentFrame;
    this.#currentFrame = copy(message.snapshot); this.#interpolationElapsed = 0;
    this.#snapshot = copy(message.snapshot); this.#events.push(...copy(message.events));
    const frameAckSeq = this.#info.lastAckSeq;
    const reflectedDash = frameAckSeq !== null && this.#sentMovement.some(input =>
      input.seq <= frameAckSeq && input.command.type === 'dash');
    if (frameAckSeq !== null) this.#sentMovement = this.#sentMovement.filter(input => input.seq > frameAckSeq);
    this.#reconcileLocalPlayer(oldVisible, reflectedDash);
    if (!this.#localPlayerAlive()) this.#outbound = [];
    this.#info.lastServerTick = message.tick;
    this.#status = message.snapshot.status === 'won' || message.snapshot.status === 'lost'
      ? SessionStatus.COMPLETE : SessionStatus.READY;
    if (resumeSync) {
      this.#cancelReconnect(); this.#seq = 0; this.#info.lastAckSeq = null; this.#sentMovement = [];
      this.#outbound = [];
      if (this.#status === SessionStatus.READY && this.#localPlayerAlive()) {
        if (this.#desired.move) this.#outbound.push(copy(this.#desired.move));
        if (this.#desired.fire) this.#outbound.push(copy(this.#desired.fire));
      }
      this.#events.push({ type: 'network-resumed' });
    }
    if (this.#status === SessionStatus.COMPLETE) { this.#resumeTicket = null; this.#outbound = []; this.#resetPresentation(); }
  }

  #protocolError(code) {
    this.#cancelReconnect(); this.#resumeTicket = null; this.#outbound = []; this.#resetPresentation(); this.#status = SessionStatus.ERROR;
    this.#events.push({ type: 'network-error', code, message: 'Invalid server protocol message.' });
    const socket = this.#socket; this.#socket = null;
    try { socket?.close(1002, 'Protocol error'); } catch {}
  }

  #transportLost(socket, resume, reason) {
    if (socket !== this.#socket || this.#explicitClose
      || [SessionStatus.CLOSED, SessionStatus.ERROR].includes(this.#status)) return;
    this.#socket = null;
    if (resume && this.#status === SessionStatus.RECONNECTING) { this.#attemptFailed(socket); return; }
    const ticket = this.#resumeTicket;
    const eligible = this.#status === SessionStatus.READY && this.#info.matchId && ticket
      && ticket.matchId === this.#info.matchId && ticket.connectionId === this.#info.connectionId
      && this.#snapshot?.status === 'active';
    if (!eligible) { this.#terminalDisconnect(reason); return; }
    this.#status = SessionStatus.RECONNECTING; this.#outbound = []; this.#resetPresentation();
    this.#deadline = this.#scheduler.now() + ticket.graceMs;
    this.#events.push({ type: 'network-reconnecting', graceMs: ticket.graceMs });
    this.#deadlineTimer = this.#scheduler.setTimeout(() => this.#reconnectTimeout(), ticket.graceMs);
    this.#openResumeAttempt();
  }

  #openResumeAttempt() {
    if (this.#status !== SessionStatus.RECONNECTING || this.#socket || this.#explicitClose) return;
    if (this.#scheduler.now() >= this.#deadline) { this.#reconnectTimeout(); return; }
    const url = new URL(`/api/rooms/${encodeURIComponent(this.#info.roomId)}/ws`, this.#origin);
    url.searchParams.set('resume', '1'); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket;
    try { socket = new this.#WebSocketImpl(url.href); }
    catch { this.#scheduleRetry(); return; }
    this.#socket = socket; this.#resumeWelcome = false; this.#wireSocket(socket, true);
    const remaining = this.#deadline - this.#scheduler.now();
    this.#attemptTimer = this.#scheduler.setTimeout(() => {
      if (socket !== this.#socket || this.#status !== SessionStatus.RECONNECTING) return;
      this.#socket = null;
      try { socket.close(1000, 'Resume attempt timed out'); } catch {}
      this.#attemptFailed(socket);
    }, Math.min(RECONNECT_ATTEMPT_TIMEOUT_MS, remaining));
  }

  #attemptFailed() {
    if (this.#attemptTimer !== null) this.#scheduler.clearTimeout(this.#attemptTimer);
    this.#attemptTimer = null; this.#resumeWelcome = false;
    this.#scheduleRetry();
  }

  #scheduleRetry() {
    if (this.#status !== SessionStatus.RECONNECTING || this.#explicitClose || this.#retryTimer !== null) return;
    const remaining = this.#deadline - this.#scheduler.now();
    if (remaining <= 0) { this.#reconnectTimeout(); return; }
    this.#retryTimer = this.#scheduler.setTimeout(() => {
      this.#retryTimer = null; this.#openResumeAttempt();
    }, Math.min(RECONNECT_RETRY_DELAY_MS, remaining));
  }

  #reconnectTimeout() {
    if (this.#status !== SessionStatus.RECONNECTING) return;
    const socket = this.#socket; this.#socket = null;
    this.#cancelReconnect(); this.#resumeTicket = null; this.#outbound = []; this.#resetPresentation();
    try { socket?.close(1000, 'Reconnect timeout'); } catch {}
    this.#status = SessionStatus.ERROR;
    this.#events.push({ type: 'network-disconnected', reason: 'reconnect-timeout' });
  }

  #terminalDisconnect(reason) {
    if ([SessionStatus.ERROR, SessionStatus.CLOSED].includes(this.#status)) return;
    const socket = this.#socket; this.#socket = null;
    this.#cancelReconnect(); this.#resumeTicket = null; this.#outbound = []; this.#resetPresentation();
    try { socket?.close(1000, 'Disconnected'); } catch {}
    this.#status = SessionStatus.ERROR;
    this.#events.push({ type: 'network-disconnected', reason });
  }

  #cancelReconnect() {
    for (const id of [this.#deadlineTimer, this.#retryTimer, this.#attemptTimer]) {
      if (id !== null) this.#scheduler.clearTimeout(id);
    }
    this.#deadlineTimer = null; this.#retryTimer = null; this.#attemptTimer = null;
    this.#deadline = null; this.#resumeWelcome = false;
  }

  #localPlayerAlive() {
    return this.#snapshot?.players?.find(player => player.slot === this.#info.slot)?.alive === true;
  }

  #visibleLocalPosition() {
    return this.#predictedPlayer ? { x: this.#predictedPlayer.x + this.#correction.x,
      y: this.#predictedPlayer.y + this.#correction.y } : null;
  }

  #reconcileLocalPlayer(oldVisible, reflectedDash = false) {
    const authoritative = this.#snapshot.players.find(player => player.slot === this.#info.slot);
    if (!authoritative?.alive) { this.#predictedPlayer = null; this.#correction = { x: 0, y: 0 }; return; }
    this.#predictedPlayer = copy(authoritative);
    if (this.#desired.move) { this.#predictedPlayer.moveX = this.#desired.move.x; this.#predictedPlayer.moveY = this.#desired.move.y; }
    for (const input of this.#sentMovement) if (input.command.type === 'dash') this.#applyPredictedDash();
    if (!oldVisible) { this.#correction = { x: 0, y: 0 }; return; }
    const dx = oldVisible.x - this.#predictedPlayer.x, dy = oldVisible.y - this.#predictedPlayer.y;
    const distance = Math.hypot(dx, dy);
    const hardSnap = distance >= HARD_SNAP_DISTANCE
      || (reflectedDash && distance >= REFLECTED_DASH_HARD_SNAP_DISTANCE);
    this.#correction = hardSnap ? { x: 0, y: 0 } : { x: dx, y: dy };
  }

  #applyPredictedDash() {
    if (!this.#predictedPlayer || this.#predictedPlayer.dashCooldown > 0) return;
    const destination = calculateDash(this.#predictedPlayer);
    this.#predictedPlayer.x = destination.x; this.#predictedPlayer.y = destination.y;
    this.#predictedPlayer.dashTimer = PLAYER_CONFIG.dashDuration;
    this.#predictedPlayer.dashCooldown = PLAYER_CONFIG.dashCooldown;
  }

  #advancePresentation(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    let remaining = Math.min(dt, MAX_PRESENTATION_DT);
    this.#interpolationElapsed = Math.min(MULTIPLAYER_TICK_DT, this.#interpolationElapsed + remaining);
    while (remaining > 0 && this.#predictedPlayer) {
      const step = Math.min(remaining, MULTIPLAYER_TICK_DT);
      this.#predictedPlayer.dashTimer = Math.max(0, this.#predictedPlayer.dashTimer - step);
      this.#predictedPlayer.dashCooldown = Math.max(0, this.#predictedPlayer.dashCooldown - step);
      Object.assign(this.#predictedPlayer, integratePlayerMovement(this.#predictedPlayer, step));
      remaining -= step;
    }
    const decay = Math.exp(-SOFT_CORRECTION_RATE * Math.min(dt, MAX_PRESENTATION_DT));
    this.#correction.x *= decay; this.#correction.y *= decay;
    if (Math.hypot(this.#correction.x, this.#correction.y) < CORRECTION_EPSILON) this.#correction = { x: 0, y: 0 };
  }

  #resetPresentation() {
    this.#previousFrame = null; this.#currentFrame = null; this.#interpolationElapsed = 0;
    this.#predictedPlayer = null; this.#correction = { x: 0, y: 0 }; this.#sentMovement = [];
  }

  #fail(message) { this.#status = SessionStatus.ERROR; return new Error(message); }
}

export async function createNetworkGameSession(options = {}) {
  return new NetworkGameSession(options).connect(options);
}
