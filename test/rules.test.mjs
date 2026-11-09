// Regression tests for the defects an independent code review found in the gray box:
// each one names the rule of v0.5 it protects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, setInput, vehicleProfile, buildReview } from '../sim.mjs';
import { obj, veh, act, run, place, route, drive } from './helpers.mjs';

const onTable = (s, id, table, cx, cy) => { obj(s, id).at = { kind: 'table', table, cx, cy, rot: 0 }; };
function groupOnMain(s, table, goods) {
  const t = obj(s, table); t.folded = false;
  goods.forEach(([id, cx, cy]) => onTable(s, id, table, cx, cy));
  t.at = { kind: 'bed', vehicle: 'main', cx: 0, cy: 0, rot: 0 };
  return t;
}
const STALL_GOODS = {
  lantern: [['lantern-box', 0, 0], ['lantern', 2, 2]],
  sweet: [['sweet-1', 0, 0], ['sweet-2', 2, 0]],
  grill: [['grill', 0, 0], ['spice', 2, 0]],
  public: [['speaker', 0, 0], ['tea-box', 2, 0]],
};

test('§7: every stall group tops the 3.0 m gate on the main truck and on a van, and clears it on the low-bed well', () => {
  for (const [stall, goods] of Object.entries(STALL_GOODS)) {
    for (const [build, vehicle, passes] of [['standard', 'main', false], ['standard', 'van-1', false], ['lowbed', 'main', true]]) {
      for (const upright of stall === 'lantern' ? [false, true] : [false]) {
        const s = createGame({ mission: 'b2', build });
        const t = obj(s, 'table-1'); t.folded = false;
        goods.forEach(([id, cx, cy]) => onTable(s, id, 'table-1', cx, cy));
        if (stall === 'lantern') obj(s, 'lantern').upright = upright;
        t.at = { kind: 'bed', vehicle, cx: 0, cy: 0, rot: 0 };
        const pr = vehicleProfile(s, veh(s, vehicle));
        const expect = upright ? false : passes;
        assert.equal(pr.passGate, expect, `${stall}${upright ? ' (lantern upright)' : ''} on ${build} ${vehicle}: top ${pr.top}`);
      }
    }
  }
});

test('§3.2: a tall group cannot be unloaded across the summit ledge into the work area', () => {
  const s = createGame({ mission: 'b2' });
  const p = addPlayer(s, 'p1', '司机');
  const v = veh(s, 'main');
  const t = groupOnMain(s, 'table-3', STALL_GOODS.public);
  Object.assign(v, { x: 95.9, y: 29, angle: 0 });   // in S2, rear against the ledge
  run(s, 0.3);
  place(p, 92.8, 30.6); p.angle = 0;
  const r = act(s, 'p1', 'interact');
  assert.equal(r.ok, false);
  assert.match(r.error, /隔着墙或护栏/);
  assert.equal(t.at.kind, 'bed', 'the group stays locked on the truck');
  // From the S2 side of the same tail it unloads as usual, onto S2.
  Object.assign(v, { x: 104, y: 29, angle: 0 }); run(s, 0.3);
  place(p, 99.6, 29.8); p.angle = 0;
  assert.equal(act(s, 'p1', 'interact').ok, true);
  assert.equal(t.at.kind, 'ground');
  assert.ok(t.x > 92.4, 'landed in S2, east of the ledge');
});

