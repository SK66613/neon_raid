export const MULTIPLAYER_PROTOCOL_VERSION = 2;
export const MAX_MULTIPLAYER_MESSAGE_BYTES = 4096;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasExactKeys = (value, keys) => {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && keys.slice().sort().every((key, index) => key === actual[index]);
};

export function validateCommand(command) {
  if (!isRecord(command) || typeof command.type !== 'string') return false;
  switch (command.type) {
    case 'move':
      return hasExactKeys(command, ['type', 'x', 'y'])
        && Number.isInteger(command.x) && command.x >= -1 && command.x <= 1
        && Number.isInteger(command.y) && command.y >= -1 && command.y <= 1;
    case 'fire':
      return hasExactKeys(command, ['type', 'active']) && typeof command.active === 'boolean';
    case 'dash':
    case 'grenade':
      return hasExactKeys(command, ['type']);
    default:
      return false;
  }
}

export function validateInputMessage(message) {
  if (!isRecord(message)) return { ok: false, code: 'invalid-message' };
  if (message.version !== MULTIPLAYER_PROTOCOL_VERSION) return { ok: false, code: 'unsupported-version' };
  if (message.type !== 'input' || !hasExactKeys(message, ['version', 'type', 'matchId', 'seq', 'command'])) {
    return { ok: false, code: 'invalid-message' };
  }
  if (typeof message.matchId !== 'string' || message.matchId.length === 0) return { ok: false, code: 'invalid-match-id' };
  if (!Number.isSafeInteger(message.seq) || message.seq < 0) return { ok: false, code: 'invalid-sequence' };
  if (!validateCommand(message.command)) return { ok: false, code: 'invalid-command' };
  return { ok: true, value: message };
}

export const createWelcomeMessage = (roomId, connectionId, slot, capacity) => ({
  version: MULTIPLAYER_PROTOCOL_VERSION, type: 'welcome', roomId, connectionId, slot, capacity,
});

export const createInputAckMessage = (matchId, seq) => ({
  version: MULTIPLAYER_PROTOCOL_VERSION, type: 'input-ack', matchId, seq,
});

const isJsonData = value => value === null || typeof value === 'string' || typeof value === 'boolean'
  || (typeof value === 'number' && Number.isFinite(value))
  || (Array.isArray(value) && value.every(isJsonData))
  || (isRecord(value) && Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(isJsonData));
const jsonCopy = (value, label) => {
  if (!isJsonData(value)) throw new TypeError(`${label} must contain finite plain JSON data`);
  let encoded;
  try { encoded = JSON.stringify(value); } catch { throw new TypeError(`${label} must be JSON data`); }
  if (encoded === undefined) throw new TypeError(`${label} must be JSON data`);
  const copy = JSON.parse(encoded);
  return copy;
};

const validString = value => typeof value === 'string' && value.length > 0;
const validSlot = value => value === 1 || value === 2;
const validCapacity = value => value === 2;
const finiteFields = (value, fields) => fields.every(key => typeof value[key] === 'number' && Number.isFinite(value[key]));
const nonNegativeFields = (value, fields) => fields.every(key => value[key] >= 0);
const DIRECTIONS = new Set(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);
const PLAYER_KEYS = ['slot', 'x', 'y', 'radius', 'vx', 'vy', 'speed', 'moveX', 'moveY', 'aimDirection',
  'lastDirection', 'hp', 'maxHp', 'armor', 'maxArmor', 'ammo', 'reserveAmmo', 'grenades', 'fireCooldown',
  'reloadTimer', 'dashTimer', 'dashCooldown', 'hitTimer', 'firing', 'alive', 'pendingActions'];
const PLAYER_NUMBERS = ['x', 'y', 'radius', 'vx', 'vy', 'speed', 'moveX', 'moveY', 'hp', 'maxHp', 'armor',
  'maxArmor', 'ammo', 'reserveAmmo', 'grenades', 'fireCooldown', 'reloadTimer', 'dashTimer', 'dashCooldown', 'hitTimer'];
const PLAYER_NON_NEGATIVE = ['radius', 'speed', 'hp', 'maxHp', 'armor', 'maxArmor', 'ammo', 'reserveAmmo',
  'grenades', 'fireCooldown', 'reloadTimer', 'dashTimer', 'dashCooldown', 'hitTimer'];
