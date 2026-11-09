// Regression tests for the second code review and the second keyboard playtest:
// each one names the rule of v0.5 it protects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, setInput, vehicleProfile, intents, snapshot } from '../sim.mjs';
import { startServer } from '../server.mjs';
import { obj, veh, act, run, place, drive } from './helpers.mjs';

const onTable = (s, id, table, cx, cy) => { obj(s, id).at = { kind: 'table', table, cx, cy, rot: 0 }; };
function groupOn(s, table, vehicle, goods) {
  const t = obj(s, table); t.folded = false;
  goods.forEach(([id, cx, cy]) => onTable(s, id, table, cx, cy));
  t.at = { kind: 'bed', vehicle, cx: 0, cy: 0, rot: 0 };
  return t;
}
const SWEET = [['sweet-1', 0, 0], ['sweet-2', 2, 0]];
const LANTERN = [['lantern-box', 0, 0], ['lantern', 2, 2]];
const keys = (s, p) => intents(s, p).map(i => `${i.key} ${i.label}`);

test('§3.3: a shelter-only load cannot dash the pass in a gust; one calm window carries it to the first windbreak', () => {
  for (const [phase, goal, tips] of [[5.0, 40, true], [0.0, 85.5, false]]) {   // 5.0: the gust starts; 0.0: three seconds of calm
    const s = createGame({ mission: 'b2' });
    addPlayer(s, 'p1', '司机');
    const v = veh(s, 'van-1');
    groupOn(s, 'table-1', 'van-1', SWEET);
    Object.assign(v, { x: 114, y: 97.5, angle: -Math.PI / 2 });
    run(s, 0.3);
    assert.equal(v.profile.advisory.gust, 0, 'the sweet-water group on a van is shelter-only');
    place(s.players[0], v.x + 2, v.y); act(s, 'p1', 'vehicle');
    s.time = Math.ceil(s.time / 9) * 9 + phase;
    drive(s, 'p1', v, [{ x: 114, y: 92 }, { x: 114, y: goal }], { speedFor: () => 40, maxTime: 20 });
    if (!tips) run(s, 9);   // and it sits out the whole next gust behind the windbreak
    assert.equal(s.stats.rollovers > 0, tips, `${tips ? 'dashing in the gust' : 'hopping in the calm'}: rollovers ${s.stats.rollovers}, at y ${v.y.toFixed(1)}`);
  }
});

test('§7: a long piece cannot be carried into a standing stall\'s customer space, only out of it', () => {
  const s = createGame({ mission: 'b2' });
  const p = addPlayer(s, 'p1', '甲');
  Object.assign(obj(s, 'table-4'), { x: 74, y: 9.75, angle: 0, folded: false, at: { kind: 'ground' } });
  const f = obj(s, 'frame-sweet');
  Object.assign(f, { x: 66, y: 16.4, angle: 0, at: { kind: 'ground' } });
  run(s, 0.1);
  place(p, 66, 17.6); p.angle = -Math.PI / 2;
  assert.equal(act(s, 'p1', 'interact').ok, true);
  assert.equal(p.holding, 'frame-sweet');
  setInput(s, 'p1', { right: true }); run(s, 2.5); setInput(s, 'p1', {});
  assert.ok(f.x > 70, `walking along the lane is fine (x ${f.x.toFixed(1)})`);
  setInput(s, 'p1', { up: true }); run(s, 2); setInput(s, 'p1', {});
  assert.ok(f.y > 13.4, `the frame stays out of the customer space (y ${f.y.toFixed(2)})`);
  assert.match(p.hint, /太长，搬不过还摆着的摊位/);
  // A frame that already reaches into it can be carried out.
  const r = createGame({ mission: 'b2' });
  const q = addPlayer(r, 'p1', '乙');
  Object.assign(obj(r, 'table-4'), { x: 74, y: 9.75, angle: 0, folded: false, at: { kind: 'ground' } });
  const g = obj(r, 'frame-grill');
  Object.assign(g, { x: 66, y: 13.2, angle: 0, at: { kind: 'ground' } });
  run(r, 0.1);
  place(q, 66, 14.5); q.angle = -Math.PI / 2;
  assert.equal(act(r, 'p1', 'interact').ok, true);
  assert.ok(g.y >= 13.2 - 1e-6, 'picking it up does not pull it deeper in');
  setInput(r, 'p1', { down: true }); run(r, 1); setInput(r, 'p1', {});
  assert.ok(g.y > 14, `carried back out (y ${g.y.toFixed(2)})`);
});

