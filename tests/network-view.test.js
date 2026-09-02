import assert from 'node:assert/strict';
import test from 'node:test';
import { createNetworkView } from '../src/game/presentation/networkView.js';

const source = { tick: 0, status: 'active', players: [{ slot: 1, alive: true, x: 10 }, { slot: 2, alive: true, x: 20 }],
  boss: {}, bullets: [], enemyBullets: [], dangerZones: [], medkits: [], nextEntityId: 1 };

test('slot one projection selects player one without mutating authority', () => {
  const original = structuredClone(source), view = createNetworkView(source, 1);
  assert.equal(view.player.slot, 1); assert.deepEqual(view.remotePlayers.map(player => player.slot), [2]);
  assert.equal(view.stage, 2); assert.deepEqual(source, original); view.player.x = 99; assert.equal(source.players[0].x, 10);
});

test('slot two projection selects player two and derives terminal flags', () => {
  const terminal = structuredClone(source); terminal.status = 'won'; terminal.players[1].alive = false;
  const view = createNetworkView(terminal, 2); assert.equal(view.player.slot, 2); assert.deepEqual(view.remotePlayers.map(player => player.slot), [1]);
  assert.equal(view.dead, true); assert.equal(view.won, true); assert.deepEqual(view.enemies, []);
});