const validPlayer = player => isRecord(player) && hasExactKeys(player, PLAYER_KEYS) && validSlot(player.slot)
  && finiteFields(player, PLAYER_NUMBERS) && nonNegativeFields(player, PLAYER_NON_NEGATIVE)
  && player.hp <= player.maxHp && player.armor <= player.maxArmor
  && DIRECTIONS.has(player.lastDirection) && DIRECTIONS.has(player.aimDirection)
  && typeof player.alive === 'boolean' && typeof player.firing === 'boolean'
  && Array.isArray(player.pendingActions) && player.pendingActions.every(action => action === 'dash' || action === 'grenade');

const BOSS_KEYS = ['id', 'x', 'y', 'radius', 'hp', 'maxHp', 'phase', 'frameTimer', 'attackTimer', 'attackFrame',
  'flashTimer', 'moveTimer', 'smokeTimer', 'targetCursor'];
const BOSS_NUMBERS = BOSS_KEYS.filter(key => !['id', 'phase'].includes(key));
const validBoss = boss => isRecord(boss) && hasExactKeys(boss, BOSS_KEYS) && boss.id === 'warden-x'
  && finiteFields(boss, BOSS_NUMBERS) && [1, 2, 3].includes(boss.phase)
  && boss.radius >= 0 && boss.hp >= 0 && boss.maxHp >= 0 && boss.hp <= boss.maxHp
  && boss.frameTimer >= 0 && boss.flashTimer >= 0 && boss.moveTimer >= 0 && boss.smokeTimer >= 0
  && Number.isSafeInteger(boss.targetCursor) && boss.targetCursor >= 0;

const validEntity = (entity, keys, numericFields) => isRecord(entity) && hasExactKeys(entity, keys)
  && validString(entity.id) && finiteFields(entity, numericFields);
const validPlayerBullet = bullet => validEntity(bullet,
  ['id', 'ownerSlot', 'x', 'y', 'vx', 'vy', 'life', 'damage'], ['x', 'y', 'vx', 'vy', 'life', 'damage'])
  && validSlot(bullet.ownerSlot);
const validEnemyBullet = bullet => validEntity(bullet,
  bullet?.targetSlot === undefined
    ? ['id', 'x', 'y', 'vx', 'vy', 'life', 'radius', 'damage']
    : ['id', 'x', 'y', 'vx', 'vy', 'life', 'radius', 'damage', 'targetSlot'],
  ['x', 'y', 'vx', 'vy', 'life', 'radius', 'damage'])
  && (bullet.targetSlot === undefined || validSlot(bullet.targetSlot));
const validDangerZone = zone => validEntity(zone,
  ['id', 'x', 'y', 'radius', 'delay', 'life', 'exploded', 'targetSlot'], ['x', 'y', 'radius', 'delay', 'life'])
  && typeof zone.exploded === 'boolean' && validSlot(zone.targetSlot);
const validMedkit = medkit => validEntity(medkit, ['id', 'x', 'y', 'alive'], ['x', 'y'])
  && typeof medkit.alive === 'boolean';

export function validateAuthoritativeSnapshot(snapshot) {
  if (!isRecord(snapshot) || !hasExactKeys(snapshot,
    ['tick', 'status', 'players', 'boss', 'bullets', 'enemyBullets', 'dangerZones', 'medkits', 'nextEntityId'])) return false;
  return Number.isSafeInteger(snapshot.tick) && snapshot.tick >= 0
    && ['active', 'won', 'lost'].includes(snapshot.status)
    && Number.isSafeInteger(snapshot.nextEntityId) && snapshot.nextEntityId >= 1
    && Array.isArray(snapshot.players) && snapshot.players.length === 2 && snapshot.players.every(validPlayer)
    && new Set(snapshot.players.map(player => player.slot)).size === 2
    && snapshot.players.some(player => player.slot === 1) && snapshot.players.some(player => player.slot === 2)
    && validBoss(snapshot.boss)
    && Array.isArray(snapshot.bullets) && snapshot.bullets.every(validPlayerBullet)
    && Array.isArray(snapshot.enemyBullets) && snapshot.enemyBullets.every(validEnemyBullet)
    && Array.isArray(snapshot.dangerZones) && snapshot.dangerZones.every(validDangerZone)
    && Array.isArray(snapshot.medkits) && snapshot.medkits.every(validMedkit);
}

