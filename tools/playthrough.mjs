// Scripted night-market runs for the V3 question: does carrying table and goods
// as one group (plan C) win everywhere? Usage:
//   node tools/playthrough.mjs --plan C --crew 1 --build standard --road short
//   plans: A, C, C2, M, P for B2; O6, O6-split, O6-vans for the teaching order
// Prints hand moves (H), hand-carry distance (M), uphill driving time and what
// the review card said. The bot is a measuring stick, not a player.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createCrew, walk, push, pick, carryTo, park, driveUp, arrive, goDown, summary, PARK, P, O, V, act, tick, tail, ASSEMBLY, intoYard, leaveYard, pickByEnd } from './bot.mjs';
import { drive } from '../test/helpers.mjs';

export const STALLS = [
  { key: 'sweet', table: 'table-1', goods: ['sweet-1', 'sweet-2'], ws: 'ws-sweet', frame: 'frame-sweet' },
  { key: 'grill', table: 'table-2', goods: ['grill', 'spice'], ws: 'ws-grill', frame: 'frame-grill' },
  { key: 'public', table: 'table-3', goods: ['speaker', 'tea-box'], ws: 'ws-public' },
  { key: 'lantern', table: 'table-4', goods: ['lantern-box', 'lantern'], ws: 'ws-front-a' },
];
const zoneCentre = (c, id) => { const z = c.s.world.zones.find(z => z.id === id); return { x: z.x + z.w / 2, y: z.y + z.h / 2 }; };
const STRIP_LANE = 16.2; // open lane of the near strip, south of a parked truck
const WORK_LANE = 25;    // lane through the workfaces, north of the frame spots
const RAMP_X = 40;       // the ramp up from the far end of the west lot
const FRAME_LANE = 18.8; // between the strip and the workfaces, clear of the front stall positions
const tableOf = Object.fromEntries(STALLS.flatMap(st => st.goods.map(g => [g, st.table])));
const wsOf = Object.fromEntries(STALLS.map(st => [st.table, st.ws]));
// The public-service face is inside the walled yard: only folded tables and loose goods pass its gate.
const YARD_WS = 'ws-public';
const UNPACK_AT = { x: 75, y: 21.2 };                  // where a group waits outside the yard gate
const YARD_STAGE = [{ x: 81.5, y: 29 }, { x: 84.5, y: 29 }]; // inside the yard, clear of the workface

function returnCrew(c, vid = 'main') {
  goDown(c, vid);
  c.ids.forEach((id, i) => { const p = P(c, id); if (p.vehicle) act(c, id, 'vehicle'); Object.assign(p, { x: 96 - i * 1.5, y: 184 }); });
  tick(c, 2);
}

/** Load whatever `pid` holds through the tail of the parked main truck. */
function loadHeldAtTail(c, pid, id, vid = 'main') {
  const tp = tail(V(c, vid));
  walk(c, pid, { x: 84, y: 186 }, { x: tp.x - 2.4, y: tp.y + 1.2 }, { x: tp.x - 2.2, y: tp.y });
  P(c, pid).angle = 0;
  act(c, pid, 'interact');
  if (P(c, pid).holding) throw new Error(`could not load ${id}: ${P(c, pid).hint}`);
}

/** Take the item nearest the tail; returns its id. */
function unloadOne(c, pid, side) {
  const v = V(c), tp = tail(v);
  walk(c, pid, side === 'near' ? { x: tp.x + 0.3, y: STRIP_LANE } : { x: tp.x, y: tp.y + 2 }, tp);
  P(c, pid).angle = Math.atan2(v.y - P(c, pid).y, v.x - P(c, pid).x);
  act(c, pid, 'interact');
  return P(c, pid).holding ?? P(c, pid).grip;
}