test('§2.4: calling for help is a rescue: refused during a wheel-lift, never uphill, and the load goes to the pad', () => {
  // (a) The tow cannot cancel a rollover that is already under way.
  const a = createGame({ mission: 'b2' });
  addPlayer(a, 'p1', '司机');
  const va = veh(a, 'main');
  groupOnMain(a, 'table-3', STALL_GOODS.public);
  run(a, 0.3);
  place(a.players[0], va.x, va.y - 2); act(a, 'p1', 'vehicle');
  let refused = null;
  drive(a, 'p1', va, route(a, { x: va.x + 6, y: va.y }, { x: 56, y: 176 }, 'short'), {
    maxTime: 60, speedFor: v => { if (!refused && v.warn > 0.3) refused = act(a, 'p1', 'recover'); return 30; },
  });
  assert.equal(refused?.ok, false);
  assert.match(refused.error, /抬轮预警/);
  assert.equal(a.stats.rollovers, 1, 'the rollover still happens');
  // (b) A truck that passed S1 on an earlier trip and is now loading in the plaza is towed to the plaza stop, not to S1.
  const b = createGame({ mission: 'b2' });
  addPlayer(b, 'p1', '司机');
  const vb = veh(b, 'main');
  groupOnMain(b, 'table-3', STALL_GOODS.public);
  Object.assign(vb, { x: 112, y: 104, angle: Math.PI / 2 }); run(b, 0.2);
  assert.equal(vb.lastStop, 's1');
  Object.assign(vb, { x: 106.4, y: 182, angle: 0 }); run(b, 0.2);
  assert.equal(vb.lastStop, 's0', 'standing in the plaza puts the truck back in the plaza stretch');
  place(b.players[0], vb.x, vb.y - 2); act(b, 'p1', 'vehicle');
  assert.equal(act(b, 'p1', 'recover').ok, true);
  assert.ok(vb.y > 160, `towed within the plaza (y ${vb.y.toFixed(1)})`);
  assert.equal(vb.profile.items, 0, 'the bed was emptied');
  const pad = b.world.walkAreas.find(z => z.id === 'pad-s0');
  const t = obj(b, 'table-3');
  assert.ok(t.at.kind === 'ground' && t.x >= pad.x - 2 && t.x <= pad.x + pad.w + 2, 'the group sits on the plaza rescue pad');
  assert.equal(obj(b, 'speaker').at.table, 'table-3', 'still locked as a group');
  assert.equal(b.stats.tows, 1);
  assert.match(buildReview(b).lines.join(''), /叫过 1 次救援/);
});

test('§7: a front stall keeps its customer space but leaves a lane, so nothing parked behind it is trapped', () => {
  const s = createGame({ mission: 'b2' });
  const p = addPlayer(s, 'p1', '司机');
  const v = veh(s, 'van-1');
  Object.assign(obj(s, 'table-4'), { x: 74, y: 10, angle: 0, folded: false, at: { kind: 'ground' } });
  Object.assign(v, { x: 58, y: 10, angle: 0 });
  run(s, 0.2);
  place(p, v.x, v.y + 2); act(s, 'p1', 'vehicle');
  setInput(s, 'p1', { up: true }); run(s, 4); setInput(s, 'p1', { brake: true }); run(s, 1);
  assert.ok(v.x < 66.5, `the customer space blocks the van (x ${v.x.toFixed(1)})`);
  assert.match(s.players[0].hint, /客人留位置/);
  Object.assign(v, { x: 58, y: 16, angle: 0, speed: 0 });
  setInput(s, 'p1', { up: true }); run(s, 5); setInput(s, 'p1', { brake: true }); run(s, 1);
  assert.ok(v.x > 85, `the south lane stays open (x ${v.x.toFixed(1)})`);
});

test('§3.3: a truck standing in the S2 stop is out of the gust; the pass starts where the stop ends', () => {
  for (const [y, tips] of [[41.5, false], [36, false], [77.5, true]]) {   // 77.5: open ground between two windbreaks
    const s = createGame({ mission: 'b2' });
    addPlayer(s, 'p1', '司机');
    const v = veh(s, 'main');
    groupOnMain(s, 'table-4', STALL_GOODS.lantern);
    obj(s, 'lantern').upright = true;
    Object.assign(v, { x: 114, y, angle: -Math.PI / 2 });
    run(s, 0.2);
    place(s.players[0], v.x + 2, v.y); act(s, 'p1', 'vehicle');
    run(s, 13);
    assert.equal(s.stats.rollovers > 0, tips, `standing at y ${y}`);
  }
});

