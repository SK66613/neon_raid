# Roadmap

This is the current engineering order, not a promise to implement every possible feature in the next PR.

## Current milestone

**FIRST ONLINE PLAYABLE — ACHIEVED.** Two real devices can use a public same-origin Cloudflare deployment to create/join one room, enter the shared two-Raider Warden-X encounter, move, and shoot under server authority. This was manually observed on 2026-09-02.

## Next engineering order

Browser resume is implemented. The next work order is:

1. Production validation of browser reconnect.
2. Multiplayer diagnostics and observability.
3. Evaluate active-match checkpoint/recovery only if production evidence shows it is needed.
4. Telegram Mini App identity and invite layer.

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
