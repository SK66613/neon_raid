import { validateCommand } from '../network/protocol.js';
import { createMathRandomRng } from '../simulation/rng.js';
import { ARENA, DANGER_CONFIG, MULTIPLAYER_TICK_DT, PLAYER_CONFIG } from './config.js';
import { createMultiplayerBossState } from './createMultiplayerBossState.js';

const W = 360, H = 540;
const DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
const clone = value => structuredClone(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copyWhitelistedPatch = (patch, allowedFields, label) => {
  if (!isRecord(patch)) throw new TypeError(`${label} patch must be a plain object`);
  const copy = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!allowedFields.includes(key) || !Number.isFinite(value)) throw new TypeError(`invalid ${label} field: ${key}`);
    copy[key] = value;
  }
  return copy;
};
const copyWhitelistedEntity = (entity, allowedFields, label) => {
  const copy = clone(entity);
  if (!isRecord(copy) || Object.keys(copy).some(key => !allowedFields.includes(key))) {
    throw new TypeError(`invalid ${label}`);
  }
  return copy;
};

export class MultiplayerBossSimulation {
  #state;
  #events;
  #rng;

  constructor({ rng = createMathRandomRng() } = {}) {
    if (!rng || typeof rng.next !== 'function') throw new TypeError('rng must expose next()');
    this.#rng = rng;
    this.#state = createMultiplayerBossState();
    this.#events = [{ type: 'match-started', slots: [1, 2] }];
  }

