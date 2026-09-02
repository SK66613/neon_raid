import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../server/worker.js';

const ISSUED_ROOM_ID = 'a'.repeat(64);

function createEnvironment() {
  const calls = { get: [], idFromString: [], forwarded: [], newUniqueId: 0 };
  const issuedId = { toString: () => ISSUED_ROOM_ID };
  const stub = {
    fetch(request) {
      calls.forwarded.push(request);
      return new Response('upgraded');
    },
  };
  const namespace = {
    newUniqueId() {
      calls.newUniqueId += 1;
      return issuedId;
    },
    idFromString(value) {
      calls.idFromString.push(value);
      if (value !== ISSUED_ROOM_ID) throw new TypeError('Invalid Durable Object ID');
      return issuedId;
    },
    get(id) {
      calls.get.push(id);
      return stub;
    },
  };
  return { env: { RAID_ROOMS: namespace }, calls, issuedId };
}

test('POST issues the namespace unique ID and fixed capacity', async () => {
  const { env, calls } = createEnvironment();
  const response = await worker.fetch(new Request('https://example.test/api/rooms', { method: 'POST' }), env);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { roomId: ISSUED_ROOM_ID, capacity: 2 });
  assert.equal(calls.newUniqueId, 1);
  assert.deepEqual(calls.idFromString, []);
});

test('join restores an issued ID and forwards its canonical value to the matching stub', async () => {
  const { env, calls, issuedId } = createEnvironment();
  const response = await worker.fetch(new Request(`https://example.test/api/rooms/${ISSUED_ROOM_ID}/ws`, {
    headers: { Upgrade: 'websocket' },
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.idFromString, [ISSUED_ROOM_ID]);
  assert.deepEqual(calls.get, [issuedId]);
  assert.equal(calls.forwarded.length, 1);
  assert.equal(new URL(calls.forwarded[0].url).searchParams.get('roomId'), ISSUED_ROOM_ID);
});

test('old, malformed, unissued, and malformed-encoded room IDs return 400', async () => {
  const { env, calls } = createEnvironment();
  const ids = ['b'.repeat(32), 'not-a-room', 'b'.repeat(64), '%E0%A4%A'];
  for (const roomId of ids) {
    const response = await worker.fetch(new Request(`https://example.test/api/rooms/${roomId}/ws`), env);
    assert.equal(response.status, 400, roomId);
    assert.deepEqual(await response.json(), { error: 'invalid-room-id' });
  }
  assert.equal(calls.forwarded.length, 0);
  assert.deepEqual(calls.idFromString, ['b'.repeat(64)]);
});

test('unknown routes and wrong methods return 404 without creating or joining', async () => {
  const { env, calls } = createEnvironment();
  const requests = [
    new Request('https://example.test/nope'),
    new Request('https://example.test/api/rooms'),
    new Request(`https://example.test/api/rooms/${ISSUED_ROOM_ID}/ws`, { method: 'POST' }),
  ];
  for (const request of requests) assert.equal((await worker.fetch(request, env)).status, 404);
  assert.equal(calls.newUniqueId, 0);
  assert.equal(calls.forwarded.length, 0);
  assert.deepEqual(calls.idFromString, []);
});
