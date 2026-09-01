export const CommandType = Object.freeze({
  MOVE: 'move', FIRE: 'fire', DASH: 'dash', GRENADE: 'grenade',
  PAUSE: 'pause', RESTART: 'restart', RELOAD: 'reload',
});

export const moveCommand = (x, y) => ({ type: CommandType.MOVE, x, y });
export const fireCommand = active => ({ type: CommandType.FIRE, active });
