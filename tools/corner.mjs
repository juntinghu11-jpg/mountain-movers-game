// Leaving the plaza for the entrance curve the way a new driver does: hold W, steer at a
// point ahead on the road, never reverse. Counts how many such drivers make the curve.
//   node tools/corner.mjs
// The plaza is emptied first (other trucks and loose goods moved away), so only the
// ground itself can pin the truck. Start points cover the plaza on both sides of the exit;
// a longer look-ahead cuts the inside corner harder.
import { createGame, addPlayer, setInput, step, action } from '../sim.mjs';

const line = [{ x: 56, y: 172 }, { x: 56, y: 154 }, { x: 100, y: 154 }];

/** The point `ahead` metres further along `line` from p's place on its current leg; a leg is done once p passes its end. */
function aimPoint(p, ahead, progress) {
  const legAt = i => {
    const a = line[i], b = line[i + 1], dx = b.x - a.x, dy = b.y - a.y;
    return Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  };
  while (progress.i < line.length - 2 && legAt(progress.i) >= 1) progress.i++;
  let i = progress.i, u = legAt(i), rest = ahead;
  for (;;) {
    const a = line[i], b = line[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (rest <= (1 - u) * len || i === line.length - 2) {
      const f = Math.min(1, u + rest / len);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    rest -= (1 - u) * len; i++; u = 0;
  }
}

let made = 0, runs = 0, pinned = 0, total = 0;
const fails = [];
for (const sx of [24, 34, 44, 64, 80, 100]) for (const sy of [176, 184, 192]) for (const ahead of [6, 10, 14]) for (const kmh of [8, 14]) {
  const s = createGame({ mission: 'b2' });
  addPlayer(s, 'p1', '司机');
  const v = s.vehicles.find(x => x.id === 'main');
  s.vehicles = [v];
  for (const o of s.objects) if (o.at.kind === 'ground') Object.assign(o, { x: 185, y: 12 });
  Object.assign(v, { x: sx, y: sy, angle: Math.atan2(170 - sy, 56 - sx), speed: 0 });
  step(s, 1 / 30);
  const p = s.players[0];
  for (const [dx, dy] of [[3, 0], [-3, 0], [0, 2.5], [0, -2.5]]) { Object.assign(p, { x: v.x + dx, y: v.y + dy }); action(s, 'p1', 'vehicle'); if (p.vehicle) break; }
  if (!p.vehicle) continue;
  runs++;
  let t = 0, stuck = 0, ok = false;
  const progress = { i: 0 };
  while (t < 60 && !ok) {
    const aim = aimPoint(v, ahead, progress);
    let ang = Math.atan2(aim.y - v.y, aim.x - v.x) - v.angle;
    while (ang > Math.PI) ang -= 2 * Math.PI; while (ang < -Math.PI) ang += 2 * Math.PI;
    const now = Math.abs(v.speed) * 3.6;
    setInput(s, 'p1', { up: now < kmh, brake: now > kmh + 3, left: ang < -0.06, right: ang > 0.06 });
    step(s, 1 / 30); t += 1 / 30;
    if (v.bump) stuck += 1 / 30;
    ok = v.x > 78 && v.y < 158;
  }
  if (ok) made++; else fails.push(`start (${sx}, ${sy}) look-ahead ${ahead} m ${kmh} km/h: pinned at (${v.x.toFixed(1)}, ${v.y.toFixed(1)})`);
  pinned += stuck; total += t;
}
console.log(`made the entrance curve with W and steering only: ${made}/${runs}; pressed against an edge ${pinned.toFixed(0)} s of ${total.toFixed(0)} s driven`);
for (const f of fails) console.log('  ' + f);
