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

After PR #15 enabled public reconnect, PC-and-phone tests interrupted and restored phone Wi-Fi during fresh active Warden-X matches. One reconnect succeeded, but the repeatable result froze and ended at `NETWORK DISCONNECTED`; refresh did not restore the intentionally memory-only credential. PR #16's client-first delayed-server-departure ordering remains covered by authenticated stale-transport takeover. PR #19's authoritative-frame watchdog is deployed, but a subsequent fresh two-player phone test still failed after a roughly 2–3 second Wi-Fi interruption and did not recover after waiting 10–20 seconds. The watchdog alone was not sufficient. Production reconnect remains **broken / unverified**.

The failure status now includes a compact, screenshot-friendly reason, trigger, and `A#/O#/W#/S#` summary (attempts created/opened, welcomes, and sync frames). During the next required production test, capture that complete status and, if available, the safe memory-only result of `window.__NEON_NETWORK_DEBUG()`. It contains no resume credential. Do not choose another reconnect behavior change until this trace identifies the failing stage.


## Manual production reconnect smoke — REQUIRED POST-MERGE VALIDATION

1. Create a fresh room and start a live Warden-X match with Device A and Device B.
2. Turn phone Wi-Fi off for approximately two seconds, then turn it on again. Do **not** refresh.
3. Expect `NETWORK INTERRUPTED — RECONNECTING…`, then `CONNECTION RESTORED — RAID CONTINUES` in the same match and Raider slot.
4. Continue movement and fire for at least ten seconds, confirming authoritative frames and shared boss progression continue.
5. If recovery fails, screenshot the complete compact reconnect summary before refreshing and report its reason, trigger, and `A/O/W/S` counts.
6. Repeat the approximately two-second Wi-Fi interruption on the same phone and verify a second resume with rotated credential behavior.
7. Only after both short interruptions pass, test a greater-than-eight-second outage separately; expect terminal disconnect/abort rather than silent identity replacement.

Do not use refresh/reload for this smoke: this PR deliberately keeps resume credentials in JavaScript memory only. Record actual observations; this procedure has not yet been manually verified in production.
