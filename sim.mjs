// Authoritative rules for the v0.5 gray box. One stability rule for vehicle,
// table and goods; outline against the old gate; fixed-rhythm gust; rollover
// recovery that sets the load down on a rescue pad; one-person push versus
// two-person lift. Units: metres, seconds, km/h only for display and signs.
import { makeWorld, GATE_LIMIT } from './maps.mjs';
import {
  TAU, clamp, dist, normAngle, toWorld, toLocal, boxCorners, rectPoly, polygonsOverlap,
  inRect, rectCenter, polylineDistance, nearestOnPolyline, angleDiff,
} from './geom.mjs';

export const CELL = 0.5;
export const KMH = 3.6;
const OPEN_TABLE_H = 0.9;
const COLORS = ['#58d8d0', '#f8bb62', '#c69bff', '#ff819a'];

// Bed columns are counted from the cab (0) towards the tail. Sections let the
// low-bed body keep a low front well and a normal-height rear shelf.
export const VEHICLE_SPECS = {
  main: {
    label: '主车', len: 7.0, wid: 2.3, cols: 8, rows: 4, cabH: 2.4, halfTrack: 1.0, mass: 300, com: 0.6,
    maxSpeed: 13.5, accel: 2.4, minTurn: 6.0, maxYaw: 0.95, seats: 4,
    sections: [{ from: 0, to: 8, h: 1.2, name: '车床' }],
  },
  lowbed: {
    label: '主车（低货台）', len: 7.0, wid: 2.3, cols: 8, rows: 4, cabH: 2.4, halfTrack: 1.0, mass: 310, com: 0.62,
    maxSpeed: 13.5, accel: 2.3, minTurn: 6.0, maxYaw: 0.95, seats: 4, clearance: 'low',
    sections: [{ from: 0, to: 5, h: 0.75, name: '低段' }, { from: 5, to: 8, h: 1.2, name: '后段', overhang: 4 }],
  },
  van: {
    label: '伴行小车', len: 4.8, wid: 1.9, cols: 5, rows: 3, cabH: 2.1, halfTrack: 0.95, mass: 260, com: 0.55,
    maxSpeed: 15, accel: 2.9, minTurn: 4.6, maxYaw: 1.2, seats: 2,
    sections: [{ from: 0, to: 5, h: 1.1, name: '车床' }],
  },
};

// Footprints in 0.5 m cells: l along the object's own axis, w across it.
export const ITEM_SPECS = {
  table: { kind: 'table', label: '折叠台', mass: 40, folded: { l: 5, w: 2, h: 0.25 }, open: { l: 5, w: 3, h: OPEN_TABLE_H } },
  frame: { label: '长棚架', mass: 50, size: { l: 7, w: 1, h: 0.4 }, long: true },
  // Stall goods are sized so that every stall group on the main truck or a van tops the
  // 3.0 m gate, and every one on the low-bed well clears it (v0.5 §7).
  lanternBox: { label: '灯笼箱', mass: 30, size: { l: 2, w: 2, h: 1.1 } },
  lantern: { label: '灯笼架', mass: 30, tall: true, upright: { l: 2, w: 1, h: 2.0 }, flat: { l: 4, w: 1, h: 0.4 } },
  // The company's gift from the market (B3): a full rack hung with lanterns, a wide sail when it stands.
  giftLantern: { label: '夜市送的灯笼架', mass: 40, tall: true, upright: { l: 4, w: 1, h: 2.1 }, flat: { l: 4, w: 2, h: 0.5 } },
  sweet: { label: '糖水桶', mass: 45, size: { l: 2, w: 2, h: 1.1 } },
  grill: { label: '烤炉', mass: 60, size: { l: 2, w: 2, h: 1.1 } },
  spice: { label: '调料箱', mass: 25, size: { l: 2, w: 2, h: 0.6 } },
  speaker: { label: '音响', mass: 40, size: { l: 2, w: 2, h: 1.1 } },
  teaBox: { label: '茶水箱', mass: 35, size: { l: 2, w: 2, h: 0.6 } },
  square: { label: '八仙桌', mass: 30, size: { l: 2, w: 2, h: 0.8 } },
  // A glass-fronted tea cabinet: laid down, the glass would break, so it only travels standing (like O2's freezer).
  cabinet: { label: '高茶柜', mass: 110, tall: true, uprightOnly: true, upright: { l: 2, w: 1, h: 2.0 }, flat: { l: 4, w: 2, h: 0.55 } },
  sign: { label: '公司招牌', mass: 40, size: { l: 6, w: 1, h: 0.5 }, long: true },
  memento: { label: '纪念物箱', mass: 25, size: { l: 2, w: 2, h: 0.6 } },
  oldSign: { label: '旧店招牌', mass: 15, size: { l: 4, w: 1, h: 0.2 } },
  shelf: { label: '货架', mass: 60, size: { l: 4, w: 2, h: 1.8 } },
  bench: { label: '短长椅', mass: 20, size: { l: 3, w: 1, h: 0.5 } },
};
const LONG_ITEM = 2.5; // metres: a carried piece this long cannot pass through a standing stall's customer space
/** Heights read to the centimetre close to the gate, so 2.96 and 3.04 never both show as 3.0. */
export const fmtTop = t => (Math.abs(t - GATE_LIMIT) < 0.1 ? t.toFixed(2) : t.toFixed(1));

// Advisory tuning. Rules come before physics (v0.5 §2.5): below the number on
// the sign nothing tips; well above it, a two-second wheel-lift warning, then a rollover.
export const TUNING = {
  stabilityRef: 1.15, stabilityFloor: 0.7,
  gustBase: 20, gustCapacity: 12.2, gustFree: 40, gustShelterOnly: 4,
  warnLimit: 2.0, warnRelax: 1.2, creakRatio: 0.85,
};

const emptyInput = () => ({ up: false, down: false, left: false, right: false, brake: false });
const byId = (list, id) => list.find(v => v.id === id);

export function dims(o) {
  const spec = ITEM_SPECS[o.spec];
  if (spec.kind === 'table') return o.folded ? spec.folded : spec.open;
  if (spec.tall) return o.upright ? spec.upright : spec.flat;
  return spec.size;
}
const isTable = o => ITEM_SPECS[o.spec].kind === 'table';
const isOpenTable = o => isTable(o) && !o.folded;

function log(s, text, p = null) {
  if (p) p.hint = text;
  if (s.log.at(-1)?.text === text && s.time - s.log.at(-1).time < 1.5) return;
  s.log.push({ time: Math.round(s.time * 10) / 10, text });
  if (s.log.length > 30) s.log.shift();
}
/** A line in the shared log from outside the rules (the server: someone took over the company). */
export const note = (s, text) => log(s, String(text).slice(0, 120));

// ---------------------------------------------------------------- setup

function makeVehicle(id, type, pose) {
  return { id, type, label: VEHICLE_SPECS[type].label, x: pose.x, y: pose.y, angle: pose.angle, speed: 0,
    occupants: [], warn: 0, creak: false, adv: null, advReason: null, curveId: null, inPass: false, sheltered: false,
    lastStop: 's0', stoppedFor: 0, parkedIn: null, frames: [], frameClock: 0, bump: false, profile: null };
}

export const NIGHT_MARKET = ['table-1', 'table-2', 'table-3', 'table-4', 'frame-sweet', 'frame-grill', 'lantern-box', 'lantern', 'sweet-1', 'sweet-2', 'grill', 'spice', 'speaker', 'tea-box'];
export const COMPANY = ['sign', 'memento-1', 'memento-2', 'old-sign', 'gift-lantern'];
export const SHED_GOODS = ['shelf-1', 'shelf-2', 'bench'];

/** The finished night market as B2 left it, or the harder default with the front stall at the station's door. */
function defaultSummerLayout() {
  const T = (id, x, y) => ({ id, x, y, angle: 0, folded: false, at: { kind: 'ground' } });
  const G = (id, table, cx, cy) => ({ id, at: { kind: 'table', table, cx, cy, rot: 0 }, upright: true });
  return { front: 'a', objects: [
    T('table-4', 74, 12), G('lantern-box', 'table-4', 0, 0), G('lantern', 'table-4', 2, 2),
    T('table-1', 71, 23), G('sweet-1', 'table-1', 0, 0), G('sweet-2', 'table-1', 2, 0),
    T('table-2', 57, 23), G('grill', 'table-2', 0, 0), G('spice', 'table-2', 2, 0),
    T('table-3', 85, 23), G('speaker', 'table-3', 0, 0), G('tea-box', 'table-3', 2, 0),
    { id: 'frame-sweet', x: 71, y: 29, angle: 0, at: { kind: 'ground' } }, { id: 'frame-grill', x: 57, y: 29, angle: 0, at: { kind: 'ground' } },
  ] };
}

/** Summer layout handed from a finished B2 run to B3; anything mid-air falls back to the default spot. */
export function summerLayout(s) {
  if (s?.mission !== 'b2' || !s.complete) return null;
  const objects = s.objects.filter(o => NIGHT_MARKET.includes(o.id) && (o.at.kind === 'ground' || o.at.kind === 'table'))
    .map(o => ({ id: o.id, x: o.x, y: o.y, angle: o.angle, folded: o.folded, upright: o.upright, at: { ...o.at } }));
  return { front: s.records.frontChoice ?? null, objects };
}

function makeObjects(mission, carry = null) {
  const objects = [];
  const add = (id, spec, x, y, angle = 0, extra = {}) => objects.push({ id, spec, label: extra.label ?? ITEM_SPECS[spec].label,
    color: extra.color ?? '#d9a66b', at: { kind: 'ground' }, x, y, angle, holders: [], folded: false, upright: true, ...extra });
  if (mission === 'o6') {
    for (let i = 0; i < 6; i++) add(`square-${i + 1}`, 'square', 90 + (i % 3) * 2.6, 189 + Math.floor(i / 3) * 3, 0, { label: `八仙桌 ${i + 1}`, color: '#b98455' });
    add('cabinet', 'cabinet', 102, 190, 0, { color: '#8d5f3e', travelledUpright: true });
    return objects;
  }
  if (mission === 'b3') {
    // The night market first takes its B2 identities, then the summer layout is applied on top.
    for (const o of makeObjects('b2')) objects.push(o);
    const layout = carry ?? defaultSummerLayout(), fallback = defaultSummerLayout();
    for (const src of [...fallback.objects, ...layout.objects]) {
      const o = objects.find(x => x.id === src.id); if (!o) continue;
      Object.assign(o, { x: src.x ?? o.x, y: src.y ?? o.y, angle: src.angle ?? 0, folded: src.folded ?? false, upright: src.upright ?? true, at: { ...src.at } });
    }
    add('sign', 'sign', 46, 188.5, 0, { label: '公司招牌', color: '#d9b45a' });
    add('memento-1', 'memento', 39, 192.5, 0, { label: '纪念物箱·一', color: '#b6a1d8' });
    add('memento-2', 'memento', 42, 192.5, 0, { label: '纪念物箱·二', color: '#b6a1d8' });
    add('old-sign', 'oldSign', 47.5, 193, 0, { label: 'B1 旧店招牌', color: '#9fb7c9' });
    add('gift-lantern', 'giftLantern', 53, 193, 0, { label: '夜市送的灯笼架', color: '#f2c14e', travelledUpright: true });
    add('shelf-1', 'shelf', 100, 203, 0, { label: '气象站货架·一', color: '#a7a089' });
    add('shelf-2', 'shelf', 100, 206.5, 0, { label: '气象站货架·二', color: '#a7a089' });
    add('bench', 'bench', 112, 205, 0, { label: '短长椅', color: '#c79a6a' });
    return objects;
  }
  ['甲', '乙', '丙', '丁'].forEach((n, i) => add(`table-${i + 1}`, 'table', 62.5 + i * 3.6, 192.5, 0, { label: `折叠台${n}`, folded: true, color: '#e2b977' }));
  add('frame-sweet', 'frame', 45, 190, 0, { label: '糖水摊棚架', color: '#7fb6a8', stall: 'sweet' });
  add('frame-grill', 'frame', 45, 193, 0, { label: '烤串摊棚架', color: '#d27f63', stall: 'grill' });
  const goods = [
    ['lantern-box', 'lanternBox', '灯笼箱', '#f09a5b', 'lantern'], ['lantern', 'lantern', '灯笼架', '#f2c14e', 'lantern'],
    ['sweet-1', 'sweet', '糖水桶·红豆', '#88c6b6', 'sweet'], ['sweet-2', 'sweet', '糖水桶·绿豆', '#88c6b6', 'sweet'],
    ['grill', 'grill', '烤炉', '#c5715a', 'grill'], ['spice', 'spice', '调料箱', '#d9a35c', 'grill'],
    ['speaker', 'speaker', '音响', '#8e9fc9', 'public'], ['tea-box', 'teaBox', '茶水箱', '#a7c58a', 'public'],
  ];
  goods.forEach(([id, spec, label, color, stall], i) => add(id, spec, 89 + (i % 4) * 2.6, 189.5 + Math.floor(i / 4) * 3.2, 0,
    { label, color, stall, ...(spec === 'lantern' ? { travelledUpright: true } : {}) }));
  return objects;
}

