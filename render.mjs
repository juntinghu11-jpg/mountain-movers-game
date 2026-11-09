// Canvas drawing for the gray box. World units are metres; heights are shown
// with a light oblique lift so a tall load reads tall from above.
import { boxCorners, hashRandom } from './geom.mjs';

export const LIFT = 0.42; // screen metres of upward shift per metre of height
const FONT = '"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif';
const VEHICLE_LOOK = {
  main: { len: 7.0, wid: 2.3, bedLen: 4.0, cab: '#3f7c6b', body: '#c48b5d', bedH: 1.2, cabH: 2.4 },
  lowbed: { len: 7.0, wid: 2.3, bedLen: 4.0, cab: '#3f7c6b', body: '#b9875f', bedH: 1.2, lowH: 0.75, cabH: 2.4 },
  van: { len: 4.8, wid: 1.9, bedLen: 2.5, cab: '#5b7fa6', body: '#c9a36f', bedH: 1.1, cabH: 2.1 },
};
export const vehicleLook = type => VEHICLE_LOOK[type] ?? VEHICLE_LOOK.main;

function hull(points) {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
const lift = (poly, z) => poly.map(p => ({ x: p.x, y: p.y - z * LIFT }));
function pathPoly(ctx, poly) { ctx.beginPath(); poly.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); }
function shade(hex, f) {
  const n = parseInt(hex.slice(1, 7), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const m = v => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

/** An extruded box: base footprint lifted from z0 to z1. */
export function box3d(ctx, poly, z0, z1, color, { stroke = null, alpha = 1 } = {}) {
  const bottom = lift(poly, z0), top = lift(poly, z1);
  ctx.save(); ctx.globalAlpha *= alpha;
  if (z1 - z0 > 0.02) { pathPoly(ctx, hull([...bottom, ...top])); ctx.fillStyle = shade(color, 0.72); ctx.fill(); }
  pathPoly(ctx, top); ctx.fillStyle = color; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.06; ctx.stroke(); }
  ctx.restore();
  return top;
}

function text(ctx, str, x, y, size, color = '#3e5a4e', weight = 600, align = 'center') {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(str, x, y);
}
/** Heights read to the centimetre close to the 3.0 m gate, as the rules print them. */
export const fmtTop = t => (Math.abs(t - 3.0) < 0.1 ? t.toFixed(2) : t.toFixed(1));
function pill(ctx, str, x, y, size, color = '#4b6656', bg = '#fffdf0e6') {
  ctx.font = `650 ${size}px ${FONT}`;
  const w = ctx.measureText(str).width + size * 1.1, h = size * 1.7;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h * 0.35); ctx.fill();
  text(ctx, str, x, y + size * 0.04, size, color, 650);
}

