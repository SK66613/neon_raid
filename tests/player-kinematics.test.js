import assert from 'node:assert/strict';
import test from 'node:test';
import { PLAYER_CONFIG } from '../src/game/multiplayer/config.js';
import { calculateDash, integratePlayerMovement, movePlayerAxisSeparated,
  normalizeMovement } from '../src/game/multiplayer/playerKinematics.js';

const player = (patch = {}) => ({ x: 145, y: 468, radius: 11, vx: 0, vy: 0,
  speed: PLAYER_CONFIG.speed, moveX: 0, moveY: 0, lastDirection: 'n', dashTimer: 0, ...patch });

test('diagonal movement is normalized and chooses the matching direction', () => {
  const vector = normalizeMovement(1, 1);
  assert.ok(Math.abs(Math.hypot(vector.x, vector.y) - 1) < 1e-12);
  assert.equal(integratePlayerMovement(player({ moveX: 1, moveY: 1 }), 0.01).lastDirection, 'se');
});

test('acceleration, friction, and maximum speed preserve authoritative behavior', () => {
  let state = player({ moveX: 1 });
  state = { ...state, ...integratePlayerMovement(state, 0.01) };
  assert.equal(state.vx, 520 * 0.01 * (1 - 8 * 0.01));
  state = player({ vx: 1000, vy: 0 });
  assert.equal(integratePlayerMovement(state, 0.01).vx, PLAYER_CONFIG.speed);
  state = player({ vx: 10, moveX: 0 });
  assert.ok(Math.abs(integratePlayerMovement(state, 0.01).vx - 9.2) < 1e-12);
});

test('arena boundaries and axis-separated collision retain the legal axis', () => {
  const result = movePlayerAxisSeparated(player({ x: 24, y: 300 }), -2, 5);
  assert.deepEqual(result, { x: 24, y: 305 });
});

test('dash uses normalized geometry and fallback direction', () => {
  const diagonal = calculateDash(player({ x: 180, y: 300, moveX: 1, moveY: 1 }));
  assert.ok(Math.abs(diagonal.x - (180 + 62 / Math.sqrt(2))) < 1e-10);
  assert.ok(Math.abs(diagonal.y - (300 + 62 / Math.sqrt(2))) < 1e-10);
  assert.deepEqual(calculateDash(player({ x: 180, y: 300, lastDirection: 'e' })),
    { x: 242, y: 300, blocked: false });
});

test('blocked dash destination leaves position unchanged', () => {
  assert.deepEqual(calculateDash(player({ x: 30, y: 300, moveX: -1 })),
    { x: 30, y: 300, blocked: true });
});
