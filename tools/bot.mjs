// A scripted crew that plays the night market through the real action API:
// it walks, carries, folds, lifts, loads and drives. Only parking manoeuvres
// on flat ground and the empty drive back down are shortcut (teleported),
// because they do not change hand moves (H) or carry distance (M).
import { createGame, addPlayer, action, step, setInput, dims } from '../sim.mjs';
import { drive, route } from '../test/helpers.mjs';

const TAU = Math.PI * 2;
export const PARK = {
  load: { x: 106.4, y: 182, angle: 0 },          // tail faces the assembly point west of it
  depart: { x: 56, y: 177, angle: -Math.PI / 2 },
  strip: { x: 86, y: 12, angle: Math.PI },        // heading west, tail towards the gate
  lot: { x: 80, y: 42, angle: 0 },               // heading east, tail towards the steps and the ramp
};
const ASSEMBLY = { x: 100, y: 182 };

export function createCrew({ build = 'standard', crew = 1, mission = 'b2' } = {}) {
  const s = createGame({ mission, build });
  const ids = ['p1', 'p2', 'p3', 'p4'].slice(0, crew);
  ids.forEach((id, i) => addPlayer(s, id, ['阿青', '小满', '老周', '豆豆'][i]));
  return { s, ids, log: [], driveTime: 0, waits: 0 };
}

const P = (c, id) => c.s.players.find(p => p.id === id);
const O = (c, id) => c.s.objects.find(o => o.id === id);
const V = (c, id = 'main') => c.s.vehicles.find(v => v.id === id);
function act(c, pid, name) {
  const r = action(c.s, pid, name);
  if (!r.ok) throw new Error(`${name} failed for ${pid}: ${r.error}`);
  return r;
}
const tick = (c, n = 1) => { for (let i = 0; i < n; i++) step(c.s, 1 / 30); };

/** Eight-way walking autopilot along waypoints (axis-first near the target). */
export function walk(c, pid, ...points) {
  for (const g of points) {
    let t = 0, last = Infinity, still = 0;
    while (t < 90) {
      const p = P(c, pid), dx = g.x - p.x, dy = g.y - p.y;
      if (Math.abs(dx) < 0.12 && Math.abs(dy) < 0.12) break;
      setInput(c.s, pid, { right: dx > 0.1, left: dx < -0.1, down: dy > 0.1, up: dy < -0.1 });
      tick(c); t += 1 / 30;
      const d = Math.hypot(dx, dy);
      still = d > last - 1e-3 ? still + 1 : 0; last = d;
      if (still > 45) throw new Error(`${pid} stuck walking to ${g.x.toFixed(1)},${g.y.toFixed(1)} at ${p.x.toFixed(1)},${p.y.toFixed(1)} (${p.hint})`);
    }
    setInput(c.s, pid, {});
  }
}

/** Every holder pushes towards each waypoint; the table centre follows. */
export function push(c, tableId, ...points) {
  const t = O(c, tableId);
  for (const g of points) {
    let time = 0, last = Infinity, still = 0;
    while (time < 120) {
      const dx = g.x - t.x, dy = g.y - t.y;
      if (Math.abs(dx) < 0.12 && Math.abs(dy) < 0.12) break;
      for (const id of t.holders) setInput(c.s, id, { right: dx > 0.1, left: dx < -0.1, down: dy > 0.1, up: dy < -0.1 });
      tick(c); time += 1 / 30;
      const d = Math.hypot(dx, dy);
      still = d > last - 1e-3 ? still + 1 : 0; last = d;
      if (still > 45) throw new Error(`${tableId} stuck at ${t.x.toFixed(1)},${t.y.toFixed(1)} going to ${g.x},${g.y}: ${P(c, t.holders[0])?.hint}`);
    }
    for (const id of t.holders) setInput(c.s, id, {});
  }
}