/** Carry a hand item from the tail to where it belongs (or stage it on the strip). */
function deliverHeld(c, pid, side, k, stageY = 15.5) {
  const id = P(c, pid).holding, tp = tail(V(c));
  const lane = side === 'near' ? [{ x: tp.x + 1, y: STRIP_LANE }] : [{ x: tp.x, y: 38 }, { x: 63, y: 38 }, { x: 63, y: 28 }];
  const strip = side === 'near' ? [] : [{ x: 63, y: STRIP_LANE }];
  // Long frames keep out of a standing stall's space: they cross the plaza on the lane south of the strip.
  if (id.startsWith('frame-')) {
    // West of the public-service yard's north wall before turning south to the frame lane.
    const g = zoneCentre(c, id), along = side === 'near' ? [{ x: 86, y: STRIP_LANE }, { x: 74.5, y: STRIP_LANE }, { x: 74.5, y: FRAME_LANE }] : [{ x: 63, y: FRAME_LANE }];
    carryTo(c, pid, g, [...lane, ...along, { x: g.x + 3, y: FRAME_LANE }]);
    return true;
  }
  if (id.startsWith('table-')) {
    const g = zoneCentre(c, wsOf[id]);
    if (wsOf[id] === YARD_WS) { walk(c, pid, ...lane, ...strip); intoYard(c, pid); carryTo(c, pid, g, []); }
    else carryTo(c, pid, g, [...lane, ...strip, { x: g.x, y: STRIP_LANE }]);
    walk(c, pid, { x: P(c, pid).x, y: P(c, pid).y - 0.4 });
    act(c, pid, 'fold');
    leaveYard(c, pid);
    return true;
  }
  if (id === 'lantern' && !O(c, id).upright) act(c, pid, 'tilt');
  const t = O(c, tableOf[id]);
  if (t.folded || t.at.kind !== 'ground') { carryTo(c, pid, { x: 93 - k * 1.3, y: stageY }, lane); return false; }
  if (wsOf[t.id] === YARD_WS) { walk(c, pid, ...lane, ...strip); intoYard(c, pid); walk(c, pid, { x: t.x + 1, y: t.y + 2 }); }
  else walk(c, pid, ...lane, { x: t.x + 1, y: t.y < 18 ? t.y + 2 : t.y - 2 });
  act(c, pid, 'interact');
  if (O(c, id).at.kind !== 'table') throw new Error(`${id} not placed: ${P(c, pid).hint}`);
  leaveYard(c, pid);
  return true;
}

/** Goods staged on the strip go onto their tables once those are open. */
function placeStaged(c, pid) {
  for (const o of c.s.objects.filter(o => o.at.kind === 'ground' && tableOf[o.id] && o.y < 18 && o.x > 86 && O(c, tableOf[o.id]).x < 86)) {
    const t = O(c, tableOf[o.id]);
    if (t.folded || t.at.kind !== 'ground') continue;
    pick(c, pid, o.id);
    if (o.id === 'lantern' && !o.upright) act(c, pid, 'tilt');
    if (wsOf[t.id] === YARD_WS) { intoYard(c, pid); walk(c, pid, { x: t.x + 1, y: t.y + 2 }); }
    else walk(c, pid, { x: P(c, pid).x, y: STRIP_LANE }, { x: t.x + 1, y: STRIP_LANE }, { x: t.x + 1, y: t.y < 18 ? t.y + 2 : t.y - 2 });
    act(c, pid, 'interact');
    leaveYard(c, pid);
  }
}

/**
 * A group cannot go through the yard's 1.4 m gate (v0.5 §7, the O7 condition): set it down
 * outside, carry the goods in, fold the table, carry it in, open it at the workface, set the goods on it.
 */
function unpackAtYard(c, st) {
  const t = O(c, st.table), goal = zoneCentre(c, st.ws), pid = t.holders[0];
  for (const id of [...t.holders]) act(c, id, 'grip');
  const goods = c.s.objects.filter(o => o.at.kind === 'table' && o.at.table === t.id).map(o => o.id);
  for (const [i] of goods.entries()) {
    walk(c, pid, { x: t.x, y: t.y + 1.6 });
    P(c, pid).angle = -Math.PI / 2;
    act(c, pid, 'interact');
    intoYard(c, pid);
    carryTo(c, pid, YARD_STAGE[i], []);
    leaveYard(c, pid);
  }
  walk(c, pid, { x: t.x, y: t.y + 1.4 });
  act(c, pid, 'fold');
  pickByEnd(c, pid, st.table, { x: 1, y: 0 }); // long side first through the gate
  intoYard(c, pid);
  carryTo(c, pid, goal, []);
  walk(c, pid, { x: P(c, pid).x, y: P(c, pid).y - 0.4 });
  act(c, pid, 'fold'); // open it at the workface
  for (const g of goods) {
    pick(c, pid, g);
    walk(c, pid, { x: t.x + 1, y: t.y + 2 });
    act(c, pid, 'interact');
    if (O(c, g).at.kind !== 'table') throw new Error(`${g} not set on its table in the yard: ${P(c, pid).hint}`);
  }
  leaveYard(c, pid);
}

