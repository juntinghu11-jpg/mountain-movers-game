// Scripted B3 "换季·公司上山" for one player. Plan A (v0.5 §8.4) clears the front
// stall first so the company's pieces go in by the front door; plan B leaves the stall
// open and walks every piece round by the deck and the back walkway. Then the
// night market goes down into the shed in a few loads, the shed's shelves and
// bench ride up on the return legs.
//   node tools/finale.mjs [flat] [back]
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createCrew, walk, pick, carryTo, park, summary, P, O, V, act, tick, tail, intoYard, leaveYard, inYard, pickByEnd } from './bot.mjs';
import { drive, route } from '../test/helpers.mjs';
import { COMPANY, dims, action } from '../sim.mjs';

const POSE = {
  garage: { x: 62, y: 182, angle: 0 },               // tail towards the garage items
  shed: { x: 104.7, y: 185.5, angle: -Math.PI / 2 },  // tail towards the shed door
  strip: { x: 86, y: 12, angle: Math.PI },
  lot: { x: 80, y: 42, angle: 0 },
};
const STRIP_LANE = 16.2;
const DOOR = { x: 104.7, y: 198.6 };
const zoneOf = (c, id) => c.s.world.zones.find(z => z.id === id);

/** Load a held item through the tail of the main truck from wherever the carrier stands. */
/** Swing the held piece (quarter turns about the carrier) until it points along dir. */
function pointHeld(c, pid, dir) {
  const p = P(c, pid);
  for (let k = 0; k < 4; k++) {
    const len = Math.hypot(p.carry.x, p.carry.y) || 1;
    if ((p.carry.x * dir.x + p.carry.y * dir.y) / len > 0.7) return;
    if (!action(c.s, pid, 'rotate').ok) return;
  }
}

function loadAtTail(c, pid, approach = []) {
  const tp = tail(V(c)), v = V(c);
  const back = { x: tp.x - Math.cos(v.angle) * 2.2, y: tp.y - Math.sin(v.angle) * 2.2 };
  // Carry the piece ahead of you towards the tail, so it does not sweep into posts on the way.
  pointHeld(c, pid, { x: Math.cos(v.angle), y: Math.sin(v.angle) });
  walk(c, pid, ...approach, back);
  P(c, pid).angle = v.angle;
  act(c, pid, 'interact');
  if (P(c, pid).holding) throw new Error(`could not load ${P(c, pid).holding}: ${P(c, pid).hint}`);
}

function unloadOne(c, pid, from) {
  const v = V(c), tp = tail(v);
  walk(c, pid, ...from, tp);
  P(c, pid).angle = v.angle + Math.PI; // facing the truck
  P(c, pid).angle = Math.atan2(v.y - P(c, pid).y, v.x - P(c, pid).x);
  act(c, pid, 'interact');
  const id = P(c, pid).holding;
  if (!id) throw new Error(`nothing came off the tail: ${P(c, pid).hint}`);
  return id;
}

function driveTo(c, pid, pts) {
  const v = V(c), p = P(c, pid);
  Object.assign(p, { x: v.x + Math.cos(v.angle + Math.PI / 2) * 2, y: v.y + Math.sin(v.angle + Math.PI / 2) * 2 });
  act(c, pid, 'vehicle');
  const r = drive(c.s, pid, v, pts, { maxTime: 300 });
  if (!r.done) throw new Error(`drive did not finish at ${v.x.toFixed(1)},${v.y.toFixed(1)}: ${p.hint}`);
  c.trips = (c.trips ?? 0) + 1;
}

