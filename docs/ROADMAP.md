# Roadmap

This is the current engineering order, not a promise to implement every possible feature in the next PR.

## Current milestone

**FIRST ONLINE PLAYABLE — ACHIEVED.** Two real devices can use a public same-origin Cloudflare deployment to create/join one room, enter the shared two-Raider Warden-X encounter, move, and shoot under server authority. This was manually observed on 2026-09-02.

## Next engineering order

Browser resume is implemented and public co-op explicitly opts into it. PR #16 covers client-first stale-transport takeover, and PR #19's authoritative-frame watchdog is deployed for the reproduced server-first OPEN-but-stalled ordering. A fresh two-player real-phone test still ended at `NETWORK DISCONNECTED` after Wi-Fi was off for roughly 2–3 seconds and did not recover after 10–20 seconds. The watchdog alone was not sufficient, so production reconnect remains broken / unverified. The next work order is:

1. Run a production two-device reconnect smoke and screenshot the compact reason/trigger/`A/O/W/S` diagnostic summary if it fails.
2. Use the safe in-memory trace to determine whether failure occurs while connecting, authenticating, synchronizing, or after synchronization.
3. Do not select another behavior fix until that evidence identifies the failing stage; then retest first resume, normal gameplay, second resume with the rotated credential, and failure beyond eight seconds.
4. Add multiplayer diagnostics and observability.
5. Add the Telegram Mini App identity and invite layer.

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
