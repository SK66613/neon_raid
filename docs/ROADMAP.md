# Roadmap

This is the current engineering order, not a promise to implement every possible feature in the next PR.

## Current milestone

**FIRST ONLINE PLAYABLE — ACHIEVED.** Two real devices can use a public same-origin Cloudflare deployment to create/join one room, enter the shared two-Raider Warden-X encounter, move, and shoot under server authority. This was manually observed on 2026-09-02.

## Next engineering order

Browser resume is implemented and public co-op explicitly opts into it. The first production reconnect test after PR #15 failed at `NETWORK DISCONNECTED`; authenticated stale-transport takeover now covers the reproduced delayed server-departure race. Production reconnect remains unverified pending an owner retest. The next work order is:

1. Run a production two-device reconnect smoke covering first resume, normal gameplay after resume, second resume with the rotated credential, and failure beyond eight seconds.
2. Fix any remaining production-only reconnect issue if one is observed.
3. Add multiplayer diagnostics and observability.
4. Add the Telegram Mini App identity and invite layer.

Do not proceed to Telegram until this order is complete and reliable browser multiplayer is re-established.

Reload recovery remains outside the browser reconnect scope because tickets are memory-only.

## Telegram

After reliable browser multiplayer:

- Add a Telegram Mini App shell.
- Validate `initData` on the server and establish trusted Telegram user identity.
- Add `startapp` room invites and Telegram sharing.

Telegram is never gameplay authority.

## Expansion

Only after reliable two-player production, consider:

- Four-player generalization.
- Stage 1 multiplayer.
- Progression and content.
- Loot, token, or NFT mechanics only when product requirements justify them.

These are later phases, not the scope of the next PR.