export function createGame({ mission = 'b2', build = 'standard', carry = null } = {}) {
  mission = ['o6', 'b3'].includes(mission) ? mission : 'b2';
  build = build === 'lowbed' ? 'lowbed' : 'standard';
  const world = makeWorld(mission);
  const vehicles = [makeVehicle('main', build === 'lowbed' ? 'lowbed' : 'main', world.spawns.main),
    ...world.spawns.vans.map((pose, i) => makeVehicle(`van-${i + 1}`, 'van', pose))];
  vehicles.slice(1).forEach((v, i) => { v.label = `伴行小车 ${i + 1}`; });
  const s = {
    version: 5, time: 0, mission, build, world, vehicles, objects: makeObjects(mission, mission === 'b3' ? carry : null), players: [],
    phase: 'working', complete: false, objectives: [], log: [], incidents: [], incidentSeq: 0, review: null,
    gust: { state: 'calm', left: world.pass.cycle.calm, index: 0 },
    records: { nearFirst: null, nearParks: 0, farParks: 0, farGroups: [], liftSteps: [], gustWaits: 0, frontChoice: null, passCrossings: [], liftLog: [] },
    stats: { moves: 0, carried: 0, driven: 0, rollovers: 0, warnings: 0, gustWaits: 0, loads: 0, unloads: 0, folds: 0, unfolds: 0,
      lifts: 0, liftSteps: 0, bumps: 0, tows: 0, startedAt: 0, completedAt: null },
  };
  for (const v of vehicles) refreshProfile(s, v);
  if (mission === 'b3') {
    const front = s.world.zones.filter(z => z.front).find(z => s.objects.some(o => isOpenTable(o) && o.at.kind === 'ground' && inRect(o, z)));
    s.records.frontChoice = front?.front ?? null;
    s.records.summerFrom = carry ? 'b2' : 'default';
  }
  updateObjectives(s);
  if (mission === 'b3') log(s, s.records.frontChoice === 'a'
    ? '换季·公司上山：前侧摊位还摆在旧气象站正门前。长招牌搬不过摊位，要么先撤这一摊，要么走后门步道。'
    : '换季·公司上山：公司的五件东西上山进新址，夜市下山进冬棚，冬棚里的货架和长椅上山。');
  else log(s, mission === 'o6'
    ? '教学单：八仙桌和高茶柜在广场南侧的木器行门口，送上山顶茶馆。先看右侧稳度卡，再决定怎么装。'
    : '夜市最后一车：四张台、两件长棚架和八件摊货，都要摆到新夜市的工作面上。');
  return s;
}

export function addPlayer(s, id, name = '搬家伙伴') {
  if (typeof id !== 'string' || !id || byId(s.players, id) || s.players.length >= 4) return false;
  const n = s.players.length, spawn = s.world.spawns.players[n];
  const p = { id, name: String(name).slice(0, 24), color: COLORS[n], x: spawn.x, y: spawn.y, angle: -Math.PI / 2,
    vehicle: null, holding: null, carry: null, grip: null, gripOffset: null, input: emptyInput(), hint: '',
    safe: { x: spawn.x, y: spawn.y }, contribution: { moves: 0, carried: 0, driven: 0 } };
  s.players.push(p);
  log(s, `${p.name} 加入公司。`);
  return p;
}

export function removePlayer(s, id) {
  const p = byId(s.players, id); if (!p) return false;
  releaseHeld(s, p);
  if (p.vehicle) leaveVehicle(s, p, true);
  s.players = s.players.filter(v => v.id !== id);
  log(s, `${p.name} 离开；手上的东西已就地放下。`);
  return true;
}

export function setInput(s, id, input = {}) {
  const p = byId(s.players, id); if (!p) return false;
  p.input = Object.fromEntries(Object.keys(emptyInput()).map(k => [k, input?.[k] === true]));
  return true;
}

// ---------------------------------------------------------------- geometry of things

const spec = v => VEHICLE_SPECS[v.type];
const bedRear = v => -spec(v).len / 2 + 0.1;
const bedFront = v => bedRear(v) + spec(v).cols * CELL;
const tailPoint = v => toWorld(v, -spec(v).len / 2 - 0.9, 0);
const vehiclePoly = (v, pad = 0) => boxCorners(v.x, v.y, spec(v).len + pad, spec(v).wid + pad, v.angle);
const objectPoly = (o, pad = 0) => { const d = dims(o); return boxCorners(o.x, o.y, d.l * CELL + pad, d.w * CELL + pad, o.angle); };
const playerPoly = (p, r = 0.36) => boxCorners(p.x, p.y, r * 2, r * 2, 0);

function slotPose(host, hostIsVehicle, slot, d) {
  const cl = slot.rot ? d.w : d.l, cw = slot.rot ? d.l : d.w;
  if (hostIsVehicle) {
    const sp = spec(host);
    const local = { x: bedFront(host) - (slot.cx + cl / 2) * CELL, y: -sp.rows * CELL / 2 + (slot.cy + cw / 2) * CELL };
    const w = toWorld(host, local.x, local.y);
    return { x: w.x, y: w.y, angle: normAngle(host.angle + (slot.rot ? Math.PI / 2 : 0)) };
  }
  const td = dims(host);
  const local = { x: td.l * CELL / 2 - (slot.cx + cl / 2) * CELL, y: -td.w * CELL / 2 + (slot.cy + cw / 2) * CELL };
  const w = toWorld(host, local.x, local.y);
  return { x: w.x, y: w.y, angle: normAngle(host.angle + (slot.rot ? Math.PI / 2 : 0)) };
}

function sectionFor(v, cx, cl) {
  const secs = spec(v).sections;
  for (const sec of secs) {
    if (cx >= sec.from && cx + cl <= sec.to) return sec;
    if (sec.overhang && cx >= sec.from && cx < sec.to && cx + cl <= sec.to + sec.overhang) return { ...sec, overhanging: true };
  }
  return null;
}

/** Height of the surface an object sits on, and of its top, above ground. */
function baseHeight(s, o) {
  if (o.at.kind === 'bed') {
    const v = byId(s.vehicles, o.at.vehicle), d = dims(o);
    return sectionFor(v, o.at.cx, o.at.rot ? d.w : d.l)?.h ?? 1.2;
  }
  if (o.at.kind === 'table') { const t = byId(s.objects, o.at.table); return baseHeight(s, t) + dims(t).h; }
  return 0;
}

function syncObjects(s) {
  // Tables first so goods on them follow the table's updated pose.
  const order = [...s.objects].sort((a, b) => (a.at.kind === 'table') - (b.at.kind === 'table'));
  for (const o of order) {
    if (o.at.kind === 'bed') {
      const v = byId(s.vehicles, o.at.vehicle);
      Object.assign(o, slotPose(v, true, o.at, dims(o)));
    } else if (o.at.kind === 'table') {
      const t = byId(s.objects, o.at.table);
      Object.assign(o, slotPose(t, false, o.at, dims(o)));
    } else if (o.at.kind === 'held') {
      const p = byId(s.players, o.at.by);
      if (p) { o.x = p.x + p.carry.x; o.y = p.y + p.carry.y; }
    }
    o.z = baseHeight(s, o);
  }
}

const goodsOn = (s, table) => s.objects.filter(o => o.at.kind === 'table' && o.at.table === table.id);
const onBed = (s, v) => s.objects.filter(o => o.at.kind === 'bed' && o.at.vehicle === v.id);
const loadOf = (s, v) => { const direct = onBed(s, v); return [...direct, ...direct.filter(isOpenTable).flatMap(t => goodsOn(s, t))]; };

// ---------------------------------------------------------------- stability card

export function curveAdvisory(base, stability) {
  const f = clamp((stability - TUNING.stabilityFloor) / (TUNING.stabilityRef - TUNING.stabilityFloor), 0.2, 1);
  return Math.round(base * f);
}
/** Gust advisory in km/h; null means hardly affected, 0 means shelter only. */
export function gustAdvisory(windage, stability) {
  if (windage < 0.3) return null;
  const v = TUNING.gustBase * (TUNING.gustCapacity * stability / windage - 1);
  if (v >= TUNING.gustFree) return null;
  if (v < TUNING.gustShelterOnly) return 0;
  return Math.round(v);
}

function profileFrom(sp, items) {
  let mass = sp.mass, moment = sp.mass * sp.com, top = sp.cabH;
  const columns = new Map();
  for (const it of items) {
    mass += it.mass; moment += it.mass * (it.z + it.h / 2); top = Math.max(top, it.z + it.h);
    for (let c = it.c0; c < it.c1; c++) columns.set(c, Math.max(columns.get(c) ?? 0, it.z + it.h - it.bedH));
  }
  const com = moment / mass, stability = sp.halfTrack / com;
  // Side area above the bed, with taller columns weighted for their longer lever.
  const windage = [...columns.values()].reduce((n, h) => n + h * CELL * (1 + h / 2), 0);
  return { mass: Math.round(mass), com: Math.round(com * 100) / 100, stability: Math.round(stability * 100) / 100,
    windage: Math.round(windage * 10) / 10, top: Math.round(top * 100) / 100 };
}

export function vehicleProfile(s, v) {
  const sp = spec(v), load = loadOf(s, v);
  const lowest = Math.min(...sp.sections.map(x => x.h));
  const items = [], flat = [], side = [];
  for (const o of load) {
    const d = dims(o), z = baseHeight(s, o);
    let c0, c1, sec;
    if (o.at.kind === 'bed') { const cl = o.at.rot ? d.w : d.l; c0 = o.at.cx; c1 = c0 + cl; sec = sectionFor(v, o.at.cx, cl); }
    else {
      // Goods on a table on the bed: map the table's own grid onto bed columns.
      const t = byId(s.objects, o.at.table), td = dims(t);
      if (!t.at.rot) { c0 = t.at.cx + o.at.cx; c1 = c0 + (o.at.rot ? d.w : d.l); }
      else { c0 = t.at.cx + o.at.cy; c1 = c0 + (o.at.rot ? d.l : d.w); }
      sec = sectionFor(v, t.at.cx, t.at.rot ? td.w : td.l);
    }
    const bed = sec?.h ?? lowest;
    items.push({ mass: ITEM_SPECS[o.spec].mass, z, h: d.h, c0, c1, bedH: bed });
    // "Flat" means what the same goods would read if laid straight on the bed.
    const fd = ITEM_SPECS[o.spec].kind === 'table' ? ITEM_SPECS.table.folded : ITEM_SPECS[o.spec].tall && !ITEM_SPECS[o.spec].uprightOnly ? ITEM_SPECS[o.spec].flat : d;
    flat.push({ mass: ITEM_SPECS[o.spec].mass, z: bed, h: fd.h, c0, c1, bedH: bed });
    side.push({ id: o.id, label: o.label, color: o.color, x0: (sp.cols - c1) * CELL, x1: (sp.cols - c0) * CELL, z0: z, z1: z + d.h, table: isTable(o) });
  }
  const now = profileFrom(sp, items), plain = profileFrom(sp, flat);
  const adv = grade => curveAdvisory(GRADE_BASE[grade], now.stability);
  return {
    ...now, flatStability: plain.stability, gate: GATE_LIMIT, passGate: now.top <= GATE_LIMIT + 1e-9,
    advisory: { hairpin: adv('hairpin'), medium: adv('medium'), gentle: adv('gentle'), gust: gustAdvisory(now.windage, now.stability) },
    flatAdvisory: { hairpin: curveAdvisory(GRADE_BASE.hairpin, plain.stability), gentle: curveAdvisory(GRADE_BASE.gentle, plain.stability),
      gust: gustAdvisory(plain.windage, plain.stability) },
    side, bedLength: sp.cols * CELL, empty: load.length === 0, items: load.length, width: sp.wid,
  };
}
const GRADE_BASE = { hairpin: 30, medium: 38, gentle: 44 };
function refreshProfile(s, v) { syncObjects(s); v.profile = vehicleProfile(s, v); }
const refreshAll = s => { syncObjects(s); for (const v of s.vehicles) v.profile = vehicleProfile(s, v); };

// ---------------------------------------------------------------- terrain queries

const onRoad = (w, p, margin = 0.05) => w.roads.some(r => polylineDistance(p, r.points) <= r.width / 2 - margin);
const inFlat = (w, p) => w.flats.some(f => inRect(p, f));
const inWalkArea = (w, p) => w.walkAreas.some(a => inRect(p, a));
const onSteps = (w, p) => w.steps.some(a => inRect(p, a));
const drivable = (w, p) => onRoad(w, p) || inFlat(w, p) || (w.aprons ?? []).some(f => inRect(p, f));
const walkable = (w, p) => drivable(w, p) || inWalkArea(w, p) || onSteps(w, p);
const groupGround = (w, p, lifted) => inFlat(w, p) || inWalkArea(w, p) || (lifted && onSteps(w, p));
const samples = poly => [...poly, ...poly.map((p, i) => ({ x: (p.x + poly[(i + 1) % 4].x) / 2, y: (p.y + poly[(i + 1) % 4].y) / 2 })),
  { x: poly.reduce((n, p) => n + p.x, 0) / 4, y: poly.reduce((n, p) => n + p.y, 0) / 4 }];
const hitsObstacle = (w, poly) => w.obstacles.some(o => polygonsOverlap(poly, rectPoly(o)));
const flatAt = (w, p) => w.flats.find(f => inRect(p, f));

/** Customer space (apron) in front of each front stall position that currently holds an open table. */
const occupiedStalls = s => s.world.zones.filter(z => z.front && s.objects.some(o => isOpenTable(o) && o.at.kind === 'ground' && inRect(o, z))).map(z => z.apron ?? z);
const isLong = o => Math.max(dims(o).l, dims(o).w) * CELL >= LONG_ITEM;
/** Front stalls open for business: the table stands with all of that stall's goods on it, and customers stand in front. */
const servingStalls = (s, except = null) => s.world.zones.filter(z => z.front && s.objects.some(t => t !== except && isOpenTable(t) && t.at.kind === 'ground' && inRect(t, z)
  && (STALLS[z.stall]?.goods ?? []).every(id => { const g = byId(s.objects, id); return g?.at.kind === 'table' && g.at.table === t.id && (g.spec !== 'lantern' || g.upright); }))).map(z => z.apron ?? z);
/** Customer spaces a carried piece may not go deeper into: any standing stall's for a long piece, an open stall's for anything. */
const blockingAprons = (s, o) => isLong(o) ? occupiedStalls(s) : servingStalls(s);
/** How deep a footprint reaches into those customer spaces: sample points inside them. */
const apronDepth = (s, poly, aprons = occupiedStalls(s)) => Math.max(0, ...aprons.map(a => samples(poly).filter(p => inRect(p, a)).length));

// A finished front stall keeps its customer space; vehicles cannot drive into it.
const stallBlocks = (s, poly) => occupiedStalls(s).some(a => polygonsOverlap(poly, rectPoly(a)));

// Corners may ride a soft shoulder; the centre line of the body may not.
const SHOULDER = 1.0;
const nearDrivable = (w, p) => onRoad(w, p, -SHOULDER) || w.flats.some(f => inRect(p, f, -0.6)) || (w.aprons ?? []).some(f => inRect(p, f, -0.6));

/** Body samples off the drivable ground (riding the shoulder) for a pose. */
const overVerge = (s, v, pose) => { const sp = spec(v); return samples(boxCorners(pose.x, pose.y, sp.len, sp.wid, pose.angle)).filter(p => !drivable(s.world, p)).length; };

