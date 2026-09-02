import { RaidRoom } from './RaidRoom.js';
import { ROOM_CAPACITY } from './room/RoomCoordinator.js';

const ROOM_ID_PATTERN = /^[0-9a-f]{32}$/;

export { RaidRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/rooms') {
      const roomId = crypto.randomUUID().replaceAll('-', '');
      return Response.json({ roomId, capacity: ROOM_CAPACITY }, { status: 201 });
    }
    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/);
    if (request.method === 'GET' && match) {
      const roomId = decodeURIComponent(match[1]);
      if (!ROOM_ID_PATTERN.test(roomId)) return Response.json({ error: 'invalid-room-id' }, { status: 400 });
      const stub = env.RAID_ROOMS.get(env.RAID_ROOMS.idFromName(roomId));
      const durableUrl = new URL(request.url);
      durableUrl.pathname = '/ws';
      durableUrl.search = '';
      durableUrl.searchParams.set('roomId', roomId);
      return stub.fetch(new Request(durableUrl, request));
    }
    return Response.json({ error: 'not-found' }, { status: 404 });
  },
};
