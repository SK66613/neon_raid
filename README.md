# NEON RAID — Two Stage Build v0.5

NEON RAID is a vanilla JavaScript and Canvas two-stage action prototype. This refactor preserves the v0.5 Corp Sec sector, two enemy waves, and three-phase Warden-X fight while separating browser presentation from canonical gameplay.

## Architecture

Input becomes small JSON-serializable commands which cross an explicit session boundary. The local client remains the production path while the server-side boundary is now prepared for a future network session:

```text
Browser
  ↓
LocalGameSession
  ↓
single-player GameSimulation

Server path (the browser client remains future work):

Browser client (future NetworkGameSession)
  ↓
WebSocket
  ↓
Worker
  ↓
RaidRoom Durable Object
  ↓
AuthoritativeMatchHost
  ↓ fixed 30 Hz tick
MultiplayerBossSimulation
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

The multiplayer protocol is distinct from the local `FRAME` protocol. Its version 2 input envelope binds commands to a server-generated match ID and accepts only `move`, `fire`, `dash`, and `grenade`; it never accepts browser `dt`, slots, positions, HP, or damage results. The slot comes from the WebSocket attachment. An ACK means a correctly matched, fresh command was accepted into the gameplay domain; a dead player's command can still be consumed and ACKed even when the simulation intentionally has no effect. Each fixed tick broadcasts one atomic, copied `state-frame` containing the snapshot and events drained for that tick.

One connected Raider waits with no timer, so the object may hibernate. Exactly two Raiders create a fresh match and one fixed 30 Hz interval; this intentionally holds the Durable Object in memory while gameplay is active. A win or loss broadcasts its final frame, marks attachments complete, and stops the timer so hibernation is possible again. An active disconnect aborts the match with `player-left`, discards the host, stops the timer, and returns the survivor to waiting; a replacement starts a new match ID. Input while waiting or complete is rejected, and delayed input for an old match is rejected as `stale-match` without consuming its sequence.

Attachments contain only `connectionId`, authoritative `slot`, `lastInputSeq`, `matchId`, and `matchState`; canonical gameplay exists only in the in-memory host. Active-match continuity through runtime shutdown, deployment, or machine restart is **not guaranteed**. A stale active attachment without its in-memory host fails closed rather than fabricating recovery. Reconnect recovery and canonical gameplay persistence/replay are deferred.

The pure, authoritative `MultiplayerBossSimulation` now supplies a deterministic two-Raider Warden-X gameplay core. It owns a shared canonical boss and world, independent slot-ordered player resources and combat, stable monotonic entity IDs, copied JSON snapshots/events, and a server-supplied `step(dt)` boundary with a recommended fixed 30 Hz tick. Boss targeting uses deterministic round-robin selection over living Raiders in slot order.

The core is now wired into `RaidRoom`, but there is still **no browser WebSocket client or `NetworkGameSession`**. Multiplayer Stage 1, Telegram, reconnect/recovery, and active gameplay persistence are not implemented. The complete offline v0.5 single-player path remains unchanged.

## Development and validation

```sh
npm install
npm run dev
npm run check
npm run test:simulation
npm run test:session
npm run test:room
npm run test:multiplayer-simulation
npm run test:authoritative-room
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
