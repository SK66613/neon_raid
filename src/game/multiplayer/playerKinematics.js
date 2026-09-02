import { ARENA, DASH_DESTINATION_BOUNDS, PLAYER_CONFIG } from './config.js';

export const PLAYER_DIRECTIONS = Object.freeze(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function normalizeMovement(x, y) {
  const length = Math.hypot(x, y);
  return length ? { x: x / length, y: y / length } : { x: 0, y: 0 };
}

export function movementDirection(x, y, fallback = 'n') {
  if (Math.hypot(x, y) < 0.001) return fallback;
  const index = Math.round((Math.atan2(y, x) + Math.PI / 2) / (Math.PI / 4));
  return PLAYER_DIRECTIONS[((index % 8) + 8) % 8];
}

export function isPlayerBlocked(player, x, y, arena = ARENA) {
  return x - player.radius < arena.minX || x + player.radius > arena.maxX
    || y - player.radius < arena.minY || y + player.radius > arena.maxY;
}

export function movePlayerAxisSeparated(player, dx, dy, arena = ARENA) {
  let x = player.x + dx;
  if (isPlayerBlocked(player, x, player.y, arena)) x = player.x;
  let y = player.y + dy;
  if (isPlayerBlocked(player, x, y, arena)) y = player.y;
  return { x, y };
}

export function integratePlayerMovement(player, dt, config = PLAYER_CONFIG, arena = ARENA) {
  const movement = normalizeMovement(player.moveX, player.moveY);
  let vx = player.vx, vy = player.vy;
  let lastDirection = player.lastDirection;
  if (movement.x || movement.y) {
    lastDirection = movementDirection(movement.x, movement.y, lastDirection);
    vx += movement.x * config.acceleration * dt;
    vy += movement.y * config.acceleration * dt;
  }
  vx *= Math.max(0, 1 - config.friction * dt);
  vy *= Math.max(0, 1 - config.friction * dt);
  const speed = Math.hypot(vx, vy);
  const maximum = player.speed * (player.dashTimer > 0 ? 1.6 : 1);
  if (speed > maximum) { vx = vx / speed * maximum; vy = vy / speed * maximum; }
  const position = movePlayerAxisSeparated(player, vx * dt, vy * dt, arena);
  return { ...position, vx, vy, lastDirection };
}

export function calculateDash(player, config = PLAYER_CONFIG, arena = ARENA,
  bounds = DASH_DESTINATION_BOUNDS) {
  let dx = player.moveX, dy = player.moveY;
  if (!dx && !dy) {
    const angle = -Math.PI / 2 + PLAYER_DIRECTIONS.indexOf(player.lastDirection) * Math.PI / 4;
    dx = Math.cos(angle); dy = Math.sin(angle);
  }
  const movement = normalizeMovement(dx, dy);
  const x = clamp(player.x + movement.x * config.dashDistance, bounds.minX, bounds.maxX);
  const y = clamp(player.y + movement.y * config.dashDistance, bounds.minY, bounds.maxY);
  return isPlayerBlocked(player, x, y, arena) ? { x: player.x, y: player.y, blocked: true } : { x, y, blocked: false };
}
