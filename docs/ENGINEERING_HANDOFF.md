# Engineering Handoff

## Project

NEON RAID is a browser top-down cyberpunk shooter / roguelite. The current offline game is the full v0.5 two-stage experience:

1. **Stage 1:** Corp Sec sector.
2. **Stage 2:** Warden-X reactor boss.

Current multiplayer scope is the Warden-X boss encounter only. Multiplayer Stage 1 is not implemented.

## Current verified state

| Item | Value |
| --- | --- |
| Repository | `SK66613/neon_raid` |
| Default branch | `main` |
| Verified implementation baseline | `4ca95666fac598c2d4d3b0e76b20f25b3ceb0c75` |
| Status date | 2026-09-02 |
| Production | <https://neon-raid.cyberian13.workers.dev/> |

The baseline SHA identifies the code and production implementation state audited for this handoff. It is not a promise that `main` remains at that commit: documentation-only and later feature merges may advance the branch. Check the actual GitHub `main` ref whenever an exact current SHA matters.

**FIRST ONLINE PLAYABLE has been reached.** On 2026-09-02, production was manually exercised with a desktop browser and a phone browser. Device A created a room and received a shareable URL; Device B joined that same URL. The authoritative room started after both connected, the Warden-X scene contained two Raiders and one shared boss, and both players could move and shoot.

This is a manual production smoke observation, not automated proof. It does not establish reconnect/rejoin, multiplayer Stage 1, four-player support, or active-match persistence.

## High-level architecture

```text
Browser / future Telegram Mini App
  ↓ input intent
NetworkGameSession
  ↓ WebSocket protocol v2
Cloudflare Worker
  ↓
RaidRoom Durable Object
  ↓
AuthoritativeMatchHost
  ↓ fixed 30 Hz
MultiplayerBossSimulation
  ↓ authoritative state-frame
NetworkGameSession
  ↓
local prediction / reconciliation + remote interpolation
  ↓
Game.js
  ↓
Canvas
```

**SERVER = gameplay authority. CLIENT = intent + presentation.** A future Telegram integration is a launch, authentication, and invite shell only; it must never become gameplay authority.

## Repository ownership

| Module | Responsibility |
| --- | --- |
| `src/game/Game.js` | Browser input, Canvas, HUD, audio, cosmetic FX, and the presentation loop. |
| `src/game/simulation/GameSimulation.js` | Deterministic offline single-player gameplay. |
| `src/game/session/GameSession.js` | Session abstraction. |
| `src/game/session/LocalGameSession.js` | Offline session implementation. |
| `src/game/session/NetworkGameSession.js` | Browser multiplayer transport/session, canonical server snapshot, and presentation prediction/interpolation/reconciliation. |
| `src/game/multiplayer/MultiplayerBossSimulation.js` | Authoritative two-player Warden-X gameplay. |
| `src/game/multiplayer/playerKinematics.js` | Pure shared Raider movement geometry used by server simulation and client prediction. |
| `server/room/AuthoritativeMatchHost.js` | Owns one authoritative simulation and its fixed server tick. |
| `server/RaidRoom.js` | Durable Object room, WebSockets, slots, and match lifecycle. |
| `server/worker.js` | Room creation and WebSocket routing. |
| `src/game/network/protocol.js` | Strict multiplayer protocol v2. |
| `wrangler.jsonc` | Worker, static assets, Durable Object binding/migration, and same-origin production deployment. |

## Release / PR evolution

The merge history records these architectural milestones:

1. **PR #1:** modular client foundation.
2. **PR #2:** deterministic gameplay simulation.
3. **PR #3:** local session boundary.
4. **PR #4:** multiplayer Worker/room foundation.
5. **PR #5:** authoritative two-player boss simulation.
6. **PR #6:** authoritative `RaidRoom` matches.
7. **PR #7:** playable browser `NetworkGameSession`.
8. **PR #8:** smoothing, prediction, and reconciliation.
9. **PR #9:** production same-origin Cloudflare deployment, merged at `4ca95666fac598c2d4d3b0e76b20f25b3ceb0c75`.

## What is currently working

### Offline

- Full v0.5 two-stage single-player game.

### Online

- Room creation and a shareable join URL.
- Exactly two server-owned player slots and one shared Warden-X.
- Fixed-30 Hz authoritative simulation.
- Authoritative damage, resources, death, win, and loss.
- Browser rendering of both Raiders.
- Local movement and dash prediction, server reconciliation, soft correction, and hard snap for rejected dash-scale disagreement.
- Remote Raider, boss, and projectile interpolation.
- Same-origin HTTPS/WSS production deployment.
- Active-disconnect abort; a replacement player can start a fresh match.

### CI and automated validation coverage

- Source/assets checks; simulation, session, room/protocol, multiplayer simulation, shared kinematics, authoritative room, and network session tests.
- Vite build, build verification, deployment-config verification, Worker dry-run, and Chromium smoke.

## Known limitations

These are deferred scope, not necessarily defects:

- No browser automatic reconnect/rejoin orchestration yet; server grace is capability-gated.
- No persistent player identity.
- The active match remains in memory, with no active-match restore after Durable Object/runtime loss.
- No Telegram authentication or Telegram `startapp` invite flow.
- No multiplayer Stage 1.
- Room capacity is exactly 2; there is no four-player generalization.
- No full progression, loot, token, or NFT system.

## Server reconnect foundation (2026-09-02)

`RaidRoom` now supports opt-in, authenticated, eight-second reconnectable membership for active matches. Membership reservations and the authoritative host are intentionally in memory only, so Durable Object runtime loss continues to fail closed rather than fabricate recovered simulation state. The current browser `NetworkGameSession` does **not** opt in, retain tickets, or automatically reconnect in this PR; ordinary production browser disconnect behavior remains unchanged until the follow-up browser work.