test('prompts never offer what the action would refuse: a third pair of hands, opening where a table cannot open, T on a slope or inside the gate', () => {
  // G: two people already lift the group.
  const a = createGame({ mission: 'b2' });
  const [p1, p2, p3] = ['甲', '乙', '丙'].map((n, i) => addPlayer(a, `p${i + 1}`, n));
  const t = obj(a, 'table-2');
  Object.assign(t, { x: 80, y: 40, angle: 0, folded: false, at: { kind: 'ground' } });
  run(a, 0.1);
  place(p1, 81.8, 40); assert.equal(act(a, 'p1', 'grip').ok, true);
  place(p2, 78.2, 40); assert.equal(act(a, 'p2', 'grip').ok, true);
  place(p3, 80, 41.4);
  assert.ok(!keys(a, p3).some(k => k.startsWith('G')), keys(a, p3).join(' / '));
  assert.equal(act(a, 'p3', 'grip').ok, false);
  // Q: a folded table lying where an open one has no room, in a 1.3 m gap between two parked vans.
  const b = createGame({ mission: 'b2' });
  const q = addPlayer(b, 'p1', '甲');
  Object.assign(veh(b, 'van-1'), { x: 70, y: 40, angle: 0 });
  Object.assign(veh(b, 'van-2'), { x: 70, y: 43.2, angle: 0 });
  const ft = obj(b, 'table-1');
  Object.assign(ft, { x: 70, y: 41.6, angle: 0, folded: true, at: { kind: 'ground' } });
  run(b, 0.1);
  place(q, 72.7, 41.6);
  assert.ok(!keys(b, q).some(k => /就地展开/.test(k)), keys(b, q).join(' / '));
  const r = act(b, 'p1', 'fold');
  assert.equal(r.ok, false);
  assert.match(r.error, /展不开/);
  // T: the lantern on a group on a truck that stands on the road, and on one inside the gate.
  for (const [pose, why] of [[{ x: 56, y: 150, angle: -Math.PI / 2 }, /坡上/], [{ x: 80, y: 15, angle: 0 }, /老山门里立起来/]]) {
    const c = createGame({ mission: 'b2' });
    const d = addPlayer(c, 'p1', '甲');
    const v = veh(c, 'main');
    groupOn(c, 'table-4', 'main', [['lantern-box', 0, 0], ['lantern', 0, 2]]);
    const L = obj(c, 'lantern');
    L.upright = false;   // lying flat on the table, so T would stand it up
    Object.assign(v, pose);
    run(c, 0.3);
    place(d, L.x + 1.3, L.y + 1.3);
    run(c, 0.05);
    assert.ok(!keys(c, d).some(k => k.startsWith('T')), keys(c, d).join(' / '));
    const tilt = act(c, 'p1', 'tilt');
    assert.equal(tilt.ok, false);
    assert.match(tilt.error, why);
    assert.equal(L.upright, false);
  }
});

test('§7 (B3): the market\'s gift lantern stands too tall for the gate on a van and on the main truck; laid flat it clears', () => {
  for (const vehicle of ['van-1', 'main']) {
    const s = createGame({ mission: 'b3' });
    const g = obj(s, 'gift-lantern');
    g.at = { kind: 'bed', vehicle, cx: 0, cy: 0, rot: 0 };
    g.upright = true;
    const up = vehicleProfile(s, veh(s, vehicle));
    assert.equal(up.passGate, false, `standing on ${vehicle}: top ${up.top}`);
    g.upright = false;
    const flat = vehicleProfile(s, veh(s, vehicle));
    assert.equal(flat.passGate, true, `flat on ${vehicle}: top ${flat.top}`);
  }
});

test('§7: the public-service yard\'s 1.4 m door takes single pieces and a folded table end-on, never an open table or a group', () => {
  // An open table pushed at the door stops at the wall.
  const s = createGame({ mission: 'b2' });
  const p = addPlayer(s, 'p1', '甲');
  const t = obj(s, 'table-3');
  Object.assign(t, { x: 74.5, y: 23.3, angle: 0, folded: false, at: { kind: 'ground' } });
  onTable(s, 'speaker', 'table-3', 0, 0);
  run(s, 0.1);
  place(p, 72.5, 23.3);
  assert.equal(act(s, 'p1', 'grip').ok, true);
  setInput(s, 'p1', { right: true }); run(s, 4); setInput(s, 'p1', {});
  assert.ok(t.x + 1.25 < 78.1, `the group stays outside the yard (x ${t.x.toFixed(2)})`);
  assert.match(p.hint, /墙或门框/, 'and the one pushing is told why');
  act(s, 'p1', 'grip');
  // The same table folded goes through end-on; carried crosswise it does not.
  for (const [angle, through] of [[0, true], [Math.PI / 2, false]]) {
    const r = createGame({ mission: 'b2' });
    const q = addPlayer(r, 'p1', '乙');
    const ft = obj(r, 'table-3');
    Object.assign(ft, { x: 73, y: 23.3, angle, folded: true, at: { kind: 'ground' } });
    run(r, 0.1);
    place(q, angle ? 73 : 71.3, angle ? 24.6 : 23.3); q.angle = angle ? -Math.PI / 2 : 0;
    assert.equal(act(r, 'p1', 'interact').ok, true);
    if (angle) { place(q, 71.5, 23.3 - q.carry.y); }   // stand west of it, still holding it crosswise
    setInput(r, 'p1', { right: true }); run(r, 5); setInput(r, 'p1', {});
    assert.equal(ft.x > 79.5, through, `${angle ? 'crosswise' : 'end-on'}: table at x ${ft.x.toFixed(2)}`);
  }
});

