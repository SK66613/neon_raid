import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthoritativeMatchHost } from '../server/room/AuthoritativeMatchHost.js';
import { createSeededRng } from '../src/game/simulation/rng.js';

test('host creates copied tick-zero and fixed-step authoritative frames', () => {
  const host = new AuthoritativeMatchHost({ matchId: 'one', rng: createSeededRng(7) });
  const initial = host.initialFrame();
  assert.equal(initial.tick, 0); assert.equal(initial.snapshot.tick, 0);
  assert.ok(initial.events.some(event => event.type === 'match-started'));
  initial.snapshot.players[0].hp = -1;
  const next = host.tick(); assert.equal(next.tick, 1); assert.notEqual(next.snapshot.players[0].hp, -1);
  assert.equal(host.getStatus(), 'active'); assert.equal(host.getMatchId(), 'one');
  assert.equal('simulation' in host, false);
});

test('commands use the host slot and seeded hosts remain deterministic', () => {
  const make = id => new AuthoritativeMatchHost({ matchId: id, rng: createSeededRng(19) });
  const a = make('same'), b = make('same'); a.initialFrame(); b.initialFrame();
  const command = { type: 'move', x: 1, y: 0 };
  assert.equal(a.applyCommand(1, command), true); assert.equal(b.applyCommand(1, command), true);
  assert.throws(() => a.applyCommand(2, { ...command, slot: 1 }), TypeError);
  for (let i = 0; i < 40; i++) assert.deepEqual(a.tick(), b.tick());
});
