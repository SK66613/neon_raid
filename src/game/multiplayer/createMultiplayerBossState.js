import { BOSS_CONFIG, PLAYER_CONFIG } from './config.js';

const createPlayer = (slot, x) => ({
  slot, x, y: 468, radius: PLAYER_CONFIG.radius, vx: 0, vy: 0,
  speed: PLAYER_CONFIG.speed, moveX: 0, moveY: 0,
  aimDirection: 'n', lastDirection: 'n', hp: PLAYER_CONFIG.hp,
  maxHp: PLAYER_CONFIG.hp, armor: PLAYER_CONFIG.armor,
  maxArmor: PLAYER_CONFIG.armor, ammo: PLAYER_CONFIG.magazine,
  reserveAmmo: PLAYER_CONFIG.reserveAmmo, grenades: PLAYER_CONFIG.grenades,
  fireCooldown: 0, reloadTimer: 0, dashTimer: 0, dashCooldown: 0,
  hitTimer: 0, firing: false, alive: true, pendingActions: [],
});

export function createMultiplayerBossState() {
  return {
    tick: 0, status: 'active',
    players: [createPlayer(1, 145), createPlayer(2, 215)],
    boss: { id: 'warden-x', x: 180, y: 195, radius: 52, hp: 1200,
      maxHp: 1200, phase: 1, frameTimer: 0, attackTimer: BOSS_CONFIG.initialAttackDelay,
      attackFrame: -1, flashTimer: 0, moveTimer: 0, smokeTimer: 0,
      targetCursor: 0 },
    bullets: [], enemyBullets: [], dangerZones: [],
    medkits: [{ id: 'medkit-1', x: 48, y: 425, alive: true },
      { id: 'medkit-2', x: 310, y: 405, alive: true }],
    nextEntityId: 1,
  };
}
