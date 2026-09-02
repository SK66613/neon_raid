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