test('§2.2: whoever grips a group stands on open ground: never inside a wall, a truck or the ledge', () => {
  // Gripping a group whose near end touches the lot wall takes the far end instead.
  const s = createGame({ mission: 'b2' });
  const p = addPlayer(s, 'p1', '甲');
  const t = obj(s, 'table-1');
  Object.assign(t, { x: 75, y: 35.3, angle: Math.PI / 2, folded: false, at: { kind: 'ground' } });
  onTable(s, 'sweet-1', 'table-1', 0, 0);
  run(s, 0.1);
  place(p, 76.3, 35.0);
  assert.equal(act(s, 'p1', 'grip').ok, true);
  assert.ok(p.y > 34.4, `the holder stands in the lot (y ${p.y.toFixed(2)})`);
  setInput(s, 'p1', { down: true }); run(s, 1); setInput(s, 'p1', {});
  act(s, 'p1', 'grip');
  const y0 = p.y;
  setInput(s, 'p1', { down: true }); run(s, 0.5); setInput(s, 'p1', {});
  assert.ok(p.y > y0 + 0.5, 'and can walk away after letting go');
  // Rotating a pushed group never swings the holder into a wall.
  const r = createGame({ mission: 'b2' });
  const q = addPlayer(r, 'p1', '乙');
  Object.assign(obj(r, 'table-2'), { x: 80, y: 36.3, angle: 0, folded: false, at: { kind: 'ground' } });
  run(r, 0.1);
  place(q, 81.9, 36.3);
  assert.equal(act(r, 'p1', 'grip').ok, true);
  const turned = act(r, 'p1', 'rotate');
  assert.ok(!turned.ok || q.y > 34.4, 'the holder is not put inside the wall');
  // Pushing a group never walks its holder into a parked truck.
  const g = createGame({ mission: 'b2' });
  const h = addPlayer(g, 'p1', '丙');
  const van = veh(g, 'van-1');
  Object.assign(van, { x: 70, y: 44, angle: 0 });
  Object.assign(obj(g, 'table-2'), { x: 64, y: 40, angle: 0, folded: false, at: { kind: 'ground' } });
  run(g, 0.1);
  place(h, 62.1, 40);
  assert.equal(act(g, 'p1', 'grip').ok, true);
  setInput(g, 'p1', { down: true }); run(g, 3); setInput(g, 'p1', {});
  const inside = Math.abs(h.x - van.x) < 2.4 + 0.36 && Math.abs(h.y - van.y) < 0.95 + 0.36;
  assert.equal(inside, false, `holder at ${h.x.toFixed(1)},${h.y.toFixed(1)} is not inside the van`);
});

test('§7: inside the gate only low loads go on: a tall load there could never leave', () => {
  const s = createGame({ mission: 'b2' });
  const p = addPlayer(s, 'p1', '甲');
  const v = veh(s, 'main');
  Object.assign(v, { x: 80, y: 15, angle: 0 });
  const L = obj(s, 'lantern'); Object.assign(L, { x: 72.5, y: 15, angle: 0, upright: true, at: { kind: 'ground' } });
  run(s, 0.2);
  place(p, 71.2, 15); p.angle = 0;
  assert.equal(act(s, 'p1', 'interact').ok, true);
  assert.equal(p.holding, 'lantern');
  place(p, 74.4, 15);
  const r = act(s, 'p1', 'interact');
  assert.equal(r.ok, false);
  assert.match(r.error, /出不了老山门/);
  assert.equal(p.holding, 'lantern', 'still in hand');
  assert.equal(act(s, 'p1', 'tilt').ok, true, 'laid flat');
  assert.equal(act(s, 'p1', 'interact').ok, true, 'a flat lantern goes on');
  assert.equal(L.at.kind, 'bed');
  assert.ok(veh(s, 'main').profile.passGate);
});

test('§2.2: the tail ramp needs level ground under it, not the pass mouth', () => {
  const s = createGame({ mission: 'b2' });
  const p = addPlayer(s, 'p1', '甲');
  const v = veh(s, 'main');
  Object.assign(v, { x: 114, y: 96.4, angle: Math.PI / 2 });   // centre just inside S1, tail over the pass mouth
  Object.assign(obj(s, 'spice'), { x: 114, y: 89.3, at: { kind: 'ground' } });
  run(s, 0.2);
  place(p, 114, 88.0); act(s, 'p1', 'interact');
  place(p, 114, 90.6);
  const r = act(s, 'p1', 'interact');
  assert.equal(obj(s, 'spice').at.kind === 'bed', false, `not loaded (${r.error ?? 'ok'})`);
});

test('the review card tells how each far-side group really got up', () => {
  const s = createGame({ mission: 'b2' });
  addPlayer(s, 'p1', '甲');
  s.records.farGroups.push({ table: 'table-1', label: '音响、茶水箱', lot: '西坪', time: 1, lifted: false, route: 'unpacked' },
    { table: 'table-2', label: '烤炉、调料箱', lot: '西坪', time: 2, lifted: false, route: null });
  s.stats.completedAt = 60;
  const text = buildReview(s).lines.join('\n');
  assert.match(text, /音响、茶水箱停到了西坪，在西坪拆开，分件搬了上去/);
  assert.doesNotMatch(text, /烤炉、调料箱/, 'a group with no known route is not narrated');
});
