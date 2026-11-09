// Concurrent crew harness: every member runs a generator that sets its own
// inputs and actions; the world steps once per tick after all of them moved.
// Used to look at four-player B2: who waits, for what, and for how long.
import { createGame, addPlayer, action, step, setInput } from '../sim.mjs';

const TICK = 1 / 30;
const P = (s, id) => s.players.find(p => p.id === id);
const O = (s, id) => s.objects.find(o => o.id === id);
const V = (s, id) => s.vehicles.find(v => v.id === id);

export function act(s, pid, name, payload) {
  const r = action(s, pid, name, payload);
  if (!r.ok) throw new Error(`${pid} ${name}: ${r.error}`);
  return r;
}

/** Walk along waypoints; yields once per tick. */
export function* walk(s, pid, ...points) {
  for (const g of points) {
    let t = 0, last = Infinity, still = 0;
    for (;;) {
      const p = P(s, pid), dx = g.x - p.x, dy = g.y - p.y;
      if (Math.abs(dx) < 0.12 && Math.abs(dy) < 0.12) break;
      setInput(s, pid, { right: dx > 0.1, left: dx < -0.1, down: dy > 0.1, up: dy < -0.1 });
      yield 'walk'; t += TICK;
      const d = Math.hypot(dx, dy);
      still = d > last - 1e-3 ? still + 1 : 0; last = d;
      // Someone else may be in the way for a moment; give it a few seconds.
      if (still > 150 || t > 120) throw new Error(`${pid} stuck walking to ${g.x.toFixed(1)},${g.y.toFixed(1)} at ${p.x.toFixed(1)},${p.y.toFixed(1)}: ${p.hint}`);
    }
  }
  setInput(s, pid, {});
}

/** Push a gripped table; the leader steers every holder. */
export function* push(s, tableId, ...points) {
  const t = O(s, tableId);
  for (const g of points) {
    let time = 0, last = Infinity, still = 0;
    for (;;) {
      const dx = g.x - t.x, dy = g.y - t.y;
      if (Math.abs(dx) < 0.12 && Math.abs(dy) < 0.12) break;
      for (const id of t.holders) setInput(s, id, { right: dx > 0.1, left: dx < -0.1, down: dy > 0.1, up: dy < -0.1 });
      yield 'push'; time += TICK;
      const d = Math.hypot(dx, dy);
      still = d > last - 1e-3 ? still + 1 : 0; last = d;
      if (still > 150 || time > 180) throw new Error(`${tableId} stuck at ${t.x.toFixed(1)},${t.y.toFixed(1)} going to ${g.x},${g.y}`);
    }
  }
  for (const id of t.holders) setInput(s, id, {});
}

export function* waitUntil(cond, label = 'wait', limit = 600) {
  let t = 0;
  while (!cond()) { yield label; t += TICK; if (t > limit) throw new Error(`waited too long: ${label}`); }
}

/** Pick an object from the side where it is the nearest one on the ground. */
export function* pick(s, pid, id) {
  const o = O(s, id), p = P(s, pid);
  const base = Math.atan2(p.y - o.y, p.x - o.x), others = s.objects.filter(x => x !== o && x.at.kind === 'ground');
  let spot = null;
  for (let k = 0; k < 16 && !spot; k++) {
    const ang = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 8;
    const q = { x: o.x + Math.cos(ang) * 1.25, y: o.y + Math.sin(ang) * 1.25 };
    if (others.every(x => Math.hypot(x.x - q.x, x.y - q.y) > Math.hypot(o.x - q.x, o.y - q.y) + 0.2)) spot = q;
  }
  yield* walk(s, pid, spot ?? { x: o.x + Math.cos(base) * 1.25, y: o.y + Math.sin(base) * 1.25 });
  const me = P(s, pid); me.angle = Math.atan2(o.y - me.y, o.x - me.x);
  act(s, pid, 'interact');
  if (P(s, pid).holding !== id) throw new Error(`${pid} picked ${P(s, pid).holding} instead of ${id}`);
}

/** Carry the held item so its centre lands on target, then put it down / place it. */
export function* carryTo(s, pid, target, via = []) {
  yield* walk(s, pid, ...via);
  const p = P(s, pid);
  yield* walk(s, pid, { x: target.x - p.carry.x, y: target.y - p.carry.y });
  act(s, pid, 'interact');
}

