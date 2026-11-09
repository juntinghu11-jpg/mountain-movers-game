// Four-player B2 with every crew member acting at the same time.
//   node tools/four.mjs
// Plan (one reasonable split, written by the author, not discovered by players):
//   Every driver takes one stall group. No group clears the 3.0 m gate on these
//   trucks (v0.5 §7), so all four park at the west lot:
//   P2 van 1: sweet-water group, short road; on a van it is shelter-only, so it hops windbreak to windbreak.
//   P3 van 2: grill group, short road.   P4 van 3: lantern group standing, long road; crawls at the gust sign.
//   P1 main truck: the public-service stall folded with its goods (its walled yard's 1.4 m gate
//   takes no open table), long road, near strip; then helps P4 lift; later both frames, near strip.
//   At the west lot P2 and P3 lift each other's groups up the two steps; P1 helps P4 with the lantern group.
// Flat-ground parking manoeuvres and empty drives back down are placed directly; a
// placed vehicle only lands inside the gate if it really clears it.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createCrewGame, runCrew, walk, push, pick, carryTo, drive, waitUntil, act, P, O, V } from './crew.mjs';
import { setInput, action } from '../sim.mjs';

const zone = (s, id) => { const z = s.world.zones.find(z => z.id === id); return { x: z.x + z.w / 2, y: z.y + z.h / 2 }; };
const tailOf = (v, len) => ({ x: v.x - Math.cos(v.angle) * (len / 2 + 0.9), y: v.y - Math.sin(v.angle) * (len / 2 + 0.9) });
const LEN = { main: 7.0, 'van-1': 4.8, 'van-2': 4.8, 'van-3': 4.8 };
const STRIP_LANE = 16.2, WORK_LANE = 25;

function place(s, vid, pose) { Object.assign(V(s, vid), pose, { speed: 0 }); }
/** Group centre that sits just behind a vehicle parked at pose. */
const behind = (vid, pose) => ({ x: pose.x - Math.cos(pose.angle) * (LEN[vid] / 2 + 1.0 + 1.25), y: pose.y - Math.sin(pose.angle) * (LEN[vid] / 2 + 1.0 + 1.25) });

// Loading spots along the north edge of the old plaza, clear of the walk from the docks.
const LOAD = { main: { x: 126.4, y: 182, angle: 0 }, 'van-1': { x: 116.7, y: 174, angle: 0 }, 'van-2': { x: 96.7, y: 174, angle: 0 }, 'van-3': { x: 76.7, y: 174, angle: 0 } };
const ARRIVE = {
  near: { main: { x: 80, y: 12, angle: Math.PI }, 'van-1': { x: 90, y: 12, angle: Math.PI }, 'van-2': { x: 80, y: 12, angle: Math.PI } },
  far: { 'van-1': { x: 76, y: 37, angle: 0 }, 'van-2': { x: 88, y: 37, angle: 0 }, main: { x: 80, y: 42, angle: 0 }, 'van-3': { x: 62, y: 46, angle: 0 } },
};
// Groups and long pieces cross the lot along this row, clear of the trucks parked there.
const LOT_ROW = 39;

function* assemble(s, pid, vid, table, goods) {
  const at = behind(vid, LOAD[vid]);
  yield* pick(s, pid, table);
  yield* carryTo(s, pid, at, [{ x: P(s, pid).x, y: 186 }]);
  act(s, pid, 'fold');
  for (const g of goods) {
    yield* pick(s, pid, g);
    yield* carryTo(s, pid, { x: at.x - 2.2, y: at.y + 1.2 }, [{ x: P(s, pid).x, y: 186 }]);
    if (O(s, g).at.kind !== 'table') throw new Error(`${g} not on ${table}: ${P(s, pid).hint}`);
  }
  // Back the vehicle up to the finished group, then push the group up the tail ramp.
  place(s, vid, LOAD[vid]);
  const t = O(s, table);
  yield* walk(s, pid, { x: t.x + 1.7, y: t.y - 1.6 }, { x: t.x + 1.7, y: t.y });
  act(s, pid, 'grip');
  act(s, pid, 'interact');
  if (t.at.kind !== 'bed') throw new Error(`${table} not loaded on ${vid}: ${P(s, pid).hint}`);
}

