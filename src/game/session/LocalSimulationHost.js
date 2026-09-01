import { GameSimulation } from '../simulation/GameSimulation.js';
import { createEventsMessage, createSnapshotMessage, SessionMessageType } from './protocol.js';

const DebugMessageType = Object.freeze({
  SKIP_TO_BOSS: 'debug:skip-to-boss',
  COMPLETE_STAGE_ONE: 'debug:complete-stage-one',
  DAMAGE_BOSS: 'debug:damage-boss',
});

export class LocalSimulationHost {
  #simulation;

  constructor(options) {
    this.#simulation = new GameSimulation(options);
  }

  receive(message) {
    if (message.type === SessionMessageType.FRAME) {
      this.#simulation.step(message.dt, message.commands);
    } else if (message.type === DebugMessageType.SKIP_TO_BOSS) {
      this.#simulation.skipToBoss();
    } else if (message.type === DebugMessageType.COMPLETE_STAGE_ONE) {
      this.#simulation.completeStageOne();
    } else if (message.type === DebugMessageType.DAMAGE_BOSS) {
      this.#simulation.damageBoss(message.amount);
    } else {
      throw new Error(`Unsupported local message: ${message.type}`);
    }
    return [createSnapshotMessage(this.#simulation.getSnapshot()), createEventsMessage(this.#simulation.drainEvents())];
  }

  initialSnapshot() {
    return createSnapshotMessage(this.#simulation.getSnapshot());
  }
}

export { DebugMessageType };
