# Roadmap

This is the current engineering order, not a promise to implement every possible feature in the next PR.

## Current milestone

**FIRST ONLINE PLAYABLE — ACHIEVED.** Two real devices can use a public same-origin Cloudflare deployment to create/join one room, enter the shared two-Raider Warden-X encounter, move, and shoot under server authority. This was manually observed on 2026-09-02.

## Next: browser resume and automatic reconnect

The immediate next step is the PR #12 browser integration in `NetworkGameSession`:

- Opt into the server transport with `reconnect=1`.
- Retain the server-issued ticket privately (never in the invite URL or browser persistence).
- Retry WSS only during the advertised grace period.
- Open `resume=1` and send the authenticated resume envelope.
- Reset presentation/prediction safely for the new WebSocket sequence domain.
- Preserve the same room, match, slot, and canonical simulation when resume succeeds.

The server-side reconnectable membership foundation is complete. Browser automatic reconnect, reconnect UI, and reload recovery are not part of that foundation.

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
