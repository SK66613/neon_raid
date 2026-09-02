import assert from 'node:assert/strict';
import test from 'node:test';
import { createNetworkGameSession } from '../src/game/session/NetworkGameSession.js';
import { SessionStatus } from '../src/game/session/GameSession.js';
import { createMultiplayerBossState } from '../src/game/multiplayer/createMultiplayerBossState.js';

const roomId = 'a'.repeat(64);
const snapshot = (tick, status = 'active') => ({ ...createMultiplayerBossState(), tick, status });
const message = (type, detail = {}) => ({ version: 2, type, ...detail });

class FakeSocket {
  static instances = [];
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.listeners = {}; FakeSocket.instances.push(this); }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  emit(type, data) { if (type === 'open') this.readyState = 1; for (const listener of this.listeners[type] || []) listener(type === 'message' ? { data: JSON.stringify(data) } : data); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close(code, reason) { this.closeArgs = [code, reason]; this.readyState = 3; }
}

async function setup(options = {}) {
  FakeSocket.instances = [];
  const calls = [];
  const fetchImpl = async (...args) => { calls.push(args); return { ok: true, json: async () => ({ roomId, capacity: 2 }) }; };
  const session = await createNetworkGameSession({ mode: 'join', roomId, origin: 'http://example.test', fetchImpl,
    WebSocketImpl: FakeSocket, ...options });
  const socket = FakeSocket.instances[0]; socket.emit('open');
  socket.emit('message', message('welcome', { roomId, connectionId: 'server-choice', slot: 2, capacity: 2 }));
  return { session, socket, calls };
}
const frame = (matchId, tick, status = 'active', events = []) => message('state-frame', { matchId, tick, snapshot: snapshot(tick, status), events });

test('create mode posts once, validates the response, and exposes ws URL', async () => {
  const { session, socket, calls } = await setup({ mode: 'create', roomId: null });
  assert.equal(calls.length, 1); assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][0].pathname, '/api/rooms'); assert.equal(socket.url, `ws://example.test/api/rooms/${roomId}/ws`);
  assert.equal(session.getConnectionInfo().roomId, roomId);
});

test('malformed created room is rejected before a socket opens', async () => {
  FakeSocket.instances = [];
  await assert.rejects(createNetworkGameSession({ mode: 'create', origin: 'http://example.test', WebSocketImpl: FakeSocket,
    fetchImpl: async () => ({ ok: true, json: async () => ({ roomId: 'bad', capacity: 2 }) }) }), /malformed/);
  assert.equal(FakeSocket.instances.length, 0);
});

test('join does not fetch and https selects wss', async () => {
  const { socket, calls } = await setup({ origin: 'https://example.test' });
  assert.equal(calls.length, 0); assert.equal(socket.url, `wss://example.test/api/rooms/${roomId}/ws`);
});

test('welcome captures authoritative slot and connection metadata while waiting', async () => {
  const { session } = await setup(); const info = session.getConnectionInfo();
  assert.equal(session.getStatus(), SessionStatus.WAITING); assert.equal(info.slot, 2); assert.equal(info.connectionId, 'server-choice');
  info.slot = 1; assert.equal(session.getConnectionInfo().slot, 2); assert.equal('socket' in info, false);
});

test('frames are copied, events are owned, and ticks increase monotonically', async () => {
  const { session, socket } = await setup(); socket.emit('message', frame('m1', 0, 'active', [{ type: 'shot-fired', slot: 1 }]));
  assert.equal(session.getStatus(), SessionStatus.READY); const first = session.getSnapshot(); first.players[0].x = 999;
  assert.equal(session.getSnapshot().players[0].x, 145);
  const events = session.drainEvents(); events[0].type = 'changed'; assert.deepEqual(session.drainEvents(), []);
  socket.emit('message', frame('m1', 0)); socket.emit('message', frame('m1', 1)); socket.emit('message', frame('m1', 0));
  assert.equal(session.getSnapshot().tick, 1); assert.equal(session.getConnectionInfo().lastServerTick, 1);
});

test('update never predicts or sends browser timing', async () => {
  const { session, socket } = await setup(); socket.emit('message', frame('m1', 0)); const before = session.getSnapshot();
  session.submit({ type: 'move', x: 1, y: 0 }); session.update(999);
  assert.deepEqual(session.getSnapshot(), before); assert.deepEqual(socket.sent[0], { version: 2, type: 'input', matchId: 'm1', seq: 0,
    command: { type: 'move', x: 1, y: 0 } });
  for (const forbidden of ['dt', 'time', 'timestamp', 'slot', 'hp', 'damage', 'bossHp']) assert.equal(forbidden in socket.sent[0], false);
});

test('persistent intents dedupe while changed values preserve edge order', async () => {
  const { session, socket } = await setup(); socket.emit('message', frame('m1', 0));
  session.submit({ type: 'move', x: 1, y: 0 }); session.submit({ type: 'move', x: 1, y: 0 });
  session.submit({ type: 'dash' }); session.submit({ type: 'grenade' }); session.submit({ type: 'dash' });
  session.submit({ type: 'move', x: -1, y: 0 }); session.submit({ type: 'fire', active: true }); session.submit({ type: 'fire', active: true });
  session.update(0);
  assert.deepEqual(socket.sent.map(item => item.command.type), ['move', 'dash', 'grenade', 'dash', 'move', 'fire']);
  assert.deepEqual(socket.sent.map(item => item.seq), [0, 1, 2, 3, 4, 5]);
});

