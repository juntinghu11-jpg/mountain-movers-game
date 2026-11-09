import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, vehicleProfile, step, setInput, snapshot, worldView, ITEM_SPECS } from '../sim.mjs';
import { obj, veh, ply, act, run, place, route, drive } from './helpers.mjs';

function onBed(s, id, vehicle, cx, cy, rot = 0) { obj(s, id).at = { kind: 'bed', vehicle, cx, cy, rot }; }
function onTable(s, id, table, cx, cy, rot = 0) { obj(s, id).at = { kind: 'table', table, cx, cy, rot }; }
function group(s, tableId, goods, vehicle = null) {
  const t = obj(s, tableId); t.folded = false;
  goods.forEach((g, i) => onTable(s, g, tableId, i * 2 + (g === 'lantern' ? 0 : 0), g === 'lantern' ? 2 : 0));
  if (vehicle) onBed(s, tableId, vehicle, 0, 0);
  return t;
}
const profile = (s, id) => vehicleProfile(s, veh(s, id));

test('one stability rule: a group reads taller and slower than the same goods laid flat', () => {
  const flat = createGame({ mission: 'b2' });
  onBed(flat, 'table-1', 'main', 0, 0); onBed(flat, 'speaker', 'main', 0, 2); onBed(flat, 'tea-box', 'main', 2, 2);
  const g = createGame({ mission: 'b2' });
  group(g, 'table-1', ['speaker', 'tea-box'], 'main');
  const a = profile(flat, 'main'), b = profile(g, 'main');
  assert.ok(b.top > a.top, 'group is taller');
  assert.ok(b.stability < a.stability, 'group has the higher centre of mass');
  assert.ok(b.advisory.hairpin < a.advisory.hairpin && b.advisory.gentle < a.advisory.gentle);
  assert.equal(a.passGate, true);
  assert.equal(b.passGate, false, 'a 3.2 m group does not clear the 3.0 m old gate');
  assert.ok(b.advisory.gentle > b.advisory.hairpin, 'the long road\'s gentle curves allow more speed');
  assert.ok(b.advisory.gust > 0 && b.advisory.gust < b.advisory.hairpin);
  assert.equal(a.advisory.gust, null, 'flat load is hardly affected by the gust');
});

test('low-bed body clears the gate with a group; a companion van with a small group does not', () => {
  const low = createGame({ mission: 'b2', build: 'lowbed' });
  group(low, 'table-1', ['speaker', 'tea-box'], 'main');
  const lp = profile(low, 'main');
  assert.equal(lp.passGate, true);
  const std = createGame({ mission: 'b2' });
  group(std, 'table-1', ['speaker', 'tea-box'], 'main');
  assert.ok(lp.advisory.hairpin > profile(std, 'main').advisory.hairpin);
  const van = createGame({ mission: 'b2' });
  group(van, 'table-1', ['speaker', 'tea-box'], 'van-1');
  const vp = profile(van, 'van-1');
  assert.equal(vp.passGate, false);
  assert.ok(vp.advisory.hairpin <= profile(std, 'main').advisory.hairpin, 'narrow track reads less stable');
});

test('an upright lantern rack on a group can only wait out the gust behind a windbreak', () => {
  const s = createGame({ mission: 'b2' });
  group(s, 'table-1', ['lantern-box', 'lantern'], 'main');
  assert.equal(profile(s, 'main').advisory.gust, 0);
  obj(s, 'lantern').upright = false;
  onTable(s, 'lantern', 'table-1', 0, 2);
  assert.ok(profile(s, 'main').advisory.gust !== 0, 'laid flat it can move through a gust');
});

