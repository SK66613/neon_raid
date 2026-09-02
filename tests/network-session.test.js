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

test('completed room vacancy waits for a replacement and accepts a fresh match without resetting sequence', async () => {
  const { session, socket } = await setup(); socket.emit('message', frame('match-a', 0));
  session.submit({ type: 'dash' }); session.update(0); assert.equal(socket.sent[0].seq, 0);
  socket.emit('message', frame('match-a', 1, 'won'));
  assert.equal(session.getStatus(), SessionStatus.COMPLETE); assert.equal(session.getSnapshot().status, 'won');

  socket.emit('message', message('roster', { capacity: 2, players: [
    { connectionId: 'peer-one', slot: 1 }, { connectionId: 'server-choice', slot: 2 },
  ] }));
  assert.equal(session.getStatus(), SessionStatus.COMPLETE); assert.equal(session.getConnectionInfo().matchId, 'match-a');

  socket.emit('message', message('roster', { capacity: 2, players: [{ connectionId: 'server-choice', slot: 2 }] }));
  assert.equal(session.getStatus(), SessionStatus.WAITING); assert.equal(session.getSnapshot(), null);
  assert.deepEqual(session.getConnectionInfo(), { roomId, connectionId: 'server-choice', slot: 2, capacity: 2,
    matchId: null, peerCount: 1, lastServerTick: null, lastAckSeq: null });

  socket.emit('message', frame('match-a', 2));
  assert.equal(session.getStatus(), SessionStatus.WAITING); assert.equal(session.getSnapshot(), null);
  socket.emit('message', frame('match-b', 0));
  assert.equal(session.getStatus(), SessionStatus.READY); assert.equal(session.getConnectionInfo().matchId, 'match-b');
  assert.equal(session.getConnectionInfo().lastServerTick, 0);
  session.submit({ type: 'grenade' }); session.update(0);
  assert.equal(socket.sent.at(-1).seq, 1); assert.equal(socket.sent.at(-1).matchId, 'match-b');
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

test('authoritative snapshot is immutable while local render movement predicts safely', async () => {
  const { session, socket } = await setup(); socket.emit('message', frame('m1', 0));
  const before = session.getSnapshot(), localBefore = before.players.find(player => player.slot === 2);
  session.submit({ type: 'move', x: 1, y: 0 }); session.update(999);
  assert.deepEqual(session.getSnapshot(), before);
  assert.ok(session.getRenderSnapshot().players.find(player => player.slot === 2).x > localBefore.x);
});

test('prediction never changes resources or synthesizes gameplay entities', async () => {
  const { session, socket } = await setup(); const initial = snapshot(0);
  initial.players[1].hp = 73; initial.players[1].armor = 22; initial.players[1].ammo = 7;
  initial.players[1].reserveAmmo = 19; initial.players[1].grenades = 1; initial.boss.hp = 777;
  socket.emit('message', message('state-frame', { matchId: 'm1', tick: 0, snapshot: initial, events: [] }));
  for (const command of [{ type: 'move', x: 1, y: 0 }, { type: 'dash' },
    { type: 'fire', active: true }, { type: 'grenade' }]) session.submit(command);
  session.update(0.02); const render = session.getRenderSnapshot(), local = render.players[1];
  assert.deepEqual([local.hp, local.armor, local.ammo, local.reserveAmmo, local.grenades, render.boss.hp], [73, 22, 7, 19, 1, 777]);
  assert.deepEqual(render.bullets, []); assert.deepEqual(render.enemyBullets, []);
});

test('remote Raider, boss, and stable projectiles interpolate without authority changes or extrapolation', async () => {
  const { session, socket } = await setup(); const first = snapshot(0), second = snapshot(1);
  first.players[0].x = 100; second.players[0].x = 130; first.boss.x = 160; second.boss.x = 190;
  first.boss.hp = 900; second.boss.hp = 800; second.boss.phase = 2;
  first.bullets = [{ id: 'bullet-9', ownerSlot: 1, x: 10, y: 20, vx: 30, vy: 0, life: 1, damage: 17 }];
  second.bullets = [{ ...first.bullets[0], x: 20 }];
  first.enemyBullets = [{ id: 'enemy-bullet-8', x: 50, y: 60, vx: 0, vy: 30, life: 1, radius: 4, damage: 9 }];
  second.enemyBullets = [{ ...first.enemyBullets[0], y: 70 }];
  socket.emit('message', message('state-frame', { matchId: 'm1', tick: 0, snapshot: first, events: [] }));
  socket.emit('message', message('state-frame', { matchId: 'm1', tick: 1, snapshot: second, events: [] }));
  session.update(1 / 60); let render = session.getRenderSnapshot();
  assert.equal(render.players[0].x, 115); assert.equal(render.boss.x, 175);
  assert.deepEqual([render.boss.hp, render.boss.phase], [800, 2]);
  assert.equal(render.bullets[0].x, 15); assert.equal(render.enemyBullets[0].y, 65);
  session.update(10); render = session.getRenderSnapshot();
  assert.equal(render.players[0].x, 130); assert.equal(render.boss.x, 190);
  assert.equal(render.bullets[0].x, 20); assert.equal(render.enemyBullets[0].y, 70);
});

test('local player is predicted rather than remote-interpolated and render copies are owned', async () => {
  const { session, socket } = await setup(); const first = snapshot(0), second = snapshot(1);
  first.players[1].x = 200; second.players[1].x = 210;
  socket.emit('message', message('state-frame', { matchId: 'm1', tick: 0, snapshot: first, events: [] }));
  socket.emit('message', message('state-frame', { matchId: 'm1', tick: 1, snapshot: second, events: [] }));
  assert.equal(session.getRenderSnapshot().players[1].x, 200); // soft reconciliation preserves the prior visible position, not remote alpha.
  const render = session.getRenderSnapshot(); render.players[1].x = 999; render.boss.hp = 0;
  assert.notEqual(session.getRenderSnapshot().players[1].x, 999); assert.equal(session.getSnapshot().boss.hp, 1200);
});

test('small reconciliation converges smoothly while large divergence hard snaps', async () => {
  const { session, socket } = await setup(); socket.emit('message', frame('m1', 0));
  const small = snapshot(1); small.players[1].x += 10;
  socket.emit('message', message('state-frame', { matchId: 'm1', tick: 1, snapshot: small, events: [] }));
  assert.equal(session.getRenderSnapshot().players[1].x, 215);
  session.update(0.1); assert.ok(session.getRenderSnapshot().players[1].x > 215);
  const large = snapshot(2); large.players[1].x = 320;
  socket.emit('message', message('state-frame', { matchId: 'm1', tick: 2, snapshot: large, events: [] }));
  assert.equal(session.getRenderSnapshot().players[1].x, 320);
});

test('frame ACK boundary retains an unreflected dash and retires a reflected dash', async () => {
  const { session, socket } = await setup(); socket.emit('message', frame('m1', 0));
  session.submit({ type: 'move', x: 1, y: 0 }); session.submit({ type: 'dash' }); session.update(0);
  const unreflected = snapshot(1);
  socket.emit('message', message('input-ack', { matchId: 'm1', seq: 0 }));
  socket.emit('message', message('state-frame', { matchId: 'm1', tick: 1, snapshot: unreflected, events: [] }));
  assert.equal(session.getRenderSnapshot().players[1].x, 277);
  const reflected = snapshot(2); reflected.players[1].x = 277;
  socket.emit('message', message('input-ack', { matchId: 'm1', seq: 1 }));
  socket.emit('message', message('state-frame', { matchId: 'm1', tick: 2, snapshot: reflected, events: [] }));
  assert.equal(session.getRenderSnapshot().players[1].x, 277);
});

test('death, abort, and replacement match clear old presentation state', async () => {
  const { session, socket } = await setup(); socket.emit('message', frame('old', 0));
  session.submit({ type: 'move', x: 1, y: 0 }); session.update(0.05);
  const dead = snapshot(1); dead.players[1].alive = false;
  socket.emit('message', message('state-frame', { matchId: 'old', tick: 1, snapshot: dead, events: [] }));
  session.update(0.1); assert.equal(session.getRenderSnapshot().players[1].x, dead.players[1].x);
  socket.emit('message', message('match-aborted', { matchId: 'old', reason: 'player-left' }));
  assert.equal(session.getRenderSnapshot(), null);
  const fresh = snapshot(0); fresh.players[1].x = 100;
  socket.emit('message', message('state-frame', { matchId: 'fresh', tick: 0, snapshot: fresh, events: [] }));
  assert.equal(session.getRenderSnapshot().players[1].x, 100);
});
