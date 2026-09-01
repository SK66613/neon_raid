import assert from 'node:assert/strict';
import test from 'node:test';
import { GameSimulation } from '../src/game/simulation/GameSimulation.js';
import { CommandType, fireCommand, moveCommand } from '../src/game/simulation/commands.js';
import { createSeededRng } from '../src/game/simulation/rng.js';
import { SessionStatus } from '../src/game/session/GameSession.js';
import { LocalGameSession } from '../src/game/session/LocalGameSession.js';
import { createCommandMessage, createFrameMessage, PROTOCOL_VERSION } from '../src/game/session/protocol.js';

const create = (seed = 7) => new LocalGameSession({ rng: createSeededRng(seed) });
const advance = (session, seconds) => { for (let elapsed = 0; elapsed < seconds; elapsed += .02) session.update(.02); };

test('local session starts ready with the simulation baseline', () => {
  const session = create(), simulation = new GameSimulation({ rng: createSeededRng(7) });
  assert.equal(session.getStatus(), SessionStatus.READY);
  assert.deepEqual(session.getSnapshot(), simulation.getSnapshot());
});

test('queued move commands advance on the next browser-dt update', () => {
  const session = create(), x = session.getSnapshot().player.x;
  session.submit(moveCommand(1, 0));
  session.update(.02);
  assert.ok(session.getSnapshot().player.x > x);
});

test('fire consumes ammo and events cross the session boundary', () => {
  const session = create();
  session.submit(fireCommand(true));
  session.update(0);
  assert.equal(session.getSnapshot().player.ammo, 27);
  assert.ok(session.drainEvents().some(event => event.type === 'shot-fired'));
  assert.deepEqual(session.drainEvents(), []);
});

test('snapshots are copies and cannot mutate canonical state', () => {
  const session = create(), snapshot = session.getSnapshot();
  snapshot.player.hp = 1;
  assert.equal(session.getSnapshot().player.hp, 100);
});

test('commands, protocol messages, snapshots, and events are JSON serializable', () => {
  const session = create(), command = fireCommand(true);
  assert.doesNotThrow(() => JSON.stringify(command));
  assert.equal(createCommandMessage(command).type, 'command');
  assert.equal(createFrameMessage(.016, [command]).version, PROTOCOL_VERSION);
  session.submit(command);
  session.update(.016);
  assert.doesNotThrow(() => JSON.stringify(session.getSnapshot()));
  assert.doesNotThrow(() => JSON.stringify(session.drainEvents()));
});

test('session rejects values that cannot cross a JSON transport', () => {
  const session = create();
  assert.throws(() => session.submit({ type: CommandType.MOVE, callback() {} }), /JSON values/);
});

test('deterministic RNG remains repeatable through local sessions', () => {
  const run = () => {
    const session = create(99);
    for (let i = 0; i < 150; i++) {
      session.submit(moveCommand(i < 70 ? 1 : 0, i > 80 ? -1 : 0));
      session.submit(fireCommand(i % 20 < 8));
      session.update(.016);
    }
    return session.getSnapshot();
  };
  assert.deepEqual(run(), run());
});

test('restart is delivered as a regular gameplay command', () => {
  const session = create();
  session.submit(moveCommand(1, 0));
  advance(session, .2);
  session.submit({ type: CommandType.RESTART });
  session.update(0);
  assert.equal(session.getSnapshot().player.x, 180);
  assert.deepEqual(session.drainEvents().at(-1), { type: 'wave-started', wave: 1 });
});

test('test adapter reaches Warden-X without exposing mutable state', () => {
  const session = create(), testAdapter = session.createTestAdapter();
  testAdapter.skipToBoss();
  const snapshot = session.getSnapshot();
  assert.equal(snapshot.stage, 2);
  snapshot.boss.hp = 1;
  assert.equal(session.getSnapshot().boss.hp, 1200);
  assert.equal('simulation' in testAdapter, false);
});

test('closing is idempotent and clearly rejects commands and updates', () => {
  const session = create();
  session.close();
  session.close();
  assert.equal(session.getStatus(), SessionStatus.CLOSED);
  assert.throws(() => session.submit(moveCommand(1, 0)), /closed/);
  assert.throws(() => session.update(.016), /closed/);
});