test('the old gate stops a tall truck in both directions but lets a low one through', () => {
  const s = createGame({ mission: 'b2' });
  const p = addPlayer(s, 'p1', '司机');
  const v = veh(s, 'main');
  group(s, 'table-1', ['speaker', 'tea-box'], 'main');
  run(s, 0.3);
  Object.assign(v, { x: 96, y: 26.5, angle: -Math.PI / 2 });
  place(p, v.x + 2, v.y); act(s, 'p1', 'vehicle');
  setInput(s, 'p1', { up: true }); run(s, 3);
  assert.ok(v.y > 22.5, 'blocked at the gate');
  assert.match(p.hint, /老山门/);
  // Unload the group onto the ground: now the empty truck fits.
  obj(s, 'table-1').at = { kind: 'ground' }; obj(s, 'table-1').x = 125; obj(s, 'table-1').y = 40;
  run(s, 0.3);
  setInput(s, 'p1', { up: true }); run(s, 4);
  assert.ok(v.y < 18, 'empty truck drives through the gate');
});

test('speed over the sign: creak, two-second wheel-lift warning, then rollover with rescue on the pad', () => {
  const s = createGame({ mission: 'b2' });
  const p = addPlayer(s, 'p1', '司机');
  const v = veh(s, 'main');
  group(s, 'table-1', ['speaker', 'tea-box'], 'main');
  run(s, 0.3);
  place(p, v.x, v.y - 2); act(s, 'p1', 'vehicle');
  const pts = route(s, { x: v.x + 6, y: v.y }, { x: 56, y: 176 }, 'short');
  // Drive at a steady 30 km/h, far above the 17 km/h hairpin sign.
  drive(s, 'p1', v, pts, { speedFor: () => 30, maxTime: 60 });
  assert.equal(s.stats.rollovers, 1);
  const inc = s.incidents.find(i => i.type === 'rollover');
  assert.ok(inc, 'rollover incident recorded');
  assert.match(inc.text, /弯：\d+ > 建议 \d+/);
  assert.match(inc.text, /平装时建议/);
  assert.ok(inc.frames.length > 10, 'replay keeps the last seconds');
  assert.equal(v.lastStop, 's0');
  assert.equal(v.profile.empty, true, 'the truck comes back empty');
  const pad = s.world.walkAreas.find(a => a.id === 'pad-s0');
  const t = obj(s, 'table-1');
  assert.equal(t.at.kind, 'ground');
  assert.ok(t.x >= pad.x && t.x <= pad.x + pad.w && t.y >= pad.y && t.y <= pad.y + pad.h, 'group set down on the rescue pad');
  assert.equal(obj(s, 'speaker').at.table, 'table-1', 'the group stays locked together');
});

test('below the sign nothing tips, even with a tall group', () => {
  const s = createGame({ mission: 'b2' });
  const p = addPlayer(s, 'p1', '司机');
  const v = veh(s, 'main');
  group(s, 'table-1', ['speaker', 'tea-box'], 'main');
  run(s, 0.3);
  place(p, v.x, v.y - 2); act(s, 'p1', 'vehicle');
  const pts = route(s, { x: v.x + 6, y: v.y }, { x: 56, y: 176 }, 'short', { x: 112, y: 104 });
  const r = drive(s, 'p1', v, pts, { speedFor: veh => veh.adv !== null ? veh.adv * 0.8 : 14, maxTime: 200 });
  assert.equal(r.done, true);
  assert.equal(s.stats.rollovers, 0);
  assert.equal(v.lastStop, 's1');
});

test('gust: shelter-only load tips in the open, waits safely behind a windbreak', () => {
  const s = createGame({ mission: 'b2' });
  const p = addPlayer(s, 'p1', '司机');
  const v = veh(s, 'main');
  group(s, 'table-1', ['lantern-box', 'lantern'], 'main');
  v.lastStop = 's1';
  Object.assign(v, { x: 114, y: 78, angle: -Math.PI / 2 }); // open road between windbreaks
  run(s, 0.1);
  place(p, v.x + 2, v.y); act(s, 'p1', 'vehicle');
  while (s.gust.state !== 'gust') run(s, 0.2);
  run(s, 3);
  assert.equal(s.stats.rollovers, 1);
  assert.equal(s.incidents.at(-1).reason, 'gust');
  assert.match(s.incidents.at(-1).text, /挡风墙/);
  assert.equal(v.lastStop, 's1');
  // Same load parked in the lee of a windbreak through a whole gust.
  const t = createGame({ mission: 'b2' });
  const q = addPlayer(t, 'p1', '司机');
  const w = veh(t, 'main');
  group(t, 'table-1', ['lantern-box', 'lantern'], 'main');
  Object.assign(w, { x: 114, y: 88.5, angle: -Math.PI / 2 });
  run(t, 0.1);
  place(q, w.x + 2, w.y); act(t, 'p1', 'vehicle');
  run(t, 12);
  assert.equal(t.stats.rollovers, 0);
  assert.ok(t.stats.gustWaits >= 1);
});