/** Push a group from behind the tail to its workface along the lanes the arrival side allows. */
function pushToWorkface(c, st, side) {
  const t = O(c, st.table), goal = zoneCentre(c, st.ws), lifted = t.holders.length >= 2;
  if (st.ws === YARD_WS) {
    // To the yard gate: along the strip lane from the near side, along the work lane from the far side.
    if (side === 'near') push(c, st.table, { x: t.x, y: STRIP_LANE }, { x: UNPACK_AT.x, y: STRIP_LANE }, UNPACK_AT);
    else if (lifted) push(c, st.table, { x: t.x, y: 38 }, { x: 63, y: 38 }, { x: 63, y: WORK_LANE }, { x: UNPACK_AT.x, y: WORK_LANE }, UNPACK_AT);
    else push(c, st.table, { x: t.x, y: 38 }, { x: RAMP_X, y: 38 }, { x: RAMP_X, y: WORK_LANE }, { x: UNPACK_AT.x, y: WORK_LANE }, UNPACK_AT);
    for (const id of t.holders.slice(1)) act(c, id, 'grip');
    unpackAtYard(c, st);
    return;
  }
  const finish = goal.y < 18 ? [{ x: goal.x, y: STRIP_LANE }, goal] : [{ x: goal.x, y: WORK_LANE }, goal];
  if (side === 'near') push(c, st.table, { x: t.x, y: STRIP_LANE }, ...(goal.y < 18 ? [goal] : [{ x: goal.x, y: STRIP_LANE }, goal]));
  else if (lifted) push(c, st.table, { x: t.x, y: 38 }, { x: 63, y: 38 }, { x: 63, y: WORK_LANE }, ...finish);
  else push(c, st.table, { x: t.x, y: 38 }, { x: RAMP_X, y: 38 }, { x: RAMP_X, y: WORK_LANE },
    ...(goal.y < 18 ? [{ x: RAMP_X + 6, y: WORK_LANE }, { x: RAMP_X + 6, y: STRIP_LANE }, { x: goal.x, y: STRIP_LANE }, goal] : finish));
  for (const id of [...t.holders]) act(c, id, 'grip');
}

/** One trip of folded tables and loose goods, all to the near strip (the mixed plan's yard stall). */
function foldedTrip(c, items, road) {
  const [a, b] = c.ids;
  park(c, PARK.load);
  for (const id of items) { pick(c, a, id); loadHeldAtTail(c, a, id); }
  driveUp(c, a, road, b ? [b] : []);
  const side = arrive(c, a);
  for (let k = 0; k < items.length; k++) { unloadOne(c, a, side); deliverHeld(c, a, side, k); }
  placeStaged(c, a);
  returnCrew(c);
}

function frameTrip(c, frames, road) {
  const [a, b] = c.ids;
  park(c, PARK.load);
  for (const id of frames) { pick(c, a, id); loadHeldAtTail(c, a, id); }
  driveUp(c, a, road, b ? [b] : []);
  const side = arrive(c, a);
  for (let k = 0; k < frames.length; k++) { unloadOne(c, a, side); deliverHeld(c, a, side, k); }
  returnCrew(c);
}

