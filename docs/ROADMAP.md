# Roadmap

This is the current engineering order, not a promise to implement every possible feature in the next PR.

## Current milestone

**FIRST ONLINE PLAYABLE — ACHIEVED.** Two real devices can use a public same-origin Cloudflare deployment to create/join one room, enter the shared two-Raider Warden-X encounter, move, and shoot under server authority. This was manually observed on 2026-09-02.

## Next: reliable online

The first engineering feature after this documentation is **reconnect/rejoin architecture**. Its target concepts are:

- A short disconnect grace period, likely 5–10 seconds.
- A server-issued reconnect identity/token.
- Reclaiming the same slot, room, and match.
- Neutral or frozen Raider behavior while its connection is absent.
- Continuing the match when reconnection occurs before grace expiry.
- Aborting the match when grace expires.

**This contract must be designed before implementation.** Reconnect behavior is not part of the current system and is not implemented by this documentation PR.

After reconnect/rejoin:

1. Improve production diagnostics and observability.
2. Evaluate active-match checkpoint/recovery only after reconnect is established.

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
