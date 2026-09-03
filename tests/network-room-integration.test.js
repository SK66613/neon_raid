import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTHORITATIVE_FRAME_STALL_MS, createNetworkGameSession } from '../src/game/session/NetworkGameSession.js';
import { SessionStatus } from '../src/game/session/GameSession.js';
import { createInMemoryMultiplayerHarness } from './helpers/in-memory-multiplayer-harness.js';

const ORIGIN = 'https://integration.test';
const serverMessages = (harness, connection, type) => harness.trace.filter(item =>
  item.direction === 'server→client' && item.connection === connection && (!type || item.type === type));
const clientMessages = (harness, connection, type) => harness.trace.filter(item =>
  item.direction === 'client→server' && item.connection === connection && (!type || item.type === type));
const networkErrors = events => events.filter(event => event.type === 'network-error');
const identity = ({ roomId, matchId, connectionId, slot }) => ({ roomId, matchId, connectionId, slot });

async function connectPair(harness, reconnectCapable) {
  const schedulerA = harness.clientScheduler(), schedulerB = harness.clientScheduler();
  let roomId;
  const a = await createNetworkGameSession({ mode: 'create', origin: ORIGIN, fetchImpl: harness.fetchImpl,
    WebSocketImpl: harness.BrowserWebSocket, scheduler: schedulerA, reconnectCapable,
    onRoomCreated: value => { roomId = value; } });
  await harness.flush();
  const b = await createNetworkGameSession({ mode: 'join', roomId, origin: ORIGIN,
    WebSocketImpl: harness.BrowserWebSocket, scheduler: schedulerB, reconnectCapable });
  await harness.flush();
  return { a, b, roomId, schedulerA, schedulerB, socketA: harness.sockets()[0], socketB: harness.sockets()[1] };
}

test('default production path crosses Worker, RaidRoom, and authoritative input round trip', async t => {
  const harness = createInMemoryMultiplayerHarness(); t.after(() => harness.restore());
  const { a, b, roomId, socketA, socketB } = await connectPair(harness, false);
  assert.match(roomId, /^[0-9a-f]{64}$/);
  assert.equal(new URL(socketA.url).search, ''); assert.equal(new URL(socketB.url).search, '');
  assert.equal(a.getStatus(), SessionStatus.READY); assert.equal(b.getStatus(), SessionStatus.READY);
  const infoA = a.getConnectionInfo(), infoB = b.getConnectionInfo(), room = harness.room(roomId);
  assert.equal(infoA.matchId, infoB.matchId); assert.deepEqual(new Set([infoA.slot, infoB.slot]), new Set([1, 2]));
  assert.equal(infoA.peerCount, 2); assert.equal(infoB.peerCount, 2); assert.ok(room.host);
  assert.equal(serverMessages(harness, socketA.connection, 'welcome').length, 1);
  assert.equal(serverMessages(harness, socketB.connection, 'welcome').length, 1);
  assert.equal(serverMessages(harness, socketA.connection, 'resume-ticket').length, 0);
  assert.equal(serverMessages(harness, socketB.connection, 'resume-ticket').length, 0);
  assert.equal(serverMessages(harness, socketA.connection, 'state-frame')[0].data.tick, 0);
  assert.equal(serverMessages(harness, socketB.connection, 'state-frame')[0].data.tick, 0);
  assert.equal(a.getSnapshot().boss.id, 'warden-x'); assert.deepEqual(a.getSnapshot(), b.getSnapshot());
  assert.deepEqual(networkErrors(a.drainEvents()), []); assert.deepEqual(networkErrors(b.drainEvents()), []);

  assert.equal(a.submit({ type: 'move', x: 1, y: 0 }), true); a.update(1 / 60); await harness.flush();
  const input = clientMessages(harness, socketA.connection, 'input').at(-1).data;
  assert.deepEqual(Object.keys(input).sort(), ['command', 'matchId', 'seq', 'type', 'version']);
  assert.equal(input.command.type, 'move'); assert.equal(input.dt, undefined); assert.equal(input.position, undefined); assert.equal(input.hp, undefined);
  assert.equal(a.getConnectionInfo().lastAckSeq, 0);
  harness.serverScheduler.runTicks(); await harness.flush();
  assert.equal(a.getConnectionInfo().lastServerTick, 1); assert.equal(b.getConnectionInfo().lastServerTick, 1);
  assert.deepEqual(a.getSnapshot(), b.getSnapshot());
});