// The public-service yard and its 1.4 m gate in the west wall.
const YARD_OUT = { x: 74.4, y: 23.3 }, YARD_IN = { x: 80.6, y: 23.3 }, YARD_STAGE = { x: 82, y: 29 };
const inYard = q => q.x > 78.6 && q.x < 91.6 && q.y > 19 && q.y < 32;
function pointHeldNow(s, pid, dir) {
  const p = P(s, pid);
  for (let k = 0; k < 4; k++) {
    const len = Math.hypot(p.carry.x, p.carry.y) || 1;
    if ((p.carry.x * dir.x + p.carry.y * dir.y) / len > 0.7) return;
    if (!action(s, pid, 'rotate').ok) return;
  }
}
function* intoYard(s, pid) {
  const p = P(s, pid);
  if (inYard(p)) return;
  if (p.y < 18.4) yield* walk(s, pid, { x: p.x, y: STRIP_LANE }, { x: YARD_OUT.x, y: STRIP_LANE });
  yield* walk(s, pid, YARD_OUT);
  if (p.holding) pointHeldNow(s, pid, { x: 1, y: 0 });
  yield* walk(s, pid, YARD_IN);
}
function* leaveYard(s, pid) {
  const p = P(s, pid);
  if (!inYard(p)) return;
  yield* walk(s, pid, YARD_IN);
  if (p.holding) pointHeldNow(s, pid, { x: -1, y: 0 });
  yield* walk(s, pid, YARD_OUT);
}

/** Unload the public stall's three pieces from a truck on the strip and set it up inside the yard. */
function* yardStall(s, pid, vid) {
  const v = V(s, vid), goal = zone(s, 'ws-public');
  for (let k = 0; k < 3; k++) {
    const tp = tailOf(v, LEN[vid]);
    yield* walk(s, pid, { x: P(s, pid).x, y: STRIP_LANE }, { x: tp.x + 0.3, y: STRIP_LANE }, tp);
    P(s, pid).angle = Math.atan2(v.y - P(s, pid).y, v.x - P(s, pid).x);
    act(s, pid, 'interact');
    const id = P(s, pid).holding, t = O(s, 'table-3');
    yield* intoYard(s, pid);
    if (id === 'table-3') {
      yield* carryTo(s, pid, goal);
      yield* walk(s, pid, { x: P(s, pid).x, y: P(s, pid).y - 0.4 });
      act(s, pid, 'fold'); // open it at the workface
    } else if (!t.folded && t.at.kind === 'ground') {
      yield* walk(s, pid, { x: t.x + 1, y: t.y + 2 });
      act(s, pid, 'interact'); // set it on the table
    } else yield* carryTo(s, pid, { x: YARD_STAGE.x + k * 2.5, y: YARD_STAGE.y });
    yield* leaveYard(s, pid);
  }
  for (const g of ['speaker', 'tea-box']) {
    if (O(s, g).at.kind === 'table') continue;
    yield* intoYard(s, pid);
    yield* pick(s, pid, g);
    const t = O(s, 'table-3');
    yield* walk(s, pid, { x: t.x + 1, y: t.y + 2 });
    act(s, pid, 'interact');
    yield* leaveYard(s, pid);
  }
}

function* loadFrame(s, pid, vid, frame) {
  yield* pick(s, pid, frame);
  const tp = tailOf(V(s, vid), LEN[vid]);
  yield* walk(s, pid, { x: P(s, pid).x, y: 186 }, { x: tp.x - 2.4, y: tp.y + 1.2 }, { x: tp.x - 2.2, y: tp.y });
  P(s, pid).angle = 0;
  act(s, pid, 'interact');
  if (P(s, pid).holding) throw new Error(`${frame} not loaded: ${P(s, pid).hint}`);
}

const DEPART = { short: { x: 56, y: 177, angle: -Math.PI / 2 }, long: { x: 131, y: 182, angle: 0 } };

function* driveUp(s, pid, vid, road) {
  const v = V(s, vid), hop = v.profile.advisory.gust === 0; // a shelter-only load hops windbreak to windbreak
  // Pulling out of the loading spot onto the road mouth is a flat-ground manoeuvre: place it.
  yield* waitUntil(() => !s.vehicles.some(o => o !== v && Math.hypot(o.x - DEPART[road].x, o.y - DEPART[road].y) < 9), 'wait-road', 300);
  place(s, vid, DEPART[road]);
  const pts = road === 'short'
    ? [{ x: 56, y: 172 }, ...s.world.roads.find(r => r.id === 'short').points, { x: 113, y: 101 }]
    : [{ x: 137, y: 182 }, ...s.world.roads.find(r => r.id === 'long').points, { x: 116, y: 104 }, { x: 114, y: 101 }];
  const p = P(s, pid); Object.assign(p, { x: v.x + 1.5, y: v.y - 2 });
  act(s, pid, 'vehicle');
  yield* drive(s, pid, vid, pts);
  if (hop) {
    for (const h of [{ x: 114, y: 85.5 }, { x: 114, y: 68.5 }, { x: 114, y: 54 }, { x: 114, y: 36 }]) {
      setInput(s, pid, { brake: true });
      // Go in the calm, and only when nobody crawling ahead would hold us up in the open.
      const clear = () => !s.vehicles.some(o => o !== v && o.x > 108 && o.x < 120 && o.y < v.y - 1 && o.y > h.y - 8);
      yield* waitUntil(() => s.gust.state === 'calm' && s.gust.left > 2.6 && clear(), 'wait-gust', 120);
      yield* drive(s, pid, vid, [{ x: v.x, y: v.y - 2 }, h], { factor: 1, cap: 36, gustCrawl: false });
    }
  } else yield* drive(s, pid, vid, [{ x: 114, y: 96 }, { x: 114, y: 36 }]);
}