test('one person cannot push a group up the steps; two can lift it; letting go on the steps puts it back', () => {
  const s = createGame({ mission: 'b2' });
  const a = addPlayer(s, 'a', '甲'), b = addPlayer(s, 'b', '乙');
  const t = group(s, 'table-1', ['sweet-1']);
  Object.assign(t, { x: 63, y: 37.5, angle: Math.PI / 2 }); // in the west lot, long side towards the steps
  run(s, 0.1);
  place(a, 63, 39.3); assert.equal(act(s, 'a', 'grip').ok, true);
  setInput(s, 'a', { up: true }); run(s, 3);
  assert.ok(t.y > 34.9, 'one-person push stops at the bottom step');
  assert.match(a.hint, /台阶/);
  place(b, 63, 35.7);
  assert.equal(act(s, 'b', 'grip').ok, true);
  assert.equal(t.holders.length, 2);
  setInput(s, 'a', { up: true }); setInput(s, 'b', { up: true }); run(s, 1.1);
  assert.ok(t.y < 34.5 && t.y > 30, 'lifted onto the steps');
  setInput(s, 'a', {}); setInput(s, 'b', {});
  act(s, 'b', 'grip');
  assert.ok(t.y > 34.9, 'set down on the flat below, not on the steps');
  place(b, t.x, t.y - 1.7);
  assert.equal(act(s, 'b', 'grip').ok, true);
  setInput(s, 'a', { up: true }); setInput(s, 'b', { up: true }); run(s, 4);
  assert.ok(t.y < 30, 'two people carried it all the way up');
  assert.ok(s.stats.liftSteps >= 1);
});

test('tables fold only when empty and unfold only where there is room', () => {
  const s = createGame({ mission: 'b2' });
  const p = addPlayer(s, 'p1', '队长');
  const t = obj(s, 'table-1');
  place(p, t.x, t.y - 1.2);
  // Folded tables stand side by side in the store: no room to open in place there.
  const r = act(s, 'p1', 'fold');
  assert.equal(t.folded, r.ok ? false : true);
  Object.assign(t, { x: 100, y: 176, angle: 0, folded: true });
  place(p, 100, 174.6);
  assert.equal(act(s, 'p1', 'fold').ok, true);
  assert.equal(t.folded, false);
  onTable(s, 'speaker', 'table-1', 0, 0);
  assert.equal(act(s, 'p1', 'fold').ok, false, 'cannot fold with goods on it');
  obj(s, 'speaker').at = { kind: 'ground' }; Object.assign(obj(s, 'speaker'), { x: 110, y: 176 });
  assert.equal(act(s, 'p1', 'fold').ok, true);
});

