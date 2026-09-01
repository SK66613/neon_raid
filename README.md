# NEON RAID — Two Stage Build v0.5

NEON RAID is a vanilla JavaScript and Canvas two-stage action prototype. This refactor preserves the v0.5 Corp Sec sector, two enemy waves, and three-phase Warden-X fight while separating browser presentation from canonical gameplay.

## Architecture

Input becomes small JSON-serializable commands which cross an explicit session boundary. The current architecture is:

```text
Browser Presentation
        ↓
GameSession
        ↓
LocalGameSession
        ↓
GameSimulation
```

`LocalGameSession` is the current offline, single-player implementation. It queues commands, advances the simulation with browser frame `dt`, and returns copied JSON-serializable snapshots and semantic events. Its in-memory `LoopbackTransport` exchanges versioned protocol messages with a `LocalSimulationHost`, demonstrating the transport boundary without adding a network or changing gameplay timing.

### Browser layer

- `src/game/Game.js` translates keyboard and pointer input into commands and orchestrates the frame loop.
- `src/game/session/GameSession.js` defines the small `submit`, `update`, snapshot, event, status, and close contract used by presentation.
- `src/game/session/protocol.js` defines protocol version 1 frame, snapshot, and event message envelopes.
- Canvas drawing, HUD updates, images, procedural audio, rain, screen shake, and cosmetic particles remain presentation concerns.
- `src/game/assets.js` is the logical asset manifest; `public/assets/` contains the image files.

### Simulation layer

- `src/game/state/createGameState.js` creates canonical global, player, Stage 1, projectile, danger-zone, and Warden-X state using only primitives, arrays, and plain objects.
- `src/game/simulation/commands.js` defines the serializable move, fire, dash, grenade, reload, pause, and restart command contract.
- `src/game/simulation/GameSimulation.js` owns movement, collision, combat, AI, waves, stage progression, boss phases, gameplay timers, events, and snapshots without browser APIs or wall-clock access.
- `src/game/simulation/rng.js` supplies the injectable random-number boundary, including a seeded generator for deterministic tests.

There is **no multiplayer yet**, **no networking**, **no Telegram integration yet**, and **no backend yet**. A future `NetworkGameSession` can implement the same client-facing boundary for authoritative room work; this PR only supplies the local loopback implementation.

## Development and validation

```sh
npm install
npm run dev
npm run check
npm run test:simulation
npm run test:session
npm run build
npm run verify:build
npm run test:smoke
```

The Node simulation suite requires no DOM, Canvas, or Playwright. The Chromium smoke test verifies browser boot, Stage 1 movement/fire, the Warden-X transition, and boss damage.

## Controls

- **WASD / arrow keys:** move
- **Space:** fire
- **Shift:** dash
- **G:** grenade
- **Touch controls:** movement, fire, dash, grenade, pause, and restart

## Scope and deployment

There are no intentional changes to controls, balance, assets, enemy behavior, stage progression, or Warden-X thresholds and patterns. No multiplayer, networking, backend, Telegram SDK, or Telegram integration is included. The production client retains its origin-root (`base: '/'`) deployment contract.