function* arrive(s, pid, vid) {
  const v = V(s, vid), near = v.profile.passGate;
  if (near) {
    yield* drive(s, pid, vid, [{ x: 104, y: 32 }, { x: 96, y: 30 }, { x: 96, y: 17 }]);
    if (v.y > 22) throw new Error(`${vid} stopped at the gate: ${P(s, pid).hint}`);
  }
  place(s, vid, (near ? ARRIVE.near : ARRIVE.far)[vid]);
  act(s, pid, 'vehicle');
}

function* unloadGroup(s, pid, vid) {
  const v = V(s, vid), tp = tailOf(v, LEN[vid]);
  yield* walk(s, pid, { x: tp.x, y: tp.y + (v.y < 18 ? 3 : -2.5) }, tp);
  P(s, pid).angle = Math.atan2(v.y - P(s, pid).y, v.x - P(s, pid).x);
  act(s, pid, 'interact');
  return P(s, pid).grip;
}

function* nearGroup(s, pid, vid, ws) {
  const id = yield* unloadGroup(s, pid, vid);
  const t = O(s, id), goal = zone(s, ws);
  yield* push(s, id, { x: t.x, y: STRIP_LANE }, { x: goal.x, y: STRIP_LANE }, goal);
  act(s, pid, 'grip');
}

/** Walk down into the west lot (by the steps, if coming from the work area) and on to a spot there. */
function* toLot(s, pid, spot) {
  if (P(s, pid).y < 33) yield* walk(s, pid, { x: 63, y: 30 }, { x: 63, y: LOT_ROW });
  yield* walk(s, pid, { x: spot.x, y: LOT_ROW }, spot);
}

/** Two people lift a group from behind a west-lot truck up the steps to its workface. */
function* liftUp(s, lead, helper, id, ws) {
  const t = O(s, id), goal = zone(s, ws);
  const end = { x: t.x - Math.cos(t.angle) * 1.7, y: t.y - Math.sin(t.angle) * 1.7 };
  yield* toLot(s, helper, end);
  act(s, helper, 'grip');
  const finish = goal.y < 18 ? [{ x: 63, y: STRIP_LANE + 1 }, { x: goal.x, y: STRIP_LANE + 1 }, goal] : [{ x: goal.x, y: WORK_LANE }, goal];
  yield* push(s, id, { x: t.x, y: LOT_ROW }, { x: 63, y: LOT_ROW }, { x: 63, y: WORK_LANE }, ...finish);
  act(s, lead, 'grip'); act(s, helper, 'grip');
}

function* carryFrameUp(s, pid, vid, frame, side) {
  const v = V(s, vid), tp = tailOf(v, LEN[vid]);
  yield* walk(s, pid, side === 'far' ? { x: tp.x, y: tp.y - 2.5 } : { x: tp.x + 0.3, y: STRIP_LANE }, tp);
  P(s, pid).angle = Math.atan2(v.y - P(s, pid).y, v.x - P(s, pid).x);
  act(s, pid, 'interact');
  frame ??= P(s, pid).holding; // whichever frame is nearest the tail
  if (P(s, pid).holding !== frame) throw new Error(`expected ${frame} off ${vid}, got ${P(s, pid).holding}`);
  const goal = zone(s, frame);
  const via = side === 'far' ? [{ x: tp.x, y: LOT_ROW }, { x: 63, y: LOT_ROW }, { x: 63, y: 30 }, { x: goal.x + 3, y: 30 }] : [{ x: tp.x + 1, y: STRIP_LANE }, { x: goal.x + 3, y: STRIP_LANE }];
  yield* carryTo(s, pid, goal, via);
}