export function createWorldRenderer() {
  let scenery = null, sceneryKey = '';
  function buildScenery(world) {
    const key = `${world.mission}:${world.bounds.width}`;
    if (key === sceneryKey) return;
    sceneryKey = key; scenery = { trees: [], blobs: [] };
    const rand = hashRandom(77);
    const busy = p => world.flats.some(f => p.x > f.x - 3 && p.x < f.x + f.w + 3 && p.y > f.y - 3 && p.y < f.y + f.h + 3)
      || world.walkAreas.some(f => p.x > f.x - 2 && p.x < f.x + f.w + 2 && p.y > f.y - 2 && p.y < f.y + f.h + 2)
      || world.obstacles.some(f => p.x > f.x - 2 && p.x < f.x + f.w + 2 && p.y > f.y - 2 && p.y < f.y + f.h + 2)
      || world.roads.some(r => r.points.some((q, i) => i && segDist(p, r.points[i - 1], q) < r.width / 2 + 2.5));
    for (let i = 0; i < 900; i++) {
      const p = { x: rand() * world.bounds.width, y: rand() * world.bounds.height };
      if (!busy(p)) scenery.trees.push({ ...p, r: 1.1 + rand() * 1.6, c: ['#5f8a5c', '#6f9663', '#7d9f6b', '#557f56'][Math.floor(rand() * 4)], pine: rand() > 0.35 });
    }
    for (let i = 0; i < 40; i++) scenery.blobs.push({ x: rand() * world.bounds.width, y: rand() * world.bounds.height, rx: 10 + rand() * 30, ry: 6 + rand() * 18, a: rand() * Math.PI, c: i % 2 ? '#a9bc93' : '#94aa82' });
  }

  function drawGround(ctx, world, t) {
    const { width, height } = world.bounds;
    ctx.fillStyle = '#9fb38c'; ctx.fillRect(-40, -40, width + 80, height + 80);
    ctx.save(); ctx.globalAlpha = 0.45;
    for (const b of scenery.blobs) { ctx.fillStyle = b.c; ctx.beginPath(); ctx.ellipse(b.x, b.y, b.rx, b.ry, b.a, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    // Contours climbing towards the summit (north).
    ctx.save(); ctx.strokeStyle = '#7e966f40'; ctx.lineWidth = 0.35;
    for (let i = 0; i < 14; i++) { ctx.beginPath(); ctx.ellipse(100, -10, 40 + i * 16, 20 + i * 15, 0, 0, Math.PI); ctx.stroke(); }
    ctx.restore();
    for (const r of world.roads) {
      ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const stroke = (w, c) => { ctx.beginPath(); r.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.lineWidth = w; ctx.strokeStyle = c; ctx.stroke(); };
      stroke(r.width + 2.2, '#b7b296'); stroke(r.width, '#cfc8ae');
      ctx.setLineDash([2.4, 2.6]); stroke(0.18, '#f4efdc'); ctx.restore();
    }
    for (const a of world.aprons ?? []) { ctx.fillStyle = '#cfc8ae'; ctx.fillRect(a.x, a.y, a.w, a.h); }
    for (const f of world.flats) {
      ctx.fillStyle = f.near ? '#e2dcc4' : f.far ? '#d9d3b8' : '#ddd6bd'; ctx.fillRect(f.x, f.y, f.w, f.h);
      ctx.strokeStyle = '#bdb597'; ctx.lineWidth = 0.25; ctx.strokeRect(f.x, f.y, f.w, f.h);
    }
    for (const a of world.walkAreas) {
      if (a.pad) {
        ctx.fillStyle = '#efe0b6'; ctx.fillRect(a.x, a.y, a.w, a.h);
        ctx.save(); ctx.beginPath(); ctx.rect(a.x, a.y, a.w, a.h); ctx.clip(); ctx.strokeStyle = '#d9b96a'; ctx.lineWidth = 0.3;
        for (let k = -a.h; k < a.w; k += 1.6) { ctx.beginPath(); ctx.moveTo(a.x + k, a.y + a.h); ctx.lineTo(a.x + k + a.h, a.y); ctx.stroke(); }
        ctx.restore();
      } else if (a.ramp) {
        ctx.fillStyle = '#e1d7b8'; ctx.fillRect(a.x, a.y, a.w, a.h);
        ctx.strokeStyle = '#c2b48c'; ctx.lineWidth = 0.25;
        for (let y = a.y + 1.5; y < a.y + a.h; y += 1.6) { ctx.beginPath(); ctx.moveTo(a.x + 1, y + 0.8); ctx.lineTo(a.x + a.w / 2, y); ctx.lineTo(a.x + a.w - 1, y + 0.8); ctx.stroke(); }
      } else {
        ctx.fillStyle = a.id === 'deck' ? '#d8c39b' : a.id.startsWith('tea') ? '#e8d9bb' : '#ebe4cb';
        ctx.fillRect(a.x, a.y, a.w, a.h);
        if (a.id === 'work') { ctx.strokeStyle = '#d9d1b4'; ctx.lineWidth = 0.08; for (let x = a.x; x < a.x + a.w; x += 2) { ctx.beginPath(); ctx.moveTo(x, a.y); ctx.lineTo(x, a.y + a.h); ctx.stroke(); } }
      }
    }
    for (const b of world.breakovers ?? []) {
      ctx.fillStyle = '#b9ae8c'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = '#8f8466'; ctx.lineWidth = 0.18;
      for (let x = b.x + 0.4; x < b.x + b.w; x += 0.8) { ctx.beginPath(); ctx.moveTo(x, b.y + 0.4); ctx.lineTo(x, b.y + b.h - 0.4); ctx.stroke(); }
    }
    for (const st of world.steps) {
      ctx.fillStyle = '#cbc3a5'; ctx.fillRect(st.x, st.y, st.w, st.h);
      ctx.fillStyle = '#b3aa89'; ctx.fillRect(st.x, st.y + st.h / 2 - 0.12, st.w, 0.24); ctx.fillRect(st.x, st.y + st.h - 0.2, st.w, 0.2);
    }
    // Pass: wind streaks when the gust blows, calm lee behind each windbreak.
    const pass = world.pass;
    for (const sh of pass.shelters) { ctx.fillStyle = '#d7e3d2aa'; ctx.fillRect(sh.x, sh.y, sh.w, sh.h); }
  }

  function drawZones(ctx, world, state, t) {
    for (const z of world.zones) {
      const done = state.objectives?.some(o => o.done && ((z.stall && o.id === z.stall) || (z.accepts && o.id === (z.accepts === 'square' ? 'squares' : 'cabinet'))));
      const color = z.kind === 'staging' ? '#8e9a7c' : z.kind === 'frame' ? '#4f8e85' : done ? '#4f9562' : '#d08a4e';
      ctx.save();
      ctx.fillStyle = `${color}22`; ctx.fillRect(z.x, z.y, z.w, z.h);
      ctx.setLineDash(z.kind === 'staging' ? [0.6, 0.6] : [1.2, 0.8]); ctx.lineDashOffset = -t * 1.5;
      ctx.strokeStyle = `${color}cc`; ctx.lineWidth = 0.2; ctx.strokeRect(z.x + 0.1, z.y + 0.1, z.w - 0.2, z.h - 0.2);
      ctx.restore();
    }
  }

  function drawObstacle(ctx, o) {
    {
      if (o.kind === 'building') {
        box3d(ctx, [{ x: o.x, y: o.y }, { x: o.x + o.w, y: o.y }, { x: o.x + o.w, y: o.y + o.h }, { x: o.x, y: o.y + o.h }], 0, 3.2, o.id === 'station' ? '#b9a98c' : '#c69170');
        text(ctx, o.label, o.x + o.w / 2, o.y + o.h / 2 - 3.2 * LIFT, 1.5, '#fff7e4', 700);
      } else if (o.kind === 'gate') {
        box3d(ctx, [{ x: o.x, y: o.y }, { x: o.x + o.w, y: o.y }, { x: o.x + o.w, y: o.y + o.h }, { x: o.x, y: o.y + o.h }], 0, 3.0, '#b4523e');
      } else {
        const h = o.kind === 'windbreak' ? 2.6 : o.kind === 'post' ? 1.3 : 1.0;
        box3d(ctx, [{ x: o.x, y: o.y }, { x: o.x + o.w, y: o.y }, { x: o.x + o.w, y: o.y + o.h }, { x: o.x, y: o.y + o.h }], 0, h, o.kind === 'windbreak' ? '#9b9580' : o.kind === 'post' ? '#8f8a7a' : '#a9a68c');
      }
    }
  }

  function drawGateBeams(ctx, world) {
    for (const g of world.gates) {
      // The beam sits at the clearance height: what passes under it is what fits.
      const y = g.y + g.h / 2 - g.limit * LIFT;
      ctx.fillStyle = '#b4523e'; ctx.fillRect(g.x - 2.5, y - 0.45, g.w + 5, 0.9);
      text(ctx, `老山门 限高 ${g.limit.toFixed(1)} m`, g.x + g.w / 2, y - 1.4, 1.15, '#7b2d1f', 750);
    }
  }

  function drawWind(ctx, world, state, t) {
    const pass = world.pass, z = pass.zone, g = state.gust?.state;
    // Prayer flags at both ends: they stream before and during a gust.
    for (const [fx, fy] of [[z.x - 3, z.y + z.h + 2], [z.x - 3, z.y - 2]]) {
      ctx.strokeStyle = '#6e604a'; ctx.lineWidth = 0.18; ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - 4); ctx.stroke();
      const flap = g === 'gust' ? 1 : g === 'warn' ? 0.6 : 0.15;
      ['#d84f3c', '#efc14a', '#4f9562', '#4a77b4', '#f4f1e6'].forEach((c, i) => {
        const wave = Math.sin(t * (g === 'gust' ? 18 : 5) + i) * 0.25 * flap;
        ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(fx + i * 0.9 * flap + 0.1, fy - 4 + i * 0.5);
        ctx.lineTo(fx + 1.1 + i * 0.9 * flap + 0.4 * flap, fy - 3.7 + i * 0.5 + wave); ctx.lineTo(fx + i * 0.9 * flap + 0.1, fy - 3.3 + i * 0.5); ctx.fill();
      });
    }
    if (g !== 'gust' && g !== 'warn') return;
    ctx.save(); ctx.beginPath(); ctx.rect(z.x - 4, z.y, z.w + 10, z.h); ctx.clip();
    const rand = hashRandom(5), strength = g === 'gust' ? 1 : 0.35;
    for (let i = 0; i < 46; i++) {
      const y = z.y + rand() * z.h, speed = 14 + rand() * 10, len = 2 + rand() * 3;
      if (pass.shelters.some(s => y > s.y && y < s.y + s.h) && g === 'gust') continue;
      const x = z.x - 4 + ((t * speed + rand() * 40) % (z.w + 12));
      ctx.strokeStyle = `rgba(255,255,255,${0.55 * strength})`; ctx.lineWidth = 0.14;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + len / 2, y - 0.3, x + len, y); ctx.stroke();
    }
    ctx.restore();
  }

  function drawSigns(ctx, world, ref, scale) {
    for (const c of world.curves) {
      const adv = ref?.profile?.advisory?.[c.grade];
      // Where the sign's limit applies: a faint dashed edge of the curve zone near the truck being read.
      if (ref && scale > 6) for (const z of c.zones) {
        if (Math.hypot(z.x - ref.x, z.y - ref.y) > z.r + 30) continue;
        ctx.save(); ctx.strokeStyle = 'rgba(120,96,52,0.45)'; ctx.lineWidth = 0.18; ctx.setLineDash([0.8, 0.8]);
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
      for (const s of c.signs) {
        ctx.strokeStyle = '#5d5545'; ctx.lineWidth = 0.15; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x, s.y - 1.6); ctx.stroke();
        const color = adv === undefined ? '#6a7b70' : adv >= c.base ? '#3f8457' : adv >= c.base * 0.6 ? '#b97a1f' : '#b8432f';
        ctx.fillStyle = '#fffdf2'; ctx.strokeStyle = color; ctx.lineWidth = 0.22;
        ctx.beginPath(); ctx.roundRect(s.x - 1.7, s.y - 3.7, 3.4, 2.3, 0.4); ctx.fill(); ctx.stroke();
        text(ctx, adv === undefined ? c.label : `≤${adv}`, s.x, s.y - 2.55, 1.15, color, 800);
        if (scale > 9) text(ctx, c.label, s.x, s.y + 0.5, 0.75, '#4c5d52', 600);
      }
    }
  }

  function drawObject(ctx, o, me, highlight, t) {
    const d = o.dims, len = d.l * 0.5, wid = d.w * 0.5, poly = boxCorners(o.x, o.y, len, wid, o.angle);
    // Something in someone's hands rides above its own shadow.
    const carried = o.at?.kind === 'held' ? 0.55 : 0;
    if (carried) { ctx.fillStyle = 'rgba(30,50,40,0.28)'; pathPoly(ctx, poly); ctx.fill(); }
    const z = (o.z ?? 0) + carried, lifted = (o.holders?.length ?? 0) >= 2 ? 0.35 : 0;
    const isTable = o.spec === 'table';
    if (isTable && !o.folded) {
      const legs = boxCorners(o.x, o.y, len - 0.25, wid - 0.25, o.angle);
      for (const p of legs) { ctx.strokeStyle = '#8b6a43'; ctx.lineWidth = 0.12; ctx.beginPath(); ctx.moveTo(p.x, p.y - (z + lifted) * LIFT); ctx.lineTo(p.x, p.y - (z + lifted + d.h - 0.06) * LIFT); ctx.stroke(); }
      box3d(ctx, poly, z + lifted + d.h - 0.06, z + lifted + d.h, o.color, { stroke: '#9b7646' });
    } else {
      const top = box3d(ctx, poly, z + lifted, z + lifted + d.h, o.color, { stroke: '#00000030' });
      if (isTable) { ctx.strokeStyle = '#9b7646'; ctx.lineWidth = 0.08; ctx.beginPath(); ctx.moveTo((top[0].x + top[3].x) / 2, (top[0].y + top[3].y) / 2); ctx.lineTo((top[1].x + top[2].x) / 2, (top[1].y + top[2].y) / 2); ctx.stroke(); }
      if ((o.spec === 'lantern' || o.spec === 'giftLantern') && o.upright) {
        const cx = (top[0].x + top[2].x) / 2, cy = (top[0].y + top[2].y) / 2;
        for (let i = 0; i < 3; i++) { ctx.fillStyle = o.lit ? '#ffcf5a' : '#d9552f'; ctx.shadowColor = '#ffd36b'; ctx.shadowBlur = o.lit ? 0.8 : 0; ctx.beginPath(); ctx.ellipse(cx - 0.3 + i * 0.3, cy + 0.15 + (i % 2) * 0.12, 0.17, 0.22, 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.shadowBlur = 0;
      }
    }
    if (highlight === o.id) {
      ctx.save(); ctx.strokeStyle = '#fff6b8'; ctx.lineWidth = 0.18; ctx.setLineDash([0.5, 0.35]); ctx.lineDashOffset = -t * 2;
      pathPoly(ctx, lift(boxCorners(o.x, o.y, len + 0.4, wid + 0.4, o.angle), z)); ctx.stroke(); ctx.restore();
    }
  }

  function drawVehicle(ctx, v, objects, me, highlight, t) {
    const look = vehicleLook(v.type), poly = boxCorners(v.x, v.y, look.len, look.wid, v.angle);
    const shake = v.warn > 0 ? Math.sin(t * 60) * 0.06 * Math.min(1, v.warn) : 0;
    const tilt = Math.min(1, (v.warn ?? 0) / 2);
    ctx.save(); ctx.translate(shake, 0);
    // Shadow grows sideways as the wheels start to lift.
    ctx.fillStyle = `rgba(30,50,40,${0.22 + tilt * 0.2})`; pathPoly(ctx, boxCorners(v.x + 0.5 + tilt * 0.8, v.y + 0.6, look.len, look.wid + tilt * 0.8, v.angle)); ctx.fill();
    const fwd = { x: Math.cos(v.angle), y: Math.sin(v.angle) };
    const bedCenter = { x: v.x - fwd.x * (look.len / 2 - 0.1 - look.bedLen / 2), y: v.y - fwd.y * (look.len / 2 - 0.1 - look.bedLen / 2) };
    const cabLen = look.len - look.bedLen - 0.2, cabCenter = { x: v.x + fwd.x * (look.len / 2 - cabLen / 2), y: v.y + fwd.y * (look.len / 2 - cabLen / 2) };
    box3d(ctx, poly, 0.25, 0.75, '#4b5651');
    const deck = v.type === 'lowbed' ? look.lowH : look.bedH;
    box3d(ctx, boxCorners(bedCenter.x, bedCenter.y, look.bedLen, look.wid - 0.1, v.angle), 0.5, deck, look.body, { stroke: '#7c5a3a' });
    if (v.type === 'lowbed') {
      const shelf = { x: v.x - fwd.x * (look.len / 2 - 0.1 - 0.75), y: v.y - fwd.y * (look.len / 2 - 0.1 - 0.75) };
      box3d(ctx, boxCorners(shelf.x, shelf.y, 1.5, look.wid - 0.1, v.angle), 0.5, look.bedH, shade(look.body, 0.92), { stroke: '#7c5a3a' });
    }
    const items = objects.filter(o => o.at?.kind === 'bed' && o.at.vehicle === v.id);
    const goods = objects.filter(o => o.at?.kind === 'table' && items.some(i => i.id === o.at.table));
    // Draw from the tail forward so nearer stacks overlap correctly.
    for (const o of [...items, ...goods].sort((a, b) => (a.z ?? 0) - (b.z ?? 0) || b.y - a.y)) drawObject(ctx, o, me, highlight, t);
    box3d(ctx, boxCorners(cabCenter.x, cabCenter.y, cabLen, look.wid, v.angle), 0.5, look.cabH, look.cab, { stroke: '#284d43' });
    const glass = boxCorners(cabCenter.x + fwd.x * cabLen * 0.22, cabCenter.y + fwd.y * cabLen * 0.22, cabLen * 0.3, look.wid * 0.82, v.angle);
    pathPoly(ctx, lift(glass, look.cabH)); ctx.fillStyle = '#bcd7c9'; ctx.fill();
    if (v.creak && !v.warn) { ctx.strokeStyle = '#e7b653'; ctx.lineWidth = 0.15; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(v.x, v.y - 2.6 * LIFT, 3 + i * 0.6 + (t * 3 % 0.6), -0.5, 0.5); ctx.stroke(); } }
    if (v.warn > 0) { ctx.strokeStyle = `rgba(214,72,48,${0.4 + 0.4 * Math.sin(t * 20)})`; ctx.lineWidth = 0.35; pathPoly(ctx, lift(poly, 0.3)); ctx.stroke(); }
    if (highlight === `tail:${v.id}`) {
      const tail = { x: v.x - fwd.x * (look.len / 2 + 0.9), y: v.y - fwd.y * (look.len / 2 + 0.9) };
      ctx.save(); ctx.strokeStyle = '#fff6b8'; ctx.lineWidth = 0.2; ctx.setLineDash([0.5, 0.35]); ctx.lineDashOffset = -t * 2;
      ctx.beginPath(); ctx.arc(tail.x, tail.y, 1.1, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    ctx.restore();
  }

  function drawPlayer(ctx, p, me) {
    if (p.vehicle) return;
    const self = p.id === me?.id;
    ctx.fillStyle = 'rgba(30,50,40,0.25)'; ctx.beginPath(); ctx.ellipse(p.x + 0.12, p.y + 0.15, 0.42, 0.24, 0, 0, Math.PI * 2); ctx.fill();
    box3d(ctx, boxCorners(p.x, p.y, 0.55, 0.55, 0), 0, 1.2, p.color ?? '#d08d62');
    ctx.fillStyle = '#efd0a1'; ctx.beginPath(); ctx.arc(p.x, p.y - 1.45 * LIFT, 0.26, 0, Math.PI * 2); ctx.fill();
    if (self) { ctx.strokeStyle = '#fffae5'; ctx.lineWidth = 0.1; ctx.beginPath(); ctx.arc(p.x, p.y, 0.75, 0, Math.PI * 2); ctx.stroke(); }
    pill(ctx, p.name ?? '伙伴', p.x, p.y - 2.4, 0.62, self ? '#2f6a55' : '#5a6b5d');
  }

  function drawLabels(ctx, world, scale) {
    for (const l of world.labels) {
      ctx.save(); ctx.translate(l.x, l.y); if (l.vertical) ctx.rotate(-Math.PI / 2);
      text(ctx, l.text, 0, 0, scale < 6 ? 3.2 : 1.6, '#4a5e4c99', 700); ctx.restore();
    }
    if (scale < 6) {
      // Whole-map view: short names for where things go, the steps and the ramp, at a fixed screen size.
      const px = 9.5 / scale;
      const short = z => z.kind === 'staging' || z.kind === 'frame' ? null : z.front ? `前侧·${z.front === 'a' ? '站' : '台'}`
        : z.accepts === 'square' ? (z.id === 'spot-1' ? '方桌位' : null) : z.label.split(' · ')[0].replace('摊工作面', '').replace('（立放）', '');
      for (const z of world.zones) { const name = short(z); if (name) pill(ctx, name, z.x + z.w / 2, z.y + z.h / 2, px, '#7b4b24', '#fffdf0d8'); }
      for (const st of world.steps) pill(ctx, '台阶', st.x + st.w / 2, st.y + st.h / 2, px, '#7b4b24');
      for (const a of world.walkAreas) if (a.ramp) pill(ctx, '缓坡', a.x + a.w / 2, a.y + a.h / 2, px, '#5b6b5c');
      return;
    }
    const small = 1.05;
    // The near strip's name sits on its south edge: its north edge belongs to the stall positions' labels.
    for (const f of world.flats) pill(ctx, f.label, f.x + f.w / 2, f.near ? f.y + f.h - 1.4 : f.y + 1.6, small, f.near ? '#7b4b24' : '#5b6b5c');
    for (const a of world.walkAreas) if (a.pad || a.ramp || a.id === 'work' || a.id === 'deck') pill(ctx, a.label, a.x + a.w / 2, a.pad ? a.y + a.h / 2 : a.y + 1.2, small * 0.9, a.pad ? '#8a6418' : '#5b6b5c');
    for (const st of world.steps) pill(ctx, st.label, st.x + st.w / 2, st.y + st.h + 1.1, small * 0.9, '#7b4b24');
    for (const b of world.breakovers ?? []) pill(ctx, b.label, b.x + b.w / 2, b.y - 1.1, small * 0.9, '#7b4b24');
    // Zone names sit on the zone's top edge, clear of what stands inside.
    for (const z of world.zones) pill(ctx, z.label, z.x + z.w / 2, z.y + 0.2, small * 0.85, z.kind === 'staging' ? '#5b6b5c' : '#7b4b24', '#fffdf0d0');
  }

  function drawTrees(ctx, view) {
    const { x0, y0, x1, y1 } = view;
    for (const tr of scenery.trees) {
      if (tr.x < x0 - 4 || tr.x > x1 + 4 || tr.y < y0 - 4 || tr.y > y1 + 6) continue;
      ctx.fillStyle = '#3d5d3c33'; ctx.beginPath(); ctx.ellipse(tr.x + 0.6, tr.y + 0.4, tr.r, tr.r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      if (tr.pine) {
        ctx.fillStyle = tr.c;
        for (let k = 0; k < 3; k++) { const w = tr.r * (1 - k * 0.22), base = tr.y - k * tr.r * 0.55; ctx.beginPath(); ctx.moveTo(tr.x - w, base); ctx.lineTo(tr.x, base - tr.r * 1.3); ctx.lineTo(tr.x + w, base); ctx.fill(); }
      } else { ctx.fillStyle = tr.c; ctx.beginPath(); ctx.arc(tr.x, tr.y - tr.r * 0.6, tr.r, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  return {
    draw(ctx, { world, state, me, camera, ref, highlight, goal, t, width, height }) {
      buildScenery(world);
      ctx.save();
      ctx.translate(width / 2, height / 2); ctx.scale(camera.scale, camera.scale); ctx.translate(-camera.x, -camera.y);
      const view = { x0: camera.x - width / 2 / camera.scale, x1: camera.x + width / 2 / camera.scale, y0: camera.y - height / 2 / camera.scale, y1: camera.y + height / 2 / camera.scale };
      drawGround(ctx, world, t);
      drawZones(ctx, world, state, t);
      drawWind(ctx, world, state, t);
      drawSigns(ctx, world, ref, camera.scale);
      drawLabels(ctx, world, camera.scale);
      // Painter's order by ground y so southern things overlap northern ones.
      const items = [];
      for (const o of world.obstacles) items.push({ y: o.y + o.h, draw: () => drawObstacle(ctx, o) });
      for (const o of state.objects) if (o.at?.kind === 'ground' || o.at?.kind === 'held') items.push({ y: o.y + 0.3, draw: () => drawObject(ctx, o, me, highlight, t) });
      for (const o of state.objects) if (o.at?.kind === 'table') { const host = state.objects.find(x => x.id === o.at.table); if (host && host.at?.kind !== 'bed') items.push({ y: host.y + 0.31, draw: () => drawObject(ctx, o, me, highlight, t) }); }
      for (const v of state.vehicles) items.push({ y: v.y + 1, draw: () => drawVehicle(ctx, v, state.objects, me, highlight, t) });
      for (const p of state.players) items.push({ y: p.y + 0.2, draw: () => drawPlayer(ctx, p, me) });
      items.sort((a, b) => a.y - b.y);
      for (const it of items) it.draw();
      drawGateBeams(ctx, world);
      drawTrees(ctx, view);
      ctx.restore();
      if (goal) drawGoal(ctx, goal, camera, width, height);
    },
  };
}

/** Where to go next: a marker on the spot when it is on screen, an arrow at the edge when it is not. */
function drawGoal(ctx, goal, camera, width, height) {
  let sx = width / 2 + (goal.x - camera.x) * camera.scale, sy = height / 2 + (goal.y - camera.y) * camera.scale;
  // The free band between the side panels, below the toast line and above the dock.
  const left = Math.min(310, width * 0.25), right = width - Math.min(340, width * 0.25), top = 150, bottom = height - 160;
  ctx.save();
  ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (sx > 40 && sx < width - 40 && sy > 90 && sy < height - 50) {
    // On screen: a bobbing tag over the spot, kept clear of the panels.
    sx = Math.max(left, Math.min(right, sx)); sy = Math.max(top, Math.min(height - 130, sy));
    const bob = Math.sin(performance.now() / 260) * 3, w = ctx.measureText(goal.label).width + 14;
    ctx.fillStyle = '#2e6860'; ctx.beginPath(); ctx.moveTo(sx, sy - 6 + bob); ctx.lineTo(sx - 7, sy - 18 + bob); ctx.lineTo(sx + 7, sy - 18 + bob); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2e6860ee'; ctx.beginPath(); ctx.roundRect(sx - w / 2, sy - 42 + bob, w, 22, 8); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(goal.label, sx, sy - 31 + bob);
    ctx.restore(); return;
  }
  const cx = (left + right) / 2, cy = (top + bottom) / 2, ang = Math.atan2(sy - cy, sx - cx);
  const k = Math.min(Math.abs((right - left) / 2 / (Math.cos(ang) || 1e-6)), Math.abs((bottom - top) / 2 / (Math.sin(ang) || 1e-6)));
  const ax = cx + Math.cos(ang) * k * 0.96, ay = cy + Math.sin(ang) * k * 0.96;
  ctx.translate(ax, ay);
  ctx.fillStyle = '#2e6860ee'; ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.rotate(ang); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-5, -6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.restore();
  const label = goal.label, w = ctx.measureText(label).width + 14, ly = Math.sin(ang) > 0.5 ? -30 : 30;
  ctx.fillStyle = '#fffdf3ee'; ctx.beginPath(); ctx.roundRect(-w / 2, ly - 11, w, 22, 8); ctx.fill();
  ctx.fillStyle = '#2e6860'; ctx.fillText(label, 0, ly);
  ctx.restore();
}

function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

/**
 * Side view of a vehicle and its load: the same picture on the stability card
 * and in the three-second replay. x runs from the tail (left) to the cab (right).
 */
export function drawSideView(ctx, w, h, { side = [], vehicleType = 'main', top = 2.4, roll = 0, gate = 3.0, showGate = true, caption = '', gust = false, shake = 0, rearInset = false }) {
  const look = vehicleLook(vehicleType);
  const span = look.len + 1.4, scale = Math.min((w - 30) / span, (h - 40) / 4.6);
  const ground = h - 22, x0 = 16 + (w - 30 - span * scale) / 2 + 0.7 * scale;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.fillStyle = '#c9c1a2'; ctx.fillRect(0, ground, w, h - ground);
  // Gate clearance line: on the card, not in a curve or gust replay, where height was not the problem.
  if (showGate) {
    const gy = ground - gate * scale;
    ctx.setLineDash([6, 5]); ctx.strokeStyle = '#c0533e'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(8, gy); ctx.lineTo(w - 8, gy); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = `650 ${Math.max(12, h * 0.085)}px ${FONT}`; ctx.fillStyle = '#b0472f'; ctx.textAlign = 'left'; ctx.fillText(`老山门 ${gate.toFixed(1)} m`, 10, gy - 6);
  }
  if (gust) { ctx.strokeStyle = '#ffffffcc'; ctx.lineWidth = 2; for (let i = 0; i < 6; i++) { const y = ground - (0.8 + i * 0.6) * scale; ctx.beginPath(); ctx.moveTo(8, y); ctx.quadraticCurveTo(40, y - 6, 70, y); ctx.stroke(); } }
  // Seen from the roadside, a truck tipping away from the camera shortens and
  // leans; it lies flat when the roll reaches ninety degrees.
  // The side view only leans so far; the rear-view inset shows the truck going over.
  const sideRoll = rearInset ? Math.min(roll, 0.75) : roll, lean = Math.cos(sideRoll * Math.PI / 2);
  ctx.translate(shake, ground); ctx.transform(1, 0, -0.35 * Math.sin(sideRoll * Math.PI / 2), Math.max(0.06, lean), 0, 0); ctx.translate(0, -ground);
  const X = m => x0 + m * scale, Z = m => ground - m * scale;
  ctx.fillStyle = '#3e4a45';
  for (const ax of [1.2, look.len - 1.3]) { ctx.beginPath(); ctx.arc(X(ax), Z(0.45), 0.45 * scale, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#58625d'; ctx.fillRect(X(0), Z(0.75), look.len * scale, 0.3 * scale);
  const bedTop = vehicleType === 'lowbed' ? look.lowH : look.bedH;
  ctx.fillStyle = look.body;
  if (vehicleType === 'lowbed') {
    ctx.fillRect(X(0.1), Z(look.bedH), 1.5 * scale, (look.bedH - 0.5) * scale);
    ctx.fillRect(X(1.6), Z(look.lowH), 2.5 * scale, (look.lowH - 0.5) * scale);
  } else ctx.fillRect(X(0.1), Z(bedTop), look.bedLen * scale, (bedTop - 0.5) * scale);
  ctx.fillStyle = look.cab; ctx.beginPath(); ctx.roundRect(X(look.bedLen + 0.3), Z(look.cabH), (look.len - look.bedLen - 0.3) * scale, (look.cabH - 0.5) * scale, [6, 10, 2, 2]); ctx.fill();
  ctx.fillStyle = '#bcd7c9'; ctx.fillRect(X(look.len - 1.15), Z(look.cabH - 0.25), 0.8 * scale, 0.7 * scale);
  for (const s of [...side].sort((a, b) => a.z0 - b.z0)) {
    const xa = X(s.x0 + 0.1), xb = X(s.x1 + 0.1), za = Z(s.z0), zb = Z(s.z1);
    if (s.table && s.z1 - s.z0 > 0.5) {
      ctx.fillStyle = shade(s.color, 0.8); ctx.fillRect(xa + 2, zb, 3, za - zb); ctx.fillRect(xb - 5, zb, 3, za - zb);
      ctx.fillStyle = s.color; ctx.fillRect(xa, zb, xb - xa, Math.max(3, 0.08 * scale));
    } else {
      ctx.fillStyle = s.color; ctx.beginPath(); ctx.roundRect(xa + 1, zb, xb - xa - 2, za - zb, 3); ctx.fill();
      ctx.strokeStyle = '#00000025'; ctx.lineWidth = 1; ctx.stroke();
      if (xb - xa > 28 && za - zb > 12) { ctx.font = `600 ${Math.min(18, (za - zb) * 0.45)}px ${FONT}`; ctx.fillStyle = '#2b3c35'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s.label.slice(0, 4), (xa + xb) / 2, (za + zb) / 2); }
    }
  }
  ctx.restore();
  // Top marker drawn upright, outside the tilt.
  const ty = ground - top * scale;
  ctx.strokeStyle = !showGate ? '#4c6a5f' : top > gate + 1e-6 ? '#c0533e' : '#3f8457'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(w - 70, ty); ctx.lineTo(w - 12, ty); ctx.stroke();
  ctx.font = `750 ${Math.max(13, h * 0.09)}px ${FONT}`; ctx.fillStyle = ctx.strokeStyle; ctx.textAlign = 'right'; ctx.fillText(`最高点 ${fmtTop(top)} m`, w - 12, ty - 6);
  if (caption) { ctx.font = `700 ${Math.max(13, h * 0.08)}px ${FONT}`; ctx.fillStyle = '#2f4f45'; ctx.textAlign = 'left'; ctx.fillText(caption, 12, 26); }
  if (rearInset) drawRearView(ctx, w - Math.min(130, w * 0.2) - 10, h * 0.38, Math.min(130, w * 0.2), h * 0.5, { side, vehicleType, top, roll });
}

/** Small view from behind: the roll shows as a plain rotation about the outer wheel. */
function drawRearView(ctx, x, y, w, h, { side, vehicleType, top, roll }) {
  const look = vehicleLook(vehicleType), scale = Math.min((w - 12) / (look.wid + Math.max(top, 2.6)), (h - 26) / Math.max(4, top + 0.4));
  ctx.save();
  ctx.fillStyle = '#ffffffb8'; ctx.fillRect(x, y, w, h);
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  const gx = x + 8 + look.wid / 2 * scale, gy = y + h - 10;
  ctx.fillStyle = '#c9c1a2'; ctx.fillRect(x, gy, w, 10);
  ctx.font = `650 11px ${FONT}`; ctx.fillStyle = '#5b6b5c'; ctx.textAlign = 'left'; ctx.fillText('后视', x + 6, y + 14);
  const half = look.wid / 2;
  ctx.translate(gx + half * scale, gy); ctx.rotate(roll * Math.PI / 2); ctx.translate(-(gx + half * scale), -gy);
  ctx.fillStyle = '#3e4a45';
  for (const sx of [-half + 0.25, half - 0.25]) ctx.fillRect(gx + (sx - 0.2) * scale, gy - 0.9 * scale, 0.4 * scale, 0.9 * scale);
  const deck = vehicleType === 'lowbed' ? look.lowH : look.bedH;
  ctx.fillStyle = look.body; ctx.fillRect(gx - half * scale, gy - deck * scale, look.wid * scale, (deck - 0.5) * scale);
  const load = Math.max(deck, ...side.map(s => s.z1));
  if (load > deck) { ctx.fillStyle = '#d9a66b'; ctx.fillRect(gx - (half - 0.15) * scale, gy - load * scale, (look.wid - 0.3) * scale, (load - deck) * scale); }
  ctx.fillStyle = look.cab; ctx.globalAlpha = 0.55; ctx.fillRect(gx - half * scale, gy - look.cabH * scale, look.wid * scale, (look.cabH - deck) * scale);
  ctx.restore();
}
