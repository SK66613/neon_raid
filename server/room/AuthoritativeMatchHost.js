import { MultiplayerBossSimulation } from '../../src/game/multiplayer/MultiplayerBossSimulation.js';
import { MULTIPLAYER_TICK_DT } from '../../src/game/multiplayer/config.js';
import { createStateFrameMessage } from '../../src/game/network/protocol.js';

export class AuthoritativeMatchHost {
  #matchId;
  #simulation;

  constructor({ matchId, rng } = {}) {
    if (typeof matchId !== 'string' || matchId.length === 0) throw new TypeError('matchId is required');
    this.#matchId = matchId;
    this.#simulation = new MultiplayerBossSimulation({ rng });
  }

  applyCommand(slot, command) { return this.#simulation.applyCommand(slot, command); }
  initialFrame() { return this.#frame(); }
  tick() { this.#simulation.step(MULTIPLAYER_TICK_DT); return this.#frame(); }
  getStatus() { return this.#simulation.getSnapshot().status; }
  getMatchId() { return this.#matchId; }
  #frame() { return createStateFrameMessage(this.#matchId, this.#simulation.getSnapshot(), this.#simulation.drainEvents()); }
}