test('§7: a front stall counts only on the station side of the strip; the south half stays a lane', () => {
  for (const [y, done] of [[9.75, true], [15.2, false]]) {
    const s = createGame({ mission: 'b2' });
    addPlayer(s, 'p1', '甲');
    Object.assign(obj(s, 'table-4'), { x: 74, y, angle: 0, folded: false, at: { kind: 'ground' } });
    LANTERN.forEach(([id, cx, cy]) => onTable(s, id, 'table-4', cx, cy));
    run(s, 0.5);
    assert.equal(s.objectives.find(o => o.id === 'lantern').done, done, `table at y ${y}`);
  }
});

test('an owner handed over keeps a member\'s grace to come back; one address cannot keep many rooms open', { timeout: 15_000 }, async () => {
  const running = await startServer({ port: 0, ownerGrace: 300, memberGrace: 280, unopenedRoomMs: 60_000, roomsPerAddress: 10, liveRoomsPerAddress: 2 });
  const base = `http://127.0.0.1:${running.address.port}`;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const post = async (path, body, headers = {}) => { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
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
    closers[0]();
    await sleep(420);   // handed over at about 330 ms; the member's grace (280 ms) starts only then
    assert.equal(room.ownerId, guest.playerId, 'handed over');
    assert.ok(room.clients.has(host.playerId), 'the old owner is still a member right after the hand-over');
    assert.ok(room.state.players.some(p => p.id === host.playerId), 'and still has a character in the world');
    closers.push(await open(host.roomId, host));
    await sleep(800);
    assert.ok(room.clients.has(host.playerId), 'back within the grace, as a member');
    assert.equal(room.ownerId, guest.playerId);
    // A second open room is fine; a third from the same address is refused while both stay open.
    const second = (await post('/api/rooms', { name: '第二家' })).body;
    closers.push(await open(second.roomId, second));
    const third = await post('/api/rooms', { name: '第三家' });
    assert.equal(third.status, 429);
    assert.match(third.body.error, /开着的公司太多/);
  } finally {
    for (const close of closers) close();
    await running.close();
  }
});

test('the goal pointer knows where the piece in your hands goes', () => {
  for (const [mission, id, goal] of [['b2', 'sweet-1', /糖水/], ['b2', 'frame-grill', /烤串摊棚架/], ['o6', 'cabinet', /高茶柜/], ['b3', 'memento-1', /新址/], ['b3', 'spice', /冬棚/]]) {
    const s = createGame({ mission });
    const p = addPlayer(s, 'p1', '甲');
    const o = obj(s, id);
    o.at = { kind: 'held', by: 'p1' }; p.holding = id;
    assert.match(snapshot(s).players[0].goal?.label ?? '', goal, `${mission} ${id}`);
  }
});

test('O6: the tea cabinet has a glass door: it only travels standing, and T is never offered for it', () => {
  const s = createGame({ mission: 'o6' });
  const p = addPlayer(s, 'p1', '甲');
  const cab = obj(s, 'cabinet');
  place(p, cab.x, cab.y + 1.4); p.angle = -Math.PI / 2;
  assert.equal(act(s, 'p1', 'interact').ok, true);
  assert.equal(p.holding, 'cabinet');
  assert.ok(!keys(s, p).some(k => k.startsWith('T')), keys(s, p).join(' / '));
  const r = act(s, 'p1', 'tilt');
  assert.equal(r.ok, false);
  assert.match(r.error, /玻璃门/);
  assert.equal(cab.upright, true);
});