function vehicleBlocked(s, v, pose) {
  const w = s.world, sp = spec(v), poly = boxCorners(pose.x, pose.y, sp.len, sp.wid, pose.angle);
  const core = [{ x: pose.x, y: pose.y }, toWorld(pose, sp.len / 2 - 0.6, 0), toWorld(pose, -sp.len / 2 + 0.6, 0)];
  if (!core.every(p => drivable(w, p)) || !samples(poly).every(p => nearDrivable(w, p))) return 'edge';
  if (hitsObstacle(w, poly)) return 'obstacle';
  if (w.gates.some(g => polygonsOverlap(poly, rectPoly(g))) && v.profile.top > GATE_LIMIT + 1e-9) return 'gate';
  if (sp.clearance === 'low' && (w.breakovers ?? []).some(b => polygonsOverlap(poly, rectPoly(b)))) return 'breakover';
  if ((w.narrows ?? []).some(n => sp.wid > n.limit + 1e-9 && polygonsOverlap(poly, rectPoly(n)))) return 'narrow';
  if (s.vehicles.some(o => o !== v && polygonsOverlap(poly, vehiclePoly(o)))) return 'vehicle';
  if (s.objects.some(o => o.at.kind === 'ground' && polygonsOverlap(poly, objectPoly(o)))) return 'object';
  if (s.players.some(p => !p.vehicle && polygonsOverlap(poly, playerPoly(p)))) return 'player';
  if (stallBlocks(s, poly) && !stallBlocks(s, vehiclePoly(v))) return 'stall';
  return null;
}

function placementBlocked(s, o, pose, { ignore = [], lifted = false, group = false } = {}) {
  const w = s.world, d = dims(o), poly = boxCorners(pose.x, pose.y, d.l * CELL, d.w * CELL, pose.angle);
  if (!isTable(o) && blockingAprons(s, o).some(a => polygonsOverlap(poly, rectPoly(a)))) return 'stall';
  const ground = group ? p => groupGround(w, p, lifted) : p => walkable(w, p);
  if (!samples(poly).every(ground)) return group && samples(poly).some(p => onSteps(w, p)) ? 'steps' : 'edge';
  if (hitsObstacle(w, poly)) return 'obstacle';
  if (group && w.gates.some(g => polygonsOverlap(poly, rectPoly(g))) && d.h + Math.max(0, ...goodsOn(s, o).map(g => dims(g).h)) > GATE_LIMIT) return 'gate';
  if (s.vehicles.some(v => polygonsOverlap(poly, vehiclePoly(v)))) return 'vehicle';
  if (s.objects.some(x => x !== o && x.at.kind === 'ground' && !ignore.includes(x.id) && polygonsOverlap(poly, objectPoly(x)))) return 'object';
  return null;
}

// ---------------------------------------------------------------- surfaces

function occupancy(s, host, hostIsVehicle) {
  const cells = new Map();
  const list = s.objects.filter(o => hostIsVehicle ? o.at.kind === 'bed' && o.at.vehicle === host.id : o.at.kind === 'table' && o.at.table === host.id);
  for (const o of list) {
    const d = dims(o), cl = o.at.rot ? d.w : d.l, cw = o.at.rot ? d.l : d.w;
    for (let x = o.at.cx; x < o.at.cx + cl; x++) for (let y = o.at.cy; y < o.at.cy + cw; y++) cells.set(`${x},${y}`, o.id);
  }
  return cells;
}

function surfaceSize(host, hostIsVehicle) {
  if (hostIsVehicle) return { cols: spec(host).cols, rows: spec(host).rows };
  const d = dims(host); return { cols: d.l, rows: d.w };
}

function pathClear(cells, cols, cx, cl, cy, cw, ignore) {
  for (let x = cx + cl; x < cols; x++) for (let y = cy; y < cy + cw; y++) {
    const id = cells.get(`${x},${y}`);
    if (id && id !== ignore) return false;
  }
  return true;
}

function findSlot(s, host, hostIsVehicle, o, preferRot = 0) {
  const d = dims(o), { cols, rows } = surfaceSize(host, hostIsVehicle), cells = occupancy(s, host, hostIsVehicle);
  for (const rot of [preferRot, 1 - preferRot]) {
    const cl = rot ? d.w : d.l, cw = rot ? d.l : d.w;
    if (cw > rows) continue;
    for (let cx = 0; cx < cols; cx++) for (let cy = 0; cy + cw <= rows; cy++) {
      if (hostIsVehicle) {
        const sec = sectionFor(host, cx, cl);
        if (!sec) continue;
        if (sec.overhanging) {
          if (!ITEM_SPECS[o.spec].long || rot) continue;
          if (s.objects.some(x => x.at.kind === 'bed' && x.at.vehicle === host.id && sectionFor(host, x.at.cx, x.at.rot ? dims(x).w : dims(x).l)?.overhanging)) continue;
        }
      } else if (cx + cl > cols) continue;
      let free = true;
      for (let x = cx; x < cx + cl && free; x++) for (let y = cy; y < cy + cw; y++) if (x < cols && cells.has(`${x},${y}`)) { free = false; break; }
      if (!free) continue;
      if (hostIsVehicle && !pathClear(cells, cols, cx, cl, cy, cw)) continue;
      return { cx, cy, rot };
    }
  }
  return null;
}

function accessibleOnBed(s, v) {
  const cells = occupancy(s, v, true), cols = spec(v).cols;
  return onBed(s, v).filter(o => { const d = dims(o), cl = o.at.rot ? d.w : d.l, cw = o.at.rot ? d.l : d.w; return pathClear(cells, cols, o.at.cx, cl, o.at.cy, cw, o.id); })
    .sort((a, b) => (b.at.cx + (b.at.rot ? dims(b).w : dims(b).l)) - (a.at.cx + (a.at.rot ? dims(a).w : dims(a).l)));
}

// ---------------------------------------------------------------- player actions

const nearTail = (s, p, range = 2.6, steps = false) => s.vehicles.filter(v => Math.abs(v.speed) < 0.3 && dist(p, tailPoint(v)) <= range
  && toLocal(v, p).x < -spec(v).len / 2 + 0.6 && tailClear(s, v, p, steps)).sort((a, b) => dist(p, tailPoint(a)) - dist(p, tailPoint(b)))[0];

/** Nothing solid between a truck's tail and a point behind it: no wall or ledge, and for groups no steps. */
function tailClear(s, v, q, steps = false, width = 0.5) {
  const rear = toWorld(v, -spec(v).len / 2, 0), len = dist(rear, q);
  if (len < 0.05) return true;
  const poly = boxCorners((rear.x + q.x) / 2, (rear.y + q.y) / 2, len, width, Math.atan2(q.y - rear.y, q.x - rear.x));
  return !hitsObstacle(s.world, poly) && !(steps && s.world.steps.some(st => polygonsOverlap(poly, rectPoly(st))));
}

// The tail ramp needs level ground under the truck and under the ramp itself: not a road, a junction mouth or the steps.
const rampReady = (s, v) => inFlat(s.world, v) && groupGround(s.world, tailPoint(v), false);

/**
 * Inside the gate the only way out is under it (v0.5 §7): a load that would top the
 * gate is refused there, so nobody builds a truck that can never leave.
 */
function tooTallInside(s, v, p) {
  if (!flatAt(s.world, v)?.near) return false;
  refreshProfile(s, v);
  if (v.profile.top <= GATE_LIMIT + 1e-9) return false;
  log(s, `装上后最高点 ${fmtTop(v.profile.top)} m，出不了老山门（限高 ${GATE_LIMIT.toFixed(1)} m）。在近侧只能装低的；整组要先推到西坪再装车。`, p);
  return true;
}

function count(s, p, kind, amount = 1) {
  if (kind === 'moves') { s.stats.moves += amount; p.contribution.moves += amount; }
}

function releaseHeld(s, p) {
  if (p.holding) {
    const o = byId(s.objects, p.holding);
    if (o) { o.at = { kind: 'ground' }; if (placementBlocked(s, o, o)) { const spot = findFreeSpot(s, o, p); if (spot) Object.assign(o, spot); } }
    p.holding = null; p.carry = null;
  }
  if (p.grip) releaseGrip(s, p);
}

function findFreeSpot(s, o, around, opts = {}) {
  for (const r of [0, 1, 2, 3, 4.5, 6, 8, 10]) {
    const n = r ? Math.max(8, Math.round(r * 5)) : 1;
    for (let i = 0; i < n; i++) {
      const pose = { x: around.x + Math.cos(i * TAU / n) * r, y: around.y + Math.sin(i * TAU / n) * r, angle: opts.angle ?? o.angle };
      if (opts.within && !inRect(pose, opts.within)) continue;
      if (!placementBlocked(s, o, pose, opts)) return pose;
    }
  }
  return null;
}

function hold(s, p, o) {
  const d = dims(o), dx = o.x - p.x, dy = o.y - p.y, len = Math.hypot(dx, dy) || 1;
  const want = Math.min(len, Math.max(d.l, d.w) * CELL / 2 + 0.45);
  // What you carry rides straight ahead, behind or to one side of you, so it lines up with a door.
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 2)) * (Math.PI / 2);
  const near = { x: p.x + Math.cos(ang) * want, y: p.y + Math.sin(ang) * want };
  // Keep the item where it is if pulling it closer would push it into a wall, a truck or a stall's customer space.
  const poly = boxCorners(near.x, near.y, d.l * CELL, d.w * CELL, o.angle);
  const ok = samples(poly).every(c => walkable(s.world, c)) && !hitsObstacle(s.world, poly) && !s.vehicles.some(v => polygonsOverlap(poly, vehiclePoly(v)))
    && !(apronDepth(s, poly, blockingAprons(s, o)) > apronDepth(s, boxCorners(o.x, o.y, d.l * CELL, d.w * CELL, o.angle), blockingAprons(s, o)));
  p.carry = ok ? { x: near.x - p.x, y: near.y - p.y } : { x: dx, y: dy };
  o.at = { kind: 'held', by: p.id };
  p.holding = o.id;
  o.x = p.x + p.carry.x; o.y = p.y + p.carry.y;
  log(s, `搬起${o.label}。${ITEM_SPECS[o.spec].tall ? 'T 立起 / 放倒，' : ''}R 旋转，E 放下 / 装车 / 摆上台。`, p);
  return true;
}

function pickUp(s, p, o) {
  if (dist(p, o) > Math.max(dims(o).l, dims(o).w) * CELL / 2 + REACH + 0.1) return false;
  return hold(s, p, o);
}

function putDown(s, p) {
  const o = byId(s.objects, p.holding);
  const why = placementBlocked(s, o, o);
  if (why) { log(s, why === 'edge' ? '这里放不下：要放在平地或路面上。' : '这里放不下，先挪开一点。', p); return false; }
  o.at = { kind: 'ground' }; p.holding = null; p.carry = null;
  count(s, p, 'moves');
  log(s, `放下${o.label}。`, p);
  if (ITEM_SPECS[o.spec].tall) trackUpright(s, o);
  return true;
}

/**
 * Whether a held piece or a pushed group can go up this truck's tail now, and what the truck
 * would then read. The action and its prompt both use it, so a prompt never promises a refusal.
 */
function loadCheck(s, v, o, group = false) {
  if (!rampReady(s, v)) return { ok: false, why: 'slope' };
  if (group && dist(o, tailPoint(v)) > Math.max(dims(o).l, dims(o).w) * CELL / 2 + 2.2) return { ok: false, why: 'far' };
  if (group && !tailClear(s, v, o, true, Math.min(dims(o).l, dims(o).w) * CELL)) return { ok: false, why: 'walled' };
  const slot = findSlot(s, v, true, o, Math.abs(Math.sin(o.angle - v.angle)) > 0.7 ? 1 : 0);
  if (!slot) return { ok: false, why: 'full' };
  const before = o.at;
  o.at = { kind: 'bed', vehicle: v.id, ...slot };
  const pr = vehicleProfile(s, v);
  o.at = before;
  if (flatAt(s.world, v)?.near && !pr.passGate) return { ok: false, why: 'inside', slot, pr };
  return { ok: true, slot, pr };
}
const LOAD_REFUSED = {
  slope: () => '坡路上放不了车尾坡。把车停到平地（停靠点、卸货带、西坪），车尾也要落在平地上再装。',
  far: () => '把整组推到车尾坡跟前，再按 E 推上车。',
  full: (v, o, group) => group ? `${v.label}的车床放不下这个整组（一车只放得下一个展开的台）。` : `${v.label}装不下${o.label}：车床被占了，或者里面的货挡着通道。`,
  inside: (v, o, group, c) => `装上后最高点 ${fmtTop(c.pr.top)} m，出不了老山门（限高 ${GATE_LIMIT.toFixed(1)} m）。在近侧只能装低的；整组要先推到西坪再装车。`,
  walled: () => '整组和车尾之间隔着墙、门框或台阶，推不上去。',
};

function loadHeld(s, p, v) {
  const o = byId(s.objects, p.holding), c = loadCheck(s, v, o);
  if (!c.ok) { log(s, LOAD_REFUSED[c.why](v, o, false, c), p); return false; }
  o.at = { kind: 'bed', vehicle: v.id, ...c.slot };
  p.holding = null; p.carry = null;
  s.stats.loads++; count(s, p, 'moves');
  refreshProfile(s, v);
  if (ITEM_SPECS[o.spec].tall) trackUpright(s, o);
  log(s, `${o.label}已锁定在${v.label}上。最高点 ${fmtTop(v.profile.top)} m。`, p);
  return true;
}

function placeOnTable(s, p, t) {
  const o = byId(s.objects, p.holding);
  if (isTable(o)) { log(s, '台上不能再放台。', p); return false; }
  const slot = findSlot(s, t, false, o, Math.abs(Math.sin(o.angle - t.angle)) > 0.7 ? 1 : 0);
  if (!slot) { log(s, `${t.label}上放不下${o.label}了。`, p); return false; }
  o.at = { kind: 'table', table: t.id, ...slot }; p.holding = null; p.carry = null;
  count(s, p, 'moves'); syncObjects(s);
  log(s, `${o.label}摆上${t.label}。G 可以推动整组。`, p);
  return true;
}

function takeFromTable(s, p, t) {
  const goods = goodsOn(s, t).sort((a, b) => dist(p, a) - dist(p, b));
  if (!goods.length) return false;
  const o = goods[0];
  if (t.holders.length) { log(s, '整组正在被推着，先放下再取货。', p); return false; }
  markRoute(s, t, 'unpacked');
  o.at = { kind: 'ground' }; o.z = 0;
  return hold(s, p, o);
}

