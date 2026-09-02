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

const roomId = 'b'.repeat(64);
const canonicalPlayer = slot => ({ slot, x: 10, y: 20, radius: 12, vx: 0, vy: 0, hp: 100, armor: 40,
  ammo: 24, reserveAmmo: 96, grenades: 3, dashCooldown: 0, hitTimer: 0, dashTimer: 0,
  alive: true, firing: false, lastDirection: 'n', aimDirection: 'n' });

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
  const snapshot = { tick: 0, status: 'active', players: [canonicalPlayer(1), canonicalPlayer(2)], boss: {},
    bullets: [], enemyBullets: [], dangerZones: [], medkits: [], nextEntityId: 1 };
  for (const message of [
    createWelcomeMessage(roomId, 'connection', 1, 2), createRosterMessage(2, [{ connectionId: 'connection', slot: 1 }]),
    createInputAckMessage('match', 0), createStateFrameMessage('match', snapshot, []),
    createMatchAbortedMessage('match', 'player-left'), createErrorMessage('stale-match', 'Stale match.'),
  ]) assert.equal(validateServerMessage(message).ok, true, message.type);
});

test('client rejects versions, unknown types, malformed frames, non-JSON and extra fields', () => {
  const snapshot = { tick: 2, status: 'active', players: [canonicalPlayer(1), canonicalPlayer(2)], boss: {} };
  const valid = { version: 2, type: 'state-frame', matchId: 'match', tick: 2, snapshot, events: [] };
  for (const message of [
    { ...createWelcomeMessage(roomId, 'connection', 1, 2), version: 1 },
    { version: 2, type: 'future' }, { ...valid, matchId: '' }, { ...valid, tick: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, tick: 1 }, { ...valid, snapshot: { ...snapshot, players: [canonicalPlayer(1)] } },
    { ...valid, snapshot: { ...snapshot, players: [canonicalPlayer(1), { ...canonicalPlayer(2), x: NaN }] } },
    { ...valid, extra: true }, { ...createInputAckMessage('match', 1), extra: true },
  ]) assert.equal(validateServerMessage(message).ok, false);
});
