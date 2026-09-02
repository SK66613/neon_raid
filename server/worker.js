import { RaidRoom } from './RaidRoom.js';
import { ROOM_CAPACITY } from './room/RoomCoordinator.js';

const ROOM_ID_PATTERN = /^[0-9a-f]{64}$/;

const invalidRoomId = () => Response.json({ error: 'invalid-room-id' }, { status: 400 });

export { RaidRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/rooms') {
      const roomId = env.RAID_ROOMS.newUniqueId().toString();
      return Response.json({ roomId, capacity: ROOM_CAPACITY }, { status: 201 });
    }
    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/);
    if (request.method === 'GET' && match) {
      const reconnect = url.searchParams.get('reconnect');
      const resume = url.searchParams.get('resume');
      if ((reconnect !== null && reconnect !== '1') || (resume !== null && resume !== '1') || (reconnect === '1' && resume === '1')) {
        return Response.json({ error: 'invalid-websocket-capability' }, { status: 400 });
      }
      let candidate;
      try {
        candidate = decodeURIComponent(match[1]);
      } catch {
        return invalidRoomId();
      }
      if (!ROOM_ID_PATTERN.test(candidate)) return invalidRoomId();
      let id;
      try {
        id = env.RAID_ROOMS.idFromString(candidate);
      } catch {
        return invalidRoomId();
      }
      const roomId = id.toString();
      const stub = env.RAID_ROOMS.get(id);
      const durableUrl = new URL(request.url);
      durableUrl.pathname = '/ws';
      durableUrl.search = '';
      durableUrl.searchParams.set('roomId', roomId);
      if (reconnect === '1') durableUrl.searchParams.set('reconnect', '1');
      if (resume === '1') durableUrl.searchParams.set('resume', '1');
      return stub.fetch(new Request(durableUrl, request));
    }
    return Response.json({ error: 'not-found' }, { status: 404 });
  },
};