function crossPass(c, pid, up) {
  const s = c.s, v = V(c), gust = v.profile.advisory.gust;
  const ends = up ? [{ x: 114, y: 96 }, { x: 114, y: 36 }] : [{ x: 114, y: 38 }, { x: 114, y: 98 }];
  if (gust !== 0) { drive(s, pid, v, ends, { maxTime: 120, speedFor: () => (gust === null ? 40 : Math.max(4, gust * 0.85)) }); return; }
  const hops = up ? [{ x: 114, y: 85.5 }, { x: 114, y: 68.5 }, { x: 114, y: 54 }, { x: 114, y: 36 }] : [{ x: 114, y: 54 }, { x: 114, y: 68.5 }, { x: 114, y: 85.5 }, { x: 114, y: 98 }];
  for (const h of hops) {
    let guard = 0;
    while (!(s.gust.state === 'calm' && s.gust.left > 2.6) && guard++ < 900) tick(c);
    c.waits = (c.waits ?? 0) + 1;
    drive(s, pid, v, [{ x: v.x, y: v.y + (up ? -2 : 2) }, h], { speedFor: () => 36, maxTime: 30 });
  }
}

/** Up from the plaza to the summit; parks at the strip if the load clears the gate, else at the west lot. */
function goUp(c, pid) {
  park(c, { x: 56, y: 177, angle: -Math.PI / 2 });
  driveTo(c, pid, route(c.s, { x: 56, y: 172 }, 'short', { x: 113, y: 100 }));
  crossPass(c, pid, true);
  const v = V(c);
  if (v.profile.passGate) {
    drive(c.s, pid, v, route(c.s, { x: 104, y: 32 }, { x: 96, y: 30 }, { x: 96, y: 17 }), { maxTime: 60 });
    park(c, POSE.strip);
  } else park(c, POSE.lot);
  act(c, pid, 'vehicle');
  return v.profile.passGate ? 'near' : 'far';
}

/** Down from the summit to the shed door, driving the whole way (the load rides down). */
function goDown(c, pid) {
  park(c, { x: 114, y: 36, angle: Math.PI / 2 });
  const pts = route(c.s, { x: 114, y: 42 });
  driveTo(c, pid, pts);
  crossPass(c, pid, false);
  drive(c.s, pid, V(c), route(c.s, { x: 112, y: 104 }, 'short:rev', { x: 56, y: 176 }), { maxTime: 240 });
  park(c, POSE.shed);
  act(c, pid, 'vehicle');
}

/** From a parked summit truck to a point in the work area or on the strip, by the lane the side allows. */
const toPlaza = side => side === 'near' ? [{ x: 90, y: STRIP_LANE }] : [{ x: 74, y: 38 }, { x: 63, y: 38 }, { x: 63, y: 28 }, { x: 63, y: STRIP_LANE }];
const fromPlaza = side => side === 'near' ? [{ x: 90, y: STRIP_LANE }] : [{ x: 63, y: STRIP_LANE }, { x: 63, y: 28 }, { x: 63, y: 38 }, { x: 74, y: 38 }];

/** Packs the station's long room in two rows, keeping the front doorway clear. */
function stationPacker() {
  const rows = [{ y: 1.9, x: 64 }, { y: 4.6, x: 64, skip: [69.8, 75.6] }];
  return len => {
    for (const r of rows) {
      if (r.skip && r.x + len > r.skip[0] && r.x < r.skip[1]) r.x = r.skip[1];
      if (r.x + len <= 84.2) { const at = { x: r.x + len / 2, y: r.y }; r.x += len + 0.5; return at; }
    }
    throw new Error('station is full');
  };
}

function intoStation(c, pid, pack, side) {
  // Through the front door: swing the piece in front (north) of the carrier, walk it in,
  // then swing it level with the long room before walking to its spot.
  const p = P(c, pid), o = O(c, p.holding);
  walk(c, pid, ...toPlaza(side), { x: 72.2, y: STRIP_LANE });
  for (let k = 0; k < 3 && !(Math.abs(p.carry.x) < 0.3 && p.carry.y < 0); k++) act(c, pid, 'rotate');
  walk(c, pid, { x: 72.2 - p.carry.x, y: 7.6 - p.carry.y }, { x: 72.2 - p.carry.x, y: 3.2 - p.carry.y });
  act(c, pid, 'rotate'); // now the piece lies beside the carrier, along the room
  const spot = pack(Math.max(dims(o).l, dims(o).w) * 0.5);
  walk(c, pid, { x: spot.x - p.carry.x, y: 3.2 }, { x: spot.x - p.carry.x, y: spot.y - p.carry.y });
  act(c, pid, 'interact');
  if (P(c, pid).holding) throw new Error(`${o.label} not put down in the station: ${P(c, pid).hint}`);
  walk(c, pid, { x: P(c, pid).x, y: 3.2 }, { x: 72.2, y: 3.2 }, { x: 72.2, y: 8 });
}

