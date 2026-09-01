export const SessionStatus = Object.freeze({
  IDLE: 'idle',
  READY: 'ready',
  CLOSED: 'closed',
});

// The intentionally small client-facing contract shared by local and future sessions.
export class GameSession {
  submit() { throw new Error('GameSession.submit() must be implemented'); }
  update() { throw new Error('GameSession.update() must be implemented'); }
  getSnapshot() { throw new Error('GameSession.getSnapshot() must be implemented'); }
  drainEvents() { throw new Error('GameSession.drainEvents() must be implemented'); }
  getStatus() { throw new Error('GameSession.getStatus() must be implemented'); }
  close() { throw new Error('GameSession.close() must be implemented'); }
}
