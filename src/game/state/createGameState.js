const firstWave = [
  [68, 105, 'rifle'],
  [285, 110, 'rifle'],
  [285, 405, 'rifle'],
];

export function createGameState() {
  return {
    stage: 1,
    paused: false,
    dead: false,
    won: false,
    transitionTimer: 0,
    waveSpawnTimer: 0,
    wave: 1,
    kills: 0,
    nextId: 1,
    player: {
      x: 180, y: 460, radius: 11, hp: 100, maxHp: 100,
      armor: 60, maxArmor: 60, vx: 0, vy: 0, speed: 125,
      ammo: 28, reserveAmmo: 112, grenades: 3,
      moveX: 0, moveY: 0, lastDirection: 'n', aimDirection: 'n',
      hitTimer: 0, dashTimer: 0, dashCooldown: 0,
      reloadTimer: 0, fireCooldown: 0, firing: false,
    },
    enemies: firstWave.map(([x, y, role], index) => createEnemy(`enemy-${index + 1}`, x, y, role)),
    bullets: [], enemyBullets: [],
    crates: [{ x: 78, y: 246, w: 63, h: 62 }, { x: 230, y: 277, w: 68, h: 65 }, { x: 150, y: 155, w: 66, h: 64 }],
    barrels: [{ x: 300, y: 188, radius: 18, hp: 3, alive: true }, { x: 48, y: 354, radius: 18, hp: 3, alive: true }],
    medkits: [{ x: 55, y: 448, alive: true }],
    dangerZones: [],
    boss: createBoss(),
  };
}

export function createEnemy(id, x, y, role = 'rifle') {
  return { id, x, y, radius: 10, hp: 72, maxHp: 72, speed: role === 'heavy' ? 33 : 43,
    shootCooldown: 0.5, burst: 0, burstCooldown: 0, state: 'seek', direction: 's',
    moveDirection: 's', hitTimer: 0, deadTimer: 0, role, strafe: 1 };
}

export function createBoss() {
  return { x: 180, y: 195, radius: 52, hp: 1200, maxHp: 1200, phase: 1,
    frameTimer: 0, attackTimer: 0.8, attackFrame: -1, flashTimer: 0,
    moveTimer: 0, smokeTimer: 0 };
}