/** Plan B: round the standing stall over the deck, along the back walkway and in by the back door. */
function intoStationBack(c, pid, pack, side) {
  const p = P(c, pid), o = O(c, p.holding);
  walk(c, pid, ...toPlaza(side), { x: 39, y: STRIP_LANE }, { x: 39, y: 9 });
  // Swing the piece ahead (east) of the carrier for the walkway and the door.
  for (let k = 0; k < 3 && !(p.carry.x > 0.3 && Math.abs(p.carry.y) < 0.3); k++) act(c, pid, 'rotate');
  walk(c, pid, { x: 36.6, y: 9 }, { x: 36.6, y: 2.7 });
  const spot = pack(Math.max(dims(o).l, dims(o).w) * 0.5);
  walk(c, pid, { x: spot.x - p.carry.x, y: 2.7 }, { x: spot.x - p.carry.x, y: spot.y - p.carry.y });
  act(c, pid, 'interact');
  if (P(c, pid).holding) throw new Error(`${o.label} not put down in the station: ${P(c, pid).hint}`);
  walk(c, pid, { x: P(c, pid).x, y: 3.2 }, { x: 72.2, y: 3.2 }, { x: 72.2, y: 8 });
}

/** Packs the shed in rows from the back wall forward, long pieces lying east-west. */
function shedPacker() {
  const rows = [{ y: 208.6, x: 93 }, { y: 205.6, x: 93 }, { y: 202.4, x: 107 }];
  return len => { const r = rows.find(row => row.x + len <= 121.5); if (!r) throw new Error('shed is full'); const at = { x: r.x + len / 2, y: r.y }; r.x += len + 0.6; return at; };
}

function intoShed(c, pid, pack) {
  const p = P(c, pid), o = O(c, p.holding);
  walk(c, pid, { x: DOOR.x, y: 194 });
  // Swing the piece ahead (south) of the carrier, walk it through the door, then lay it east-west.
  for (let k = 0; k < 3 && !(Math.abs(p.carry.x) < 0.3 && p.carry.y > 0); k++) act(c, pid, 'rotate');
  walk(c, pid, { x: DOOR.x - p.carry.x, y: 195 - p.carry.y * 0 }, { x: DOOR.x - p.carry.x, y: 200.9 });
  const along = Math.abs(p.carry.y) > 0.3;
  if (along) act(c, pid, 'rotate');
  const len = Math.max(dims(o).l, dims(o).w) * 0.5;
  const spot = pack(len);
  walk(c, pid, { x: P(c, pid).x, y: 201.6 }, { x: spot.x - p.carry.x, y: 201.6 }, { x: spot.x - p.carry.x, y: spot.y - p.carry.y });
  act(c, pid, 'interact');
  if (P(c, pid).holding) throw new Error(`${o.label} not put down in the shed: ${P(c, pid).hint}`);
  walk(c, pid, { x: P(c, pid).x, y: 201.2 }, { x: DOOR.x, y: 201.2 }, { x: DOOR.x, y: 194 });
}