test('beds load from the tail and unload last-in first-out; one open table fills a main bed', () => {
  const s = createGame({ mission: 'b2' });
  const p = addPlayer(s, 'p1', '队长');
  const v = veh(s, 'main');
  Object.assign(v, { x: 110, y: 176, angle: 0 });
  run(s, 0.1);
  const tail = { x: v.x - 4.5, y: v.y };
  for (const id of ['grill', 'spice', 'sweet-1']) {
    const o = obj(s, id); Object.assign(o, { x: tail.x - 3.2, y: tail.y, at: { kind: 'ground' } });
    place(p, tail.x - 2, tail.y); assert.equal(act(s, 'p1', 'interact').ok, true, `pick ${id}`);
    place(p, tail.x, tail.y); assert.equal(act(s, 'p1', 'interact').ok, true, `load ${id}`);
  }
  assert.equal(obj(s, 'grill').at.cx, 0, 'first load goes to the front');
  assert.deepEqual([obj(s, 'spice').at.cx, obj(s, 'sweet-1').at.cx], [0, 2], 'side by side, then behind');
  ply(s, 'p1').angle = 0; // facing the truck
  assert.equal(act(s, 'p1', 'interact').ok, true);
  assert.equal(ply(s, 'p1').holding, 'sweet-1', 'the piece nearest the tail comes out first');
  assert.equal(act(s, 'p1', 'interact').ok, true, 'and goes back in');
  assert.equal(obj(s, 'sweet-1').at.cx, 2, 'the front of the row it blocks is still taken');
  // An open table cannot join a bed that already holds goods in its rows.
  const s2 = createGame({ mission: 'b2' });
  group(s2, 'table-1', [], 'main');
  const t2 = obj(s2, 'table-2'); t2.folded = false;
  const q = addPlayer(s2, 'p1', '队长');
  const w = veh(s2, 'main');
  Object.assign(w, { x: 110, y: 176, angle: 0 });
  Object.assign(t2, { x: w.x - 3.5 - 0.9 - 1.9, y: w.y, angle: 0 });
  run(s2, 0.1);
  place(q, t2.x + 1.7, t2.y); act(s2, 'p1', 'grip');
  const res = act(s2, 'p1', 'interact');
  assert.equal(res.ok, false);
  assert.match(res.error, /一个展开的台/);
});

test('low-bed rear shelf takes exactly one overhanging long piece and no folded table', () => {
  const s = createGame({ mission: 'b2', build: 'lowbed' });
  const p = addPlayer(s, 'p1', '队长');
  const v = veh(s, 'main');
  Object.assign(v, { x: 110, y: 176, angle: 0 });
  run(s, 0.1);
  const tail = { x: v.x - 4.5, y: v.y };
  const load = id => { const o = obj(s, id); Object.assign(o, { x: tail.x - 4, y: tail.y, angle: 0, at: { kind: 'ground' } }); place(p, tail.x - 2.4, tail.y); act(s, 'p1', 'interact'); place(p, tail.x, tail.y); return act(s, 'p1', 'interact'); };
  assert.equal(load('frame-sweet').ok, true);
  assert.equal(obj(s, 'frame-sweet').at.cx, 5, 'long piece sits on the rear shelf');
  const second = load('frame-grill');
  assert.equal(second.ok, false, 'only one long piece may overhang');
  act(s, 'p1', 'interact');
  // With the shelf clear, two folded tables still fit in the low well.
  const t = createGame({ mission: 'b2', build: 'lowbed' });
  const q = addPlayer(t, 'p1', '队长'), w = veh(t, 'main');
  Object.assign(w, { x: 110, y: 176, angle: 0 }); run(t, 0.1);
  for (const id of ['table-1', 'table-2']) {
    const o = obj(t, id); Object.assign(o, { x: w.x - 4.5 - 3.4, y: w.y, angle: 0, at: { kind: 'ground' } });
    place(q, w.x - 4.5 - 1.8, w.y); act(t, 'p1', 'interact'); place(q, w.x - 4.5, w.y);
    assert.equal(act(t, 'p1', 'interact').ok, true, id);
  }
  assert.ok(['table-1', 'table-2'].every(id => obj(t, id).at.cx < 5));
});

test('nothing loads on a slope: tail ramps need flat ground', () => {
  const s = createGame({ mission: 'b2' });
  const p = addPlayer(s, 'p1', '队长');
  const v = veh(s, 'main');
  Object.assign(v, { x: 80, y: 154, angle: 0 }); run(s, 0.1);
  const o = obj(s, 'spice'); Object.assign(o, { x: v.x - 5.6, y: v.y, at: { kind: 'ground' } });
  place(p, v.x - 4.6, v.y); act(s, 'p1', 'interact');
  const r = act(s, 'p1', 'interact');
  assert.equal(o.at.kind === 'bed', false);
  assert.match(p.hint, /坡路/);
});

