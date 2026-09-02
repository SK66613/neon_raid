import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MULTIPLAYER_PROTOCOL_VERSION,
  createErrorMessage,
  createInputAckMessage,
  createMatchAbortedMessage,
  createStateFrameMessage,
  createRosterMessage,
  createWelcomeMessage,
  validateCommand,
  validateInputMessage,
  validateServerMessage,
} from '../src/game/network/protocol.js';
import { createMultiplayerBossState } from '../src/game/multiplayer/createMultiplayerBossState.js';

const roomId = 'b'.repeat(64);
const canonicalSnapshot = (tick = 0) => ({ ...createMultiplayerBossState(), tick });

const input = (command, overrides = {}) => ({ version: 2, type: 'input', matchId: 'match', seq: 0, command, ...overrides });

test('protocol version two is supported and version one is rejected', () => {
  assert.equal(MULTIPLAYER_PROTOCOL_VERSION, 2);
  assert.equal(validateInputMessage(input({ type: 'dash' })).ok, true);
  assert.deepEqual(validateInputMessage(input({ type: 'dash' }, { version: 1 })), {
    ok: false, code: 'unsupported-version',
  });
});

test('only exact move, fire, dash, and grenade intent shapes validate', () => {
  for (const command of [
    { type: 'move', x: -1, y: 1 }, { type: 'move', x: 0, y: 0 }, { type: 'move', x: 1, y: -1 },
    { type: 'fire', active: true }, { type: 'fire', active: false }, { type: 'dash' }, { type: 'grenade' },
  ]) assert.equal(validateCommand(command), true);

  for (const command of [
    { type: 'move', x: 2, y: 0 }, { type: 'move', x: 0.5, y: 0 }, { type: 'move', x: NaN, y: 0 },
    { type: 'move', x: Infinity, y: 0 }, { type: 'fire', active: 1 }, { type: 'dash', dt: 1 },
    { type: 'grenade', damage: 10 }, null, [], 'dash',
  ]) assert.equal(validateCommand(command), false);
});

test('input envelopes reject malformed JSON-equivalent values and client timing', () => {
  for (const message of [
    null, [], 'input', input({ type: 'dash' }, { seq: -1 }), input({ type: 'dash' }, { seq: 1.5 }),
    input({ type: 'dash' }, { seq: Number.MAX_SAFE_INTEGER + 1 }),
    { ...input({ type: 'dash' }), dt: 0.016 },
    { version: 2, type: 'roster', matchId: 'match', seq: 0, command: { type: 'dash' } },
    { version: 2, type: 'input', seq: 0, command: { type: 'dash' } },
    input({ type: 'dash' }, { matchId: '' }), { ...input({ type: 'dash' }), slot: 2 },
  ]) assert.equal(validateInputMessage(message).ok, false);
});

test('server envelope constructors produce serializable versioned messages', () => {
  const messages = [
    createWelcomeMessage('room', 'connection', 1, 2),
    createInputAckMessage('match', 7),
    createMatchAbortedMessage('match', 'player-left'),
    createStateFrameMessage('match', { tick: 3, status: 'active' }, [{ type: 'event' }]),
    createRosterMessage(2, [{ connectionId: 'connection', slot: 1, lastInputSeq: 9 }]),
    createErrorMessage('invalid-json', 'Message must be valid JSON.'),
  ];
  for (const message of messages) {
    assert.equal(message.version, MULTIPLAYER_PROTOCOL_VERSION);
    assert.deepEqual(JSON.parse(JSON.stringify(message)), message);
  }
  assert.deepEqual(messages[4].players, [{ connectionId: 'connection', slot: 1 }]);
  assert.deepEqual(messages[1], { version: 2, type: 'input-ack', matchId: 'match', seq: 7 });
  assert.equal(messages[3].tick, messages[3].snapshot.tick);
});

test('state frames copy their JSON payloads and reject invalid data', () => {
  const snapshot = { tick: 0, values: [1] }, events = [{ type: 'match-started' }];
  const frame = createStateFrameMessage('match', snapshot, events);
  snapshot.values.push(2); events[0].type = 'changed';
  assert.deepEqual(frame.snapshot.values, [1]); assert.equal(frame.events[0].type, 'match-started');
  assert.throws(() => createStateFrameMessage('match', { tick: NaN }, []), TypeError);
  assert.throws(() => createStateFrameMessage('match', { tick: 0, bad: new Set() }, []), TypeError);
  assert.throws(() => createStateFrameMessage('match', { tick: 0 }, new Map()), TypeError);
});