/** Solo alternative at the west lot: take the goods off, fold the table, carry everything up the steps. */
function unpackAtLot(c, pid, st) {
  const t = O(c, st.table), goal = zoneCentre(c, st.ws);
  if (P(c, pid).grip) act(c, pid, 'grip');
  const stash = st.goods.map((g, i) => ({ g, spot: { x: t.x - 2 - i * 1.6, y: t.y - 2.2 } }));
  for (const { g, spot } of stash) {
    walk(c, pid, { x: t.x, y: t.y - 1.6 });
    act(c, pid, 'interact');
    if (P(c, pid).holding !== g && P(c, pid).holding) { /* took the other one first */ }
    const held = P(c, pid).holding;
    carryTo(c, pid, stash.find(x => x.g === held).spot, []);
  }
  walk(c, pid, { x: t.x, y: t.y - 1.4 });
  act(c, pid, 'fold');
  const yard = st.ws === YARD_WS;
  if (yard) { pickByEnd(c, pid, st.table, { x: 1, y: 0 }); walk(c, pid, { x: 63, y: 38 }, { x: 63, y: 28 }); intoYard(c, pid); carryTo(c, pid, goal, []); }
  else { pick(c, pid, st.table); carryTo(c, pid, goal, [{ x: 63, y: 38 }, { x: 63, y: 28 }, { x: goal.x, y: goal.y < 18 ? STRIP_LANE : 28 }]); }
  walk(c, pid, { x: P(c, pid).x, y: P(c, pid).y - 0.4 });
  act(c, pid, 'fold');
  leaveYard(c, pid);
  for (const { g } of stash) {
    walk(c, pid, { x: 63, y: 28 }, { x: 63, y: 38 }); // back down the steps to the lot
    pick(c, pid, g);
    if (g === 'lantern' && !O(c, g).upright) act(c, pid, 'tilt');
    const table = O(c, st.table);
    if (yard) { walk(c, pid, { x: 63, y: 38 }, { x: 63, y: 28 }); intoYard(c, pid); walk(c, pid, { x: table.x + 1, y: table.y + 2 }); }
    else walk(c, pid, { x: 63, y: 38 }, { x: 63, y: 28 }, { x: table.x + 1, y: table.y < 18 ? STRIP_LANE : 28 }, { x: table.x + 1, y: table.y < 18 ? table.y + 2 : table.y + 2 });
    act(c, pid, 'interact');
    if (O(c, g).at.kind !== 'table') throw new Error(`${g} not placed after unpacking: ${P(c, pid).hint}`);
    leaveYard(c, pid);
  }
}

export function planC(c, { road = 'short', unpackFar = false, mixed = false } = {}) {
  const [a, b] = c.ids, lowbed = c.s.build === 'lowbed';
  const pendingFrames = ['frame-sweet', 'frame-grill'];
  for (const st of STALLS) {
    if (mixed && st.ws === YARD_WS) { foldedTrip(c, [st.table, ...st.goods], road); continue; }
    park(c, PARK.depart); // keep the truck clear while the group is assembled
    pick(c, a, st.table);
    carryTo(c, a, ASSEMBLY, [{ x: 80, y: 185 }]);
    act(c, a, 'fold'); // unfold at the assembly point
    for (const [i, g] of st.goods.entries()) {
      const who = b && i === 1 ? b : a;
      pick(c, who, g);
      carryTo(c, who, { x: ASSEMBLY.x - 2.2, y: ASSEMBLY.y + 1.2 }, []);
      if (O(c, g).at.kind !== 'table') throw new Error(`${g} not on the table: ${P(c, who).hint}`);
    }
    park(c, PARK.load);
    walk(c, a, { x: ASSEMBLY.x + 1.7, y: ASSEMBLY.y - 1.5 }, { x: ASSEMBLY.x + 1.7, y: ASSEMBLY.y });
    act(c, a, 'grip');
    act(c, a, 'interact'); // push the group up the tail ramp
    if (O(c, st.table).at.kind !== 'bed') throw new Error(`group ${st.key} not loaded: ${P(c, a).hint}`);
    // The low-bed body carries one long frame on its rear shelf behind the group.
    const frame = lowbed && pendingFrames.length ? pendingFrames.shift() : null;
    if (frame) { pick(c, a, frame); loadHeldAtTail(c, a, frame); }
    driveUp(c, a, road, b ? [b] : []);
    const side = arrive(c, a);
    if (frame) { unloadOne(c, a, side); deliverHeld(c, a, side, 0); }
    unloadOne(c, a, side);
    const t = O(c, st.table);
    if (b) {
      const ends = [1, -1].map(k => ({ x: t.x + Math.cos(t.angle) * 1.7 * k, y: t.y + Math.sin(t.angle) * 1.7 * k }));
      const end = ends.sort((p, q) => Math.hypot(q.x - P(c, a).x, q.y - P(c, a).y) - Math.hypot(p.x - P(c, a).x, p.y - P(c, a).y))[0];
      walk(c, b, { x: end.x, y: end.y + (side === 'near' ? 2.5 : -2.5) }, end);
      act(c, b, 'grip');
    }
    if (side === 'far' && unpackFar && !b) unpackAtLot(c, a, st);
    else pushToWorkface(c, st, side);
    returnCrew(c);
  }
  if (pendingFrames.length) frameTrip(c, pendingFrames, road);
  return summary(c);
}

/**
 * Plan P, partial groups: each table rides open with only the goods that keep it under
 * the 3.0 m gate; the tall piece rides loose beside it, and a frame along the fourth row.
 * Everything parks on the near strip; the tall piece goes onto the table at the workface.
 */