/** Whether the piece nearest the tail can come off now, and where it would land. */
function unloadCheck(s, v) {
  if (!rampReady(s, v)) return { ok: false, why: 'slope' };
  const list = accessibleOnBed(s, v);
  if (!list.length) return { ok: false, why: onBed(s, v).length ? 'buried' : 'empty' };
  const o = list[0], d = dims(o), group = isOpenTable(o);
  // Leave room for a person at the near end of a group, clear of the truck.
  const tail = toWorld(v, -spec(v).len / 2 - d.l * CELL / 2 - (group ? 1.0 : 0.6), 0);
  const pose = { x: tail.x, y: tail.y, angle: v.angle };
  if (!tailClear(s, v, pose, group, Math.min(d.l, d.w) * CELL)) return { ok: false, why: 'walled', o };
  const blocked = group ? placementBlocked(s, o, pose, { group: true, ignore: goodsOn(s, o).map(g => g.id) }) : placementBlocked(s, o, pose);
  if (blocked) return { ok: false, why: group ? (blocked === 'edge' ? 'edge' : 'room-group') : 'room', o };
  return { ok: true, o, pose, group };
}
const UNLOAD_REFUSED = {
  slope: '坡路上放不了车尾坡：车和车尾都要在平地上。', buried: '里面的货被挡住了，先卸靠车尾的那件。', empty: '车上是空的。',
  walled: '车尾后面隔着墙、护栏或台阶，卸不过去。', edge: '车尾后面不是平地，整组卸不下来。',
  'room-group': '车尾后面没有放整组的空间。', room: '车尾后面没有空间。',
};

function unloadFromTail(s, p, v) {
  const c = unloadCheck(s, v);
  if (!c.ok) { log(s, UNLOAD_REFUSED[c.why], p); return false; }
  const { o, pose } = c;
  if (c.group) {
    o.at = { kind: 'ground' }; Object.assign(o, pose);
    s.stats.unloads++;
    refreshProfile(s, v);
    const lot = flatAt(s.world, v);
    if (lot?.far) recordFarGroup(s, o, lot);
    grip(s, p, o);
    log(s, `${o.label}整组卸下。推着它走（一个人只能走平地和缓坡）；两人一起按 G 可以抬上两级台阶。`, p);
    return true;
  }
  o.at = { kind: 'ground' }; Object.assign(o, pose);
  s.stats.unloads++;
  refreshProfile(s, v);
  hold(s, p, o);
  log(s, `从${v.label}卸下${o.label}。`, p);
  return true;
}

function recordFarGroup(s, t, lot) {
  const names = goodsOn(s, t).map(g => g.label);
  s.records.farGroups.push({ table: t.id, label: names.length ? names.join('、') : t.label, lot: lot.label, time: s.time, lifted: false, route: null });
  if (s.records.farGroups.length > 60) s.records.farGroups.shift();
}

/** How a group parked at the far side actually got up: the first of lifted, ramp, unpacked. */
function markRoute(s, t, route) {
  const far = s.records.farGroups.findLast(g => g.table === t.id);
  if (!far || far.route) return;
  far.route = route;
  if (route === 'lifted') far.lifted = true;
}

function loadGroup(s, p, v, t) {
  const c = loadCheck(s, v, t, true);
  if (!c.ok) { log(s, LOAD_REFUSED[c.why](v, t, true, c), p); return false; }
  t.at = { kind: 'bed', vehicle: v.id, ...c.slot };
  for (const id of [...t.holders]) { const h = byId(s.players, id); if (h) { h.grip = null; h.gripOffset = null; } }
  t.holders = [];
  s.stats.loads++; count(s, p, 'moves');
  refreshProfile(s, v);
  for (const g of goodsOn(s, t)) if (ITEM_SPECS[g.spec].tall) trackUpright(s, g);
  const pr = v.profile;
  log(s, `整组推上${v.label}并锁好。最高点 ${fmtTop(pr.top)} m${pr.passGate ? '，能过老山门' : '，过不了老山门'}。`, p);
  return true;
}

function standOk(s, q, from = null) {
  if (!walkable(s.world, q) || hitsObstacle(s.world, playerPoly(q, 0.3))) return false;
  return !s.vehicles.some(v => polygonsOverlap(playerPoly(q), vehiclePoly(v)) && !(from && polygonsOverlap(playerPoly(from), vehiclePoly(v)) && dist(q, v) > dist(from, v)));
}

function grip(s, p, t) {
  if (t.holders.includes(p.id)) return true;
  if (t.holders.length >= 2) { log(s, '已经有两个人在抬了。', p); return false; }
  if (p.holding) { log(s, '先放下手里的东西。', p); return false; }
  let offset = { x: p.x - t.x, y: p.y - t.y };
  const len = Math.hypot(offset.x, offset.y);
  const reach = dims(t).l * CELL / 2 + 0.45;
  if (len < reach - 0.2 || len > reach + 1.2) {
    // Stand at the nearer end of the table, like taking a handle; the other end if the nearer one is taken or walled in.
    const ax = Math.cos(t.angle), ay = Math.sin(t.angle), sign = (offset.x * ax + offset.y * ay) >= 0 ? 1 : -1;
    const other = t.holders.length ? byId(s.players, t.holders[0]) : null;
    const ends = other ? [-Math.sign(other.gripOffset.x * ax + other.gripOffset.y * ay) || -sign] : [sign, -sign];
    const end = ends.find(e => standOk(s, { x: t.x + ax * reach * e, y: t.y + ay * reach * e }, p));
    if (end === undefined) { log(s, '台的这一头站不了人（贴着墙或车）：先从另一边推开一点。', p); return false; }
    offset = { x: ax * reach * end, y: ay * reach * end };
  }
  t.holders.push(p.id); p.grip = t.id; p.gripOffset = offset;
  // Playtest record for V6: who reached for the table first, and how long they waited for a partner.
  if (t.holders.length === 1) t.gripStart = { name: p.name, time: s.time };
  else if (t.gripStart) { s.records.liftLog.push({ table: t.id, first: t.gripStart.name, second: p.name, waited: Math.round((s.time - t.gripStart.time) * 10) / 10, time: Math.round(s.time) }); if (s.records.liftLog.length > 60) s.records.liftLog.shift(); }
  p.x = t.x + p.gripOffset.x; p.y = t.y + p.gripOffset.y;
  t.lastFlat = { x: t.x, y: t.y, angle: t.angle };
  if (t.holders.length === 2) { s.stats.lifts++; log(s, `两人抬起${t.label}：走得快，能上下两级台阶。任何一人松手就稳稳放下。`, p); }
  else log(s, `推着${goodsOn(s, t).length ? '整组' : t.label}走：只走平地和缓坡。E 在车尾推上车，G 松手。`, p);
  return true;
}

function releaseGrip(s, p) {
  const t = byId(s.objects, p.grip);
  p.grip = null; p.gripOffset = null;
  if (!t) return;
  t.holders = t.holders.filter(id => id !== p.id);
  // A group set down on the steps by fewer than two people goes back to where
  // it last stood on flat ground ("任何一人松手，整组就稳稳放下").
  if (t.holders.length < 2 && s.world.steps.some(st => polygonsOverlap(objectPoly(t), rectPoly(st)))) {
    const back = t.lastFlat ?? { x: t.x, y: t.y, angle: t.angle };
    Object.assign(t, back);
    for (const id of t.holders) { const h = byId(s.players, id); if (h) { h.x = t.x + h.gripOffset.x; h.y = t.y + h.gripOffset.y; } }
    log(s, `${t.label}退回台阶下的平地。一个人推不过台阶，可以绕缓坡，或叫上搭档一起抬。`);
  }
  // A group set down by two people is still one move.
  if (!t.holders.length) count(s, p, 'moves');
}

/** Where a folded table would open: its own spot, or a free one close by. */
function unfoldSpot(s, t) {
  t.folded = false;
  const spot = placementBlocked(s, t, t, { group: true }) ? findFreeSpot(s, t, t, { group: true }) : { x: t.x, y: t.y, angle: t.angle };
  t.folded = true;
  return spot && dist(spot, t) <= 2.5 ? spot : null;
}

function toggleFold(s, p) {
  if (p.holding || p.grip) { log(s, '先放下手里的东西，再展开或折起台。', p); return false; }
  const t = nearTable(s, p);
  if (!t) { log(s, 'Q：靠近地上的折叠台展开它，或折起一张空台。', p); return false; }
  if (!t.folded) {
    if (goodsOn(s, t).length) { log(s, '台上还有货，折叠前要先清空。', p); return false; }
    t.folded = true; s.stats.folds++; count(s, p, 'moves');
    log(s, `${t.label}折起来了，可以按 E 一个人搬走。`, p); return true;
  }
  const spot = unfoldSpot(s, t);
  if (!spot) { log(s, '这里展不开：展开的台要放在平地上，周围要有空位。', p); return false; }
  t.folded = false; Object.assign(t, spot);
  s.stats.unfolds++; count(s, p, 'moves');
  log(s, `${t.label}展开了。可以把货摆上去，连台带货一起搬。`, p);
  return true;
}

function rotateHeld(s, p) {
  if (p.grip) {
    const t = byId(s.objects, p.grip), pose = { x: t.x, y: t.y, angle: normAngle(t.angle + Math.PI / 2) };
    if (placementBlocked(s, t, pose, { group: true, lifted: t.holders.length >= 2, ignore: goodsOn(s, t).map(g => g.id) })) { log(s, '这里转不开。', p); return false; }
    const standing = t.holders.map(id => byId(s.players, id)).every(h => standOk(s, { x: t.x - h.gripOffset.y, y: t.y + h.gripOffset.x }, h));
    if (!standing) { log(s, '这里转不开：转过去人就站到墙里或车里了。', p); return false; }
    Object.assign(t, pose);
    for (const id of t.holders) {
      const h = byId(s.players, id), o = h.gripOffset;
      h.gripOffset = { x: -o.y, y: o.x }; h.x = t.x + h.gripOffset.x; h.y = t.y + h.gripOffset.y;
    }
    syncObjects(s); return true;
  }
  const o = byId(s.objects, p.holding);
  if (!o) { log(s, 'R：旋转手里的货，或正在推的整组。', p); return false; }
  // Swing the piece a quarter turn around the carrier, so a long piece can be brought
  // in front of you to go through a door; the carrier keeps their place.
  const carry = { x: -p.carry.y, y: p.carry.x };
  const pose = { x: p.x + carry.x, y: p.y + carry.y, angle: normAngle(Math.round(o.angle / (Math.PI / 2)) * (Math.PI / 2) + Math.PI / 2) };
  const d = dims(o), poly = boxCorners(pose.x, pose.y, d.l * CELL, d.w * CELL, pose.angle);
  if (!samples(poly).every(c => walkable(s.world, c)) || hitsObstacle(s.world, poly) || s.vehicles.some(v => polygonsOverlap(poly, vehiclePoly(v)))) { log(s, '这里转不开。', p); return false; }
  if (isLong(o) && occupiedStalls(s).some(z => polygonsOverlap(poly, rectPoly(z)))) { log(s, `${o.label}太长，在摊位前转不开。`, p); return false; }
  p.carry = carry; Object.assign(o, pose); return true;
}

function tiltTarget(s, p) {
  if (p.holding || p.grip || p.vehicle) return null;
  return s.objects.filter(o => ITEM_SPECS[o.spec].tall && !ITEM_SPECS[o.spec].uprightOnly && o.at.kind === 'table' && dist(p, o) < 2.4).filter(o => {
    const t = byId(s.objects, o.at.table);
    if (t.holders.length) return false;
    const v = t.at.kind === 'bed' ? byId(s.vehicles, t.at.vehicle) : null;
    return !v || Math.abs(v.speed) < 0.3;
  }).sort((a, b) => dist(p, a) - dist(p, b))[0] ?? null;
}

/** Whether a tall piece on a table can be stood up or laid down where it is, and the slot it would take. */
function tiltCheck(s, o) {
  const t = byId(s.objects, o.at.table), was = { at: o.at, upright: o.upright };
  const v = t.at.kind === 'bed' ? byId(s.vehicles, t.at.vehicle) : null;
  // Working on a loaded truck needs it parked on level ground, like loading does.
  if (v && !rampReady(s, v)) return { ok: false, why: 'slope' };
  o.at = { kind: 'ground' }; o.upright = !o.upright;
  const slot = findSlot(s, t, false, o, 0);
  let why = slot ? null : 'room';
  if (slot && v) {
    o.at = { kind: 'table', table: t.id, ...slot };
    const pr = vehicleProfile(s, v);
    if (!pr.passGate && (flatAt(s.world, v)?.near || s.world.gates.some(g => polygonsOverlap(vehiclePoly(v), rectPoly(g))))) why = 'inside';
  }
  Object.assign(o, was);
  return { ok: !why, why, slot };
}

/** Stand up or lay down a tall piece where it sits on a table, if the table has room for its new footprint. */
function tiltOnTable(s, p, o) {
  const t = byId(s.objects, o.at.table), c = tiltCheck(s, o);
  if (!c.ok) {
    log(s, c.why === 'slope' ? '车停在坡上，不能在车上摆弄货。' : c.why === 'inside' ? '在老山门里立起来就出不去了：先开到西坪或垭口后停靠点。' : `${t.label}上没有地方${o.upright ? '放倒' : '立起'}${o.label}，先挪开别的货。`, p);
    return false;
  }
  o.upright = !o.upright;
  o.at = { kind: 'table', table: t.id, ...c.slot };
  const v = t.at.kind === 'bed' ? byId(s.vehicles, t.at.vehicle) : null;
  if (v) { refreshProfile(s, v); trackUpright(s, o); }
  syncObjects(s);
  log(s, o.upright ? `${o.label}在台上立起来了：更高。` : `${o.label}在台上放倒了：更低，过老山门和阵风都更容易。`, p);
  return true;
}

