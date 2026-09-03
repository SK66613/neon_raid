# Roadmap

This is the current engineering order, not a promise to implement every possible feature in the next PR.

## Current milestone

**FIRST ONLINE PLAYABLE — ACHIEVED.** Two real devices can use a public same-origin Cloudflare deployment to create/join one room, enter the shared two-Raider Warden-X encounter, move, and shoot under server authority. This was manually observed on 2026-09-02.

## Next engineering order

Browser resume is implemented but temporarily disabled by default after the 2026-09-03 production startup regression. The next work order is:

1. Restore and manually verify two-device production startup.
2. Build a real cross-layer `RaidRoom` ↔ `NetworkGameSession` regression harness.
3. Identify and fix the reconnect-capable startup failure without assuming a root cause.
4. Re-enable browser reconnect only after production startup is proven.
5. Add multiplayer diagnostics and observability.

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
