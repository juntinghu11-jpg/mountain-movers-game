// Room lifetime on the real server: an owner who leaves hands over, drive-by rooms
// expire, and one address cannot fill the server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('an owner gone for a while hands the company over; unopened rooms expire; one address cannot fill the server', { timeout: 15_000 }, async () => {
  const running = await startServer({ port: 0, ownerGrace: 300, unopenedRoomMs: 400, roomsPerAddress: 3 });
  const base = `http://127.0.0.1:${running.address.port}`;
  const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const open = async (roomId, who) => {
    const controller = new AbortController();
    const response = await fetch(`${base}/api/rooms/${roomId}/events?playerId=${who.playerId}&token=${who.token}`, { signal: controller.signal });
    const reader = response.body.getReader();
    (async () => { try { for (;;) { const { done } = await reader.read(); if (done) return; } } catch {} })();
    return () => controller.abort();
  };
  const closers = [];
  try {
    const host = (await post('/api/rooms', { name: '房主' })).body;
    closers.push(await open(host.roomId, host));
    const guest = (await post(`/api/rooms/${host.roomId}/join`, { name: '伙伴' })).body;
    closers.push(await open(host.roomId, guest));
    await sleep(100);
    const room = running.rooms.get(host.roomId);
    assert.equal(room.ownerId, host.playerId);
    closers[0]();                                     // the owner's tab closes
    await sleep(150);
    const waiting = await post(`/api/rooms/${host.roomId}/action`, { playerId: guest.playerId, token: guest.token, action: 'interact' });
    assert.equal(waiting.status, 409, 'for a short while the room waits for its owner');
    await sleep(500);
    assert.equal(room.ownerId, guest.playerId, 'the member still here takes over');
    assert.ok(room.state.log.some(l => l.text.includes('接手')), 'the hand-over is in the shared log');
    assert.ok(room.events.some(e => e.type === 'owner_changed'));
    const going = await post(`/api/rooms/${host.roomId}/action`, { playerId: guest.playerId, token: guest.token, action: 'interact' });
    assert.equal(going.status, 200, 'and the game runs again');
    const t0 = room.state.time; await sleep(200);
    assert.ok(room.state.time > t0, 'the simulation advances');

    // A room nobody ever opens disappears; one address may only create a few rooms in ten minutes.
    const drive = (await post('/api/rooms', { name: '路过' })).body;
    assert.ok(running.rooms.has(drive.roomId));
    await sleep(600);
    assert.equal(running.rooms.has(drive.roomId), false, 'the unopened room expired');
    const third = await post('/api/rooms', { name: '第三家' });
    assert.equal(third.status, 201);
    const fourth = await post('/api/rooms', { name: '第四家' });
    assert.equal(fourth.status, 429, 'the fourth room from one address in ten minutes is refused');
    assert.match(fourth.body.error, /太频繁/);
  } finally {
    for (const close of closers) close();
    await running.close();
  }
});
