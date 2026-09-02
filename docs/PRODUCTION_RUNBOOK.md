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