export function fourPlayerB2() {
  const { s } = createCrewGame({ crew: 4 });
  s.players.forEach((p, i) => Object.assign(p, { x: 70 + i * 3, y: 184 }));
  const shared = { publicAtLot: false, lanternAtLot: false, p1Free: false, p4Free: false, p2Free: false, p3Free: false };

  function* p1() { // main truck
    place(s, 'main', LOAD.main);
    for (const id of ['table-3', 'speaker', 'tea-box']) yield* loadFrame(s, 'p1', 'main', id);
    yield* driveUp(s, 'p1', 'main', 'long');
    yield* arrive(s, 'p1', 'main');
    if (V(s, 'main').y > 18) throw new Error('the folded public stall should clear the gate');
    yield* yardStall(s, 'p1', 'main');
    shared.p1Free = true;
    yield* waitUntil(() => shared.lanternDone, 'help-lift', 400);
    // Second trip for both frames: the empty truck goes back down directly.
    place(s, 'main', LOAD.main);
    Object.assign(P(s, 'p1'), { x: 96, y: 186 });
    for (const f of ['frame-sweet', 'frame-grill']) yield* loadFrame(s, 'p1', 'main', f);
    yield* driveUp(s, 'p1', 'main', 'short');
    yield* arrive(s, 'p1', 'main');
    for (let k = 0; k < 2; k++) yield* carryFrameUp(s, 'p1', 'main', null, 'near');
  }
  function* p2() {
    yield* assemble(s, 'p2', 'van-1', 'table-1', ['sweet-1', 'sweet-2']);
    yield* driveUp(s, 'p2', 'van-1', 'short');
    yield* arrive(s, 'p2', 'van-1');
    yield* farGroup(s, 'p2', 'van-1', 'ws-sweet');
  }
  function* p3() {
    yield* waitUntil(() => s.time > 4, 'stagger');
    yield* assemble(s, 'p3', 'van-2', 'table-2', ['grill', 'spice']);
    yield* waitUntil(() => s.vehicles.find(v => v.id === 'van-1').y < 150 || s.time > 200, 'wait-road');
    yield* driveUp(s, 'p3', 'van-2', 'short');
    yield* arrive(s, 'p3', 'van-2');
    yield* unloadGroup(s, 'p3', 'van-2');
    act(s, 'p3', 'grip'); // set it down and help with the sweet-water group first
    shared.p3Free = true;
    yield* waitUntil(() => shared.p2Free, 'wait-partner', 400);
    const t = O(s, 'table-2');
    yield* toLot(s, 'p3', { x: t.x + 1.7, y: t.y });
    act(s, 'p3', 'grip');
    yield* liftUp(s, 'p3', 'p2', 'table-2', 'ws-grill');
    shared.grillDone = true;
  }
  /** The first van at the lot: unload, wait for the second van's driver, lift together. */
  function* farGroup(s, pid, vid, ws) {
    yield* unloadGroup(s, pid, vid);
    yield* waitUntil(() => shared.p3Free, 'wait-partner', 400);
    yield* liftUp(s, pid, 'p3', 'table-1', ws);
    shared.p2Free = true;
    yield* waitUntil(() => shared.grillDone, 'help-lift', 400);
  }
  function* p4() {
    yield* waitUntil(() => s.time > 8, 'stagger');
    yield* assemble(s, 'p4', 'van-3', 'table-4', ['lantern-box', 'lantern']);
    yield* waitUntil(() => V(s, 'main').x > 150 || V(s, 'main').y < 160 || s.time > 300, 'wait-road');
    yield* driveUp(s, 'p4', 'van-3', 'long');
    yield* arrive(s, 'p4', 'van-3');
    yield* unloadGroup(s, 'p4', 'van-3');
    act(s, 'p4', 'grip'); // set it down and go help with the main truck's group first
    shared.p4Free = true;
    yield* waitUntil(() => shared.p1Free, 'wait-partner', 400);
    yield* toLot(s, 'p4', { x: O(s, 'table-4').x + 1.7, y: O(s, 'table-4').y });
    act(s, 'p4', 'grip');
    yield* liftUp(s, 'p4', 'p1', 'table-4', 'ws-front-b');
    shared.lanternDone = true;
  }
  let result;
  try { result = runCrew(s, [['p1', p1()], ['p2', p2()], ['p3', p3()], ['p4', p4()]]); }
  catch (e) { e.message += ` | t=${s.time.toFixed(1)} incidents: ${s.incidents.map(i => `${i.type} ${i.vehicle} ${i.text}`).join(' / ')}`; throw e; }
  return { ...result, moves: s.stats.moves, carried: Math.round(s.stats.carried), rollovers: s.stats.rollovers, liftSteps: s.stats.liftSteps,
    farParks: s.records.farParks, nearParks: s.records.nearParks, liftWaits: s.records.liftLog.map(l => l.waited),
    nearFirst: s.records.nearFirst?.name ?? null, objectives: s.objectives.map(o => `${o.done ? '✓' : '·'} ${o.label}`), review: s.review?.lines ?? [] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(fourPlayerB2(), null, 2));
}