  applyCommand(slot, command) {
    const player = this.#player(slot);
    if (!validateCommand(command)) throw new TypeError('invalid multiplayer command');
    if (!player.alive || this.#state.status !== 'active') return false;
    if (command.type === 'move') { player.moveX = command.x; player.moveY = command.y; }
    else if (command.type === 'fire') player.firing = command.active;
    else player.pendingActions.push(command.type);
    return true;
  }

  step(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new TypeError('dt must be a finite non-negative number');
    if (this.#state.status !== 'active') return;
    dt = Math.min(dt, MULTIPLAYER_TICK_DT);
    this.#state.tick++;
    for (const player of this.#state.players) {
      this.#playerStep(player, dt);
      if (this.#state.status !== 'active') return;
    }
    this.#bossStep(dt);
    if (this.#state.status !== 'active') return;
    this.#projectiles(dt);
    if (this.#state.status !== 'active') return;
    this.#dangerZones(dt);
    if (this.#state.status !== 'active') return;
    this.#medkits();
  }

  getSnapshot() { return clone(this.#state); }
  drainEvents() { const result = clone(this.#events); this.#events = []; return result; }

  createTestAdapter() {
    const setPlayer = (slot, patch) => Object.assign(this.#player(slot),
      copyWhitelistedPatch(patch, ['x', 'y', 'hp', 'armor', 'ammo', 'grenades'], 'player'));
    const setBoss = patch => Object.assign(this.#state.boss,
      copyWhitelistedPatch(patch, ['hp', 'attackTimer', 'moveTimer'], 'boss'));
    const addEnemyBullet = bullet => {
      const copy = copyWhitelistedEntity(bullet,
        ['id', 'x', 'y', 'vx', 'vy', 'life', 'radius', 'damage', 'targetSlot'], 'enemy bullet');
      this.#state.enemyBullets.push(copy);
    };
    const addDangerZone = zone => {
      const copy = copyWhitelistedEntity(zone,
        ['id', 'x', 'y', 'radius', 'delay', 'life', 'exploded', 'targetSlot'], 'danger zone');
      this.#state.dangerZones.push(copy);
    };
    return Object.freeze({ setPlayer, setBoss, addEnemyBullet, addDangerZone });
  }

  // Trusted host/domain hooks, deliberately not part of the remote command vocabulary.
  damagePlayer(slot, amount) {
    const player = this.#player(slot);
    if (!Number.isFinite(amount) || amount < 0) throw new TypeError('damage must be non-negative');
    if (!player.alive || player.hitTimer > 0 || player.dashTimer > 0 || this.#state.status !== 'active') return false;
    const absorbed = Math.min(amount, player.armor);
    player.armor -= absorbed; player.hp -= amount - absorbed; player.hitTimer = 0.28;
    this.#emit('player-hit', { slot, damage: amount });
    if (player.hp <= 0) {
      player.hp = 0; player.alive = false; player.firing = false;
      player.moveX = 0; player.moveY = 0; player.vx = 0; player.vy = 0;
      player.pendingActions = [];
      this.#emit('player-died', { slot });
      if (this.#state.players.every(item => !item.alive)) {
        this.#state.status = 'lost'; this.#clearInputs(); this.#emit('match-lost');
      }
    }
    return true;
  }

  damageBoss(amount, { ownerSlot, flashDuration = 0.06 } = {}) {
    if (!Number.isFinite(amount) || amount < 0) throw new TypeError('damage must be non-negative');
    if (this.#state.status !== 'active') return false;
    const boss = this.#state.boss;
    boss.hp = Math.max(0, boss.hp - amount); boss.flashTimer = flashDuration;
    this.#emit('boss-hit', { ...(ownerSlot ? { slot: ownerSlot } : {}), damage: amount, hp: boss.hp });
    if (boss.hp === 0) {
      this.#state.status = 'won'; this.#clearInputs(); this.#emit('boss-defeated'); this.#emit('match-won');
    }
    return true;
  }

  #player(slot) {
    if (slot !== 1 && slot !== 2) throw new RangeError('slot must be 1 or 2');
    return this.#state.players[slot - 1];
  }
  #id(kind) { return `${kind}-${this.#state.nextEntityId++}`; }
  #emit(type, detail = {}) { this.#events.push({ type, ...detail }); }
  #clearInputs() {
    for (const player of this.#state.players) {
      player.firing = false; player.moveX = 0; player.moveY = 0; player.pendingActions = [];
    }
  }
  #blocked(player, x, y) {
    return x - player.radius < ARENA.minX || x + player.radius > ARENA.maxX
      || y - player.radius < ARENA.minY || y + player.radius > ARENA.maxY;
  }
  #move(player, dx, dy) {
    const oldX = player.x, oldY = player.y;
    player.x += dx;
    if (this.#blocked(player, player.x, player.y)) player.x = oldX;
    player.y += dy;
    if (this.#blocked(player, player.x, player.y)) player.y = oldY;
  }
  #direction(player, dx, dy) {
    if (Math.hypot(dx, dy) < 0.001) return player.lastDirection;
    const index = Math.round((Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI / 4));
    return DIRECTIONS[((index % 8) + 8) % 8];
  }

  #playerStep(player, dt) {
    if (!player.alive) return;
    player.hitTimer = Math.max(0, player.hitTimer - dt);
    player.dashTimer = Math.max(0, player.dashTimer - dt);
    player.dashCooldown = Math.max(0, player.dashCooldown - dt);
    player.fireCooldown = Math.max(0, player.fireCooldown - dt);
    this.#reload(player, dt);
    const actions = player.pendingActions;
    player.pendingActions = [];
    for (const action of actions) {
      if (action === 'dash') this.#dash(player); else this.#grenade(player);
      if (this.#state.status !== 'active') return;
    }
    if (player.firing) this.#fire(player);
    let dx = player.moveX, dy = player.moveY;
    if (dx || dy) {
      const length = Math.hypot(dx, dy); dx /= length; dy /= length;
      player.lastDirection = this.#direction(player, dx, dy);
      player.vx += dx * PLAYER_CONFIG.acceleration * dt;
      player.vy += dy * PLAYER_CONFIG.acceleration * dt;
    }
    player.vx *= Math.max(0, 1 - PLAYER_CONFIG.friction * dt);
    player.vy *= Math.max(0, 1 - PLAYER_CONFIG.friction * dt);
    const speed = Math.hypot(player.vx, player.vy);
    const maximum = player.speed * (player.dashTimer > 0 ? 1.6 : 1);
    if (speed > maximum) { player.vx = player.vx / speed * maximum; player.vy = player.vy / speed * maximum; }
    this.#move(player, player.vx * dt, player.vy * dt);
  }

  #fire(player) {
    if (player.fireCooldown > 0 || player.reloadTimer > 0) return;
    if (player.ammo <= 0) { this.#startReload(player); return; }
    const boss = this.#state.boss, angle = Math.atan2(boss.y + 25 - (player.y - 12), boss.x - player.x);
    player.aimDirection = this.#direction(player, Math.cos(angle), Math.sin(angle));
    const bullet = { id: this.#id('bullet'), ownerSlot: player.slot,
      x: player.x + Math.cos(angle) * 15, y: player.y - 13 + Math.sin(angle) * 8,
      vx: Math.cos(angle) * PLAYER_CONFIG.bulletSpeed, vy: Math.sin(angle) * PLAYER_CONFIG.bulletSpeed,
      life: 1.35, damage: PLAYER_CONFIG.bulletDamage };
    this.#state.bullets.push(bullet); player.ammo--; player.fireCooldown = PLAYER_CONFIG.fireInterval;
    this.#emit('shot-fired', { slot: player.slot, bulletId: bullet.id, direction: player.aimDirection });
  }
  #startReload(player) {
    if (player.reloadTimer > 0 || player.ammo === PLAYER_CONFIG.magazine || player.reserveAmmo <= 0) return;
    player.reloadTimer = PLAYER_CONFIG.reloadDuration; this.#emit('reload-started', { slot: player.slot });
  }
  #reload(player, dt) {
    if (player.reloadTimer <= 0) return;
    player.reloadTimer -= dt;
    if (player.reloadTimer <= 0) {
      player.reloadTimer = 0;
      const take = Math.min(PLAYER_CONFIG.magazine - player.ammo, player.reserveAmmo);
      player.ammo += take; player.reserveAmmo -= take; this.#emit('reload-completed', { slot: player.slot });
    }
  }
  #dash(player) {
    if (player.dashCooldown > 0) return;
    let dx = player.moveX, dy = player.moveY;
    if (!dx && !dy) { const angle = -Math.PI / 2 + DIRECTIONS.indexOf(player.lastDirection) * Math.PI / 4; dx = Math.cos(angle); dy = Math.sin(angle); }
    const length = Math.hypot(dx, dy) || 1;
    const nextX = clamp(player.x + dx / length * PLAYER_CONFIG.dashDistance, 18, 342);
    const nextY = clamp(player.y + dy / length * PLAYER_CONFIG.dashDistance, 70, 508);
    if (!this.#blocked(player, nextX, nextY)) { player.x = nextX; player.y = nextY; }
    player.dashTimer = PLAYER_CONFIG.dashDuration; player.dashCooldown = PLAYER_CONFIG.dashCooldown;
    this.#emit('dash', { slot: player.slot, x: player.x, y: player.y });
  }
  #grenade(player) {
    if (player.grenades <= 0) return;
    player.grenades--; const boss = this.#state.boss, x = boss.x, y = boss.y + 25;
    this.#emit('grenade-thrown', { slot: player.slot, x, y });
    this.#explode(x, y, 90, 105, player.slot);
  }

  #livingTarget() {
    const living = this.#state.players.filter(player => player.alive);
    if (!living.length) return null;
    const target = living[this.#state.boss.targetCursor % living.length];
    this.#state.boss.targetCursor++; return target;
  }
  #bossStep(dt) {
    const boss = this.#state.boss;
    boss.moveTimer += dt; boss.frameTimer += dt; boss.attackTimer -= dt;
    boss.flashTimer = Math.max(0, boss.flashTimer - dt);
    boss.x = 180 + Math.sin(boss.moveTimer * 0.85) * (boss.phase === 3 ? 48 : 34);
    boss.y = 193 + Math.sin(boss.moveTimer * 1.45) * 5;
    if (boss.attackTimer <= 0) this.#bossPattern();
    if (boss.attackFrame >= 0 && (boss.attackFrame += dt * 8) >= 4) boss.attackFrame = -1;
    boss.smokeTimer += dt;
    if (boss.phase >= 2 && boss.smokeTimer > 0.22) {
      boss.smokeTimer = 0; this.#emit('boss-smoke', { x: boss.x + (this.#rng.next() - 0.5) * 45, y: boss.y - 55 + this.#rng.next() * 30 });
    }
  }
  #bossPattern() {
    const boss = this.#state.boss, next = boss.hp < 400 ? 3 : boss.hp < 800 ? 2 : 1;
    if (next !== boss.phase) { boss.phase = next; this.#emit('boss-phase-changed', { phase: next }); }
    if (boss.phase === 1) { this.#bossBurst(5, 0.72, 165); if (this.#rng.next() < 0.65) this.#createDanger(DANGER_CONFIG[1][0]); boss.attackTimer = 0.82; }
    else if (boss.phase === 2) { this.#rng.next() < 0.5 ? this.#bossBurst(7, 0.98, 178) : this.#bossRadial(11, 136); this.#createDanger(DANGER_CONFIG[2][0]); boss.attackTimer = 0.68; }
    else { this.#rng.next() < 0.48 ? this.#bossRadial(15, 146) : this.#bossBurst(9, 1.22, 188); for (const config of DANGER_CONFIG[3]) this.#createDanger(config); boss.attackTimer = 0.54; }
  }
  #bossBurst(count, spread, speed) {
    const boss = this.#state.boss, target = this.#livingTarget(); if (!target) return;
    const angle = Math.atan2(target.y - (boss.y + 35), target.x - boss.x), ids = [];
    for (let index = 0; index < count; index++) {
      const offset = (index - (count - 1) / 2) * (spread / Math.max(1, count - 1));
      const bullet = { id: this.#id('enemy-bullet'), x: boss.x, y: boss.y + 48,
        vx: Math.cos(angle + offset) * speed, vy: Math.sin(angle + offset) * speed,
        life: 3.4, radius: 4, damage: 10, targetSlot: target.slot };
      this.#state.enemyBullets.push(bullet); ids.push(bullet.id);
    }
    boss.attackFrame = 0; this.#emit('enemy-shot', { bossId: boss.id, targetSlot: target.slot, bulletIds: ids });
  }
  #bossRadial(count, speed) {
    const boss = this.#state.boss, ids = [];
    for (let index = 0; index < count; index++) {
      const angle = index / count * Math.PI * 2 + boss.moveTimer * 0.4;
      const bullet = { id: this.#id('enemy-bullet'), x: boss.x, y: boss.y + 40,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 3.6, radius: 4, damage: 9 };
      this.#state.enemyBullets.push(bullet); ids.push(bullet.id);
    }
    boss.attackFrame = 2; this.#emit('enemy-shot', { bossId: boss.id, bulletIds: ids });
  }
  #createDanger(config) {
    const target = this.#livingTarget(); if (!target) return;
    this.#state.dangerZones.push({ id: this.#id('danger-zone'),
      x: clamp(target.x + (this.#rng.next() - 0.5) * config.xRange, config.minX, config.maxX),
      y: clamp(target.y + (this.#rng.next() - 0.5) * config.yRange, config.minY, config.maxY),
      radius: config.radius, delay: config.delay, life: config.delay + 0.22, exploded: false,
      targetSlot: target.slot });
  }
  #projectiles(dt) {
    for (const bullet of this.#state.bullets) {
      bullet.x += bullet.vx * dt; bullet.y += bullet.vy * dt; bullet.life -= dt;
      if (bullet.life > 0 && distance(bullet, { x: this.#state.boss.x, y: this.#state.boss.y + 20 }) < this.#state.boss.radius + 7) {
        bullet.life = 0; this.damageBoss(bullet.damage, { ownerSlot: bullet.ownerSlot });
      }
      if (this.#state.status !== 'active') break;
    }
    this.#state.bullets = this.#state.bullets.filter(b => b.life > 0 && b.x > -20 && b.x < W + 20 && b.y > -20 && b.y < H + 20);
    if (this.#state.status !== 'active') return;
    for (const bullet of this.#state.enemyBullets) {
      bullet.x += bullet.vx * dt; bullet.y += bullet.vy * dt; bullet.life -= dt;
      if (bullet.life <= 0) continue;
      for (const player of this.#state.players) {
        if (player.alive && distance(bullet, player) < player.radius + bullet.radius) {
          bullet.life = 0; this.damagePlayer(player.slot, bullet.damage); break;
        }
      }
      if (this.#state.status !== 'active') return;
    }
    this.#state.enemyBullets = this.#state.enemyBullets.filter(b => b.life > 0 && b.x > -25 && b.x < W + 25 && b.y > -25 && b.y < H + 25);
  }
  #dangerZones(dt) {
    for (const zone of this.#state.dangerZones) {
      zone.delay -= dt; zone.life -= dt;
      if (zone.delay <= 0 && !zone.exploded) {
        zone.exploded = true; this.#explode(zone.x, zone.y, zone.radius + 20, 0);
        if (this.#state.status !== 'active') return;
      }
    }
    this.#state.dangerZones = this.#state.dangerZones.filter(zone => zone.life > 0);
  }
  #explode(x, y, radius, bossDamage, ownerSlot) {
    const id = this.#id('explosion'); this.#emit('explosion', { id, ...(ownerSlot ? { slot: ownerSlot } : {}), x, y, radius });
    if (bossDamage && distance({ x, y }, { x: this.#state.boss.x, y: this.#state.boss.y + 25 }) < radius + this.#state.boss.radius) this.damageBoss(bossDamage, { ownerSlot, flashDuration: 0.12 });
    if (!ownerSlot) for (const player of this.#state.players) if (player.alive && distance(player, { x, y }) < radius * 0.62) this.damagePlayer(player.slot, 18);
  }
  #medkits() {
    for (const medkit of this.#state.medkits) if (medkit.alive) {
      for (const player of this.#state.players) if (player.alive && distance(player, medkit) < 27) {
        medkit.alive = false; player.hp = Math.min(player.maxHp, player.hp + 32);
        this.#emit('medkit-collected', { slot: player.slot, medkitId: medkit.id, x: medkit.x, y: medkit.y }); break;
      }
    }
  }
}
