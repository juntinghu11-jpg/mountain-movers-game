// Small 2D geometry helpers shared by the simulation and the browser.
// World units are metres; y grows downward (screen convention), north is up.
export const TAU = Math.PI * 2;
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const normAngle = a => ((a % TAU) + TAU) % TAU;
export const angleDiff = (a, b) => { const d = normAngle(a - b); return d > Math.PI ? d - TAU : d; };

/** Rotate a local offset (along heading, across heading) into world space. */
export const toWorld = (pose, lx, ly) => ({
  x: pose.x + lx * Math.cos(pose.angle) - ly * Math.sin(pose.angle),
  y: pose.y + lx * Math.sin(pose.angle) + ly * Math.cos(pose.angle),
});
export const toLocal = (pose, p) => {
  const dx = p.x - pose.x, dy = p.y - pose.y, c = Math.cos(pose.angle), s = Math.sin(pose.angle);
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
};

/** Corners of an oriented box centred at (x, y); len lies along the angle. */
export function boxCorners(x, y, len, wid, angle = 0) {
  const c = Math.cos(angle), s = Math.sin(angle), hl = len / 2, hw = wid / 2;
  return [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([dx, dy]) => ({ x: x + dx * c - dy * s, y: y + dx * s + dy * c }));
}
export const rectPoly = r => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];

/** Separating-axis test for convex polygons. Touching edges do not overlap. */
export function polygonsOverlap(a, b) {
  for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const nx = -(q.y - p.y), ny = q.x - p.x;
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const v of a) { const d = v.x * nx + v.y * ny; if (d < amin) amin = d; if (d > amax) amax = d; }
    for (const v of b) { const d = v.x * nx + v.y * ny; if (d < bmin) bmin = d; if (d > bmax) bmax = d; }
    if (amax <= bmin + 1e-6 || bmax <= amin + 1e-6) return false;
  }
  return true;
}
export const inRect = (p, r, margin = 0) => p.x >= r.x + margin && p.x <= r.x + r.w - margin && p.y >= r.y + margin && p.y <= r.y + r.h - margin;
export const rectCenter = r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function segmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const t = len2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
export function polylineDistance(p, points) {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) best = Math.min(best, segmentDistance(p, points[i - 1], points[i]));
  return best;
}
/** Closest point on a polyline, its distance and the heading of that segment. */
export function nearestOnPolyline(p, points) {
  let best = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1) : 0;
    const q = { x: a.x + dx * t, y: a.y + dy * t }, d = Math.hypot(p.x - q.x, p.y - q.y);
    if (!best || d < best.d) best = { x: q.x, y: q.y, d, dir: Math.atan2(dy, dx) };
  }
  return best;
}
/** Distance along a polyline to the closest point; used for ordering signs and stops. */
export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}
/** Point and heading at distance d along a polyline. */
export function pointAlong(points, d) {
  for (let i = 1; i < points.length; i++) {
    const seg = dist(points[i - 1], points[i]);
    if (d <= seg || i === points.length - 1) {
      const t = seg ? clamp(d / seg, 0, 1) : 0, a = points[i - 1], b = points[i];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    d -= seg;
  }
  return { ...points[0], angle: 0 };
}

/**
 * Round each interior corner of a waypoint list with a fillet. Returns sampled
 * centre-line points and one record per corner (centre, radius, turn).
 */
export function filletPath(waypoints, radii) {
  const points = [{ ...waypoints[0] }], corners = [];
  for (let i = 1; i < waypoints.length - 1; i++) {
    const a = waypoints[i - 1], b = waypoints[i], c = waypoints[i + 1];
    const r = Array.isArray(radii) ? radii[i - 1] : radii;
    const u1 = { x: (b.x - a.x) / dist(a, b), y: (b.y - a.y) / dist(a, b) };
    const u2 = { x: (c.x - b.x) / dist(b, c), y: (c.y - b.y) / dist(b, c) };
    const cross = u1.x * u2.y - u1.y * u2.x, dot = clamp(u1.x * u2.x + u1.y * u2.y, -1, 1);
    const theta = Math.acos(dot);
    if (theta < 1e-3 || !r) { points.push({ ...b }); continue; }
    const t = r * Math.tan(theta / 2);
    const p1 = { x: b.x - u1.x * t, y: b.y - u1.y * t }, p2 = { x: b.x + u2.x * t, y: b.y + u2.y * t };
    const side = cross > 0 ? 1 : -1; // +1 turns clockwise on screen (y down)
    const n = { x: -u1.y * side, y: u1.x * side };
    const centre = { x: p1.x + n.x * r, y: p1.y + n.y * r };
    const start = Math.atan2(p1.y - centre.y, p1.x - centre.x);
    const steps = Math.max(3, Math.ceil(theta / (Math.PI / 18)));
    points.push(p1);
    for (let k = 1; k < steps; k++) {
      const ang = start + side * theta * k / steps;
      points.push({ x: centre.x + Math.cos(ang) * r, y: centre.y + Math.sin(ang) * r });
    }
    points.push(p2);
    corners.push({ index: i, x: centre.x, y: centre.y, radius: r, turn: theta, side, entry: p1, exit: p2, inDir: u1, outDir: u2 });
  }
  points.push({ ...waypoints.at(-1) });
  return { points, corners };
}

export function hashRandom(seed) {
  let value = seed | 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) | 0; return (value >>> 0) / 4294967296; };
}
