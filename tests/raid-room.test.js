import assert from 'node:assert/strict';
import test from 'node:test';
import { RaidRoom } from '../server/RaidRoom.js';

class FakeSocket {
  constructor() {
    this.messages = [];
    this.attachment = undefined;
    this.closed = false;
  }

  send(message) { this.messages.push(JSON.parse(message)); }
  serializeAttachment(value) { this.attachment = structuredClone(value); }
  deserializeAttachment() { return structuredClone(this.attachment); }
  close() { this.closed = true; }
}

class FakeContext {
  constructor(sockets = []) { this.sockets = [...sockets]; }
  acceptWebSocket(socket) { this.sockets.push(socket); }
  getWebSockets() { return [...this.sockets]; }
  remove(socket) { this.sockets = this.sockets.filter((candidate) => candidate !== socket); }
}

class FakeResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.webSocket = init.webSocket;
  }

  static json(value, init = {}) {
    return new FakeResponse(JSON.stringify(value), init);
  }

  async json() { return JSON.parse(this.body); }
}

const messagesOfType = (socket, type) => socket.messages.filter((message) => message.type === type);
const lastMessageOfType = (socket, type) => messagesOfType(socket, type).at(-1);

test('RaidRoom owns joins, sequencing, disconnects, and hibernation recovery', async (t) => {
  const OriginalResponse = globalThis.Response;
  const OriginalWebSocketPair = globalThis.WebSocketPair;
  const pairs = [];
  globalThis.Response = FakeResponse;
  globalThis.WebSocketPair = class {
    constructor() {
      this.client = new FakeSocket();
      this.server = new FakeSocket();
      pairs.push(this);
    }
  };
  t.after(() => {
    globalThis.Response = OriginalResponse;
    if (OriginalWebSocketPair === undefined) delete globalThis.WebSocketPair;
    else globalThis.WebSocketPair = OriginalWebSocketPair;
  });

  const ctx = new FakeContext();
  let room = new RaidRoom(ctx);
  const request = new Request(`https://room.internal/ws?roomId=${'a'.repeat(64)}`, {
    headers: { Upgrade: 'websocket' },
  });

  const firstResponse = await room.fetch(request);
  assert.equal(firstResponse.status, 101);
  const first = pairs[0].server;
  const firstWelcome = lastMessageOfType(first, 'welcome');
  assert.equal(firstWelcome.slot, 1);
  assert.equal(firstWelcome.roomId, 'a'.repeat(64));
  assert.deepEqual(first.deserializeAttachment(), {
    connectionId: firstWelcome.connectionId, slot: 1, lastInputSeq: -1,
  });
  assert.deepEqual(lastMessageOfType(first, 'roster').players, [
    { connectionId: firstWelcome.connectionId, slot: 1 },
  ]);

  const secondResponse = await room.fetch(request);
  assert.equal(secondResponse.status, 101);
  const second = pairs[1].server;
  const secondWelcome = lastMessageOfType(second, 'welcome');
  assert.equal(secondWelcome.slot, 2);
  const expectedRoster = [
    { connectionId: firstWelcome.connectionId, slot: 1 },
    { connectionId: secondWelcome.connectionId, slot: 2 },
  ];
  assert.deepEqual(lastMessageOfType(first, 'roster').players, expectedRoster);
  assert.deepEqual(lastMessageOfType(second, 'roster').players, expectedRoster);

  const thirdResponse = await room.fetch(request);
  assert.equal(thirdResponse.status, 409);
  assert.deepEqual(await thirdResponse.json(), { error: 'room-full', capacity: 2 });
  assert.deepEqual(ctx.getWebSockets(), [first, second]);

  room.webSocketMessage(first, JSON.stringify({
    version: 1, type: 'input', seq: 4, command: { type: 'move', x: 1, y: 0 },
  }));
  assert.deepEqual(lastMessageOfType(first, 'input-ack'), { version: 1, type: 'input-ack', seq: 4 });
  assert.equal(first.deserializeAttachment().lastInputSeq, 4);

  for (const seq of [4, 3]) {
    room.webSocketMessage(first, JSON.stringify({ version: 1, type: 'input', seq, command: { type: 'dash' } }));
    assert.equal(lastMessageOfType(first, 'error').code, 'stale-sequence');
    assert.equal(first.deserializeAttachment().lastInputSeq, 4);
  }
  room.webSocketMessage(first, JSON.stringify({ version: 2, type: 'input', seq: 5, command: { type: 'dash' } }));
  assert.equal(lastMessageOfType(first, 'error').code, 'unsupported-version');
  room.webSocketMessage(first, JSON.stringify({ version: 1, type: 'input', seq: 5, command: { type: 'pause' } }));
  assert.equal(lastMessageOfType(first, 'error').code, 'invalid-command');
  assert.equal(first.deserializeAttachment().lastInputSeq, 4);

  // A fresh object instance sees only ctx sockets and their attachments, as it would after hibernation.
  room = new RaidRoom(ctx);
  assert.deepEqual(room.coordinator().roster(), expectedRoster);
  room.webSocketMessage(second, JSON.stringify({ version: 1, type: 'input', seq: 9, command: { type: 'grenade' } }));
  assert.equal(second.deserializeAttachment().lastInputSeq, 9);

  ctx.remove(first);
  room.webSocketClose(first);
  assert.deepEqual(lastMessageOfType(second, 'roster').players, [
    { connectionId: secondWelcome.connectionId, slot: 2 },
  ]);
  await room.fetch(request);
  const replacement = pairs[2].server;
  assert.equal(lastMessageOfType(replacement, 'welcome').slot, 1);
  assert.deepEqual(lastMessageOfType(second, 'roster').players.map(({ slot }) => slot), [1, 2]);
});