/** Take a piece by its end, so it trails in line with you through a narrow door. */
function pickEnd(c, pid, id) {
  const o = O(c, id), half = Math.max(dims(o).l, dims(o).w) * 0.25, ax = dims(o).l >= dims(o).w ? o.angle : o.angle + Math.PI / 2;
  const ends = [1, -1].map(k => ({ x: o.x + Math.cos(ax) * (half + 0.7) * k, y: o.y + Math.sin(ax) * (half + 0.7) * k }));
  const p = P(c, pid), end = ends.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
  walk(c, pid, { x: end.x, y: 202.2 }, end);
  P(c, pid).angle = Math.atan2(o.y - end.y, o.x - end.x);
  act(c, pid, 'interact');
  if (P(c, pid).holding !== id) throw new Error(`${pid} picked ${P(c, pid).holding} instead of ${id}`);
}

function outOfShed(c, pid, id) {
  walk(c, pid, { x: DOOR.x, y: 194 }, { x: DOOR.x, y: 202.2 });
  pickEnd(c, pid, id);
  const p = P(c, pid);
  for (let k = 0; k < 3 && !(Math.abs(p.carry.x) < 0.3 && p.carry.y < 0); k++) act(c, pid, 'rotate');
  walk(c, pid, { x: DOOR.x - p.carry.x, y: 202.5 }, { x: DOOR.x - p.carry.x, y: 194.5 - p.carry.y * 0 });
}

const shedSlots = Array.from({ length: 24 }, (_, i) => ({ x: 94.5 + (i % 8) * 3.6, y: 201.6 + Math.floor(i / 8) * 3.1 }));
const stationSlots = Array.from({ length: 10 }, (_, i) => ({ x: 65.5 + (i % 5) * 3.9, y: i < 5 ? 2.2 : 4.1 }));

