import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomCoordinator, ROOM_CAPACITY } from '../server/room/RoomCoordinator.js';
import { validateInputMessage } from '../src/game/network/protocol.js';

test('an empty room has capacity two and allocates both slots', () => {
  const room = new RoomCoordinator();
  assert.equal(room.capacity, ROOM_CAPACITY);
  assert.equal(room.capacity, 2);
  assert.deepEqual(room.join('alpha'), { ok: true, member: { connectionId: 'alpha', slot: 1, lastInputSeq: -1 } });
  assert.deepEqual(room.join('beta'), { ok: true, member: { connectionId: 'beta', slot: 2, lastInputSeq: -1 } });
  assert.deepEqual(room.join('gamma'), { ok: false, reason: 'full' });
});

test('leaving frees the lowest slot for reuse without disturbing a peer', () => {
  const room = new RoomCoordinator();
  room.join('alpha');
  room.join('beta');
  assert.equal(room.leave('alpha'), true);
  assert.deepEqual(room.roster(), [{ connectionId: 'beta', slot: 2 }]);
  assert.equal(room.join('gamma').member.slot, 1);
  assert.deepEqual(room.roster(), [
    { connectionId: 'gamma', slot: 1 },
    { connectionId: 'beta', slot: 2 },
  ]);
});

test('fresh input sequences advance and duplicate or stale sequences do not', () => {
  const room = new RoomCoordinator();
  room.join('alpha');
  assert.equal(room.acceptInput('alpha', 4).ok, true);
  assert.deepEqual(room.acceptInput('alpha', 4), { ok: false, reason: 'stale-sequence' });
  assert.deepEqual(room.acceptInput('alpha', 3), { ok: false, reason: 'stale-sequence' });
  assert.equal(room.acceptInput('alpha', 5).ok, true);
  assert.deepEqual(room.acceptInput('missing', 0), { ok: false, reason: 'not-member' });
});

test('attachment restore fails closed on malformed or duplicate metadata', () => {
  const room = new RoomCoordinator();
  assert.equal(room.restore(null), false);
  assert.equal(room.restore([]), false);
  assert.equal(room.restore({ connectionId: 'alpha', slot: 1 }), false);
  assert.equal(room.restore({ connectionId: '', slot: 1, lastInputSeq: -1 }), false);
  assert.equal(room.restore({ connectionId: 'alpha', slot: 0, lastInputSeq: -1 }), false);
  assert.equal(room.restore({ connectionId: 'alpha', slot: 1, lastInputSeq: -2 }), false);
  assert.equal(room.restore({ connectionId: 'alpha', slot: 1, lastInputSeq: 1.5 }), false);
  assert.equal(room.restore({ connectionId: 'alpha', slot: 1, lastInputSeq: 7 }), true);
  assert.equal(room.restore({ connectionId: 'alpha', slot: 2, lastInputSeq: 8 }), false);
  assert.equal(room.restore({ connectionId: 'beta', slot: 1, lastInputSeq: 8 }), false);
  assert.deepEqual(room.roster(), [{ connectionId: 'alpha', slot: 1 }]);
});

test('wire commands cannot inject authoritative state or global controls', () => {
  for (const command of [
    { type: 'move', x: 0, y: 1, hp: 100 },
    { type: 'setPosition', x: 2, y: 3 },
    { type: 'damageBoss', damage: 10 },
    { type: 'pause' },
    { type: 'restart' },
    { type: 'unknown' },
  ]) {
    assert.equal(validateInputMessage({ version: 2, type: 'input', matchId: 'match', seq: 0, command }).ok, false);
  }
});