test('reconnect-capable fresh startup accepts the real ticket-before-frame ordering', async t => {
  const harness = createInMemoryMultiplayerHarness(); t.after(() => harness.restore());
  const { a, b, roomId, socketA, socketB } = await connectPair(harness, true);
  for (const socket of [socketA, socketB]) {
    const url = new URL(socket.url); assert.equal(url.search, '?reconnect=1'); assert.equal(url.searchParams.has('resumeToken'), false);
    const messages = serverMessages(harness, socket.connection), types = messages.map(item => item.type);
    assert.ok(types.indexOf('welcome') < types.indexOf('resume-ticket'));
    assert.ok(types.indexOf('resume-ticket') < types.indexOf('state-frame'));
    assert.equal(messages.find(item => item.type === 'resume-ticket').data.matchId,
      messages.find(item => item.type === 'state-frame').data.matchId);
  }
  const attachments = harness.room(roomId).ctx.getWebSockets().map(socket => socket.deserializeAttachment());
  assert.equal(attachments.filter(item => item.reconnectCapable).length, 2);
  assert.equal(a.getStatus(), SessionStatus.READY); assert.equal(b.getStatus(), SessionStatus.READY);
  assert.equal(a.getConnectionInfo().matchId, b.getConnectionInfo().matchId);
  assert.deepEqual(new Set([a.getConnectionInfo().slot, b.getConnectionInfo().slot]), new Set([1, 2]));
  assert.equal(a.getConnectionInfo().lastServerTick, 0); assert.equal(b.getConnectionInfo().lastServerTick, 0);
  assert.deepEqual(networkErrors(a.drainEvents()), []); assert.deepEqual(networkErrors(b.drainEvents()), []);
});

test('active session resumes twice with rotated credentials and ordinary frames between', async t => {
  const harness = createInMemoryMultiplayerHarness(); t.after(() => harness.restore());
  const { a, b, roomId, schedulerA, socketA } = await connectPair(harness, true);
  a.drainEvents(); b.drainEvents();
  const before = a.getConnectionInfo(), room = harness.room(roomId), host = room.host;
  await harness.lose(socketA, { serverFirst: true });
  assert.equal(a.getStatus(), SessionStatus.READY);
  const firstResumeSocket = harness.sockets().at(-1), firstResume = clientMessages(harness, firstResumeSocket.connection, 'resume')[0].data;
  assert.equal(new URL(firstResumeSocket.url).search, '?resume=1'); assert.equal(new URL(firstResumeSocket.url).searchParams.has('resumeToken'), false);
  assert.equal(harness.trace.find(item => item.event === 'reservation-created' && item.connection === socketA.connection).count, 1);
  assert.equal(room.host, host); assert.equal(room.reservations.size, 0);
  assert.deepEqual(identity(a.getConnectionInfo()), identity(before));
  let events = a.drainEvents(); assert.equal(events.filter(item => item.type === 'network-reconnecting').length, 1);
  assert.equal(events.filter(item => item.type === 'network-resumed').length, 1);
  const resumeTypes = serverMessages(harness, firstResumeSocket.connection).map(item => item.type);
  assert.deepEqual(resumeTypes.slice(0, 4), ['welcome', 'resume-ticket', 'state-frame', 'roster']);
  assert.equal(a.submit({ type: 'dash' }), true); a.update(1 / 60); await harness.flush();
  assert.equal(clientMessages(harness, firstResumeSocket.connection, 'input').at(-1).data.seq, 0);

  harness.serverScheduler.runTicks(2); await harness.flush();
  assert.equal(a.getStatus(), SessionStatus.READY); assert.equal(b.getStatus(), SessionStatus.READY);
  assert.equal(a.getConnectionInfo().lastServerTick, 2); assert.equal(b.getConnectionInfo().lastServerTick, 2);
  assert.deepEqual(networkErrors(a.drainEvents()), []); assert.deepEqual(networkErrors(b.drainEvents()), []);

  await harness.lose(firstResumeSocket, { serverFirst: true });
  const secondResumeSocket = harness.sockets().at(-1), secondResume = clientMessages(harness, secondResumeSocket.connection, 'resume')[0].data;
  assert.notEqual(secondResume.resumeToken, firstResume.resumeToken);
  assert.equal(a.getStatus(), SessionStatus.READY); assert.equal(room.host, host); assert.deepEqual(identity(a.getConnectionInfo()), identity(before));
  events = a.drainEvents(); assert.equal(events.filter(item => item.type === 'network-reconnecting').length, 1);
  assert.equal(events.filter(item => item.type === 'network-resumed').length, 1);
  harness.serverScheduler.runTicks(); await harness.flush();
  assert.equal(a.getStatus(), SessionStatus.READY); assert.equal(a.getConnectionInfo().lastServerTick, 3);
  assert.equal(clientMessages(harness, secondResumeSocket.connection, 'resume').length, 1);
  assert.equal(a.submit({ type: 'grenade' }), true); a.update(1 / 60); await harness.flush();
  assert.equal(clientMessages(harness, secondResumeSocket.connection, 'input').at(-1).data.seq, 0);
  await schedulerA.advance(0, harness.queue);
});

