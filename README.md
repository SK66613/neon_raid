# NEON RAID — Two Stage Build v0.5

NEON RAID is a vanilla JavaScript and Canvas two-stage action prototype. This refactor preserves the v0.5 Corp Sec sector, two enemy waves, and three-phase Warden-X fight while separating browser presentation from canonical gameplay.

## Architecture

Input becomes small JSON-serializable commands which cross an explicit session boundary. The local client remains the production path while the server-side boundary is now prepared for a future network session:

```text
Browser
  ↓
GameSession
  ├─ LocalGameSession
  │    ↓
  │  GameSimulation
  │
  └─ future NetworkGameSession
           ↓
        WebSocket
           ↓
        Worker
           ↓
     RaidRoom Durable Object
```

`LocalGameSession` is the current offline, single-player implementation. It queues commands, advances the simulation with browser frame `dt`, and returns copied JSON-serializable snapshots and semantic events. Its in-memory `LoopbackTransport` exchanges versioned protocol messages with a `LocalSimulationHost`, demonstrating the transport boundary without adding a network or changing gameplay timing.

The protocol's `FRAME` message and its `dt` are local simulation-host controls only: browser frame time drives the offline game. They are not an authoritative multiplayer wire contract. A future authoritative server must own its clock and must never trust client-provided `dt`.

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

### Authoritative room foundation

The Cloudflare Worker exposes `POST /api/rooms` and `GET /api/rooms/:roomId/ws`. Each room ID is an opaque, server-issued Durable Object unique ID: creation uses `RAID_ROOMS.newUniqueId()`, while joins validate the capability with `idFromString()` before resolving the matching `RaidRoom`. No room registry, D1, or KV is needed. A room accepts at most two anonymous connections, assigns reusable slots and temporary connection IDs on the server, ingests only validated and sequenced player-intent commands, and broadcasts a stable roster.

The multiplayer protocol is distinct from the local `FRAME` protocol. It accepts only `move`, `fire`, `dash`, and `grenade`; it never accepts browser `dt`, positions, HP, or damage results. The server will own gameplay time when authoritative simulation is introduced. Durable Object WebSocket attachments hold each connection's ID, slot, and last accepted sequence, allowing the room to rebuild its roster with `ctx.getWebSockets()` after hibernation without an always-awake timer.

This change adds only the authoritative room/WebSocket foundation. There is **no client networking or `NetworkGameSession` yet**, **no two-player gameplay yet**, **no Telegram identity or authentication yet**, **no matchmaking yet**, and **no database**. Connection IDs are temporary anonymous identities; real Telegram authentication is explicitly deferred.

## Development and validation

```sh
npm install
npm run dev
npm run check
npm run test:simulation
npm run test:session
npm run test:room
npm run build
npm run verify:build
npm run build:server
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

There are no intentional changes to controls, balance, assets, enemy behavior, stage progression, or Warden-X thresholds and patterns. The server foundation does not add client networking, multiplayer simulation, persistence, Telegram SDK, or Telegram integration. The production client retains its origin-root (`base: '/'`) deployment contract.
