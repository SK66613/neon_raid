# Multiplayer Contract

These are the current multiplayer invariants. Future PRs must preserve them unless a dedicated architecture change explicitly revises the contract.

## Authority

The client may submit **only intent**. The allowed remote commands are `move`, `fire`, `dash`, and `grenade`.

The client must never authoritatively send or set `dt`, `slot`, `connectionId`, position, velocity, HP, armor, ammo, reserve ammo, grenade count, damage, boss HP, boss damage, death, win/loss, canonical bullets, or canonical enemy state. The server decides every gameplay result.

## Protocol

`MULTIPLAYER_PROTOCOL_VERSION = 2`. Input has this shape:

```js
{
  version: 2,
  type: "input",
  matchId,
  seq,
  command
}
```

- `roomId` identifies the Durable Object room.
- `matchId` identifies one particular match lifecycle inside that room.
- `seq` increases monotonically per socket connection. It must not reset for a replacement match while that socket survives.

## Server tick

The authoritative server advances at **30 Hz**. Browser `dt` must never advance canonical multiplayer gameplay.

## Snapshot contract

- `NetworkGameSession.getSnapshot()` returns only the latest authoritative server truth.
- `NetworkGameSession.getRenderSnapshot()` returns a presentation-only copy. It may include local predicted movement, reconciliation correction, remote interpolation, and boss/projectile interpolation.

The render snapshot must never become canonical gameplay state.

## Prediction

Prediction is limited to local Raider presentation movement. It may predict `x`/`y`, `vx`/`vy`, movement direction, and dash presentation movement.

It must not predict canonical HP, armor, ammo, grenades, damage, boss HP, death, win/loss, or bullets.

## Interpolation

- Do not extrapolate.
- Identify remote Raiders by slot, the boss by stable ID, and bullets/enemy bullets by stable ID.
- Interpolate continuous presentation fields.
- Take authoritative resource and state fields from the newest server frame.

## Reconciliation

The server always wins. Reconciliation uses ACK-aware movement history and authoritative frames: reflected inputs are retired, while an unreflected dash may be replayed. Small position disagreement is soft-corrected; large disagreement is hard-snapped. A rejected, reflected dash-scale disagreement is also hard-snapped.

## Lifecycle

The normal lifecycle is:

```text
WAITING → READY → COMPLETE
READY → RECONNECTING → READY
RECONNECTING → ERROR (when recovery fails)
```

An active disconnect currently follows:

```text
READY match A → player disconnect → match-aborted
→ survivor WAITING → replacement → fresh match B
```

A completed vacancy follows:

```text
COMPLETE → roster vacancy → WAITING → replacement → fresh match
```

Old or retired match frames cannot reactivate a previous match.

## Room

Capacity is exactly **2**, with server-owned slots **1** and **2**. Slot assignment is server-owned. Do not casually change capacity from two to four; that requires a dedicated architecture change.

## Reconnectable membership (protocol v2)

Reconnect is an additive, capability-gated protocol-v2 contract; it does not change server authority. A fresh internal WebSocket may opt in with `reconnect=1`. At match start the server privately sends that member a match-scoped `resume-ticket` containing its public logical `connectionId`, `matchId`, a secret 64-character lowercase hexadecimal token, and the fixed 8,000 ms grace duration. The token must never be placed in public/share URLs, rosters, logs, errors, or presentation-oriented connection information.

An unexpected active disconnect reserves the same room slot and keeps the authoritative match ticking while neutral move and fire intents are applied. An unauthenticated `resume=1` transport must first send the exact `resume` envelope. Successful authentication before the deadline preserves `roomId`, `matchId`, `connectionId`, slot, and simulation state, rotates the secret, and sends an immediate non-advancing synchronization frame. Input `seq` is per WebSocket, so the resumed connection resets to `-1` and may begin at zero; the survivor's sequence is unchanged. Expiry aborts with `player-left`. Runtime loss still fails closed because hosts and reservations remain in memory.

The public invite remains `?coop=join&room=<roomId>`; transport flags and credentials do not belong in it.


## Browser reconnect lifecycle

`NetworkGameSession` opts fresh create and join transports into reconnectable membership. It owns the latest server ticket privately and in memory only. On an eligible active-match interruption it freezes the last authoritative presentation, allows only persistent desired move/fire state to change, and runs at most one resume WebSocket attempt at a time inside the original server-advertised deadline. No gameplay is sent before the authenticated synchronization frame.

The synchronization frame rebases presentation directly to server truth. It normally advances the tick, but the single authenticated resume barrier may replace a same-match frame whose tick equals the last observed tick; lower ticks remain invalid and ordinary frames remain strictly increasing. A resumed WebSocket starts a new client sequence domain at zero, clears ACK/prediction history, and replays the latest move and fire intents once if the local Raider is alive. Dash and grenade edges are never replayed. Rotated credentials replace earlier tickets and support another interruption in the same match.
