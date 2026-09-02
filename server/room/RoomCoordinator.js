export const ROOM_CAPACITY = 2;

export class RoomCoordinator {
  constructor(members = []) {
    this.members = new Map();
    for (const member of members) this.restore(member);
  }

  restore({ connectionId, slot, lastInputSeq = -1 }) {
    if (typeof connectionId !== 'string' || !Number.isInteger(slot) || slot < 1 || slot > ROOM_CAPACITY) return false;
    if ([...this.members.values()].some((member) => member.slot === slot)) return false;
    this.members.set(connectionId, { connectionId, slot, lastInputSeq });
    return true;
  }

  join(connectionId) {
    if (this.members.has(connectionId)) return { ok: false, reason: 'duplicate' };
    const occupied = new Set([...this.members.values()].map(({ slot }) => slot));
    const slot = [1, 2].find((candidate) => !occupied.has(candidate));
    if (!slot) return { ok: false, reason: 'full' };
    const member = { connectionId, slot, lastInputSeq: -1 };
    this.members.set(connectionId, member);
    return { ok: true, member: { ...member } };
  }

  leave(connectionId) {
    return this.members.delete(connectionId);
  }

  acceptInput(connectionId, seq) {
    const member = this.members.get(connectionId);
    if (!member) return { ok: false, reason: 'not-member' };
    if (!Number.isSafeInteger(seq) || seq < 0 || seq <= member.lastInputSeq) {
      return { ok: false, reason: 'stale-sequence' };
    }
    member.lastInputSeq = seq;
    return { ok: true, member: { ...member } };
  }

  get capacity() { return ROOM_CAPACITY; }
  get size() { return this.members.size; }
  roster() {
    return [...this.members.values()]
      .map(({ connectionId, slot }) => ({ connectionId, slot }))
      .sort((a, b) => a.slot - b.slot);
  }
}