const LOW = { sweet: [], grill: ['spice'], public: ['tea-box'], lantern: ['lantern'] };
export function planP(c, { road = 'short' } = {}) {
  const [a, b] = c.ids;
  const pendingFrames = ['frame-sweet', 'frame-grill'];
  for (const st of STALLS) {
    park(c, PARK.depart);
    pick(c, a, st.table);
    carryTo(c, a, ASSEMBLY, [{ x: 80, y: 185 }]);
    act(c, a, 'fold'); // unfold at the assembly point
    for (const g of LOW[st.key]) {
      pick(c, a, g);
      if (g === 'lantern' && O(c, g).upright) act(c, a, 'tilt'); // a flat rack keeps the group under the gate
      carryTo(c, a, { x: ASSEMBLY.x - 2.2, y: ASSEMBLY.y + 1.2 }, []);
      if (O(c, g).at.kind !== 'table') throw new Error(`${g} not on the table: ${P(c, a).hint}`);
    }
    park(c, PARK.load);
    walk(c, a, { x: ASSEMBLY.x + 1.7, y: ASSEMBLY.y - 1.5 }, { x: ASSEMBLY.x + 1.7, y: ASSEMBLY.y });
    act(c, a, 'grip');
    act(c, a, 'interact');
    if (O(c, st.table).at.kind !== 'bed') throw new Error(`partial group ${st.key} not loaded: ${P(c, a).hint}`);
    for (const g of st.goods.filter(g => !LOW[st.key].includes(g))) { pick(c, a, g); loadHeldAtTail(c, a, g); }
    // A frame fits along the fourth row unless two loose pieces already fill the tail end.
    const frame = st.key !== 'sweet' && pendingFrames.length ? pendingFrames.shift() : null;
    if (frame) { pick(c, a, frame); loadHeldAtTail(c, a, frame); }
    driveUp(c, a, road, b ? [b] : []);
    const side = arrive(c, a);
    if (side !== 'near') throw new Error(`a partial group should clear the gate (top ${V(c).profile.top})`);
    for (let k = 0; ; k++) {
      const id = unloadOne(c, a, side);
      if (!id) break;
      if (P(c, a).grip) { pushToWorkface(c, st, side); break; }
      deliverHeld(c, a, side, k, 8.4); // stage loose pieces north of the tail, clear of the lane the group leaves by
    }
    if (st.key === 'lantern') { // stand the rack up where it sits on the table
      const L = O(c, 'lantern');
      walk(c, a, { x: L.x + 1.2, y: L.y + 1.4 });
      act(c, a, 'tilt');
    }
    placeStaged(c, a);
    returnCrew(c);
  }
  if (pendingFrames.length) frameTrip(c, pendingFrames, road);
  return summary(c);
}

export function planA(c, { road = 'short' } = {}) {
  const [a, b] = c.ids, lowbed = c.s.build === 'lowbed';
  // Load order is reversed on the way out: last in, first off the tail.
  const trips = lowbed ? [
    ['table-1', 'table-2', 'sweet-1', 'sweet-2'],
    ['table-3', 'table-4', 'grill', 'spice'],
    ['speaker', 'tea-box', 'lantern-box', 'lantern', 'frame-sweet'],
    ['frame-grill'],
  ] : [
    ['sweet-1', 'sweet-2', 'table-1', 'table-2'],
    ['grill', 'spice', 'table-3', 'table-4'],
    ['frame-sweet', 'frame-grill', 'speaker', 'tea-box', 'lantern-box', 'lantern'],
  ];
  for (const items of trips) {
    park(c, PARK.load);
    for (const id of items) {
      pick(c, a, id);
      if (id === 'lantern') act(c, a, 'tilt'); // lay it flat so the truck clears the gate
      loadHeldAtTail(c, a, id);
    }
    driveUp(c, a, road, b ? [b] : []);
    const side = arrive(c, a);
    if (side !== 'near') throw new Error('fold-and-carry load should clear the gate');
    for (let k = 0; k < items.length; k++) {
      if (!unloadOne(c, a, side)) throw new Error(`nothing came off the tail: ${P(c, a).hint}`);
      deliverHeld(c, a, side, k);
    }
    placeStaged(c, a);
    returnCrew(c);
  }
  return summary(c);
}