function tiltHeld(s, p) {
  const o = byId(s.objects, p.holding);
  if (!o) { const on = tiltTarget(s, p); if (on) return tiltOnTable(s, p, on); }
  if (!o || !ITEM_SPECS[o.spec].tall) { log(s, 'T：把手里或台上的高件立起或放倒（灯笼架、高茶柜）。', p); return false; }
  if (ITEM_SPECS[o.spec].uprightOnly) { log(s, `${o.label}是整面玻璃门，放倒会压坏：只能立着运。`, p); return false; }
  o.upright = !o.upright;
  log(s, o.upright ? `${o.label}立起来了：更高，占地更小。` : `${o.label}放倒了：更低，占地更长。`, p);
  return true;
}

function trackUpright(s, o) {
  if (!o.upright && (o.at.kind === 'bed' || (o.at.kind === 'table' && byId(s.objects, o.at.table)?.at.kind === 'bed'))) o.travelledUpright = false;
}

function enterOrLeave(s, p) {
  if (p.vehicle) return leaveVehicle(s, p);
  if (p.holding || p.grip) { log(s, '先放下手里的东西再上车。', p); return false; }
  const v = boardTarget(s, p);
  if (!v) { log(s, '靠近一辆车按 F 上车。', p); return false; }
  if (Math.abs(v.speed) > 0.8) { log(s, '等车停稳再上。', p); return false; }
  if (v.occupants.length >= spec(v).seats) { log(s, `${v.label}坐满了。`, p); return false; }
  v.occupants.push(p.id); p.vehicle = v.id; p.input = emptyInput(); p.x = v.x; p.y = v.y;
  log(s, v.occupants[0] === p.id ? `你在${v.label}的驾驶位。W/S 油门 / 倒车，A/D 转向，空格刹车。` : `你坐在${v.label}上。停车后 F 下车。`, p);
  return true;
}

function leaveVehicle(s, p, force = false) {
  const v = byId(s.vehicles, p.vehicle);
  if (!v) { p.vehicle = null; return true; }
  if (!force && Math.abs(v.speed) > 0.8) { log(s, '先停稳再下车。', p); return false; }
  const sp = spec(v);
  const doors = [];
  for (const side of [-1, 1]) for (const along of [sp.len / 2 - 1.4, 0, -sp.len / 2 + 1]) doors.push(toWorld(v, along, side * (sp.wid / 2 + 0.8)));
  let spot = doors.find(c => walkable(s.world, c) && !hitsObstacle(s.world, playerPoly(c)) && !s.vehicles.some(o => polygonsOverlap(playerPoly(c), vehiclePoly(o)))) ?? null;
  if (!spot && !force) { log(s, '车门外没有下车的地方，先挪一下车。', p); return false; }
  spot ??= { x: v.x, y: v.y };
  v.occupants = v.occupants.filter(id => id !== p.id);
  p.vehicle = null; p.x = spot.x; p.y = spot.y; p.input = emptyInput(); p.safe = { ...spot };
  log(s, `${p.name}下车。`, p);
  return true;
}

// How far beyond its own half-length a thing on the ground can be reached with E or G.
const REACH = 1.6;

/** What E would do right now, without doing it. interact() and the on-screen prompts both use it. */
function chooseE(s, p) {
  if (p.vehicle) return { kind: 'in-vehicle' };
  if (p.grip) {
    const t = byId(s.objects, p.grip), v = nearTail(s, t, Math.max(dims(t).l, dims(t).w) * CELL / 2 + 2.4, true);
    return v ? { kind: 'load-group', v, o: t } : { kind: 'release', o: t };
  }
  if (p.holding) {
    const o = byId(s.objects, p.holding), reach = Math.max(dims(o).l, dims(o).w) * CELL / 2;
    // Either the carrier or the end of what they carry may be at the tail ramp.
    const v = nearTail(s, p, 2.8) ?? nearTail(s, o, 2.2 + reach);
    if (v) return { kind: 'load', v, o };
    if (!isTable(o)) {
      const near = x => Math.min(dist(p, x), dist(o, x));
      const t = s.objects.filter(x => isOpenTable(x) && x.at.kind === 'ground' && near(x) < 2.6).sort((a, b) => near(a) - near(b))[0];
      if (t) return { kind: 'place', t, o };
    }
    return { kind: 'put-down', o };
  }
  // The tail only competes with a nearby object when there is something to unload.
  const tailV = nearTail(s, p, 2.6), v = tailV && accessibleOnBed(s, tailV).length ? tailV : null;
  const near = s.objects.filter(o => o.at.kind === 'ground' && !o.holders.length && dist(p, o) < Math.max(dims(o).l, dims(o).w) * CELL / 2 + REACH)
    .sort((a, b) => dist(p, a) - dist(p, b))[0];
  // Standing right at a loaded tail, face the truck to unload or face the item to pick it up.
  const facingTail = v && Math.cos(Math.atan2(v.y - p.y, v.x - p.x) - p.angle) > 0.3;
  if (near && (!v || (dist(p, tailPoint(v)) > 1.2 ? dist(p, near) < dist(p, tailPoint(v)) : !facingTail))) {
    if (isOpenTable(near)) return goodsOn(s, near).length ? { kind: 'take', t: near, o: goodsOn(s, near).sort((a, b) => dist(p, a) - dist(p, b))[0] } : { kind: 'grip', t: near };
    return { kind: 'pick', o: near };
  }
  if (v || tailV) return { kind: 'unload', v: v ?? tailV, o: v ? accessibleOnBed(s, v)[0] : null };
  const walled = s.vehicles.some(v => Math.abs(v.speed) < 0.3 && dist(p, tailPoint(v)) <= 2.6 && toLocal(v, p).x < -spec(v).len / 2 + 0.6);
  return { kind: walled ? 'walled' : 'none' };
}

function interact(s, p) {
  const c = chooseE(s, p);
  switch (c.kind) {
    case 'in-vehicle': log(s, '停车后按 F 下车，再装卸。', p); return false;
    case 'load-group': return loadGroup(s, p, c.v, c.o);
    case 'release': releaseGrip(s, p); log(s, `松手，${c.o.label}稳稳放下。`, p); return true;
    case 'load': return loadHeld(s, p, c.v);
    case 'place': return placeOnTable(s, p, c.t);
    case 'put-down': return putDown(s, p);
    case 'take': return takeFromTable(s, p, c.t);
    case 'grip': return grip(s, p, c.t);
    case 'pick': return pickUp(s, p, c.o);
    case 'unload': return unloadFromTail(s, p, c.v);
    default:
      log(s, c.kind === 'walled' ? '车尾和你之间隔着墙或护栏，从这边装卸不了。' : 'E：搬起 / 放下货物，车尾装卸，摆上展开的台。G 推整组，Q 展开 / 折叠台。', p);
      return false;
  }
}

/** What the truck would read if this piece or group went on now: the card's "装上后" line. */
function previewLoad(s, v, o, group = false) {
  const c = loadCheck(s, v, o, group), pr = c.pr;
  return { vehicle: v.id, label: v.label, fits: c.ok, why: c.why ?? null, insideGate: c.why === 'inside',
    ...(pr ? { top: pr.top, passGate: pr.passGate, hairpin: pr.advisory.hairpin, gentle: pr.advisory.gentle, gust: pr.advisory.gust } : {}) };
}
const REFUSED_PROMPT = { slope: '车停在坡上，装不了', far: '再往车尾推近一点', full: '装不下', inside: '', walled: '隔着门框或墙，推不上去' };

const fold = x => isTable(x) && x.at.kind === 'ground' && !x.holders.length;
const nearTable = (s, p) => s.objects.filter(o => fold(o) && dist(p, o) < 2.8).sort((a, b) => dist(p, a) - dist(p, b))[0];
const gripTarget = (s, p) => s.objects.filter(o => isOpenTable(o) && o.at.kind === 'ground' && dist(p, o) < dims(o).l * CELL / 2 + REACH + 0.1).sort((a, b) => dist(p, a) - dist(p, b))[0];
const boardTarget = (s, p) => s.vehicles.filter(v => polygonsOverlap(playerPoly(p, 2.0), vehiclePoly(v))).sort((a, b) => dist(p, a) - dist(p, b))[0];

/**
 * The prompts for one player: exactly what each key would do now, from the same
 * decisions the actions use, so a chip on screen never promises what the rules refuse.
 */
export function intents(s, p) {
  const out = [], add = (key, label, main = false, extra = {}) => out.push({ key, label, main, ...extra });
  if (p.vehicle) {
    const v = byId(s.vehicles, p.vehicle), driving = v.occupants[0] === p.id;
    if (driving) add('W/S', '油门 / 倒车');
    if (Math.abs(v.speed) <= 0.8) add('F', '下车', true);
    if (driving && v.bump && Math.abs(v.speed) < 0.3) add('S', '倒一点再打方向');
    return out;
  }
  const c = chooseE(s, p);
  const withPreview = (label, v, o, group = false) => {
    const pv = previewLoad(s, v, o, group);
    if (!pv.fits) return add('E', pv.insideGate ? `装上后 ${fmtTop(pv.top)} m，出不了老山门` : pv.why === 'full' ? `${v.label}装不下` : REFUSED_PROMPT[pv.why], true, { preview: pv, refused: true, target: `tail:${v.id}` });
    add('E', `${label} → ${fmtTop(pv.top)} m${pv.passGate ? '' : '，过不了老山门'}`, true, { preview: pv, target: `tail:${v.id}` });
  };
  if (c.kind === 'load-group') withPreview(`推上${c.v.label}`, c.v, c.o, true);
  else if (c.kind === 'release') add('G', c.o.holders.length > 1 ? '松手（两人抬着）' : '松手', true);
  else if (c.kind === 'load') withPreview(`装上${c.v.label}`, c.v, c.o);
  else if (c.kind === 'place') {
    const room = findSlot(s, c.t, false, c.o, Math.abs(Math.sin(c.o.angle - c.t.angle)) > 0.7 ? 1 : 0);
    add('E', room ? `摆上${c.t.label}` : `${c.t.label}上放不下了`, true, { target: c.t.id, ...(room ? {} : { refused: true }) });
  }
  else if (c.kind === 'put-down') add('E', placementBlocked(s, c.o, c.o) ? '这里放不下' : '放下', true, placementBlocked(s, c.o, c.o) ? { refused: true } : {});
  else if (c.kind === 'take') add('E', `取下${c.o.label}`, true, { target: c.t.id });
  else if (c.kind === 'grip') add('E', '推着走', true, { target: c.t.id });
  else if (c.kind === 'pick') add('E', `搬起${c.o.label}`, true, { target: c.o.id });
  else if (c.kind === 'unload' && c.o) {
    const u = unloadCheck(s, c.v);
    add('E', u.ok ? `从${c.v.label}车尾卸下${c.o.label}` : u.why === 'slope' ? '车停在坡上，卸不了' : '车尾后面没有地方卸', true, { target: `tail:${c.v.id}`, ...(u.ok ? {} : { refused: true }) });
  }
  if (p.grip) {
    const t = byId(s.objects, p.grip);
    if (c.kind === 'load-group') add('G', t.holders.length > 1 ? '松手（两人抬着）' : '松手');
    if (t.holders.length < 2) add('', '搭档靠近按 G 一起抬');
    add('R', '转向');
    return out.slice(0, 4);
  }
  if (p.holding) {
    const o = byId(s.objects, p.holding);
    if (ITEM_SPECS[o.spec].tall && !ITEM_SPECS[o.spec].uprightOnly) add('T', o.upright ? '放倒（更低）' : '立起（更高）');
    add('R', '旋转');
    return out.slice(0, 4);
  }
  const g = gripTarget(s, p);
  if (g && c.kind !== 'grip' && g.holders.length < 2) add('G', g.holders.length ? '一起抬' : goodsOn(s, g).length ? '推整组' : '推着走');
  const tilt = tiltTarget(s, p);
  if (tilt && tiltCheck(s, tilt).ok) add('T', `${tilt.upright ? '放倒' : '立起'}台上的${tilt.label}`);
  const f = nearTable(s, p);
  if (f && !(c.kind === 'take' || (g && goodsOn(s, f).length))) add('Q', f.folded ? (unfoldSpot(s, f) ? '就地展开' : '') : goodsOn(s, f).length ? '' : '折起');
  const car = boardTarget(s, p);
  if (car && Math.abs(car.speed) <= 0.8 && car.occupants.length < spec(car).seats) add('F', `上${car.label}`, !out.some(i => i.main));
  return out.filter(i => i.label).slice(0, 4);
}

function gripAction(s, p) {
  if (p.vehicle) return false;
  if (p.grip) { const t = byId(s.objects, p.grip); releaseGrip(s, p); log(s, `松手，${t.label}稳稳放下。`, p); return true; }
  const t = gripTarget(s, p);
  if (!t) { log(s, 'G：靠近一张展开的台（可以带着货），推它或和搭档一起抬。', p); return false; }
  return grip(s, p, t);
}

function recover(s, p) {
  if (p.vehicle) {
    const v = byId(s.vehicles, p.vehicle);
    if (v.occupants[0] !== p.id) { log(s, '由司机来叫救援。', p); return false; }
    // A call for help is a rescue like any other: it cannot cancel a wheel-lift already under way.
    if (v.warn > 0) { log(s, '抬轮预警中叫不了救援：先减速。', p); return false; }
    const stop = rescueStop(s, v), pose = freeVehicleSpot(s, v, stop);
    if (!pose) { log(s, '停靠点暂时没有空位。', p); return false; }
    if (v.passing) { s.records.passCrossings.push({ vehicle: v.label, driver: p.name, dir: 'up', style: 'towed', top: v.passing.top, gust: v.passing.gust, seconds: Math.round(s.time - v.passing.start), waited: Math.round(v.passing.waited), peakInGust: Math.round(v.passing.peak), time: Math.round(v.passing.start) }); v.passing = null; }
    const items = rescue(s, v, stop, pose);
    s.stats.tows++;
    log(s, `${v.label}被拖回${stop.label}${items ? `，车上的 ${items} 件（整组保持锁定）卸在救援坪上，要重新装车` : ''}。`, p);
    return true;
  }
  releaseHeld(s, p);
  const spot = { ...p.safe };
  p.x = spot.x; p.y = spot.y;
  log(s, '回到最近的安全步行位置，手上的东西就地放下。', p);
  return true;
}

function freeVehicleSpot(s, v, stop) {
  const a = stop.area, base = stop.spawn;
  const tries = [base];
  for (let dy = 0; dy < a.h; dy += 3) for (let dx = 0; dx < a.w; dx += 3) tries.push({ x: a.x + 4 + dx, y: a.y + 2 + dy, angle: base.angle });
  for (const t of tries) if (!vehicleBlocked(s, v, t)) return { x: t.x, y: t.y, angle: t.angle };
  return null;
}