test('waiting retains persistent intent but discards edge actions', async () => {
  const { session, socket } = await setup(); session.submit({ type: 'move', x: 1, y: 0 }); session.submit({ type: 'fire', active: true });
  session.submit({ type: 'dash' }); session.submit({ type: 'grenade' }); session.update(12); assert.equal(socket.sent.length, 0);
  socket.emit('message', frame('new', 0)); session.update(0);
  assert.deepEqual(socket.sent.map(item => item.command.type), ['move', 'fire']);
});

test('abort waits, rejects old frames, accepts replacement, and preserves sequence', async () => {
  const { session, socket } = await setup(); socket.emit('message', frame('old', 0));
  session.submit({ type: 'dash' }); session.update(0); socket.emit('message', message('match-aborted', { matchId: 'old', reason: 'player-left' }));
  assert.equal(session.getStatus(), SessionStatus.WAITING); assert.equal(session.getConnectionInfo().connectionId, 'server-choice');
  assert.deepEqual(session.drainEvents(), [{ type: 'match-aborted', reason: 'player-left' }]);
  socket.emit('message', frame('old', 1)); assert.equal(session.getConnectionInfo().matchId, null);
  socket.emit('message', frame('fresh', 0)); session.submit({ type: 'grenade' }); session.update(0);
  assert.equal(socket.sent.at(-1).seq, 1); assert.equal(session.getConnectionInfo().matchId, 'fresh');
});

test('ACK bookkeeping accepts only increasing ACKs for the current match', async () => {
  const { session, socket } = await setup(); socket.emit('message', frame('m1', 0));
  socket.emit('message', message('input-ack', { matchId: 'other', seq: 9 })); assert.equal(session.getConnectionInfo().lastAckSeq, null);
  socket.emit('message', message('input-ack', { matchId: 'm1', seq: 4 })); socket.emit('message', message('input-ack', { matchId: 'm1', seq: 3 }));
  assert.equal(session.getConnectionInfo().lastAckSeq, 4);
});

test('terminal frames complete and stop new gameplay input', async () => {
  const { session, socket } = await setup(); socket.emit('message', frame('m1', 0, 'won'));
  assert.equal(session.getStatus(), SessionStatus.COMPLETE); session.submit({ type: 'dash' }); session.update(0); assert.equal(socket.sent.length, 0);
});

test('a local death frame drops queued input and rejects every gameplay command', async () => {
  const { session, socket } = await setup(); socket.emit('message', frame('m1', 0));
  session.submit({ type: 'move', x: 1, y: 0 }); session.submit({ type: 'fire', active: true });
  session.submit({ type: 'dash' }); session.submit({ type: 'grenade' });
  const dead = snapshot(1); dead.players.find(player => player.slot === 2).alive = false;
  socket.emit('message', message('state-frame', { matchId: 'm1', tick: 1, snapshot: dead, events: [] }));
  session.update(0); assert.equal(socket.sent.length, 0);
  for (const command of [{ type: 'move', x: -1, y: 0 }, { type: 'fire', active: false }, { type: 'dash' }, { type: 'grenade' }]) {
    assert.equal(session.submit(command), false);
  }
  session.update(0); assert.equal(socket.sent.length, 0); assert.equal(session.getStatus(), SessionStatus.READY);
});

test('a malformed authoritative frame fails closed at the session boundary', async () => {
  const { session, socket } = await setup(); const malformed = snapshot(0); delete malformed.boss;
  socket.emit('message', message('state-frame', { matchId: 'm1', tick: 0, snapshot: malformed, events: [] }));
  assert.equal(session.getStatus(), SessionStatus.ERROR); assert.equal(socket.closeArgs[0], 1002);
  assert.equal(session.drainEvents()[0].type, 'network-error');
});

test('server errors are copied lifecycle events', async () => {
  const { session, socket } = await setup(); socket.emit('message', message('error', { code: 'stale-match', message: 'No match.' }));
  const events = session.drainEvents(); assert.deepEqual(events, [{ type: 'network-error', code: 'stale-match', message: 'No match.' }]);
  events[0].code = 'changed'; assert.deepEqual(session.drainEvents(), []); assert.equal(session.getStatus(), SessionStatus.WAITING);
});

test('unsupported protocol and unexpected close fail without reconnect', async () => {
  const first = await setup(); first.socket.emit('message', { version: 1, type: 'roster' }); assert.equal(first.session.getStatus(), SessionStatus.ERROR);
  const second = await setup(); second.socket.emit('close', {}); assert.equal(second.session.getStatus(), SessionStatus.ERROR);
  assert.deepEqual(second.session.drainEvents(), [{ type: 'network-disconnected', reason: 'socket-closed' }]);
});

test('explicit close clears and closes normally', async () => {
  const { session, socket } = await setup(); session.close(); assert.equal(session.getStatus(), SessionStatus.CLOSED);
  assert.deepEqual(socket.closeArgs, [1000, 'Session closed']); session.close();
});
