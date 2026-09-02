export const MULTIPLAYER_PROTOCOL_VERSION = 1;
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
  if (message.type !== 'input' || !hasExactKeys(message, ['version', 'type', 'seq', 'command'])) {
    return { ok: false, code: 'invalid-message' };
  }
  if (!Number.isSafeInteger(message.seq) || message.seq < 0) return { ok: false, code: 'invalid-sequence' };
  if (!validateCommand(message.command)) return { ok: false, code: 'invalid-command' };
  return { ok: true, value: message };
}

export const createWelcomeMessage = (roomId, connectionId, slot, capacity) => ({
  version: MULTIPLAYER_PROTOCOL_VERSION, type: 'welcome', roomId, connectionId, slot, capacity,
});

export const createInputAckMessage = (seq) => ({
  version: MULTIPLAYER_PROTOCOL_VERSION, type: 'input-ack', seq,
});

export const createRosterMessage = (capacity, players) => ({
  version: MULTIPLAYER_PROTOCOL_VERSION,
  type: 'roster',
  capacity,
  players: players.map(({ connectionId, slot }) => ({ connectionId, slot })),
});

export const createErrorMessage = (code, message) => ({
  version: MULTIPLAYER_PROTOCOL_VERSION, type: 'error', code, message,
});