test('night market finishes when every stall stands on its workface; review uses recorded events', () => {
  const s = createGame({ mission: 'b2' });
  addPlayer(s, 'p1', '阿青');
  const zone = id => s.world.zones.find(z => z.id === id);
  const at = (id, z, angle = 0) => { const r = zone(z); Object.assign(obj(s, id), { x: r.x + r.w / 2, y: r.y + r.h / 2, angle, at: { kind: 'ground' }, folded: false }); };
  at('table-1', 'ws-front-a'); onTable(s, 'lantern-box', 'table-1', 0, 0); onTable(s, 'lantern', 'table-1', 2, 2);
  at('table-2', 'ws-sweet'); onTable(s, 'sweet-1', 'table-2', 0, 0); onTable(s, 'sweet-2', 'table-2', 2, 0);
  at('table-3', 'ws-grill'); onTable(s, 'grill', 'table-3', 0, 0); onTable(s, 'spice', 'table-3', 2, 0);
  at('table-4', 'ws-public'); onTable(s, 'speaker', 'table-4', 0, 0); onTable(s, 'tea-box', 'table-4', 2, 0);
  run(s, 0.5);
  assert.equal(s.complete, false, 'the frames are still missing');
  at('frame-sweet', 'frame-sweet'); at('frame-grill', 'frame-grill');
  obj(s, 'lantern').upright = false;
  run(s, 0.5);
  assert.equal(s.complete, false, 'the lantern rack must stand upright');
  obj(s, 'lantern').upright = true;
  run(s, 0.5);
  assert.equal(s.complete, true);
  assert.equal(s.lanternLit, true);
  assert.equal(s.records.frontChoice, 'a');
  assert.ok(s.review.lines.some(l => l.includes('靠气象站一侧')));
  assert.ok(s.review.lines.some(l => l.includes('灯笼架是立着上山的')));
});

test('O6 teaching order wants six square tables in the tea house and the cabinet upright', () => {
  const s = createGame({ mission: 'o6' });
  addPlayer(s, 'p1', '阿青');
  const spots = s.world.zones.filter(z => z.accepts === 'square');
  spots.forEach((z, i) => Object.assign(obj(s, `square-${i + 1}`), { x: z.x + z.w / 2, y: z.y + z.h / 2 }));
  const cab = s.world.zones.find(z => z.accepts === 'cabinet');
  Object.assign(obj(s, 'cabinet'), { x: cab.x + cab.w / 2, y: cab.y + cab.h / 2, upright: false });
  run(s, 0.5);
  assert.equal(s.complete, false);
  obj(s, 'cabinet').upright = true;
  run(s, 0.5);
  assert.equal(s.complete, true);
});

test('snapshots stay small and carry no static map; replays travel separately', () => {
  const s = createGame({ mission: 'b2' });
  for (let i = 0; i < 4; i++) addPlayer(s, `p${i}`, `伙伴${i}`);
  run(s, 1);
  const snap = snapshot(s);
  assert.equal(snap.world, undefined);
  assert.ok(JSON.stringify(snap).length < 20000);
  assert.ok(worldView(s).roads.length >= 5);
  assert.ok(snap.incidents.every(i => i.frames === undefined));
  assert.equal(addPlayer(s, 'p5', '第五位'), false, 'four players at most');
});

test('item catalogue keeps the v0.5 bed rules: two folded tables or one open table per main bed', () => {
  const t = ITEM_SPECS.table;
  assert.equal(t.open.l * t.open.w, 15);
  assert.ok(2 * t.folded.w <= 4 && 3 * t.folded.w > 4);
  assert.ok(2 * t.open.w > 4 && t.open.l <= 8 && 2 * t.open.l > 8);
});