/** Pure-pursuit driving at a fraction of the advisory; yields per tick. */
export function* drive(s, pid, vid, points, { factor = 0.85, cap = 40, lookahead = 5, gustCrawl = true } = {}) {
  const v = V(s, vid);
  let i = 0, t = 0, stuck = 0, reverse = 0;
  for (;;) {
    while (i < points.length - 1 && Math.hypot(points[i].x - v.x, points[i].y - v.y) < lookahead) i++;
    const g = points[i], dx = g.x - v.x, dy = g.y - v.y, d = Math.hypot(dx, dy);
    if (i === points.length - 1 && d < 2.5) break;
    let ang = Math.atan2(dy, dx) - v.angle; while (ang > Math.PI) ang -= 2 * Math.PI; while (ang < -Math.PI) ang += 2 * Math.PI;
    const kmh = Math.abs(v.speed) * 3.6;
    let want = cap;
    const ahead = points.slice(i, i + 6);
    for (const c of s.world.curves) if (ahead.some(p => c.zones.some(z => Math.hypot(p.x - z.x, p.y - z.y) <= z.r + 4))) want = Math.min(want, v.profile.advisory[c.grade] * factor);
    if (v.adv !== null && v.adv !== undefined) want = Math.min(want, v.adv * factor);
    const inPassAhead = v.inPass || ahead.some(p => p.x > 109 && p.x < 119 && p.y > 38 && p.y < 98);
    // A crawling crew keeps to the gust sign the whole way; a hop between windbreaks runs in the calm instead.
    if (gustCrawl && inPassAhead && v.profile.advisory.gust !== null) want = Math.min(want, Math.max(3, v.profile.advisory.gust * factor));
    if (i === points.length - 1) want = Math.min(want, Math.max(4, d * 2.2));
    // Keep a gap to whatever is ahead on the road.
    for (const o of s.vehicles) {
      if (o === v) continue;
      const ox = o.x - v.x, oy = o.y - v.y, od = Math.hypot(ox, oy);
      const along = ox * Math.cos(v.angle) + oy * Math.sin(v.angle), across = Math.abs(-ox * Math.sin(v.angle) + oy * Math.cos(v.angle));
      if (od < 16 && along > 0 && across < 3) want = Math.min(want, od < 10 ? 0 : Math.abs(o.speed) * 3.6);
    }
    if (reverse > 0) { reverse -= TICK; setInput(s, pid, { down: true, left: ang > 0, right: ang < 0 }); yield 'drive'; continue; }
    stuck = v.bump || (kmh < 0.5 && want > 3 && t > 1) ? stuck + TICK : 0;
    if (stuck > 1.5) { stuck = 0; reverse = 1.2; continue; }
    const slow = Math.abs(ang) > 0.5 ? Math.max(6, want * (1 - Math.min(0.7, Math.abs(ang) / 2))) : want;
    setInput(s, pid, { up: kmh < slow - 1, brake: kmh > slow + 2, left: ang < -0.06, right: ang > 0.06 });
    yield 'drive'; t += TICK;
    if (t > 300) throw new Error(`${pid} could not finish the drive (at ${v.x.toFixed(1)},${v.y.toFixed(1)})`);
  }
  setInput(s, pid, { brake: true });
  for (let k = 0; k < 90 && Math.abs(v.speed) > 0.05; k++) yield 'drive';
  setInput(s, pid, {});
}

/**
 * Run all crew generators together. Returns per-member time spent in each
 * activity, so waiting can be told apart from walking, pushing and driving.
 */
export function runCrew(s, members, { maxTime = 3600 } = {}) {
  const actors = members.map(([pid, gen]) => ({ pid, gen, done: false, time: {} }));
  let t = 0;
  while (actors.some(a => !a.done) && !s.complete && t < maxTime) {
    for (const a of actors) {
      if (a.done) continue;
      const r = a.gen.next();
      if (r.done) { a.done = true; a.finishedAt = t; continue; }
      a.time[r.value] = (a.time[r.value] ?? 0) + TICK;
    }
    step(s, TICK); t += TICK;
  }
  return { time: t, complete: s.complete, actors: actors.map(a => ({ pid: a.pid, finishedAt: a.finishedAt ?? t, time: Object.fromEntries(Object.entries(a.time).map(([k, v]) => [k, Math.round(v)])) })) };
}

export function createCrewGame({ mission = 'b2', build = 'standard', crew = 4 } = {}) {
  const s = createGame({ mission, build });
  const ids = ['p1', 'p2', 'p3', 'p4'].slice(0, crew);
  ids.forEach((id, i) => addPlayer(s, id, ['阿青', '小满', '老周', '豆豆'][i]));
  return { s, ids };
}

export { P, O, V };
