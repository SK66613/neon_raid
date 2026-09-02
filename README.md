# NEON RAID

NEON RAID is a vanilla JavaScript and Canvas top-down cyberpunk shooter / roguelite. The complete offline v0.5 game contains the Corp Sec sector and three-phase Warden-X encounter. Public two-player co-op for the Warden-X encounter is now live at **<https://neon-raid.cyberian13.workers.dev/>**.

On 2026-09-02, the owner manually verified the production co-op flow with two real devices. See the **[canonical engineering documentation](docs/README.md)** for the current architecture, multiplayer invariants, operations, limitations, and roadmap.

## Architecture at a glance

- Offline: `Game.js` → `LocalGameSession` → deterministic `GameSimulation`.
- Online: `Game.js` → `NetworkGameSession` → WebSocket protocol v2 → Cloudflare Worker and `RaidRoom` Durable Object → fixed-30 Hz `AuthoritativeMatchHost` and `MultiplayerBossSimulation`.
- The online server owns gameplay truth. The client sends intent and adds presentation-only prediction, reconciliation, and interpolation.
- Multiplayer currently covers exactly two Raiders in the Warden-X encounter; Stage 1 remains single-player.

## Local development

```sh
npm install
npm run dev
```

For local two-tab co-op, run Wrangler and Vite separately:

```sh
# Terminal A
npm run dev:server

# Terminal B
npm run dev
```

Open `http://localhost:5173/?coop=create`, then copy the generated `?coop=join&room=<roomId>` URL into a second tab.

## Validation

```sh
npm ci
npm run check
npm run test:simulation
npm run test:session
npm run test:room
npm run test:multiplayer-simulation
npm run test:player-kinematics
npm run test:authoritative-room
npm run test:network-session
npm run build
npm run verify:build
npm run verify:deploy
npm run build:server
npm run test:smoke
```

## Deployment

The production deployment is a single same-origin Cloudflare Worker with Static Assets and the `RAID_ROOMS` Durable Object binding. With an authenticated Wrangler session:

```sh
npm ci
npm run deploy
```

`dist/` is generated before deployment and is not committed. Operational details and the two-device smoke procedure are in the [production runbook](docs/PRODUCTION_RUNBOOK.md).

## Controls

- **WASD / arrow keys:** move
- **Space:** fire
- **Shift:** dash
- **G:** grenade
- **Touch controls:** movement, fire, dash, grenade, pause, and restart
