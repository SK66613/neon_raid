# Roadmap

This is the current engineering order, not a promise to implement every possible feature in the next PR.

## Current milestone

**FIRST ONLINE PLAYABLE — ACHIEVED.** Two real devices can use a public same-origin Cloudflare deployment to create/join one room, enter the shared two-Raider Warden-X encounter, move, and shoot under server authority. This was manually observed on 2026-09-02.

## Next engineering order

Browser resume is implemented but temporarily disabled by default. Fresh-room two-device startup was manually reverified after PR #13, and the deterministic cross-layer harness passes without establishing the cause of the earlier observation. The next work order is:

1. Independently audit and merge the cross-layer harness.
2. Re-enable browser reconnect in one tiny focused PR.
3. Run a production two-device reconnect smoke covering first resume, normal gameplay after resume, second resume with the rotated credential, and failure beyond eight seconds.
4. Add multiplayer diagnostics and observability.
5. Add the Telegram layer.

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