function setBuild(s, p, build) {
  const v = byId(s.vehicles, 'main');
  if (onBed(s, v).length) { log(s, '换配置前先卸空主车。', p); return false; }
  if (!inRect(v, s.world.flats[0])) { log(s, '配置要在旧夜市广场（车库出口）换。', p); return false; }
  s.build = build === 'lowbed' ? 'lowbed' : 'standard';
  v.type = s.build === 'lowbed' ? 'lowbed' : 'main'; v.label = VEHICLE_SPECS[v.type].label;
  refreshProfile(s, v);
  log(s, s.build === 'lowbed' ? '主车换上低货台：前部低段放一个整组，后段只放得下一件长件，遇到坡折会刮底。' : '主车换回普通车床。');
  return true;
}

export function action(s, id, name, payload = {}) {
  const p = byId(s.players, id); if (!p || typeof name !== 'string') return false;
  payload = payload && typeof payload === 'object' ? payload : {};
  syncObjects(s);
  let ok = false;
  if (name === 'interact') ok = interact(s, p);
  else if (name === 'grip') ok = gripAction(s, p);
  else if (name === 'fold') ok = !p.vehicle && toggleFold(s, p);
  else if (name === 'rotate') ok = rotateHeld(s, p);
  else if (name === 'tilt') ok = tiltHeld(s, p);
  else if (name === 'vehicle') ok = enterOrLeave(s, p);
  else if (name === 'recover') ok = recover(s, p);
  else if (name === 'build') ok = setBuild(s, p, payload.build);
  else return false;
  refreshAll(s);
  updateObjectives(s);
  return ok ? { ok: true } : { ok: false, error: p.hint };
}

// ---------------------------------------------------------------- motion

function gustTick(s) {
  const c = s.world.pass.cycle, period = c.calm + c.warn + c.gust, ph = s.time % period;
  const index = Math.floor(s.time / period);
  const state = ph < c.calm ? 'calm' : ph < c.calm + c.warn ? 'warn' : 'gust';
  const left = state === 'calm' ? c.calm - ph : state === 'warn' ? c.calm + c.warn - ph : period - ph;
  if (state === 'gust' && s.gust.state !== 'gust') s.gust.counted = [];
  s.gust = { state, left: Math.round(left * 10) / 10, index, period, counted: s.gust.counted ?? [] };
}

function stopRegion(w, p) {
  return w.stops.find(st => st.region.some(id => {
    const area = w.flats.find(f => f.id === id) ?? (w.aprons ?? []).find(f => f.id === id);
    if (area) return inRect(p, area);
    const road = w.roads.find(r => r.id === id);
    return Boolean(road) && polylineDistance(p, road.points) <= road.width / 2;
  }));
}

function curveAt(s, v) {
  for (const c of s.world.curves) {
    const road = s.world.roads.find(r => r.id === c.road);
    if (polylineDistance(v, road.points) > road.width / 2 + 1) continue;
    if (c.zones.some(z => Math.hypot(v.x - z.x, v.y - z.y) <= z.r)) return c;
  }
  return null;
}

const BUMPS = {
  edge: '车头顶到路边了：S 倒一点，再打方向。实在出不来，Esc 菜单里可以叫救援。',
  obstacle: '撞到墙了：S 倒车绕开。', vehicle: '前面有车：等它走开，或者倒车让一让。',
  object: '前面有货挡着，先把它搬开。', player: '前面有人。',
};

/**
 * Ways off a road edge, tried in order: scrape along it at a slight angle; turn with the
 * wheel at a crawl, pivoting on the axle behind the direction of travel; after almost a
 * second pressed against it, ease back towards the middle of the nearest road.
 */
// What a truck can work its way off by itself: road edges, walls and posts, the gate, a narrow lane or a break-over.
const UNSTICK = new Set(['edge', 'obstacle', 'gate', 'narrow', 'breakover']);
function unstickPose(s, v, dt, steer, throttle) {
  const sp = spec(v);
  if (Math.abs(v.speed) > 0.3) { const g = glidePose(s, v, dt, steer); if (g) { v.stuckFor = 0; return g; } }
  const dir = Math.sign(v.speed) || Math.sign(throttle) || 1;
  // Nosed in at a shallow angle with W held: creep along the edge without turning into it.
  if (throttle && Math.abs(v.speed) <= 0.3) {
    for (const k of [1, 2, 3, 4]) for (const side of steer ? [steer, -steer] : [1, -1]) {
      const heading = v.angle + side * dir * k * 0.09, crawl = dir * 1.2 * dt;
      const pose = { x: v.x + Math.cos(heading) * crawl, y: v.y + Math.sin(heading) * crawl, angle: v.angle };
      if (!vehicleBlocked(s, v, pose)) return { ...pose, still: true };
    }
  }
  if (steer && throttle) {
    const yaw = steer * dir * 0.5 * dt, pivot = toWorld(v, dir > 0 ? -sp.len / 2 + 1.1 : sp.len / 2 - 1.1, 0);
    const c = Math.cos(yaw), sn = Math.sin(yaw), rx = v.x - pivot.x, ry = v.y - pivot.y;
    const pose = { x: pivot.x + rx * c - ry * sn, y: pivot.y + rx * sn + ry * c, angle: normAngle(v.angle + yaw) };
    if (!vehicleBlocked(s, v, pose) && overVerge(s, v, pose) <= overVerge(s, v, v)) return { ...pose, still: true };
  }
  if ((v.stuckFor ?? 0) > 0.8 && (throttle || steer)) {
    const road = s.world.roads.map(r => nearestOnPolyline(v, r.points)).sort((a, b) => a.d - b.d)[0];
    if (road && road.d < 20) {
      // Face along the road the way the truck already points, and edge towards its middle.
      const along = Math.abs(angleDiff(road.dir, v.angle)) < Math.PI / 2 ? road.dir : road.dir + Math.PI;
      const turn = clamp(angleDiff(along, v.angle), -0.05, 0.05), len = Math.hypot(road.x - v.x, road.y - v.y) || 1;
      for (const k of [1, 0]) {
        const pose = { x: v.x + (road.x - v.x) / len * Math.min(0.15, len), y: v.y + (road.y - v.y) / len * Math.min(0.15, len), angle: normAngle(v.angle + turn * k) };
        if (!vehicleBlocked(s, v, pose)) return { ...pose, still: true };
      }
    }
  }
  // Pinned in a corner with the wheel turned: inch back while the nose comes round, as a driver works out by hand.
  if (steer && throttle && (v.stuckFor ?? 0) > 0.5) {
    const back = -Math.sign(throttle) * 0.9 * dt, yaw = steer * Math.sign(throttle) * 0.6 * dt;
    const pose = { x: v.x + Math.cos(v.angle) * back, y: v.y + Math.sin(v.angle) * back, angle: normAngle(v.angle + yaw) };
    if (!vehicleBlocked(s, v, pose)) return { ...pose, still: true };
  }
  return null;
}

/** A slightly turned, slower step that clears the edge, preferring the way the wheel is turned. */
function glidePose(s, v, dt, steer) {
  const step = v.speed * dt * 0.6;
  for (const dir of steer ? [steer, -steer] : [1, -1]) {
    const angle = normAngle(v.angle + dir * Math.sign(v.speed) * 1.1 * dt);
    const pose = { x: v.x + Math.cos(angle) * step, y: v.y + Math.sin(angle) * step, angle };
    if (!vehicleBlocked(s, v, pose) && overVerge(s, v, pose) <= overVerge(s, v, v)) return pose;
  }
  return null;
}

function drive(s, v, dt) {
  const sp = spec(v), driver = byId(s.players, v.occupants[0]), input = driver?.input ?? emptyInput();
  let glide = null;
  if (driver) v.lastDriver = driver.name;
  const throttle = Number(input.up) - Number(input.down), steer = Number(input.right) - Number(input.left);
  if (input.brake || !driver) v.speed = Math.sign(v.speed) * Math.max(0, Math.abs(v.speed) - (driver ? 8 : 3) * dt);
  else if (throttle > 0) v.speed = v.speed < 0 ? Math.min(0, v.speed + 8 * dt) : Math.min(sp.maxSpeed, v.speed + sp.accel * dt);
  else if (throttle < 0) v.speed = v.speed > 0 ? Math.max(0, v.speed - 8 * dt) : Math.max(-3.5, v.speed - sp.accel * 0.7 * dt);
  else v.speed = Math.sign(v.speed) * Math.max(0, Math.abs(v.speed) - 0.9 * dt);
  if (Math.abs(v.speed) < 0.02) v.speed = 0;
  const yaw = steer * Math.min(Math.abs(v.speed) / sp.minTurn, sp.maxYaw) * Math.sign(v.speed);
  const pose = { angle: normAngle(v.angle + yaw * dt) };
  pose.x = v.x + Math.cos(pose.angle) * v.speed * dt; pose.y = v.y + Math.sin(pose.angle) * v.speed * dt;
  if (v.speed !== 0 || yaw !== 0) {
    const why = vehicleBlocked(s, v, pose);
    if (!why) {
      const moved = Math.hypot(pose.x - v.x, pose.y - v.y);
      Object.assign(v, pose); v.bump = false; v.stuckFor = 0;
      s.stats.driven += moved; if (driver) driver.contribution.driven += moved;
    } else if (UNSTICK.has(why) && (glide = unstickPose(s, v, dt, steer, throttle))) {
      // Against the road edge the truck scrapes along it, still turns with the wheel at a
      // crawl, and after a moment is eased back towards the middle: edges slow you, they do not trap you.
      const moved = Math.hypot(glide.x - v.x, glide.y - v.y);
      Object.assign(v, { x: glide.x, y: glide.y, angle: glide.angle });
      v.speed = (Math.sign(v.speed) || Math.sign(throttle) || 1) * Math.min(Math.abs(v.speed), 2);
      if (glide.still) v.speed = 0;
      s.stats.driven += moved; if (driver) driver.contribution.driven += moved;
      if (!v.bump && driver) log(s, '擦着路边走：往路中间打方向。', driver);
      v.bump = true;
    } else {
      if (!v.bump && Math.abs(v.speed) > 1.5) s.stats.bumps++;
      if (!v.bump && driver && BUMPS[why]) log(s, BUMPS[why], driver);
      v.bump = true; v.speed = 0;
      if (UNSTICK.has(why) && (throttle || steer)) v.stuckFor = (v.stuckFor ?? 0) + dt;
      if (why === 'gate' && driver) log(s, `最高点 ${fmtTop(v.profile.top)} m，老山门限高 ${GATE_LIMIT.toFixed(1)} m：过不去。走西坪，或者先把东西放低。`, driver);
      if (why === 'stall' && driver) log(s, '前侧摊位前要给客人留位置，车开不进去。', driver);
      if (why === 'breakover' && driver) log(s, '低货台过坡折会刮底：这条路开不过去。停在垭口后停靠点，或者换普通车床。', driver);
      if (why === 'narrow' && driver) log(s, `茶馆巷口限宽 2.2 m，${v.label}宽 ${spec(v).wid} m：进不去。停回垭口后停靠点，人手搬进去，或者换伴行小车。`, driver);
    }
  }
  for (const id of v.occupants) { const o = byId(s.players, id); if (o) { o.x = v.x; o.y = v.y; o.angle = v.angle; } }
  // The stop of the stretch the truck last stood in; a rescue returns there, never uphill of it.
  const stop = stopRegion(s.world, v);
  if (stop) v.lastStop = stop.id;
  stability(s, v, dt, driver);
  passLog(s, v, dt, driver);
  parking(s, v, dt, driver);
  v.frameClock += dt;
  if (v.frameClock >= 0.1) {
    v.frameClock = 0;
    v.frames.push({ t: Math.round(s.time * 10) / 10, x: +v.x.toFixed(2), y: +v.y.toFixed(2), a: +v.angle.toFixed(3),
      v: Math.round(Math.abs(v.speed) * KMH), adv: v.adv, w: +v.warn.toFixed(2), g: v.inPass && !v.sheltered && s.gust.state === 'gust' });
    if (v.frames.length > 36) v.frames.shift();
  }
}

/**
 * Playtest record for V5: how each vehicle got through the gust pass. "dashed" went
 * through in calm air, "crawled" kept moving under the gust sign, "waited" sat out a
 * gust behind a windbreak, "unaffected" carried nothing the gust cares about.
 */
function passLog(s, v, dt, driver) {
  const inside = inRect(v, s.world.pass.zone);
  if (inside && !v.passing) v.passing = { vehicle: v.label, driver: driver?.name ?? v.lastDriver ?? null, start: s.time, startY: v.y, top: v.profile.top, gust: v.profile.advisory.gust, waited: 0, movedInGust: 0, peak: 0 };
  if (inside && v.passing && s.gust.state === 'gust') {
    if (v.sheltered && Math.abs(v.speed) < 0.5) v.passing.waited += dt;
    else if (!v.sheltered && Math.abs(v.speed) > 0.5) { v.passing.movedInGust += dt; v.passing.peak = Math.max(v.passing.peak, Math.abs(v.speed) * KMH); }
  }
  if (!inside && v.passing) {
    const c = v.passing; v.passing = null;
    const style = c.gust === null ? 'unaffected' : c.waited > 0.5 ? 'waited' : c.movedInGust > 0.3 ? (c.peak > (c.gust ?? 0) + 1 ? 'braved' : 'crawled') : 'dashed';
    s.records.passCrossings.push({ vehicle: c.vehicle, driver: c.driver, dir: v.y < c.startY ? 'up' : 'down', style, top: c.top, gust: c.gust,
      seconds: Math.round(s.time - c.start), waited: Math.round(c.waited), peakInGust: Math.round(c.peak), time: Math.round(c.start) });
    if (s.records.passCrossings.length > 60) s.records.passCrossings.shift();
  }
}