test('the stability card reproduces the v0.5 §2.3 sample table within the placeholders\' tolerance', () => {
  const read = (build, vehicle, setup) => { const s = createGame({ mission: 'b2', build }); setup(s, vehicle); return vehicleProfile(s, veh(s, vehicle)); };
  const groupOn = (s, vehicle) => group(s, 'table-1', ['speaker', 'tea-box'], vehicle);
  const flat = (s, vehicle) => { onBed(s, 'table-1', vehicle, 0, 0); onBed(s, 'table-2', vehicle, 0, 2); onBed(s, 'speaker', vehicle, 5, 0); onBed(s, 'tea-box', vehicle, 5, 2); };
  // [config, design top m, design hairpin km/h, design gust km/h (null = hardly affected), passes the gate]
  const rows = [
    ['main folded + loose', read('standard', 'main', flat), 2.4, 30, null, true],
    ['main group', read('standard', 'main', groupOn), 3.2, 16, 12, false],
    ['low-bed group', read('lowbed', 'main', groupOn), 2.7, 24, 14, true],
    ['van small group', read('standard', 'van-1', groupOn), 3.1, 14, 10, false],
    ['van loose', read('standard', 'van-1', (s, v) => { onBed(s, 'speaker', v, 0, 0); onBed(s, 'tea-box', v, 2, 0); }), 2.2, 32, null, true],
  ];
  for (const [name, pr, top, hairpin, gust, gate] of rows) {
    assert.ok(Math.abs(pr.top - top) <= 0.15, `${name}: top ${pr.top} vs ${top}`);
    assert.ok(Math.abs(pr.advisory.hairpin - hairpin) <= 3, `${name}: hairpin ${pr.advisory.hairpin} vs ${hairpin}`);
    if (gust === null) assert.equal(pr.advisory.gust, null, `${name}: gust should hardly matter`);
    else assert.ok(Math.abs(pr.advisory.gust - gust) <= 3, `${name}: gust ${pr.advisory.gust} vs ${gust}`);
    assert.equal(pr.passGate, gate, `${name}: gate`);
  }
});

test('B3 starts from the summer layout; a stall at the station door blocks the long sign until it is struck', async () => {
  const { summerLayout } = await import('../sim.mjs');
  const s = createGame({ mission: 'b3' });
  const p = addPlayer(s, 'p1', '阿青');
  run(s, 0.2);
  assert.equal(s.records.frontChoice, 'a', 'default summer layout keeps the front stall at the door');
  assert.equal(s.objectives.length, 3);
  assert.ok(s.objectives.every(o => !o.done));
  // Carry the 3 m sign towards the front door through the stall's customer space: blocked.
  const sign = obj(s, 'sign');
  Object.assign(sign, { x: 84, y: 10, angle: 0, at: { kind: 'ground' } });
  place(p, 86.2, 10); p.angle = Math.PI;
  assert.equal(act(s, 'p1', 'interact').ok, true);
  setInput(s, 'p1', { left: true }); run(s, 2.5); setInput(s, 'p1', {});
  assert.ok(sign.x > 80 - 0.1 + 1.5, `sign stopped short of the stall (x ${sign.x.toFixed(1)})`);
  assert.match(p.hint, /摊位/);
  // Strike the stall: goods off, table folded. Now the sign passes.
  const stall = obj(s, 'table-4');
  for (const g of ['lantern', 'lantern-box']) { const o = obj(s, g); Object.assign(o, { at: { kind: 'ground' }, x: 95 + (g === 'lantern' ? 0 : 2), y: 10 }); }
  stall.folded = true;
  run(s, 0.1);
  setInput(s, 'p1', { left: true }); run(s, 2.5); setInput(s, 'p1', {});
  assert.ok(sign.x < 78, `sign carried past the struck stall (x ${sign.x.toFixed(1)})`);
  // A finished B2 hands its own layout over.
  const b2 = createGame({ mission: 'b2' });
  addPlayer(b2, 'p1', '阿青');
  const zone = id => b2.world.zones.find(z => z.id === id);
  const at = (id, z) => { const r = zone(z); Object.assign(obj(b2, id), { x: r.x + r.w / 2, y: r.y + r.h / 2, angle: 0, at: { kind: 'ground' }, folded: false }); };
  const on = (id, t, cx, cy) => { obj(b2, id).at = { kind: 'table', table: t, cx, cy, rot: 0 }; };
  at('table-1', 'ws-front-b'); on('lantern-box', 'table-1', 0, 0); on('lantern', 'table-1', 2, 2);
  at('table-2', 'ws-sweet'); on('sweet-1', 'table-2', 0, 0); on('sweet-2', 'table-2', 2, 0);
  at('table-3', 'ws-grill'); on('grill', 'table-3', 0, 0); on('spice', 'table-3', 2, 0);
  at('table-4', 'ws-public'); on('speaker', 'table-4', 0, 0); on('tea-box', 'table-4', 2, 0);
  at('frame-sweet', 'frame-sweet'); at('frame-grill', 'frame-grill');
  run(b2, 0.5);
  assert.equal(b2.complete, true);
  const b3 = createGame({ mission: 'b3', carry: summerLayout(b2) });
  assert.equal(b3.records.frontChoice, 'b', 'the B2 choice carries into the finale');
  assert.equal(b3.records.summerFrom, 'b2');
  const t1 = obj(b3, 'table-1');
  assert.ok(Math.abs(t1.x - obj(b2, 'table-1').x) < 1e-6 && Math.abs(t1.y - obj(b2, 'table-1').y) < 1e-6);
});