test('B3: a front stall open for business has customers in front: nothing is carried through to the front door; closed, the door is open again', () => {
  for (const [open, through] of [[true, false], [false, true]]) {
    const s = createGame({ mission: 'b3' });
    const p = addPlayer(s, 'p1', '甲');
    if (!open) obj(s, 'lantern').upright = false;   // the rack laid down: the stall is no longer serving
    const m = obj(s, 'memento-1');
    Object.assign(m, { x: 72.2, y: 15.2, angle: 0, at: { kind: 'ground' } });
    run(s, 0.1);
    place(p, 72.2, 16.5); p.angle = -Math.PI / 2;
    assert.equal(act(s, 'p1', 'interact').ok, true);
    setInput(s, 'p1', { up: true }); run(s, 3); setInput(s, 'p1', {});
    assert.equal(m.y < 12, through, `${open ? 'open' : 'closed'} stall: the box at y ${m.y.toFixed(2)}`);
    if (!through) assert.match(p.hint, /客人站在前面/);
  }
});

test('B3: a pushed group is no cart past an open stall', () => {
  const s = createGame({ mission: 'b3' });
  const p = addPlayer(s, 'p1', '甲');
  const t = obj(s, 'table-1');
  Object.assign(t, { x: 70, y: 16.3, angle: Math.PI / 2, folded: false, at: { kind: 'ground' } });   // in line with the front door
  obj(s, 'memento-1').at = { kind: 'table', table: 'table-1', cx: 0, cy: 0, rot: 0 };
  run(s, 0.1);
  place(p, 70, 18.0);
  assert.equal(act(s, 'p1', 'grip').ok, true);
  setInput(s, 'p1', { up: true }); run(s, 4); setInput(s, 'p1', {});
  assert.ok(t.y > 13.4, `the group stays out of the open stall's customer space (y ${t.y.toFixed(2)})`);
  assert.match(p.hint, /客人站在前面/);
});

test('carrying a piece at a narrow door: a slightly off-centre approach eases into the opening instead of jamming on the frame', () => {
  for (const offset of [0, 0.25, -0.25]) {
    const s = createGame({ mission: 'b2' });
    const p = addPlayer(s, 'p1', '甲');
    const g = obj(s, 'speaker');
    Object.assign(g, { x: 74.2, y: 23.3 + offset, angle: 0, at: { kind: 'ground' } });
    run(s, 0.1);
    place(p, 72.9, 23.3 + offset); p.angle = 0;
    assert.equal(act(s, 'p1', 'interact').ok, true);
    setInput(s, 'p1', { right: true }); run(s, 4); setInput(s, 'p1', {});
    assert.ok(g.x > 80, `offset ${offset}: the speaker went through the 1.4 m gate (x ${g.x.toFixed(2)}, y ${g.y.toFixed(2)})`);
  }
});

test('a truck nosed into a corner works itself free while W and a direction are held', () => {
  const s = createGame({ mission: 'b2' });
  addPlayer(s, 'p1', '司机');
  const v = veh(s, 'main');
  Object.assign(v, { x: 96.5, y: 24.5, angle: -Math.PI / 2 - 0.5 });   // pinned against the wall at the old gate's approach
  run(s, 0.1);
  place(s.players[0], v.x + 2, v.y); act(s, 'p1', 'vehicle');
  const start = { x: v.x, y: v.y };
  setInput(s, 'p1', { up: true, left: true }); run(s, 4); setInput(s, 'p1', {});
  assert.ok(Math.hypot(v.x - start.x, v.y - start.y) > 4, `got out of the corner (moved ${Math.hypot(v.x - start.x, v.y - start.y).toFixed(2)} m)`);
});

test('a truck nosed into a straight edge at a shallow angle creeps along it while W is held', () => {
  const s = createGame({ mission: 'b2' });
  addPlayer(s, 'p1', '司机');
  const v = veh(s, 'main');
  s.vehicles = [v];
  for (const o of s.objects) if (o.at.kind === 'ground') Object.assign(o, { x: 185, y: 12 });
  Object.assign(v, { x: 71.05, y: 168.53, angle: 190.6 * Math.PI / 180 });   // pinned on the plaza's north edge, just east of the exit
  run(s, 0.1);
  place(s.players[0], v.x, v.y + 2.5); act(s, 'p1', 'vehicle');
  assert.ok(s.players[0].vehicle, 'the driver is in');
  const start = { x: v.x, y: v.y };
  // Wheel straight: it creeps along the edge. (Wheel turned into the edge, it still swings in and pins: VALIDATION.md.)
  setInput(s, 'p1', { up: true }); run(s, 3); setInput(s, 'p1', {});
  assert.ok(start.x - v.x > 0.8, `crept west along the edge (moved ${(start.x - v.x).toFixed(2)} m)`);
  assert.ok(Math.abs(v.y - start.y) < 0.2, 'without turning into it');
});