export function validateServerMessage(message) {
  if (!isRecord(message)) return { ok: false, code: 'invalid-message' };
  if (message.version !== MULTIPLAYER_PROTOCOL_VERSION) return { ok: false, code: 'unsupported-version' };
  let valid = false;
  switch (message.type) {
    case 'welcome':
      valid = hasExactKeys(message, ['version', 'type', 'roomId', 'connectionId', 'slot', 'capacity'])
        && /^[0-9a-f]{64}$/.test(message.roomId) && validString(message.connectionId)
        && validSlot(message.slot) && validCapacity(message.capacity);
      break;
    case 'roster':
      valid = hasExactKeys(message, ['version', 'type', 'capacity', 'players'])
        && validCapacity(message.capacity) && Array.isArray(message.players)
        && message.players.length <= 2 && message.players.every(player => isRecord(player)
          && hasExactKeys(player, ['connectionId', 'slot']) && validString(player.connectionId) && validSlot(player.slot))
        && new Set(message.players.map(player => player.slot)).size === message.players.length;
      break;
    case 'input-ack':
      valid = hasExactKeys(message, ['version', 'type', 'matchId', 'seq']) && validString(message.matchId)
        && Number.isSafeInteger(message.seq) && message.seq >= 0;
      break;
    case 'state-frame': {
      const snapshot = message.snapshot;
      valid = hasExactKeys(message, ['version', 'type', 'matchId', 'tick', 'snapshot', 'events'])
        && validString(message.matchId) && Number.isSafeInteger(message.tick) && message.tick >= 0
        && isJsonData(snapshot) && validateAuthoritativeSnapshot(snapshot) && snapshot.tick === message.tick
        && Array.isArray(message.events) && isJsonData(message.events);
      break;
    }
    case 'match-aborted':
      valid = hasExactKeys(message, ['version', 'type', 'matchId', 'reason'])
        && validString(message.matchId) && validString(message.reason);
      break;
    case 'error':
      valid = hasExactKeys(message, ['version', 'type', 'code', 'message'])
        && validString(message.code) && validString(message.message);
      break;
    default:
      return { ok: false, code: 'unsupported-message-type' };
  }
  if (!valid) return { ok: false, code: 'invalid-message' };
  return { ok: true, value: jsonCopy(message, 'server message') };
}

export function createStateFrameMessage(matchId, snapshot, events) {
  if (typeof matchId !== 'string' || matchId.length === 0) throw new TypeError('matchId is required');
  const snapshotCopy = jsonCopy(snapshot, 'snapshot');
  const eventsCopy = jsonCopy(events, 'events');
  if (!isRecord(snapshotCopy) || !Number.isSafeInteger(snapshotCopy.tick) || snapshotCopy.tick < 0) throw new TypeError('invalid snapshot tick');
  if (!Array.isArray(eventsCopy)) throw new TypeError('events must be an array');
  return { version: MULTIPLAYER_PROTOCOL_VERSION, type: 'state-frame', matchId,
    tick: snapshotCopy.tick, snapshot: snapshotCopy, events: eventsCopy };
}

export function createMatchAbortedMessage(matchId, reason) {
  if (typeof matchId !== 'string' || matchId.length === 0) throw new TypeError('matchId is required');
  if (typeof reason !== 'string' || reason.length === 0) throw new TypeError('reason is required');
  return { version: MULTIPLAYER_PROTOCOL_VERSION, type: 'match-aborted', matchId, reason };
}

export const createRosterMessage = (capacity, players) => ({
  version: MULTIPLAYER_PROTOCOL_VERSION,
  type: 'roster',
  capacity,
  players: players.map(({ connectionId, slot }) => ({ connectionId, slot })),
});

export const createErrorMessage = (code, message) => ({
  version: MULTIPLAYER_PROTOCOL_VERSION, type: 'error', code, message,
});
