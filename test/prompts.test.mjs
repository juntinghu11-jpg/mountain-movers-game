// The on-screen prompts come from the same decisions as the actions: a chip never
// promises what the rules would refuse, and loading shows the height before it happens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, setInput, intents } from '../sim.mjs';
import { obj, veh, act, run, place } from './helpers.mjs';

const main = list => list.find(i => i.main);

test('prompts: what E would do, with the height a load would reach before it goes on', () => {
  const s = createGame({ mission: 'b2' });
  const p = addPlayer(s, 'p1', '甲');
  const t = obj(s, 'table-1');
  place(p, t.x + 1.6, t.y); run(s, 0.1);
  let list = intents(s, p);
  assert.match(main(list).label, /搬起/);
  assert.ok(list.some(i => i.key === 'Q' && i.label === '就地展开'));
  // Holding the standing lantern rack at an empty truck's tail: the prompt says it will top the gate.
  const v = veh(s, 'main');
  Object.assign(v, { x: 106.4, y: 182, angle: 0 });
  const L = obj(s, 'lantern'); Object.assign(L, { x: 99, y: 182, angle: 0, upright: true, at: { kind: 'ground' } });
  place(p, 97.6, 182); p.angle = 0; run(s, 0.1);
  assert.equal(act(s, 'p1', 'interact').ok, true);
  place(p, 100.6, 182); run(s, 0.1);
  list = intents(s, p);
  const e = main(list);
  assert.match(e.label, /装上主车 → 3\.2 m，过不了老山门/);
  assert.equal(e.preview.passGate, false);
  assert.ok(list.some(i => i.key === 'T' && /放倒/.test(i.label)));
  assert.equal(act(s, 'p1', 'tilt').ok, true);
  assert.match(main(intents(s, p)).label, /→ 2\.4 m$/, 'laid flat it reads the cab height and clears the gate');
  // Inside the gate the same prompt says plainly that it would be refused, and E is refused.
  const q = createGame({ mission: 'b2' });
  const r = addPlayer(q, 'p1', '乙');
  Object.assign(veh(q, 'main'), { x: 80, y: 15, angle: 0 });
  Object.assign(obj(q, 'lantern'), { x: 72.5, y: 15, angle: 0, upright: true, at: { kind: 'ground' } });
  place(r, 71.2, 15); r.angle = 0; run(q, 0.1);
  act(q, 'p1', 'interact');
  place(r, 74.4, 15); run(q, 0.1);
  const refused = main(intents(q, r));
  assert.equal(refused.refused, true);
  assert.match(refused.label, /出不了老山门/);
  assert.equal(act(q, 'p1', 'interact').ok, false);
});

test('prompts never promise more than the action does', () => {
  // Walk one player across the plaza past tables, goods and trucks; wherever E is offered, E works.
  const s = createGame({ mission: 'b2' });
  const p = addPlayer(s, 'p1', '甲');
  let offered = 0;
  for (let x = 36; x <= 120; x += 1.7) for (let y = 186; y <= 196; y += 1.9) {
    const probe = createGame({ mission: 'b2' });
    const q = addPlayer(probe, 'p1', '甲');
    place(q, x, y); run(probe, 0.05);
    const e = main(intents(probe, q));
    if (!e || e.key !== 'E' || e.refused) continue;
    offered++;
    assert.equal(act(probe, 'p1', 'interact').ok, true, `E offered "${e.label}" at ${x.toFixed(1)},${y.toFixed(1)} but refused: ${q.hint}`);
  }
  assert.ok(offered > 10, `E was offered at ${offered} spots`);
  assert.ok(p);
});

test('T stands up or lays down a tall piece where it sits on a table', () => {
  const s = createGame({ mission: 'b2' });
  const p = addPlayer(s, 'p1', '甲');
  const t = obj(s, 'table-4'); Object.assign(t, { x: 90, y: 190, angle: 0, folded: false, at: { kind: 'ground' } });
  obj(s, 'lantern-box').at = { kind: 'table', table: 'table-4', cx: 0, cy: 0, rot: 0 };
  const L = obj(s, 'lantern'); L.upright = true; L.at = { kind: 'table', table: 'table-4', cx: 2, cy: 2, rot: 0 };
  run(s, 0.1);
  place(p, L.x + 1.2, L.y + 1.2); run(s, 0.1);
  assert.ok(intents(s, p).some(i => i.key === 'T' && /放倒台上的灯笼架/.test(i.label)));
  assert.equal(act(s, 'p1', 'tilt').ok, true);
  assert.equal(L.upright, false);
  assert.equal(L.at.kind, 'table', 'still on its table');
  assert.equal(L.at.table, 'table-4');
});

test('a truck that meets the road edge at a shallow angle scrapes along it instead of stopping dead', () => {
  const s = createGame({ mission: 'b2' });
  const p = addPlayer(s, 'p1', '司机');
  const v = veh(s, 'main');
  // On the long road's first straight, heading east but angled into its south edge.
  Object.assign(v, { x: 160, y: 184.2, angle: 0.15 });
  run(s, 0.1);
  place(p, v.x, v.y - 2.5); act(s, 'p1', 'vehicle');
  setInput(s, 'p1', { up: true }); run(s, 4); setInput(s, 'p1', {});
  assert.ok(v.x > 168, `kept going along the edge (x ${v.x.toFixed(1)})`);
  assert.ok(s.log.some(l => l.text.includes('擦着路边走')), 'it did touch the edge, and the driver was told');
  assert.ok(v.y < 186, 'and it stayed on the road');
  assert.equal(s.stats.rollovers, 0);
});