function stability(s, v, dt, driver) {
  const pr = v.profile, kmh = Math.abs(v.speed) * KMH;
  const curve = curveAt(s, v);
  v.curveId = curve?.id ?? null;
  v.inPass = inRect(v, s.world.pass.zone);
  v.sheltered = s.world.pass.shelters.some(z => inRect(v, z));
  let adv = null, reason = null;
  if (curve) { adv = curveAdvisory(curve.base, pr.stability); reason = 'curve'; }
  const gusting = v.inPass && !v.sheltered && s.gust.state === 'gust';
  if (gusting && pr.advisory.gust !== null && (adv === null || pr.advisory.gust < adv)) { adv = pr.advisory.gust; reason = 'gust'; }
  v.adv = adv; v.advReason = reason;
  const over = adv !== null && (kmh > adv + 0.5 || (adv === 0 && reason === 'gust'));
  const ratio = adv ? kmh / adv : over ? 9 : 0;
  v.creak = adv !== null && ratio > TUNING.creakRatio;
  if (over) {
    if (v.warn === 0) {
      s.stats.warnings++;
      v.episode = { start: s.time, place: reason === 'gust' ? '垭口阵风' : curve.label, reason, adv, peak: kmh };
      if (driver) log(s, reason === 'gust' ? '阵风！抬轮预警——减速，或者躲到挡风墙后。' : `抬轮预警：${curve.label}建议 ≤ ${adv} km/h。`, driver);
    }
    v.episode.peak = Math.max(v.episode.peak, kmh);
    v.warn += dt * (ratio > 1.3 || adv === 0 ? 1.5 : 1);
  } else if (v.warn > 0 && !(v.inPass && s.gust.state === 'gust' && v.episode?.reason === 'gust')) {
    v.warn = Math.max(0, v.warn - TUNING.warnRelax * dt);
    if (v.warn === 0 && v.episode) { recordIncident(s, v, 'warning', v.episode); v.episode = null; }
  }
  if (v.warn >= TUNING.warnLimit) rollover(s, v, driver);
  // Waiting out a gust behind a windbreak is part of the planning story.
  if (v.sheltered && s.gust.state === 'gust' && Math.abs(v.speed) < 0.5 && !s.gust.counted.includes(v.id)) {
    s.gust.counted.push(v.id); s.stats.gustWaits++;
  }
}

function reasonText(s, v, ep) {
  const pr = v.profile;
  const goodsHigh = loadOf(s, v).some(o => o.at.kind === 'table') ? '台上的货把重心抬高了' : loadOf(s, v).some(o => ITEM_SPECS[o.spec].tall && o.upright) ? '立着的高件把重心抬高了' : '装得太重太高';
  if (ep.reason === 'gust') {
    const flat = pr.flatAdvisory.gust, flatText = flat === null ? '平装时几乎不受风' : `平装时建议 ${flat}`;
    if (!ep.adv) return `垭口阵风：装得这么高，阵风时只能停在挡风墙后。受风面积 ${pr.windage} m²，${flatText}。`;
    return `垭口阵风：${Math.round(ep.peak)} > 建议 ${ep.adv}。受风面积 ${pr.windage} m²，${flatText}。`;
  }
  const curve = s.world.curves.find(c => c.label === ep.place);
  const flat = curve ? curveAdvisory(curve.base, pr.flatStability) : null;
  return `${ep.place}：${Math.round(ep.peak)} > 建议 ${ep.adv}。${goodsHigh}${flat ? `，平装时建议 ${flat}` : ''}。`;
}

function recordIncident(s, v, type, ep) {
  const driver = byId(s.players, v.occupants[0]);
  const incident = {
    id: ++s.incidentSeq, type, time: Math.round(s.time * 10) / 10, vehicle: v.id, vehicleLabel: v.label, driver: driver?.name ?? null,
    place: ep.place, reason: ep.reason, speed: Math.round(ep.peak), adv: ep.adv, text: reasonText(s, v, ep),
    frames: v.frames.slice(-32), side: v.profile.side, top: v.profile.top, bedLength: v.profile.bedLength, vehicleType: v.type,
  };
  s.incidents.push(incident);
  if (s.incidents.length > 16) s.incidents.shift();
  return incident;
}

function rollover(s, v, driver) {
  const ep = v.episode ?? { place: '路上', reason: 'curve', adv: v.adv ?? 0, peak: Math.abs(v.speed) * KMH };
  const incident = recordIncident(s, v, 'rollover', ep);
  v.episode = null; v.warn = 0; v.speed = 0; s.stats.rollovers++;
  if (v.passing) { s.records.passCrossings.push({ vehicle: v.label, driver: driver?.name ?? null, dir: 'up', style: 'tipped', top: v.passing.top, gust: v.passing.gust, seconds: Math.round(s.time - v.passing.start), waited: Math.round(v.passing.waited), peakInGust: Math.round(ep.peak), time: Math.round(v.passing.start) }); v.passing = null; }
  const stop = rescueStop(s, v);
  const items = rescue(s, v, stop, freeVehicleSpot(s, v, stop) ?? stop.spawn);
  incident.rescue = { stop: stop.label, items };
  log(s, `侧翻！${incident.text} 救援把${v.label}拖回${stop.label}，${items ? `车上的 ${items} 件（整组保持锁定）卸在旁边的救援坪上，要重新装车` : '车是空的'}。`, driver);
}

const rescueStop = (s, v) => s.world.stops.find(st => st.id === v.lastStop) ?? s.world.stops[0];

/**
 * Rescue (v0.5 §2.4), the same after a rollover or a call for help: the truck goes back
 * to the stop of the stretch it last stood in, and everything on its bed, groups still
 * locked, is set down on that stop's rescue pad to be loaded again.
 */
function rescue(s, v, stop, pose) {
  const pad = s.world.walkAreas.find(a => a.id === stop.pad);
  const items = [...onBed(s, v)].sort((a, b) => b.at.cx - a.at.cx);
  Object.assign(v, { x: pose.x, y: pose.y, angle: pose.angle, speed: 0, warn: 0, episode: null });
  for (const o of items) {
    o.at = { kind: 'ground' };
    o.angle = 0;
    const spot = findFreeSpot(s, o, rectCenter(pad), { within: pad, group: isOpenTable(o), ignore: goodsOn(s, o).map(g => g.id) })
      ?? findFreeSpot(s, o, rectCenter(pad), { group: isOpenTable(o), ignore: goodsOn(s, o).map(g => g.id) })
      ?? { x: rectCenter(pad).x, y: rectCenter(pad).y, angle: 0 };
    Object.assign(o, spot);
  }
  refreshProfile(s, v);
  for (const id of v.occupants) { const o = byId(s.players, id); if (o) { o.x = v.x; o.y = v.y; } }
  return items.length;
}

function parking(s, v, dt, driver) {
  const area = flatAt(s.world, v);
  if (area?.id !== v.parkedIn) v.parkedIn = null;
  if (Math.abs(v.speed) < 0.3 && area) v.stoppedFor += dt; else v.stoppedFor = 0;
  if (v.stoppedFor > 1 && v.parkedIn !== area?.id) {
    v.parkedIn = area.id;
    if (area.near && !v.profile.empty) {
      s.records.nearParks++;
      const name = driver?.name ?? v.lastDriver;
      if (!s.records.nearFirst && name) s.records.nearFirst = { name, vehicle: v.label, time: s.time };
    }
    if (area.far && !v.profile.empty) s.records.farParks++;
  }
}

function walk(s, p, dt) {
  const i = p.input, dx = Number(i.right) - Number(i.left), dy = Number(i.down) - Number(i.up);
  if (p.grip) return;
  if (!dx && !dy) return;
  const mag = Math.hypot(dx, dy), held = byId(s.objects, p.holding);
  const speed = held ? (isTable(held) ? 3.0 : 3.3) : 4.2;
  const mx = dx / mag * speed * dt, my = dy / mag * speed * dt;
  p.angle = Math.atan2(dy, dx);
  // Someone already brushing a truck may always step away from it.
  const brushing = s.vehicles.filter(v => polygonsOverlap(playerPoly(p), vehiclePoly(v)));
  const stalls = held ? blockingAprons(s, held) : [];
  const ok = (x, y) => {
    const q = { x, y };
    if (!walkable(s.world, q) || hitsObstacle(s.world, playerPoly(q))) return false;
    if (s.vehicles.some(v => polygonsOverlap(playerPoly(q), vehiclePoly(v)) && !(brushing.includes(v) && dist(q, v) > dist(p, v)))) return false;
    if (!held) return true;
    const pose = { x: x + p.carry.x, y: y + p.carry.y, angle: held.angle }, d = dims(held);
    const poly = boxCorners(pose.x, pose.y, d.l * CELL, d.w * CELL, pose.angle);
    // A long piece may only leave a standing stall's customer space, never go deeper into it.
    const depth = stalls.length ? apronDepth(s, poly, stalls) : 0;
    if (depth && depth >= apronDepth(s, boxCorners(held.x, held.y, d.l * CELL, d.w * CELL, held.angle), stalls)) {
      log(s, isLong(held) ? `${held.label}太长，搬不过还摆着的摊位：先撤摊，或者绕开走。` : '摊位开着，客人站在前面：搬着东西过不去。先撤摊，或者绕开走。', p);
      return false;
    }
    return samples(poly).every(c => walkable(s.world, c)) && !hitsObstacle(s.world, poly) && !s.vehicles.some(v => polygonsOverlap(poly, vehiclePoly(v)));
  };
  const old = { x: p.x, y: p.y };
  if (ok(p.x + mx, p.y + my)) { p.x += mx; p.y += my; }
  else { if (ok(p.x + mx, p.y)) p.x += mx; if (ok(p.x, p.y + my)) p.y += my; }
  // Lining up with a doorway: when a carried piece snags on a frame, ease sideways towards the opening.
  if (held && dist(p, old) < 1e-6 && (!dx || !dy)) {
    const px = -dy / mag, py = dx / mag, most = speed * dt * 0.6;
    for (let k = 1; k <= 8; k++) {
      const off = k * 0.05, side = [1, -1].find(sg => ok(p.x + mx + px * off * sg, p.y + my + py * off * sg));
      if (!side) continue;
      const step = Math.min(off, most);
      if (ok(p.x + px * step * side, p.y + py * step * side)) { p.x += px * step * side; p.y += py * step * side; }
      break;
    }
    const d = dims(held);
    if (dist(p, old) < 1e-6 && hitsObstacle(s.world, boxCorners(p.x + p.carry.x + mx * 4, p.y + p.carry.y + my * 4, d.l * CELL, d.w * CELL, held.angle)))
      p.hint = `${held.label}卡在墙或门框上：让它在你身前（R 旋转），对准门的正中再走。`;
  }
  const moved = dist(p, old);
  if (held) { s.stats.carried += moved; p.contribution.carried += moved; }
  else if (moved > 0) p.safe = { x: p.x, y: p.y };
}

const PUSH_BLOCKED = {
  edge: '整组只走平地、缓坡和抬着上的台阶：前面不是。山路上要装车走。',
  obstacle: '前面是墙或门框：整组过不去。窄门只进得去单件和折起的台。',
  gate: '整组太高，过不了老山门。',
  vehicle: '前面有车挡着。',
  object: '前面有别的货挡着。',
  stand: '推的人没地方站：贴着墙或车了，换个方向推。',
};
function moveGroups(s, dt) {
  for (const t of s.objects.filter(o => o.holders.length)) {
    const holders = t.holders.map(id => byId(s.players, id)).filter(Boolean);
    if (!holders.length) { t.holders = []; continue; }
    let vx = 0, vy = 0;
    for (const h of holders) {
      const dx = Number(h.input.right) - Number(h.input.left), dy = Number(h.input.down) - Number(h.input.up), m = Math.hypot(dx, dy);
      if (m) { vx += dx / m; vy += dy / m; }
    }
    vx /= holders.length; vy /= holders.length;
    const mag = Math.hypot(vx, vy);
    if (mag < 0.05) continue;
    const lifted = holders.length >= 2, speed = lifted ? 3.0 : 1.8;
    const mx = vx / Math.max(mag, 1) * speed * dt, my = vy / Math.max(mag, 1) * speed * dt;
    const ignore = goodsOn(s, t).map(g => g.id);
    // A group is no cart past an open stall either: it may leave that customer space, never go deeper into it.
    const aprons = servingStalls(s, t), d = dims(t);
    const okAt = (x, y) => {
      const pose = { x, y, angle: t.angle };
      if (placementBlocked(s, t, pose, { group: true, lifted, ignore })) return false;
      if (aprons.length && apronDepth(s, boxCorners(x, y, d.l * CELL, d.w * CELL, t.angle), aprons) > apronDepth(s, boxCorners(t.x, t.y, d.l * CELL, d.w * CELL, t.angle), aprons)) return false;
      // Holders need somewhere to stand: not in a wall, not inside a truck (one already brushing it may step away).
      return holders.every(h => standOk(s, { x: x + h.gripOffset.x, y: y + h.gripOffset.y }, h));
    };
    const old = { x: t.x, y: t.y };
    if (okAt(t.x + mx, t.y + my)) { t.x += mx; t.y += my; }
    else { if (okAt(t.x + mx, t.y)) t.x += mx; if (okAt(t.x, t.y + my)) t.y += my; }
    const moved = dist(t, old);
    if (moved < 1e-4) {
      // Say why the group will not go, to whoever is pushing it.
      const why = placementBlocked(s, t, { x: t.x + mx * 8, y: t.y + my * 8, angle: t.angle }, { group: true, lifted, ignore });
      if (why === 'steps' && !lifted) log(s, '一个人推不过台阶：绕缓坡走，或者叫上搭档一起按 G 抬。', holders[0]);
      else if (!why && aprons.length) for (const h of holders) h.hint = '摊位开着，客人站在前面：整组推不过去。先撤摊，或者绕开走。';
      else for (const h of holders) h.hint = PUSH_BLOCKED[why ?? 'stand'] ?? PUSH_BLOCKED.stand;
    }
    if (moved > 0) {
      // Moving again: an old "why it will not go" no longer applies.
      for (const h of holders) if (Object.values(PUSH_BLOCKED).includes(h.hint) || /客人站在前面/.test(h.hint ?? ''))
        h.hint = lifted ? '两人抬着走：能上下两级台阶。任何一人松手就稳稳放下。' : '推着整组走：只走平地和缓坡。E 在车尾推上车，G 松手。';
      s.stats.carried += moved;
      for (const h of holders) { h.contribution.carried += moved / holders.length; h.x = t.x + h.gripOffset.x; h.y = t.y + h.gripOffset.y; h.angle = Math.atan2(my, mx); }
      const overSteps = s.world.steps.some(st => polygonsOverlap(objectPoly(t), rectPoly(st)));
      if (!overSteps) t.lastFlat = { x: t.x, y: t.y, angle: t.angle };
      if (s.world.walkAreas.some(a => a.ramp && inRect(t, a))) markRoute(s, t, 'ramp');
      if (overSteps && !t.onSteps) {
        s.stats.liftSteps++;
        s.records.liftSteps.push({ table: t.id, names: holders.map(h => h.name), time: s.time });
        if (s.records.liftSteps.length > 60) s.records.liftSteps.shift();
        markRoute(s, t, 'lifted');
      }
      t.onSteps = overSteps;
    }
  }
}