export function planB3(c, { lantern = 'upright', door = 'front' } = {}) {
  const [a] = c.ids, s = c.s;
  const pack = shedPacker(), room = stationPacker();
  // U1: the company's five things go up first.
  park(c, POSE.garage);
  for (const id of COMPANY) {
    pick(c, a, id);
    if (id === 'gift-lantern' && lantern === 'flat') act(c, a, 'tilt');
    loadAtTail(c, a, [{ x: P(c, a).x, y: 185 }]);
  }
  let side = goUp(c, a);
  // Plan A clears the front stall that blocks the station's front door: goods off, table folded.
  const stall = s.objects.find(o => o.spec === 'table' && !o.folded && o.x > 68 && o.x < 80 && o.y > 7 && o.y < 17);
  if (stall && door === 'front') {
    walk(c, a, ...toPlaza(side), { x: stall.x, y: stall.y + 2.2 });
    for (const g of s.objects.filter(o => o.at.kind === 'table' && o.at.table === stall.id)) {
      walk(c, a, { x: stall.x, y: stall.y + 2.2 });
      act(c, a, 'interact');
      carryTo(c, a, { x: 92 - (P(c, a).holding === 'lantern' ? 0 : 2.6), y: 14.5 }, [{ x: 86, y: STRIP_LANE }]);
    }
    walk(c, a, { x: stall.x, y: stall.y + 2 });
    act(c, a, 'fold');
  }
  for (let k = 0; k < COMPANY.length; k++) {
    const id = unloadOne(c, a, fromPlaza(side));
    if (id === 'gift-lantern' && !O(c, id).upright) act(c, a, 'tilt');
    // A stall still open in front of the door has customers in its customer space: nothing is carried
    // through it, so every piece goes round by the back walkway while it stands.
    if (door === 'back' && stall) intoStationBack(c, a, room, side);
    else intoStation(c, a, room, side);
  }
  // D: the night market goes down in loads; U2 rides back up on the return legs.
  // What actually fits a 4.0 × 2.0 m bed: two frames plus three pieces, or two folded tables plus two boxes.
  const loads = [
    ['frame-sweet', 'frame-grill', 'lantern-box', 'speaker', 'lantern'],
    ['table-3', 'table-4', 'tea-box', 'sweet-1'],
    ['table-1', 'table-2', 'sweet-2', 'grill'],
    ['spice'],
  ];
  const upLegs = [['shelf-1'], ['shelf-2', 'bench'], [], []];
  for (const [i, load] of loads.entries()) {
    // The truck is at the summit; bring it to the strip and strip every stall the load needs.
    // (An empty truck clears the gate; moving it from the west lot to the strip is placed directly.)
    if (!V(c).profile.empty) throw new Error('expected an empty truck before loading the night market');
    park(c, POSE.strip); side = 'near';
    walk(c, a, { x: Math.max(P(c, a).x, 90), y: STRIP_LANE });
    for (const id of load) {
      const o = O(c, id);
      // Go round the parked truck by the open lane, then straight to the piece.
      if (P(c, a).y < STRIP_LANE) walk(c, a, { x: P(c, a).x, y: STRIP_LANE });
      // The public-service stall stands in the walled yard: in and out by its 1.4 m gate.
      const yard = inYard(O(c, o.at.kind === 'table' ? o.at.table : id));
      if (yard) intoYard(c, a);
      else walk(c, a, { x: O(c, o.at.kind === 'table' ? o.at.table : id).x, y: STRIP_LANE });
      if (o.at.kind === 'table') {
        const t = O(c, o.at.table);
        // Stand on the open side of the table: the strip side, or inside the yard south of it.
        const side = t.y < 18 ? t.y + 2.2 : yard ? t.y + 2.2 : t.y - 2.2, aside = t.y < 18 ? t.y + 3.2 : yard ? t.y + 4.5 : t.y - 3.2;
        walk(c, a, { x: t.x, y: side });
        act(c, a, 'interact');
        if (P(c, a).holding !== id) { const other = P(c, a).holding; carryTo(c, a, { x: t.x - 3.2, y: aside }, []); walk(c, a, { x: t.x, y: side }); act(c, a, 'interact'); if (P(c, a).holding !== id) throw new Error(`${id} still on its table (took ${other})`); }
      } else if (o.spec === 'table' && !o.folded) {
        for (const [k, g] of s.objects.filter(x => x.at.kind === 'table' && x.at.table === id).entries()) {
          walk(c, a, { x: o.x, y: o.y - 2.2 }); act(c, a, 'interact');
          carryTo(c, a, { x: o.x - 3.2 + k * 2.6, y: inYard(o) ? o.y + 4.5 : o.y - 3.6 }, []); // inside the yard, south of its table
        }
        walk(c, a, { x: o.x, y: o.y - 2 }); act(c, a, 'fold');
        if (yard) pickByEnd(c, a, id, { x: -1, y: 0 }); else pick(c, a, id);
      } else pick(c, a, id);
      if (yard) leaveYard(c, a);
      if (id === 'lantern' && O(c, id).upright) act(c, a, 'tilt'); // its stall is closed for winter; lay it flat
      loadAtTail(c, a, [{ x: P(c, a).x, y: STRIP_LANE }, { x: 92, y: STRIP_LANE }]);
    }
    goDown(c, a);
    for (let k = 0; k < load.length; k++) {
      unloadOne(c, a, [{ x: DOOR.x + 1.5, y: 194 }]);
      intoShed(c, a, pack);
    }
    for (const id of upLegs[i]) { outOfShed(c, a, id); loadAtTail(c, a, [{ x: DOOR.x + 1.5, y: 193 }]); }
    if (i === loads.length - 1) break; // the last load ends the job at the bottom
    // Back up the mountain, with whatever the shed sends to the new site (or empty).
    side = goUp(c, a);
    for (let k = 0; k < upLegs[i].length; k++) { unloadOne(c, a, fromPlaza(side)); intoStation(c, a, room, side); }
  }
  return { ...summary(c), signDoor: s.records.signDoor, objectives: s.objectives.map(o => `${o.done ? '✓' : '·'} ${o.label}`), trips: c.trips };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const flat = process.argv.includes('flat'), back = process.argv.includes('back');
  const c = createCrew({ crew: 1, mission: 'b3' });
  console.log(JSON.stringify(planB3(c, { lantern: flat ? 'flat' : 'upright', door: back ? 'back' : 'front' }), null, 2));
}
