import worker from '../../server/worker.js';
import { RaidRoom } from '../../server/RaidRoom.js';

class EventQueue {
  constructor() { this.items = []; }
  push(callback) { this.items.push(callback); }
  async flush() { while (this.items.length) await this.items.shift()(); }
}

export class DeterministicScheduler {
  constructor(now = 1_000) { this.time = now; this.nextId = 1; this.timeouts = new Map(); this.intervals = new Map(); }
  now = () => this.time;
  setTimeout = (callback, delay) => { const id = this.nextId++; this.timeouts.set(id, { callback, at: this.time + delay }); return id; };
  clearTimeout = id => this.timeouts.delete(id);
  setInterval = (callback, delay) => { const id = this.nextId++; this.intervals.set(id, { callback, delay }); return id; };
  clearInterval = id => this.intervals.delete(id);
  async advance(ms, queue = null) {
    const end = this.time + ms;
    while (true) {
      const due = [...this.timeouts].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      const [id, timer] = due; this.time = timer.at; this.timeouts.delete(id); timer.callback();
      if (queue) await queue.flush();
    }
    this.time = end;
  }
  runTicks(count = 1) { for (let index = 0; index < count; index++) for (const timer of [...this.intervals.values()]) timer.callback(); }
}

class TestResponse {
  constructor(body = null, init = {}) {
    this.body = body; this.status = init.status ?? 200; this.ok = this.status >= 200 && this.status < 300;
    this.webSocket = init.webSocket;
  }
  static json(value, init = {}) { return new TestResponse(JSON.stringify(value), { ...init, headers: { 'content-type': 'application/json' } }); }
  async json() { return JSON.parse(this.body); }
}

const messageType = data => { try { return JSON.parse(data).type; } catch { return null; } };