export function step(s, dt) {
  if (!Number.isFinite(dt) || dt <= 0) return s;
  dt = Math.min(dt, 0.1);
  const n = Math.ceil(dt / (1 / 60)), sub = dt / n;
  for (let k = 0; k < n; k++) {
    s.time += sub;
    gustTick(s);
    for (const v of s.vehicles) drive(s, v, sub);
    for (const p of s.players) if (!p.vehicle) walk(s, p, sub);
    moveGroups(s, sub);
    syncObjects(s);
  }
  s.objClock = (s.objClock ?? 0) + dt;
  if (s.objClock > 0.25) { s.objClock = 0; for (const v of s.vehicles) v.profile = vehicleProfile(s, v); updateObjectives(s); }
  return s;
}

// ---------------------------------------------------------------- objectives and review

function tableIn(s, zone) {
  return s.objects.filter(o => isOpenTable(o) && o.at.kind === 'ground' && !o.holders.length && inRect(o, zone));
}

const STALLS = {
  lantern: { label: '灯笼摊（前侧）', need: '灯笼箱、灯笼架（立着）', goods: ['lantern-box', 'lantern'] },
  sweet: { label: '糖水摊', need: '两桶糖水', goods: ['sweet-1', 'sweet-2'], frame: 'frame-sweet' },
  grill: { label: '烤串摊', need: '烤炉、调料箱', goods: ['grill', 'spice'], frame: 'frame-grill' },
  public: { label: '公共服务面', need: '音响、茶水箱', goods: ['speaker', 'tea-box'] },
};

export function updateObjectives(s) {
  const zones = s.world.zones;
  if (s.mission === 'o6') {
    const spots = zones.filter(z => z.accepts === 'square'), cab = zones.find(z => z.accepts === 'cabinet');
    const squares = s.objects.filter(o => o.spec === 'square');
    const filled = spots.filter(z => squares.some(o => o.at.kind === 'ground' && inRect(o, z))).length;
    const cabinet = byId(s.objects, 'cabinet');
    const cabDone = cabinet.at.kind === 'ground' && cabinet.upright && inRect(cabinet, cab);
    s.objectives = [
      { id: 'squares', label: `八仙桌摆进茶馆（${filled} / 6）`, done: filled === 6, ...rectCenter(spots[0]) },
      { id: 'cabinet', label: '高茶柜立在柜位上', done: cabDone, ...rectCenter(cab) },
    ];
  } else if (s.mission === 'b3') {
    // Three flows sharing the plaza and the shed door (v0.5 §8.2): U1 up, D down, U2 up.
    const station = zones.find(z => z.accepts === 'station'), shed = zones.find(z => z.accepts === 'shed');
    const settled = o => o.at.kind !== 'held' && o.at.kind !== 'bed' && !o.holders.length;
    const inside = (ids, zone) => ids.filter(id => { const o = byId(s.objects, id); return settled(o) && inRect(o, zone); }).length;
    const company = inside(COMPANY, station), market = inside(NIGHT_MARKET, shed), shelves = inside(SHED_GOODS, station);
    const giftUp = byId(s.objects, 'gift-lantern').upright;
    const sign = byId(s.objects, 'sign');
    if (!s.records.signDoor && inRect(sign, station)) s.records.signDoor = sign.x < 67 ? 'back' : 'front';
    s.objectives = [
      { id: 'company', label: `公司的五件东西进新址（${company} / 5${company === 5 && !giftUp ? '，灯笼架要立着' : ''}）`, done: company === 5 && giftUp, ...rectCenter(station) },
      { id: 'market', label: `夜市下山进冬棚（${market} / ${NIGHT_MARKET.length}）`, done: market === NIGHT_MARKET.length, ...rectCenter(shed) },
      { id: 'shelves', label: `冬棚的货架和长椅进新址（${shelves} / 3）`, done: shelves === SHED_GOODS.length, ...rectCenter(station) },
    ];
  } else {
    s.objectives = Object.entries(STALLS).map(([key, st]) => {
      const zs = zones.filter(z => z.stall === key && z.kind === 'workface');
      const tables = zs.flatMap(z => tableIn(s, z).map(t => ({ t, z })));
      const hit = tables.find(({ t }) => st.goods.every(g => { const o = byId(s.objects, g); return o.at.kind === 'table' && o.at.table === t.id && (o.spec !== 'lantern' || o.upright); }));
      const frameZone = st.frame && zones.find(z => z.kind === 'frame' && z.stall === key);
      const frame = st.frame && byId(s.objects, st.frame);
      const frameDone = !st.frame || (frame.at.kind === 'ground' && !frame.holders.length && inRect(frame, frameZone));
      const parts = [hit ? '台和货到位' : `台 + ${st.need}`, ...(st.frame ? [frameDone ? '棚架到位' : '棚架'] : [])];
      return { id: key, label: `${st.label}：${parts.join('，')}`, done: Boolean(hit) && frameDone, front: hit?.z.front ?? null, ...rectCenter(zs[0]) };
    });
    const lantern = s.objectives.find(o => o.id === 'lantern');
    s.lanternLit = Boolean(lantern?.done);
  }
  const done = s.objectives.every(o => o.done);
  if (done && !s.complete) complete(s);
  return s.objectives;
}

function complete(s) {
  s.complete = true; s.phase = 'complete'; s.stats.completedAt = Math.round(s.time);
  if (s.mission === 'b2') s.records.frontChoice = s.objectives.find(o => o.id === 'lantern')?.front ?? null;
  s.review = buildReview(s);
  log(s, s.mission === 'o6' ? '茶馆的桌椅都到位了。评价卡已生成。' : s.mission === 'b3' ? '公司的招牌进了新址，夜市回了冬棚。评价卡已生成。' : '最后一台归位，新夜市的灯亮了。评价卡已生成。');
}

export function buildReview(s) {
  const r = s.records, st = s.stats, lines = [];
  const styles = r.passCrossings.filter(c => c.style !== 'unaffected').reduce((m, c) => (m[c.style] = (m[c.style] ?? 0) + 1, m), {});
  const said = [styles.dashed && `掐着间隙冲过去 ${styles.dashed} 次`, styles.crawled && `阵风里慢慢挪过去 ${styles.crawled} 次`, styles.braved && `顶着阵风冲过去 ${styles.braved} 次`, styles.waited && `在挡风墙后等过风 ${styles.waited} 次`].filter(Boolean);
  if (said.length) lines.push(`过垭口时，你们${said.join('，')}。`);
  else if (st.gustWaits) lines.push(`听说你们在垭口挡风墙后等了 ${st.gustWaits} 阵风。`);
  if (s.mission === 'b3') return finaleReview(s, lines);
  const upright = s.objects.find(o => o.spec === 'lantern' || o.spec === 'cabinet');
  if (upright?.travelledUpright && (s.mission === 'o6' || s.lanternLit)) lines.push(s.mission === 'o6' ? '高茶柜一路立着上了山。' : '灯笼架是立着上山的，一挂上就亮了。');
  else if (upright) lines.push(s.mission === 'o6' ? '高茶柜放倒了运，到茶馆才立起来。' : '灯笼架是放倒运上来的，到了摊位才立起来。');
  if (r.nearFirst) lines.push(`近侧卸货带是 ${r.nearFirst.name} 开着${r.nearFirst.vehicle}先抢到的。`);
  const ROUTE = { lifted: '两个人直接抬上了台阶', ramp: '绕缓坡推了上去', unpacked: '在西坪拆开，分件搬了上去' };
  for (const g of r.farGroups.filter(g => g.route).slice(0, 2)) lines.push(`${g.label}停到了西坪，${ROUTE[g.route]}。`);
  if (st.tows) lines.push(`叫过 ${st.tows} 次救援，车上的货都要在救援坪上重新装车。`);
  if (s.mission === 'b2') lines.push(r.frontChoice === 'a'
    ? '前侧摊位摆在了靠气象站一侧：接单卡上写着，公司日后要从那扇正门入驻。'
    : '前侧摊位摆在靠观景台一侧，旧气象站正门前留空了。');
  const rolls = s.incidents.filter(i => i.type === 'rollover');
  if (rolls.length) lines.push(`侧翻 ${rolls.length} 次。${rolls[0].text}`);
  if (!lines.length) lines.push('一路稳稳当当。');
  return {
    title: s.mission === 'o6' ? '茶馆的客人坐下了' : '新夜市开张',
    lines,
    stats: { minutes: Math.round(st.completedAt / 6) / 10, moves: st.moves, carried: Math.round(st.carried), driven: Math.round(st.driven),
      rollovers: st.rollovers, warnings: st.warnings, gustWaits: st.gustWaits, lifts: st.lifts, liftSteps: st.liftSteps, nearParks: r.nearParks, farParks: r.farParks },
    crew: s.players.map(p => ({ name: p.name, color: p.color, moves: p.contribution.moves, carried: Math.round(p.contribution.carried), driven: Math.round(p.contribution.driven) })),
  };
}

function finaleReview(s, lines) {
  const r = s.records, st = s.stats, gift = byId(s.objects, 'gift-lantern');
  if (r.frontChoice === 'a') lines.push(r.signDoor === 'front'
    ? '听说正门是你们自己在夏天挡上的；后来先撤了那一摊，招牌才从正门进来。'
    : '听说正门是你们自己在夏天挡上的；招牌只好走后门步道绕进来。');
  else lines.push(r.signDoor === 'back' ? '正门前空着，招牌却走了后门。' : '夏天把前侧摊位摆在了观景台那边，正门一直空着，招牌直接进了新址。');
  lines.push(gift.travelledUpright ? '夜市送的灯笼架连着灯笼立着上了山，一路亮着。' : '灯笼架放平运上山，到了新址才立起来亮灯。');
  const rolls = s.incidents.filter(i => i.type === 'rollover');
  if (rolls.length) lines.push(`侧翻 ${rolls.length} 次。${rolls[0].text}`);
  return {
    title: '公司搬上了山顶',
    lines,
    stats: { minutes: Math.round(st.completedAt / 6) / 10, moves: st.moves, carried: Math.round(st.carried), driven: Math.round(st.driven),
      rollovers: st.rollovers, warnings: st.warnings, gustWaits: st.gustWaits, lifts: st.lifts, liftSteps: st.liftSteps, nearParks: r.nearParks, farParks: r.farParks },
    crew: s.players.map(p => ({ name: p.name, color: p.color, moves: p.contribution.moves, carried: Math.round(p.contribution.carried), driven: Math.round(p.contribution.driven) })),
  };
}

// ---------------------------------------------------------------- views

/** Where the piece in someone's hands belongs, for the goal pointer. */
function goalOf(s, o) {
  const zones = s.world.zones, at = z => z && { x: z.x + z.w / 2, y: z.y + z.h / 2, label: `放到${z.label.split(' · ')[0].replace('工作面', '')}` };
  if (s.mission === 'o6') {
    if (o.spec === 'cabinet') return at(zones.find(z => z.accepts === 'cabinet'));
    return at(zones.find(z => z.accepts === 'square' && !s.objects.some(x => x !== o && x.spec === 'square' && x.at.kind === 'ground' && inRect(x, z))));
  }
  if (s.mission === 'b3') return at(zones.find(z => z.accepts === (NIGHT_MARKET.includes(o.id) ? 'shed' : 'station')));
  const stall = o.stall ?? goodsOn(s, o)[0]?.stall;
  if (!stall) return null;
  if (o.spec === 'frame') return at(zones.find(z => z.kind === 'frame' && z.stall === stall));
  const faces = zones.filter(z => z.kind === 'workface' && z.stall === stall);
  return at(faces.find(z => tableIn(s, z).length) ?? [...faces].sort((a, b) => dist(o, rectCenter(a)) - dist(o, rectCenter(b)))[0]);
}

/** Static map data, sent once per run. */
export function worldView(s) {
  const { mission, bounds, roads, flats, aprons, walkAreas, steps, obstacles, gates, breakovers, narrows, pass, stops, zones, labels, curves } = s.world;
  return JSON.parse(JSON.stringify({ mission, bounds, roads, flats, aprons, walkAreas, steps, obstacles, gates, breakovers, narrows, pass, stops, zones, labels, curves }));
}

/** Dynamic state, broadcast several times a second. Incident replays travel separately. */
export function snapshot(s) {
  return JSON.parse(JSON.stringify({
    version: s.version, time: s.time, mission: s.mission, build: s.build, phase: s.phase, complete: s.complete,
    gust: { state: s.gust.state, left: s.gust.left, period: s.gust.period },
    vehicles: s.vehicles.map(({ frames, frameClock, episode, passing, ...v }) => ({ ...v, speed: +v.speed.toFixed(2), kmh: Math.round(Math.abs(v.speed) * KMH) })),
    objects: s.objects.map(o => ({ id: o.id, spec: o.spec, label: o.label, color: o.color, at: o.at, x: +o.x.toFixed(2), y: +o.y.toFixed(2), angle: +o.angle.toFixed(3),
      z: o.z ?? 0, holders: o.holders, folded: o.folded, upright: o.upright, dims: dims(o), stall: o.stall ?? null,
      lit: o.id === 'gift-lantern' ? o.upright : o.spec === 'lantern' ? Boolean(s.lanternLit) : false })),
    players: s.players.map(p => { const { input, safe, gripOffset, ...rest } = p; const hand = byId(s.objects, p.holding ?? p.grip);
      return { ...rest, input, intents: intents(s, p), goal: hand ? goalOf(s, hand) : null }; }),
    objectives: s.objectives, log: s.log, stats: s.stats, records: s.records, review: s.review, lanternLit: Boolean(s.lanternLit),
    incidents: s.incidents.map(({ frames, side, ...i }) => i),
  }));
}
