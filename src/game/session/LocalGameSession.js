import { GameSession, SessionStatus } from './GameSession.js';
import { LoopbackTransport } from './LoopbackTransport.js';
import { DebugMessageType, LocalSimulationHost } from './LocalSimulationHost.js';
import { cloneSerializable, createCommandMessage, createFrameMessage, PROTOCOL_VERSION, SessionResponseType } from './protocol.js';

export class LocalGameSession extends GameSession {
  constructor(options = {}) {
    super();
    const host = new LocalSimulationHost(options);
    this.transport = new LoopbackTransport(host);
    this.snapshot = host.initialSnapshot().snapshot;
    this.events = [];
    this.commands = [];
    this.status = SessionStatus.READY;
  }

  submit(command) {
    this.#assertReady();
    this.commands.push(createCommandMessage(command).command);
  }

  update(dt) {
    this.#assertReady();
    const responses = this.transport.exchange(createFrameMessage(dt, this.commands));
    this.commands = [];
    this.#accept(responses);
  }

  getSnapshot() { return cloneSerializable(this.snapshot); }
  drainEvents() { const events = cloneSerializable(this.events); this.events = []; return events; }
  getStatus() { return this.status; }

  close() {
    if (this.status === SessionStatus.CLOSED) return;
    this.commands = [];
    this.transport.close();
    this.status = SessionStatus.CLOSED;
  }

  createTestAdapter() {
    const send = (type, detail = {}) => {
      this.#assertReady();
      this.#accept(this.transport.exchange({ version: PROTOCOL_VERSION, type, ...detail }));
    };
    return Object.freeze({
      skipToBoss: () => send(DebugMessageType.SKIP_TO_BOSS),
      completeStageOne: () => send(DebugMessageType.COMPLETE_STAGE_ONE),
      damageBoss: (amount = 100) => send(DebugMessageType.DAMAGE_BOSS, { amount }),
    });
  }

  #accept(responses) {
    for (const response of responses) {
      if (response.type === SessionResponseType.SNAPSHOT) this.snapshot = response.snapshot;
      else if (response.type === SessionResponseType.EVENTS) this.events.push(...response.events);
    }
  }

  #assertReady() {
    if (this.status !== SessionStatus.READY) throw new Error('LocalGameSession is closed');
  }
}

export const createLocalGameSession = options => new LocalGameSession(options);