export function createInMemoryMultiplayerHarness() {
  const originals = { Response: globalThis.Response, WebSocketPair: globalThis.WebSocketPair, WebSocket: globalThis.WebSocket };
  const queue = new EventQueue(), trace = [], serverScheduler = new DeterministicScheduler();
  let roomCounter = 0, matchCounter = 0, tokenCounter = 0, socketCounter = 0, activePairHarness = null;
  const rooms = new Map(), browsers = [];

  class Endpoint {
    constructor(side) { this.side = side; this.readyState = 0; this.attachment = null; this.browser = null; this.pending = []; this.peer = null; }
    serializeAttachment(value) { this.attachment = structuredClone(value); }
    deserializeAttachment() { return structuredClone(this.attachment); }
    send(data) {
      if (this.side !== 'server' || this.readyState !== 1) throw new Error('Socket is not open');
      const deliver = () => {
        if (!this.browser || this.browser.readyState !== 1) return;
        trace.push({ direction: 'server→client', connection: this.browser.connection, type: messageType(data), data: JSON.parse(data), url: this.browser.url });
        this.browser.emit('message', { data });
      };
      if (this.browser) queue.push(deliver); else this.pending.push(deliver);
    }
    close(code = 1000, reason = '') { this.readyState = 3; trace.push({ direction: 'lifecycle', side: this.side, event: 'close', code, reason }); }
  }
  class Pair {
    constructor() {
      if (!activePairHarness) throw new Error('WebSocketPair used outside harness request');
      this.client = new Endpoint('client'); this.server = new Endpoint('server');
      this.client.peer = this.server; this.server.peer = this.client;
    }
  }
  class Context {
    constructor() { this.sockets = []; }
    acceptWebSocket(socket) { socket.readyState = 1; this.sockets.push(socket); }
    getWebSockets() { return [...this.sockets]; }
  }
  const namespace = {
    newUniqueId() { const value = (++roomCounter).toString(16).padStart(64, '0'); return { toString: () => value }; },
    idFromString(value) { if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('invalid id'); return { toString: () => value }; },
    get(id) {
      const roomId = id.toString();
      if (!rooms.has(roomId)) {
        const context = new Context();
        const room = new RaidRoom(context, {
          scheduler: serverScheduler, now: serverScheduler.now,
          createMatchId: () => `integration-match-${++matchCounter}`,
          createResumeToken: () => (++tokenCounter).toString(16).padStart(64, '0'),
        });
        rooms.set(roomId, { room, context });
      }
      return { fetch: request => rooms.get(roomId).room.fetch(request) };
    },
  };
  const fetchImpl = (input, init = {}) => worker.fetch(input instanceof Request ? input : new Request(input, init), { RAID_ROOMS: namespace });

  class BrowserWebSocket {
    static OPEN = 1;
    constructor(url) {
      this.url = String(url); this.readyState = 0; this.listeners = new Map(); this.connection = ++socketCounter; this.server = null;
      browsers.push(this); trace.push({ direction: 'lifecycle', event: 'construct', connection: this.connection, url: this.url });
      queue.push(async () => {
        activePairHarness = true;
        let response;
        try { response = await fetchImpl(new Request(this.url, { headers: { Upgrade: 'websocket' } })); }
        finally { activePairHarness = null; }
        if (response.status !== 101 || !response.webSocket) {
          this.readyState = 3; trace.push({ direction: 'lifecycle', event: 'upgrade-failed', connection: this.connection, status: response.status, url: this.url });
          queue.push(() => this.emit('error', {})); queue.push(() => this.emit('close', { code: 1006, wasClean: false })); return;
        }
        const client = response.webSocket; this.server = client.peer; client.browser = this; this.server.browser = this;
        this.readyState = 1; client.readyState = 1;
        queue.push(() => this.emit('open', {}));
        for (const delivery of this.server.pending.splice(0)) queue.push(delivery);
      });
    }
    addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(callback); }
    emit(type, event) { for (const callback of this.listeners.get(type) ?? []) callback(event); this[`on${type}`]?.(event); }
    send(data) {
      if (this.readyState !== 1 || !this.server) throw new Error('Socket is not open');
      trace.push({ direction: 'client→server', connection: this.connection, type: messageType(data), data: JSON.parse(data), url: this.url });
      queue.push(() => roomForSocket(this.server).webSocketMessage(this.server, data));
    }
    close(code = 1000, reason = '') {
      if (this.readyState >= 2) return; this.readyState = 3;
      if (this.server) queue.push(() => roomForSocket(this.server).webSocketClose(this.server, code, reason, true));
      queue.push(() => this.emit('close', { code, reason, wasClean: true }));
    }
  }
  const roomForSocket = socket => [...rooms.values()].find(({ context }) => context.sockets.includes(socket))?.room;

  globalThis.Response = TestResponse; globalThis.WebSocketPair = Pair; globalThis.WebSocket = BrowserWebSocket;
  return {
    BrowserWebSocket, clientScheduler: () => new DeterministicScheduler(), fetchImpl, queue, rooms, serverScheduler, trace,
    room(roomId) { return rooms.get(roomId)?.room; },
    sockets() { return [...browsers]; },
    async flush() { await queue.flush(); },
    async lose(browser, { serverFirst = true } = {}) {
      const server = browser.server, room = roomForSocket(server);
      browser.readyState = 3;
      if (serverFirst) {
        room.webSocketError(server);
        trace.push({ direction: 'lifecycle', event: 'reservation-created', connection: browser.connection,
          count: room.reservations.size });
      }
      queue.push(() => browser.emit('error', {})); queue.push(() => browser.emit('close', { code: 1006, wasClean: false }));
      await queue.flush();
      return { depart: async () => { if (!serverFirst) { room.webSocketError(server); trace.push({ direction: 'lifecycle',
        event: 'reservation-created', connection: browser.connection, count: room.reservations.size }); await queue.flush(); } } };
    },
    serverDepartWithoutBrowserNotification(browser) {
      const room = roomForSocket(browser.server);
      room.webSocketError(browser.server);
      trace.push({ direction: 'lifecycle', event: 'reservation-created', connection: browser.connection,
        count: room.reservations.size });
    },
    restore() { globalThis.Response = originals.Response; globalThis.WebSocketPair = originals.WebSocketPair; if (originals.WebSocket === undefined) delete globalThis.WebSocket; else globalThis.WebSocket = originals.WebSocket; },
  };
}
