const copy = value => JSON.parse(JSON.stringify(value));

export function createNetworkView(snapshot, localSlot) {
  if (!snapshot || (localSlot !== 1 && localSlot !== 2)) return null;
  const source = copy(snapshot);
  const player = source.players.find(candidate => candidate.slot === localSlot);
  if (!player) return null;
  return { ...source, stage: 2, player, remotePlayers: source.players.filter(candidate => candidate.slot !== localSlot),
    enemies: [], crates: [], barrels: [], transitionTimer: 0, paused: false,
    dead: !player.alive, won: source.status === 'won' };
}
