// Two players lift one group up the two steps through the real server, each with its own
// input delay. The server owns the group and averages the holders' inputs, so a late input
// only slows a step; it never splits the group or leaves it on the steps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('two players lift a group up the steps over the network with 60 ms and 180 ms of input delay', { timeout: 20_000 }, async () => {
  const running = await startServer({ port: 0 });
  const base = `http://127.0.0.1:${running.address.port}`;
  const post = async (path, body) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const controllers = [];
  const open = async (roomId, who) => {
    const controller = new AbortController(); controllers.push(controller);
    const response = await fetch(`${base}/api/rooms/${roomId}/events?playerId=${who.playerId}&token=${who.token}`, { signal: controller.signal });
    const reader = response.body.getReader();
    (async () => { try { for (;;) { const { done } = await reader.read(); if (done) return; } } catch {} })();
  };
  try {
    const a = (await post('/api/rooms', { name: '甲', mission: 'b2' })).body;
    await open(a.roomId, a);
    const b = (await post(`/api/rooms/${a.roomId}/join`, { name: '乙' })).body;
    await open(a.roomId, b);
    await sleep(100);
    // The scene: the sweet-water group at the foot of the steps, long side north-south, one player by each end.
    const s = running.rooms.get(a.roomId).state;
    const t = s.objects.find(o => o.id === 'table-1');
    Object.assign(t, { x: 63, y: 38.6, angle: Math.PI / 2, folded: false, at: { kind: 'ground' } });
    for (const [id, cx] of [['sweet-1', 0], ['sweet-2', 2]]) s.objects.find(o => o.id === id).at = { kind: 'table', table: 'table-1', cx, cy: 0, rot: 0 };
    const pa = s.players.find(p => p.id === a.playerId), pb = s.players.find(p => p.id === b.playerId);
    Object.assign(pa, { x: 63, y: 36.9 }); Object.assign(pb, { x: 63, y: 40.3 });
    await sleep(50);
    for (const who of [a, b]) {
      const r = await post(`/api/rooms/${a.roomId}/action`, { playerId: who.playerId, token: who.token, action: 'grip' });
      assert.equal(r.body?.ok, true, r.body?.error);
    }
    assert.deepEqual([...t.holders].sort(), [a.playerId, b.playerId].sort(), 'both hold the group');
    // Each client sends "up" every 80 ms, as the page does, but its requests arrive late.
    const send = (who, delay, input) => sleep(delay).then(() => post(`/api/rooms/${a.roomId}/input`, { playerId: who.playerId, token: who.token, input }));
    let apart = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 4000 && t.y > 30) {
      send(a, 60, { up: true }); send(b, 180, { up: true });
      await sleep(80);
      const ends = [pa, pb].map(p => Math.hypot(p.x - t.x, p.y - t.y));
      if (ends.some(d => Math.abs(d - 1.7) > 0.3)) apart++;
    }
    await Promise.all([send(a, 60, {}), send(b, 180, {})]);
    await sleep(250);
    assert.ok(t.y < 31.5, `the group is up the steps in the work area (y ${t.y.toFixed(2)})`);
    assert.equal(s.stats.liftSteps, 1, 'counted as one two-person lift up the steps');
    assert.equal(apart, 0, 'both holders stayed at their ends the whole way');
    assert.ok(s.objects.filter(o => o.at.kind === 'table' && o.at.table === 'table-1').length === 2, 'the goods rode along');
    for (const who of [a, b]) await post(`/api/rooms/${a.roomId}/action`, { playerId: who.playerId, token: who.token, action: 'grip' });
    assert.equal(t.holders.length, 0);
    assert.equal(t.at.kind, 'ground');
  } finally {
    for (const c of controllers) c.abort();
    await running.close();
  }
});