/** Walk next to an object (on the side facing the walker) and pick it up. */
export function pick(c, pid, id) {
  const o = O(c, id), p = P(c, pid);
  const base = Math.atan2(p.y - o.y, p.x - o.x), r = 1.25;
  // Stand where the wanted object is the nearest one on the ground.
  const others = c.s.objects.filter(x => x !== o && x.at.kind === 'ground');
  let spot = null;
  for (let k = 0; k < 16 && !spot; k++) {
    const ang = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 8;
    const q = { x: o.x + Math.cos(ang) * r, y: o.y + Math.sin(ang) * r };
    if (others.every(x => Math.hypot(x.x - q.x, x.y - q.y) > Math.hypot(o.x - q.x, o.y - q.y) + 0.2)) spot = q;
  }
  spot ??= { x: o.x + Math.cos(base) * r, y: o.y + Math.sin(base) * r };
  walk(c, pid, { x: spot.x, y: spot.y });
  P(c, pid).angle = Math.atan2(o.y - P(c, pid).y, o.x - P(c, pid).x);
  act(c, pid, 'interact');
  if (P(c, pid).holding !== id) throw new Error(`${pid} picked ${P(c, pid).holding} instead of ${id}`);
}

/** Carry the held item so that its centre lands on target, then put it down. */
export function carryTo(c, pid, target, via = []) {
  const p = P(c, pid);
  walk(c, pid, ...via);
  walk(c, pid, { x: target.x - p.carry.x, y: target.y - p.carry.y });
  act(c, pid, 'interact');
}

/** Swing the held piece (quarter turns about the carrier) until it points along dir. */
export function pointHeld(c, pid, dir) {
  const p = P(c, pid);
  for (let k = 0; k < 4; k++) {
    const len = Math.hypot(p.carry.x, p.carry.y) || 1;
    if ((p.carry.x * dir.x + p.carry.y * dir.y) / len > 0.7) return true;
    if (!action(c.s, pid, 'rotate').ok) return false;
  }
  return false;
}

/** Take a piece by the end that faces against dir, so it rides ahead along dir, long side first. */
export function pickByEnd(c, pid, id, dir) {
  const o = O(c, id), d = dims(o), len = Math.max(d.l, d.w) * 0.5;
  const at = { x: o.x - dir.x * (len / 2 + 0.75), y: o.y - dir.y * (len / 2 + 0.75) };
  walk(c, pid, at);
  P(c, pid).angle = Math.atan2(dir.y, dir.x);
  act(c, pid, 'interact');
  if (P(c, pid).holding !== id) throw new Error(`${pid} took ${P(c, pid).holding} by the end instead of ${id}`);
}

// The public-service yard and its 1.4 m gate in the west wall (x 78-78.6, y 22.6-24).
export const YARD = { out: { x: 74.4, y: 23.3 }, in: { x: 80.6, y: 23.3 } };
export const inYard = q => q.x > 78.6 && q.x < 91.6 && q.y > 19 && q.y < 32;

/** From the strip or the work area into the yard by its gate, the piece in hand pointing ahead. */
export function intoYard(c, pid) {
  const p = P(c, pid);
  if (inYard(p)) return;
  if (p.y < 18.4) walk(c, pid, { x: YARD.out.x, y: Math.min(p.y, 16.2) }); // round the yard's north wall
  walk(c, pid, YARD.out);
  if (p.holding) pointHeld(c, pid, { x: 1, y: 0 });
  walk(c, pid, YARD.in);
}

/** Back out through the gate, westward. */
export function leaveYard(c, pid) {
  const p = P(c, pid);
  if (!inYard(p)) return;
  walk(c, pid, { x: Math.max(YARD.in.x, Math.min(p.x, 88)), y: YARD.in.y }, YARD.in);
  if (p.holding) pointHeld(c, pid, { x: -1, y: 0 });
  walk(c, pid, YARD.out);
}

export function park(c, pose, id = 'main') {
  const v = V(c, id);
  Object.assign(v, { x: pose.x, y: pose.y, angle: pose.angle, speed: 0 });
  tick(c, 2);
}
const tail = v => { const back = (v.type === 'van' ? 2.4 : 3.5) + 0.9; return { x: v.x - Math.cos(v.angle) * back, y: v.y - Math.sin(v.angle) * back }; };