test('client resume arrives before server departure and takes over the stale transport twice', async t => {
  const harness = createInMemoryMultiplayerHarness(); t.after(() => harness.restore());
  const { a, b, roomId, socketA } = await connectPair(harness, true);
  a.drainEvents(); const before = a.getConnectionInfo(), room = harness.room(roomId), host = room.host;
  const loss = await harness.lose(socketA, { serverFirst: false });
  const resumed = harness.sockets().at(-1);
  assert.equal(new URL(resumed.url).search, '?resume=1');
  assert.equal(clientMessages(harness, resumed.connection, 'resume').length, 1);
  assert.equal(a.getStatus(), SessionStatus.READY); assert.equal(room.host, host); assert.deepEqual(identity(a.getConnectionInfo()), identity(before));
  assert.equal(socketA.server.deserializeAttachment().socketType, 'retired-member');assert.equal(room.reservations.size, 0);
  await loss.depart();assert.equal(room.host,host);assert.equal(room.reservations.size,0);assert.equal(room.memberSockets().includes(resumed.server),true);
  room.webSocketClose(socketA.server,1006,'late',false);assert.equal(room.host,host);assert.equal(room.reservations.size,0);
  harness.serverScheduler.runTicks(2);await harness.flush();assert.equal(a.getStatus(),SessionStatus.READY);assert.equal(b.getStatus(),SessionStatus.READY);
  const events = a.drainEvents(); assert.equal(events.filter(item => item.type === 'network-reconnecting').length, 1);
  assert.equal(events.filter(item => item.type === 'network-resumed').length, 1);
  assert.deepEqual(networkErrors(events), []);assert.deepEqual(networkErrors(b.drainEvents()),[]);
  const firstCredential=clientMessages(harness,resumed.connection,'resume')[0].data.resumeToken;
  await harness.lose(resumed,{serverFirst:true});const resumedAgain=harness.sockets().at(-1),secondCredential=clientMessages(harness,resumedAgain.connection,'resume')[0].data.resumeToken;
  assert.notEqual(secondCredential,firstCredential);assert.equal(a.getStatus(),SessionStatus.READY);assert.equal(room.host,host);assert.deepEqual(identity(a.getConnectionInfo()),identity(before));assert.equal(room.reservations.size,0);
});

test('server-first departure resumes when the old browser transport stays OPEN but frames stall', async t => {
  const harness = createInMemoryMultiplayerHarness(); t.after(() => harness.restore());
  const { a, b, roomId, schedulerA, socketA } = await connectPair(harness, true);
  a.drainEvents(); b.drainEvents();
  const before = a.getConnectionInfo(), room = harness.room(roomId), host = room.host;
  const initialTicket = serverMessages(harness, socketA.connection, 'resume-ticket').at(-1).data.resumeToken;

  harness.serverDepartWithoutBrowserNotification(socketA);
  assert.equal(socketA.readyState, 1);
  assert.equal(a.getStatus(), SessionStatus.READY);
  assert.equal(room.reservations.size, 1);
  await schedulerA.advance(AUTHORITATIVE_FRAME_STALL_MS - 1, harness.queue);
  assert.equal(a.getStatus(), SessionStatus.READY);
  assert.equal(harness.sockets().length, 2);

  await schedulerA.advance(1, harness.queue);
  const resumed = harness.sockets().at(-1), after = a.getConnectionInfo();
  assert.equal(new URL(resumed.url).search, '?resume=1');
  assert.equal(clientMessages(harness, resumed.connection, 'resume').length, 1);
  assert.equal(clientMessages(harness, resumed.connection, 'resume')[0].data.resumeToken, initialTicket);
  assert.deepEqual(identity(after), identity(before));
  assert.equal(after.roomId, roomId); assert.equal(room.host, host); assert.equal(room.reservations.size, 0);
  const rotatedTicket = serverMessages(harness, resumed.connection, 'resume-ticket').at(-1).data.resumeToken;
  assert.notEqual(rotatedTicket, initialTicket);
  assert.equal(a.getStatus(), SessionStatus.READY); assert.equal(b.getStatus(), SessionStatus.READY);
  let events = a.drainEvents();
  assert.equal(events.filter(item => item.type === 'network-reconnecting').length, 1);
  assert.equal(events.filter(item => item.type === 'network-resumed').length, 1);
  assert.deepEqual(networkErrors(events), []); assert.deepEqual(networkErrors(b.drainEvents()), []);

  socketA.emit('error', {}); socketA.emit('close', { code: 1006, wasClean: false });
  assert.equal(a.getStatus(), SessionStatus.READY); assert.equal(room.host, host);
  harness.serverScheduler.runTicks(2); await harness.flush();
  assert.equal(a.getStatus(), SessionStatus.READY); assert.equal(b.getStatus(), SessionStatus.READY);
  assert.equal(a.getConnectionInfo().lastServerTick, 2); assert.equal(b.getConnectionInfo().lastServerTick, 2);
  events = a.drainEvents(); assert.deepEqual(networkErrors(events), []);
  assert.equal(events.some(item => item.type === 'match-aborted'), false);
  assert.deepEqual(networkErrors(b.drainEvents()), []);
});
