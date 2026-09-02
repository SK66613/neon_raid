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
