# NEON RAID — Two Stage Build v0.5

NEON RAID is a vanilla JavaScript and Canvas two-stage action prototype. This refactor preserves the v0.5 Corp Sec sector, two enemy waves, and three-phase Warden-X fight while separating browser presentation from canonical gameplay.

## Architecture

Input becomes small JSON-serializable commands which cross an explicit session boundary. The default URL retains the complete offline path, while an explicit co-op URL selects the authoritative browser path:

```text
Game.js
  ↓
LocalGameSession
  ↓
single-player GameSimulation

Game.js
  ↓
NetworkGameSession
  ↓
WebSocket protocol v2
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

The browser `NetworkGameSession` creates or joins a room through the Worker, accepts its slot only from `welcome`, and consumes the 30 Hz authoritative `state-frame`. Co-op is boss-only: the server owns all gameplay, while the presentation layer predicts local movement and interpolates remote movement without changing canonical state. There is no reconnect, Telegram, multiplayer Stage 1, or active-match persistence. The complete offline v0.5 single-player path remains the unchanged default at `/`.

### Local two-tab co-op

Start Wrangler and Vite separately:

```sh
# Terminal A
npm run dev:server

# Terminal B
npm run dev
```

Open `http://localhost:5173/?coop=create`. Once the address changes to the shareable `?coop=join&room=<room-id>` URL, copy that URL into a second tab. The Vite development server proxies only `/api` (including WebSocket upgrades) to Wrangler at `127.0.0.1:8787`.

Expected behavior: the tabs receive slots 1 and 2, begin at tick zero, render both Raiders and the same Warden-X, control only their server-assigned Raider, and share one boss HP value. Closing either tab aborts the match for the survivor; the survivor waits in the room, and a replacement tab starts a fresh match without resetting the surviving connection's input sequence.

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
npm run test:network-session
npm run build
npm run verify:build
npm run verify:deploy
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

## Production deployment

The production deployment is one Cloudflare Worker origin. Cloudflare Static Assets serves the Vite output in `dist/` (including SPA navigation fallback), while `/api/*` runs the Worker first so room creation, API errors, and WebSocket upgrades reach `server/worker.js` and the `RAID_ROOMS` Durable Object binding. The browser continues to derive HTTP and WebSocket URLs from `window.location.origin`; HTTPS therefore selects WSS without a separate API host or CORS.

Install dependencies (`npm ci` for a lockfile-exact clean install, or `npm install` during local development) and deploy with a Cloudflare-authenticated Wrangler session:

```sh
npm ci
npm run deploy
```

`npm run deploy` builds the client, verifies the production output and deployment configuration, and then deploys with the pinned Wrangler version. `dist/` is generated for deployment and is not committed.

For the first Internet co-op test, open this on Device A:

```text
https://<origin>/?coop=create
```

After room creation changes the address, copy the complete resulting URL:

```text
https://<origin>/?coop=join&room=<roomId>
```

Open that exact URL on Device B. The devices should receive slots 1 and 2 and share one Warden-X, with responsive local prediction, smooth remote interpolation, shared authoritative boss HP, and server-authoritative resources and damage. An active disconnect aborts the match; connecting a replacement player starts a fresh match.

## Scope

There are no intentional changes to controls, balance, assets, enemy behavior, stage progression, or Warden-X thresholds and patterns. The server foundation does not add client networking, multiplayer simulation, persistence, Telegram SDK, or Telegram integration. The production client retains its origin-root (`base: '/'`) deployment contract.
