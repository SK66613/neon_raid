export const PROTOCOL_VERSION = 1;

export const SessionMessageType = Object.freeze({
  COMMAND: 'command',
  FRAME: 'frame',
});

export const SessionResponseType = Object.freeze({
  SNAPSHOT: 'snapshot',
  EVENTS: 'events',
});

const assertSerializable = value => {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new TypeError('Session payload must contain JSON values only');
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Session numbers must be finite');
  if (value && typeof value === 'object') {
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('Session payload must contain plain data');
    Object.values(value).forEach(assertSerializable);
  }
};

export const cloneSerializable = value => {
  assertSerializable(value);
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('Session payload must be JSON serializable');
  return JSON.parse(serialized);
};

export const createCommandMessage = command => cloneSerializable({
  version: PROTOCOL_VERSION,
  type: SessionMessageType.COMMAND,
  command,
});

export const createFrameMessage = (dt, commands) => cloneSerializable({
  version: PROTOCOL_VERSION,
  type: SessionMessageType.FRAME,
  dt,
  commands,
});

export const createSnapshotMessage = snapshot => cloneSerializable({
  version: PROTOCOL_VERSION,
  type: SessionResponseType.SNAPSHOT,
  snapshot,
});

export const createEventsMessage = events => cloneSerializable({
  version: PROTOCOL_VERSION,
  type: SessionResponseType.EVENTS,
  events,
});