test('B3 finishes when the company, the night market and the shed goods are all where they belong', async () => {
  const { COMPANY, NIGHT_MARKET, SHED_GOODS } = await import('../sim.mjs');
  const s = createGame({ mission: 'b3' });
  addPlayer(s, 'p1', '阿青');
  const station = s.world.zones.find(z => z.accepts === 'station'), shed = s.world.zones.find(z => z.accepts === 'shed');
  const putIn = (ids, z, row) => ids.forEach((id, i) => Object.assign(obj(s, id), { x: z.x + 2 + (i % 8) * 3.6, y: z.y + 1.2 + (Math.floor(i / 8) + row) * 2.6, angle: 0, folded: true, at: { kind: 'ground' } }));
  putIn(NIGHT_MARKET, shed, 0);
  putIn(COMPANY, station, 0);
  obj(s, 'gift-lantern').upright = false;
  putIn(SHED_GOODS, station, 1);
  run(s, 0.5);
  assert.equal(s.complete, false, 'the gift lantern rack must stand to light up');
  obj(s, 'gift-lantern').upright = true;
  run(s, 0.5);
  assert.equal(s.complete, true);
  assert.equal(s.review.title, '公司搬上了山顶');
  assert.ok(s.review.lines.some(l => l.includes('正门')));
});

test('the tea road: the low-bed scrapes at the break-over, the main truck is too wide for the lane, a van drives in', () => {
  for (const [build, vid, ok, hint] of [['lowbed', 'main', x => x < 147, /坡折/], ['standard', 'main', x => x > 147 && x < 153, /限宽 2\.2 m/], ['standard', 'van-1', x => x > 162, null]]) {
    const s = createGame({ mission: 'o6', build });
    const p = addPlayer(s, 'p1', '司机');
    const v = veh(s, vid);
    Object.assign(v, { x: 140, y: 34, angle: 0 });
    run(s, 0.1);
    place(p, v.x, v.y - 2); act(s, 'p1', 'vehicle');
    setInput(s, 'p1', { up: true }); run(s, 5); setInput(s, 'p1', { brake: true }); run(s, 2);
    assert.ok(ok(v.x), `${build} ${vid}: x ${v.x.toFixed(1)}`);
    if (hint) assert.match(p.hint, hint);
  }
});
