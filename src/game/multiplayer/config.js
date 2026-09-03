export const MULTIPLAYER_TICK_HZ = 30;
export const MULTIPLAYER_TICK_DT = 1 / MULTIPLAYER_TICK_HZ;

export const ARENA = Object.freeze({ minX: 13, maxX: 347, minY: 60, maxY: 520 });
export const DASH_DESTINATION_BOUNDS = Object.freeze({ minX: 18, maxX: 342, minY: 70, maxY: 508 });

export const PLAYER_CONFIG = Object.freeze({
  radius: 11, hp: 100, armor: 60, speed: 125,
  magazine: 28, reserveAmmo: 112, grenades: 3,
  acceleration: 520, friction: 8, fireInterval: 0.105,
  bulletSpeed: 350, bulletDamage: 17, reloadDuration: 0.82,
  dashDistance: 62, dashDuration: 0.15, dashCooldown: 1.45,
});

export const BOSS_CONFIG = Object.freeze({
  initialAttackDelay: 1.20,
  attackInterval: Object.freeze({
    1: 1.20,
    2: 1.00,
    3: 0.82,
  }),
});

export const DANGER_CONFIG = Object.freeze({
  1: Object.freeze([{ xRange: 55, yRange: 30, minX: 35, maxX: 325, minY: 280, maxY: 490, radius: 30, delay: 1 }]),
  2: Object.freeze([{ xRange: 75, yRange: 46, minX: 32, maxX: 328, minY: 275, maxY: 492, radius: 32, delay: 0.82 }]),
  3: Object.freeze([
    { xRange: 90, yRange: 54, minX: 30, maxX: 330, minY: 270, maxY: 494, radius: 34, delay: 0.65 },
    { xRange: 90, yRange: 54, minX: 30, maxX: 330, minY: 270, maxY: 494, radius: 28, delay: 0.78 },
  ]),
});