test('client validates each exact server message envelope', () => {
  const snapshot = canonicalSnapshot();
  for (const message of [
    createWelcomeMessage(roomId, 'connection', 1, 2), createRosterMessage(2, [{ connectionId: 'connection', slot: 1 }]),
    createInputAckMessage('match', 0), createStateFrameMessage('match', snapshot, []),
    createMatchAbortedMessage('match', 'player-left'), createErrorMessage('stale-match', 'Stale match.'),
  ]) assert.equal(validateServerMessage(message).ok, true, message.type);
});

test('client rejects versions, unknown types, malformed frames, non-JSON and extra fields', () => {
  const snapshot = canonicalSnapshot(2);
  const valid = { version: 2, type: 'state-frame', matchId: 'match', tick: 2, snapshot, events: [] };
  for (const message of [
    { ...createWelcomeMessage(roomId, 'connection', 1, 2), version: 1 },
    { version: 2, type: 'future' }, { ...valid, matchId: '' }, { ...valid, tick: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, tick: 1 }, { ...valid, snapshot: { ...snapshot, players: [snapshot.players[0]] } },
    { ...valid, snapshot: { ...snapshot, players: [snapshot.players[0], { ...snapshot.players[1], x: NaN }] } },
    { ...valid, extra: true }, { ...createInputAckMessage('match', 1), extra: true },
  ]) assert.equal(validateServerMessage(message).ok, false);
});

test('client rejects incomplete or invalid canonical snapshot state', () => {
  const invalidSnapshots = [];
  const without = key => { const value = canonicalSnapshot(); delete value[key]; return value; };
  for (const key of ['status', 'boss', 'bullets', 'enemyBullets', 'dangerZones', 'medkits']) invalidSnapshots.push(without(key));
  invalidSnapshots.push(
    { ...canonicalSnapshot(), status: 'paused' },
    { ...canonicalSnapshot(), boss: {} },
    { ...canonicalSnapshot(), players: canonicalSnapshot().players.map(({ maxHp, ...player }) => player) },
    { ...canonicalSnapshot(), players: canonicalSnapshot().players.map(({ maxArmor, ...player }) => player) },
    { ...canonicalSnapshot(), players: canonicalSnapshot().players.map((player, index) => index ? player : { ...player, aimDirection: 'up' }) },
    { ...canonicalSnapshot(), players: canonicalSnapshot().players.map(player => ({ ...player, slot: 1 })) },
    { ...canonicalSnapshot(), boss: { ...canonicalSnapshot().boss, hp: Infinity } },
    { ...canonicalSnapshot(), players: canonicalSnapshot().players.map((player, index) => index ? player : { ...player, speed: NaN }) },
    { ...canonicalSnapshot(), bullets: [{ id: 'bullet-1', ownerSlot: 3, x: 1, y: 2, vx: 3, vy: 4, life: 1, damage: 10 }] },
    { ...canonicalSnapshot(), enemyBullets: [{ id: 'enemy-1', x: 1, y: 2, vx: 3, vy: 4, life: 1, radius: 4, damage: 10, targetSlot: 3 }] },
    { ...canonicalSnapshot(), enemyBullets: [{ id: 'enemy-1', x: Infinity, y: 2, vx: 3, vy: 4, life: 1, radius: 4, damage: 10 }] },
    { ...canonicalSnapshot(), medkits: [{ id: '', x: 1, y: 2, alive: true }] },
    { ...canonicalSnapshot(), dangerZones: [{ id: 'zone-1', x: 1, y: 2, radius: 20, delay: 1, life: 2, exploded: false, targetSlot: 7 }] },
  );
  for (const snapshot of invalidSnapshots) {
    const frame = { version: 2, type: 'state-frame', matchId: 'match', tick: snapshot.tick, snapshot, events: [] };
    assert.deepEqual(validateServerMessage(frame), { ok: false, code: 'invalid-message' });
  }
});
