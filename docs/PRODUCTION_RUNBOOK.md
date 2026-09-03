# Production Runbook

**Production URL:** <https://neon-raid.cyberian13.workers.dev/>

## Topology and deployment contract

Production combines a Cloudflare Worker, Cloudflare Static Assets, and the `RAID_ROOMS` Durable Object binding. The current Wrangler contract is:

| Setting | Value |
| --- | --- |
| Static assets directory | `./dist` |
| Static assets binding | `ASSETS` |
| SPA fallback | `single-page-application` |
| Worker-first routes | `/api/*` |
| Durable Object | `RAID_ROOMS` → `RaidRoom` |

The SQLite Durable Object migration remains required.

## Cloudflare Builds

Use the intended Cloudflare build configuration:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `npm run build && npm run verify:build && npm run verify:deploy` |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

The build must create `dist/` before Worker Static Assets deployment. Never put credentials or tokens in repository configuration or documentation.

## Local validation

Run from the repository root:

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

## Production two-device smoke

### Already observed in production

On 2026-09-02, the owner manually exercised the public Cloudflare origin with two real devices:

1. Device A opened <https://neon-raid.cyberian13.workers.dev/?coop=create>.
2. Device A received a shareable join URL.
3. Device B opened the exact generated URL: `https://neon-raid.cyberian13.workers.dev/?coop=join&room=<roomId>`.
4. The boss scene began with two visible Raiders and one shared Warden-X.
5. Both players could move and shoot.

This was a manual production smoke, not an automated E2E result. Reconnect was not tested.

### Recommended checks for every future release

Repeat the two-device flow. The first player should wait; after the second joins, the boss scene should begin with two Raiders and one shared Warden-X. Manually check:

- Local responsiveness and remote smoothing.
- Shared boss HP and authoritative ammo/HP.
- Dash behavior.
- Active disconnect behavior.
- Replacement-player fresh-match behavior.

Record observed results rather than treating this checklist as proof that unperformed checks passed.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Blank/waiting screen with only one connected player | Expected: the match requires two players. |
| Both players remain waiting | Check Cloudflare Observability logs and the WebSocket room lifecycle. |
| Static asset deployment fails | Verify the build command generated `dist/`. |
| An API route returns the SPA page | Verify `/api/*` remains Worker-first. |
| An unexpected old match appears | Inspect `matchId` lifecycle and stale-match protection. |

## Reconnect transport capability

The room WebSocket route selectively forwards the internal non-secret flags `reconnect=1` (fresh opt-in connection) and `resume=1` (pending authenticated resume), never arbitrary query parameters or resume tokens. Supplying both flags, or malformed values, returns HTTP 400. Public co-op now explicitly enables the capability, so its fresh WebSocket includes `reconnect=1`. Credentials remain private and memory-only.

### 2026-09-03 startup incident

Production validation after PR #12 observed that a room could be created and joined and membership could reach two Raiders, but the playable Warden-X match did not start/load. The exact runtime cause is not yet proven. The emergency mitigation disables the browser's default reconnect capability, restoring the previously verified ordinary-member startup path while leaving the server foundation and browser reconnect implementation intact for investigation behind cross-layer coverage.

After PR #13 deployed, a completely new room was manually verified on PC and phone on 2026-09-03: the Warden-X match started and gameplay was visible. This did not reproduce the earlier WAITING observation and does not prove its cause. Browser reconnect opt-in has now been re-enabled at the public co-op composition boundary. Production reconnect has not yet been manually verified after this enablement.


## Manual production reconnect smoke — REQUIRED POST-MERGE VALIDATION

1. Start a live Warden-X match with Device A and Device B.
2. **A. First reconnect:** without refreshing either page, temporarily interrupt one device's network. Confirm its last authoritative scene remains visible with `NETWORK INTERRUPTED — RECONNECTING…`; restore the network within the advertised grace and expect the same match, Raider slot, logical connection, and continuing boss state, followed by `CONNECTION RESTORED — RAID CONTINUES`.
3. **B. Normal gameplay after reconnect:** verify ordinary movement, fire, authoritative frames, and shared boss progression continue after the first reconnect.
4. **C. Second reconnect using rotated credential behavior:** interrupt and restore the same device again within the grace; expect a second successful resume using the server-rotated credential behavior, without exposing the credential.
5. **D. Disconnect beyond 8 seconds:** repeat, but leave the network unavailable beyond eight seconds. Expect recovery to stop and the survivor eventually to receive the existing match-aborted/waiting behavior.

Do not use refresh/reload for this smoke: this PR deliberately keeps resume credentials in JavaScript memory only. Record actual observations; this procedure has not yet been manually verified in production.