/** O6 teaching order: everything in one load (cabinet laid flat), then carry into the tea house. */
/**
 * O6 (v0.5 §6): six square tables and a glass-fronted tea cabinet that only travels standing.
 * The tea house lane is 2.2 m wide: the main truck (2.3 m) stops at the stop after the pass and
 * everything is carried in; a van (1.9 m) drives to the door but holds two tables at a time.
 *   full  - everything on the main truck, one trip, carried in from the stop;
 *   split - the tables on the main truck, the cabinet on a van to the door;
 *   vans  - van trips only, each to the door.
 */
export function planO6(c, { road = 'short', plan = 'full' } = {}) {
  const [a] = c.ids, lowbed = c.s.build === 'lowbed';
  const squares = ['square-1', 'square-2', 'square-3', 'square-4', 'square-5', 'square-6'];
  const trips = plan === 'vans' ? [['van-1', ['cabinet', 'square-1', 'square-2']], ['van-1', ['square-3', 'square-4']], ['van-1', ['square-5', 'square-6']]]
    : plan === 'split' ? [['main', squares], ['van-1', ['cabinet']]]
    // The low-bed body holds less: cabinet and four tables, then the last two.
    : lowbed ? [['main', ['cabinet', ...squares.slice(0, 4)]], ['main', squares.slice(4)]]
    : [['main', [...squares, 'cabinet']]];
  let last = null;
  for (const [vid, items] of trips) {
    if (last && last !== vid) park(c, { x: 126, y: 190, angle: 0 }, last); // clear the loading spot for the other truck
    last = vid;
    park(c, PARK.load, vid);
    for (const id of items) { pick(c, a, id); loadHeldAtTail(c, a, id, vid); }
    driveUp(c, a, road, [], vid);
    const v = V(c, vid);
    drive(c.s, a, v, [{ x: 130, y: 34 }, { x: 150, y: 34 }, { x: 172, y: 34 }, { x: 186, y: 34 }], { maxTime: 60 });
    // A truck too wide for the lane, or a low-bed at the break-over, goes back to the stop and the crew carries on foot.
    const yard = v.x > 160;
    park(c, yard ? { x: 182, y: 31, angle: Math.PI } : { x: 130, y: 34, angle: Math.PI }, vid);
    act(c, a, 'vehicle');
    c.teaYard = (c.teaYard ?? 0) + (yard ? 1 : 0);
    for (let k = 0; k < items.length; k++) {
      const tp = tail(v);
      if (P(c, a).y < 22) walk(c, a, { x: 181, y: 19 }, { x: 181, y: 27 }); // out through the tea house door
      if (!yard) walk(c, a, ...(P(c, a).x > 160 ? [{ x: 172, y: 34 }] : []), { x: tp.x + 2.2, y: P(c, a).x > 160 ? 34 : P(c, a).y }, { x: tp.x + 2.2, y: tp.y }, tp);
      else walk(c, a, { x: tp.x + 0.6, y: tp.y + 2 }, tp);
      P(c, a).angle = Math.PI;
      act(c, a, 'interact');
      const id = P(c, a).holding;
      const spot = c.s.world.zones.find(z => id === 'cabinet' ? z.accepts === 'cabinet' : z.accepts === 'square' && !c.s.objects.some(o => o.spec === 'square' && o.at.kind === 'ground' && o.x > z.x && o.x < z.x + z.w && o.y > z.y && o.y < z.y + z.h));
      const goal = { x: spot.x + spot.w / 2, y: spot.y + spot.h / 2 };
      carryTo(c, a, goal, [...(yard ? [] : [{ x: 172, y: 34 }]), { x: 181, y: 27 }, { x: 181, y: 19 }, { x: goal.x - P(c, a).carry.x, y: 19 }]);
    }
    returnCrew(c, vid);
  }
  return { ...summary(c), teaYard: c.teaYard ?? 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const arg = (flag, fallback) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : fallback; };
  const plan = arg('--plan', 'C'), crew = Number(arg('--crew', '1')), build = arg('--build', 'standard'), road = arg('--road', 'short');
  const c = createCrew({ crew, build, mission: plan.startsWith('O6') ? 'o6' : 'b2' });
  const result = plan.startsWith('O6') ? planO6(c, { road, plan: plan === 'O6-split' ? 'split' : plan === 'O6-vans' ? 'vans' : 'full' })
    : (plan === 'A' ? planA : plan === 'P' ? planP : planC)(c, { road, unpackFar: plan === 'C2', mixed: plan === 'M' });
  console.log(JSON.stringify({ plan, crew, build, road, ...result }, null, 2));
}