export function boardAndDrive(c, pid, points, opts = {}) {
  const v = V(c, opts.vehicle ?? 'main');
  const p = P(c, pid);
  p.x = v.x + Math.cos(v.angle + Math.PI / 2) * 2; p.y = v.y + Math.sin(v.angle + Math.PI / 2) * 2;
  act(c, pid, 'vehicle');
  for (const id of opts.passengers ?? []) { const q = P(c, id); Object.assign(q, { x: p.x, y: p.y }); act(c, id, 'vehicle'); }
  const r = drive(c.s, pid, v, points, opts);
  c.driveTime += r.time;
  return r;
}

/** Cross the gust pass: crawl under the gust sign, or hop between windbreaks when it says shelter only. */
export function crossPass(c, pid, vid = 'main') {
  const s = c.s, v = V(c, vid);
  const gust = v.profile.advisory.gust;
  const top = { x: 114, y: 36 };
  if (gust !== 0) {
    // A careful crew crawls under the gust sign the whole way.
    const crawl = gust === null ? 40 : Math.max(4, gust * 0.85);
    drive(s, pid, v, route(s, { x: 114, y: 96 }, top), { maxTime: 120, speedFor: () => crawl });
    return;
  }
  const hops = [{ x: 114, y: 85.5 }, { x: 114, y: 68.5 }, { x: 114, y: 54 }, top];
  for (const h of hops) {
    // Leave only at the start of a calm so the hop finishes before the next gust.
    let guard = 0;
    while (!(s.gust.state === 'calm' && s.gust.left > 2.6) && guard++ < 900) { setInput(s, pid, { brake: true }); step(s, 1 / 30); }
    c.waits++;
    drive(s, pid, v, route(s, { x: v.x, y: v.y - 2 }, h), { speedFor: () => 36, maxTime: 30 });
  }
}

export function leave(c, pid) { act(c, pid, 'vehicle'); }

/** Drive the loaded main truck from the departure pose up to the gust pass top. */
export function driveUp(c, pid, road = 'short', passengers = [], vid = 'main') {
  park(c, PARK.depart, vid);
  const s = c.s;
  const pts = road === 'short'
    ? route(s, { x: 56, y: 172 }, 'short', { x: 113, y: 100 })
    : route(s, { x: 70, y: 178 }, { x: 120, y: 182 }, 'long', { x: 116, y: 104 }, { x: 114, y: 100 });
  boardAndDrive(c, pid, pts, { maxTime: 240, passengers, vehicle: vid });
  crossPass(c, pid, vid);
  c.trips = (c.trips ?? 0) + 1;
}

/** Everyone in the truck gets out at the destination. */
export function unloadCrew(c) { for (const id of V(c).occupants.slice()) act(c, id, 'vehicle'); }

export function arrive(c, pid) {
  const v = V(c), pr = v.profile;
  if (pr.passGate) {
    drive(c.s, pid, v, route(c.s, { x: 104, y: 32 }, { x: 96, y: 30 }, { x: 96, y: 17 }), { maxTime: 60 });
    if (v.y > 22) throw new Error(`truck did not get through the gate (${v.y.toFixed(1)}): ${P(c, pid).hint}`);
    park(c, PARK.strip);
  } else park(c, PARK.lot);
  unloadCrew(c);
  return pr.passGate ? 'near' : 'far';
}

export function goDown(c, vid = 'main') { park(c, PARK.load, vid); }

export function summary(c) {
  const s = c.s;
  return { complete: s.complete, moves: s.stats.moves, carried: Math.round(s.stats.carried), trips: c.trips ?? 0,
    driven: Math.round(s.stats.driven), driveUp: Math.round(c.driveTime),
    rollovers: s.stats.rollovers, warnings: s.stats.warnings, liftSteps: s.stats.liftSteps, gustHops: c.waits,
    nearParks: s.records.nearParks, farParks: s.records.farParks, front: s.records.frontChoice, review: s.review?.lines ?? [] };
}

export { P, O, V, act, tick, tail, ASSEMBLY };
