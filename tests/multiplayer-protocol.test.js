import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MULTIPLAYER_PROTOCOL_VERSION,
  createErrorMessage,
  createInputAckMessage,
  createRosterMessage,
  createWelcomeMessage,
  validateCommand,
  validateInputMessage,
} from '../src/game/network/protocol.js';

const input = (command, overrides = {}) => ({ version: 1, type: 'input', seq: 0, command, ...overrides });

test('protocol version one is supported and other versions are rejected', () => {
  assert.equal(MULTIPLAYER_PROTOCOL_VERSION, 1);
  assert.equal(validateInputMessage(input({ type: 'dash' })).ok, true);
  assert.deepEqual(validateInputMessage(input({ type: 'dash' }, { version: 2 })), {
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
    { version: 1, type: 'roster', seq: 0, command: { type: 'dash' } },
  ]) assert.equal(validateInputMessage(message).ok, false);
});

test('server envelope constructors produce serializable versioned messages', () => {
  const messages = [
    createWelcomeMessage('room', 'connection', 1, 2),
    createInputAckMessage(7),
    createRosterMessage(2, [{ connectionId: 'connection', slot: 1, lastInputSeq: 9 }]),
    createErrorMessage('invalid-json', 'Message must be valid JSON.'),
  ];
  for (const message of messages) {
    assert.equal(message.version, MULTIPLAYER_PROTOCOL_VERSION);
    assert.deepEqual(JSON.parse(JSON.stringify(message)), message);
  }
  assert.deepEqual(messages[2].players, [{ connectionId: 'connection', slot: 1 }]);
});
