// Test-only helpers: place things directly and drive with a simple pure-pursuit autopilot.
import { step, setInput, action } from '../sim.mjs';

export const obj = (s, id) => s.objects.find(o => o.id === id);
export const veh = (s, id) => s.vehicles.find(v => v.id === id);
export const ply = (s, id) => s.players.find(p => p.id === id);
export const act = (s, pid, name, payload) => action(s, pid, name, payload);
export const run = (s, seconds) => { for (let i = 0; i < Math.round(seconds * 30); i++) step(s, 1 / 30); };
export const place = (pl, x, y) => { pl.x = x; pl.y = y; };

/** Route through road centre lines; returns waypoint list for drive(). */
export function route(s, ...parts) {
  const out = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      const [id, dir] = part.split(':');
      const pts = s.world.roads.find(r => r.id === id).points;
      out.push(...(dir === 'rev' ? [...pts].reverse() : pts));
    } else out.push(part);
  }
  return out;
}

/**
 * Drive vehicle v (with pid in the driver seat) along waypoints.
 * speedFor(v) returns the target speed in km/h; defaults to 90% of the advisory.
 */
export function drive(s, pid, v, points, { speedFor, maxTime = 240, lookahead = 5, stopAtEnd = true } = {}) {
  let i = 0, t = 0, stuck = 0, reverse = 0;
  const rollovers = s.stats.rollovers;
  const target = speedFor ?? (veh => Math.min(40, veh.adv !== null && veh.adv !== undefined ? veh.adv * 0.9 : nextAdvisory(s, veh, points, i) ?? 40));
  while (t < maxTime) {
    while (i < points.length - 1 && Math.hypot(points[i].x - v.x, points[i].y - v.y) < lookahead) i++;
    const goal = points[i];
    const dx = goal.x - v.x, dy = goal.y - v.y, distGoal = Math.hypot(dx, dy);
    if (i === points.length - 1 && distGoal < 2.5) break;
    let ang = Math.atan2(dy, dx) - v.angle; while (ang > Math.PI) ang -= 2 * Math.PI; while (ang < -Math.PI) ang += 2 * Math.PI;
    const kmh = Math.abs(v.speed) * 3.6;
    let want = target(v);
    if (stopAtEnd && i === points.length - 1) want = Math.min(want, Math.max(4, distGoal * 2.2));
    // Back up briefly when the body is wedged against an edge.
    if (reverse > 0) { reverse -= 1 / 30; setInput(s, pid, { down: true, left: ang > 0, right: ang < 0 }); step(s, 1 / 30); t += 1 / 30; continue; }
    stuck = v.bump || (kmh < 0.5 && want > 3) ? stuck + 1 / 30 : 0;
    if (stuck > 0.8) { stuck = 0; reverse = 1.2; continue; }
    const turnSlow = Math.abs(ang) > 0.5 ? Math.max(6, want * (1 - Math.min(0.7, Math.abs(ang) / 2))) : want;
    const input = { up: kmh < turnSlow - 1, down: false, brake: kmh > turnSlow + 2, left: ang < -0.06, right: ang > 0.06 };
    setInput(s, pid, input);
    step(s, 1 / 30); t += 1 / 30;
    if (s.stats.rollovers !== rollovers) break;
  }
  setInput(s, pid, { brake: true });
  for (let k = 0; k < 90 && Math.abs(v.speed) > 0.05; k++) step(s, 1 / 30);
  setInput(s, pid, {});
  return { time: t, index: i, done: i >= points.length - 1 };
}

/** Advisory of the next curve along the route, so the autopilot slows before it. */
function nextAdvisory(s, v, points, i) {
  const ahead = points.slice(i, i + 6);
  for (const c of s.world.curves) {
    if (ahead.some(p => c.zones.some(z => Math.hypot(p.x - z.x, p.y - z.y) <= z.r + 4))) {
      const adv = v.profile.advisory[c.grade];
      return adv * 0.9;
    }
  }
  if (ahead.some(p => p.x > 109 && p.x < 119 && p.y > 38 && p.y < 98) && s.gust.state !== 'calm') {
    const g = v.profile.advisory.gust;
    if (g !== null) return Math.max(2, g * 0.85);
  }
  return null;
}
