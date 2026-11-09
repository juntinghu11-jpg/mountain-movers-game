// Hand-authored gray-box geometry for the v0.5 first validation slice:
// the lower summit map and the summit plaza (v0.5 §10). Units are metres.
import { filletPath, polylineLength } from './geom.mjs';

export const ROAD_WIDTH = 8;
export const GATE_LIMIT = 3.0;

const rect = (id, x, y, w, h, extra = {}) => ({ id, x, y, w, h, ...extra });
const GRADES = {
  hairpin: { label: '发夹弯', base: 30 },
  medium: { label: '急弯', base: 38 },
  gentle: { label: '缓弯', base: 44 },
};
const gradeFor = r => r <= 9 ? 'hairpin' : r <= 16 ? 'medium' : 'gentle';

function makeRoad(id, label, waypoints, radii, curveGroups = []) {
  const { points, corners } = filletPath(waypoints, radii);
  const curves = curveGroups.map(group => {
    const cs = group.corners.map(i => corners[i]);
    const first = cs[0], last = cs.at(-1);
    const grade = gradeFor(Math.min(...cs.map(c => c.radius)));
    // dir points back along the road, away from the curve; traffic approaches along -dir.
    // Signs stand outside the right-hand edge of the approaching lane, so two curves
    // close together never put their signs on the same verge.
    const side = (p, dir, back) => {
      const base = { x: p.x + dir.x * back, y: p.y + dir.y * back };
      return { x: base.x + dir.y * (ROAD_WIDTH / 2 + 2.2), y: base.y - dir.x * (ROAD_WIDTH / 2 + 2.2) };
    };
    return {
      id: group.id, label: group.label, road: id, grade, base: GRADES[grade].base,
      zones: cs.map(c => ({ x: c.x, y: c.y, r: c.radius + ROAD_WIDTH / 2 + 1.5 })),
      signs: [side(first.entry, { x: -first.inDir.x, y: -first.inDir.y }, 7), side(last.exit, last.outDir, 7)],
      mid: { x: cs.reduce((n, c) => n + c.x, 0) / cs.length, y: cs.reduce((n, c) => n + c.y, 0) / cs.length },
    };
  });
  return { id, label, width: ROAD_WIDTH, points, length: polylineLength(points), curves };
}

export function makeWorld(mission = 'b2') {
  const roads = [
    makeRoad('short', '盘山短路', [
      { x: 56, y: 170 }, { x: 56, y: 154 }, { x: 100, y: 154 }, { x: 100, y: 138 },
      { x: 60, y: 138 }, { x: 60, y: 122 }, { x: 112, y: 122 }, { x: 112, y: 106 },
    ], [14, 8, 8, 8, 8, 14], [
      { id: 'c1', label: '入口弯', corners: [0] },
      { id: 'h1', label: '1 号发夹弯', corners: [1, 2] },
      { id: 'h2', label: '2 号发夹弯', corners: [3, 4] },
      { id: 'c2', label: '垭口前弯', corners: [5] },
    ]),
    makeRoad('long', '环山长路', [
      { x: 138, y: 182 }, { x: 226, y: 182 }, { x: 226, y: 104 }, { x: 122, y: 104 },
    ], [24, 24], [
      { id: 'g1', label: '东缓弯', corners: [0] },
      { id: 'g2', label: '北缓弯', corners: [1] },
    ]),
    makeRoad('pass', '垭口', [{ x: 114, y: 98 }, { x: 114, y: 38 }], []),
    makeRoad('gate-road', '山门坡道', [{ x: 96, y: 28 }, { x: 96, y: 16 }], []),
    makeRoad('tea-road', '茶馆路', [{ x: 134, y: 34 }, { x: 170, y: 34 }], []),
  ];

  // Flat ground: vehicles may stop and drop a tail ramp here; groups may be pushed.
  const flats = [
    rect('old-plaza', 12, 168, 128, 30, { label: '旧夜市广场' }),
    rect('s1', 102, 96, 22, 16, { label: '垭口前停靠点' }),
    rect('s2', 92, 26, 44, 18, { label: '垭口后停靠点' }),
    rect('strip', 52, 6, 48, 12, { label: '前侧临时卸货带', near: true }),
    rect('lot', 44, 34, 48, 16, { label: '西坪', far: true }),
    rect('tea-yard', 168, 24, 30, 16, { label: '茶馆前院' }),
  ];
  // Drivable junction mouths: room to swing a long truck into a road. Not flat
  // enough for a tail ramp, so nothing is loaded or unloaded here.
  const aprons = [
    rect('short-mouth', 44, 160, 24, 8, { label: '路口' }),
    rect('pass-mouth', 106, 90, 16, 6, { label: '路口' }),
    rect('pass-top', 106, 44, 16, 5, { label: '路口' }),
  ];
  // Walk-only ground. Groups may be pushed on all of it except steps.
  const walkAreas = [
    rect('pad-s0', 2, 170, 10, 24, { label: '救援坪', pad: 's0' }),
    rect('pad-s1', 90, 98, 12, 12, { label: '救援坪', pad: 's1' }),
    rect('pad-s2', 120, 44, 12, 10, { label: '救援坪', pad: 's2' }),
    rect('work', 40, 18, 52, 14, { label: '新夜市工作面' }),
    rect('ramp', 36, 22, 8, 26, { label: '缓坡', ramp: true }),
    rect('deck', 36, 6, 16, 12, { label: '观景台' }),
    rect('tea-hall', 166, 4, 34, 18, { label: '茶馆大堂' }),
    rect('tea-door', 178, 21, 6, 4, { label: '茶馆门' }),
    ...(mission === 'b3' ? [
      rect('shed-in', 92, 200, 30, 10, { label: '冬棚' }),
      rect('shed-door', 104, 197.4, 1.4, 3.2, { label: '冬棚门' }),
      rect('station-in', 63.5, 1, 21, 4.5, { label: '公司新址（旧气象站）' }),
      rect('front-door', 71, 5.2, 2.4, 1.4, { label: '正门' }),
      rect('back-walk', 36, 0.6, 26.5, 5.6, { label: '后门步道' }),
      rect('back-door', 61.5, 1.6, 2.5, 2.2, { label: '后门' }),
    ] : []),
  ];
  const steps = [rect('steps', 58, 32, 10, 2, { label: '两级台阶', count: 2 })];
  const finale = mission === 'b3';
  const obstacles = [
    ...(finale ? [
      // B3: the east end of the old hall is the winter shed, one 1.4 m door: folded tables pass, open ones do not.
      rect('old-hall', 24, 198, 66, 14, { label: '旧夜市棚', kind: 'building' }),
      rect('shed-n1', 90, 198, 14, 2, { kind: 'wall' }), rect('shed-n2', 105.4, 198, 18.6, 2, { kind: 'wall' }),
      rect('shed-e', 122, 198, 2, 14, { kind: 'wall' }), rect('shed-s', 90, 210, 34, 2, { kind: 'wall' }),
      rect('shed-w', 90, 198, 2, 14, { kind: 'wall' }),
      // The old weather station opens as the company's new site: front door on the strip, back door at the end of a walkway.
      rect('station-n', 62, 0, 24, 1, { kind: 'wall' }), rect('station-e', 84.5, 0, 1.5, 6, { kind: 'wall' }),
      rect('station-w1', 62, 0, 1.5, 1.6, { kind: 'wall' }), rect('station-w2', 62, 3.8, 1.5, 2.2, { kind: 'wall' }),
      rect('station-s1', 63.5, 5.5, 7.5, 0.5, { kind: 'wall' }), rect('station-s2', 73.4, 5.5, 11.1, 0.5, { kind: 'wall' }),
      rect('walk-fence', 41, 5.6, 21.5, 0.6, { label: '围栏', kind: 'wall' }), // the walkway starts at the far end of the deck
    ] : [
      rect('old-hall', 24, 198, 100, 14, { label: '旧夜市棚', kind: 'building' }),
      rect('station', 62, 0, 24, 6, { label: '旧气象站', kind: 'building' }),
    ]),
    rect('wall-w', 44, 32, 14, 2, { label: '挡土墙', kind: 'wall' }),
    rect('wall-e', 68, 32, 24, 2, { label: '挡土墙', kind: 'wall' }),
    // The public-service face stands in a small walled yard; its gate is 1.4 m wide, so folded
    // tables and loose goods go in but an open table does not (the O7 condition inside B2, v0.5 §7).
    rect('yard-n', 78, 18.4, 13.6, 0.6, { kind: 'wall' }),
    rect('yard-w1', 78, 19, 0.6, 3.6, { kind: 'wall' }),
    rect('yard-w2', 78, 24, 0.6, 8, { kind: 'wall' }),
    rect('tea-n', 164, 2, 38, 2, { kind: 'wall' }), rect('tea-w', 164, 2, 2, 22, { kind: 'wall' }),
    rect('tea-e', 200, 2, 2, 22, { kind: 'wall' }),
    rect('tea-s1', 164, 22, 14, 2, { kind: 'wall' }), rect('tea-s2', 184, 22, 18, 2, { kind: 'wall' }),
    // Windbreaks stand clear of the pass mouths, so a truck turning in from a stop never clips one.
    rect('wind-1', 107, 81, 3, 9, { label: '挡风墙', kind: 'windbreak' }),
    rect('wind-2', 107, 63, 3, 11, { label: '挡风墙', kind: 'windbreak' }),
    rect('wind-3', 107, 49.5, 3, 9, { label: '挡风墙', kind: 'windbreak' }),
    rect('tea-post-n', 157.6, 29, 0.8, 3.8, { label: '石墩', kind: 'post' }),
    rect('tea-post-s', 157.6, 35.2, 0.8, 3.8, { label: '石墩', kind: 'post' }),
    rect('gate-post-w', 89.5, 19, 2.5, 3, { label: '老山门', kind: 'gate' }),
    rect('gate-post-e', 100, 19, 2.5, 3, { label: '老山门', kind: 'gate' }),
    // The summit shelf: S2 sits below the work area; only the gate road and the west lot connect them.
    rect('ledge', 91.6, 22, 0.8, 12, { label: '崖边护栏', kind: 'wall' }),
  ];
  const gates = [rect('old-gate', 92, 19, 8, 3, { label: '老山门', limit: GATE_LIMIT })];
  // A break-over on the tea house road: the low-bed body scrapes here (v0.5 §3.1).
  const breakovers = [rect('tea-breakover', 150, 29.5, 2.5, 9, { label: '坡折 · 低货台会刮底' })];
  // The tea house lane: two stone posts at its mouth, 2.2 m clear. The vans (1.9 m) go in to the door;
  // the main truck (2.3 m) stops short and its load is carried from the stop after the pass (O6, v0.5 §6).
  const narrows = [rect('tea-lane', 156, 30, 4, 8, { label: '茶馆巷口 · 限宽 2.2 m', limit: 2.2 })];
  const pass = {
    // Gusts start where the pass leaves the S2 stop: a truck standing in a stop is never in the wind.
    zone: rect('pass-zone', 110, 44, 8, 52, { label: '垭口阵风段' }),
    shelters: [rect('shelter-1', 110, 81, 8, 9), rect('shelter-2', 110, 63, 8, 11), rect('shelter-3', 110, 49.5, 8, 9)],
    // Fixed rhythm (v0.5 §3.3): calm, a two-second rising whistle, then the gust. One calm-and-whistle
    // window carries a tall load from one windbreak to the next; only a well-timed run-up from the
    // S1 stop clears the whole 52 m in one window, and a late start is caught in the open.
    cycle: { calm: 3, warn: 2, gust: 4 },
  };
  // A rescue returns a truck to the stop of the stretch it last stood in (region): the
  // plaza for anything below the hairpins, S1 below the pass, S2 for the whole summit.
  const stops = [
    { id: 's0', label: '入口停靠点', area: rect('s0-area', 12, 168, 26, 30), pad: 'pad-s0', spawn: { x: 24, y: 175, angle: 0 }, region: ['old-plaza', 'short-mouth'] },
    { id: 's1', label: '垭口前停靠点', area: flats[1], pad: 'pad-s1', spawn: { x: 113, y: 104, angle: -Math.PI / 2 }, region: ['s1', 'pass-mouth'] },
    { id: 's2', label: '垭口后停靠点', area: flats[2], pad: 'pad-s2', spawn: { x: 122, y: 34, angle: Math.PI }, region: ['s2', 'strip', 'lot', 'tea-yard', 'gate-road', 'tea-road'] },
  ];

  const zones = [];
  const stage = (id, x, y, w, h, label, extra = {}) => zones.push(rect(id, x, y, w, h, { label, ...extra }));
  if (mission === 'b3') {
    stage('garage', 36, 186, 20, 11, '车库门口 · 公司的五件东西', { kind: 'staging' });
    stage('station-target', 63.5, 1, 21, 4.5, '新址', { kind: 'target', accepts: 'station' });
    stage('shed-target', 92, 200, 30, 10, '冬棚', { kind: 'target', accepts: 'shed' });
    // The summer layout stays where the players left it; the front positions still count as stalls.
    stage('ws-front-a', 68, 6, 12, 7.5, '前侧摊位 · 靠气象站一侧', { kind: 'stall', stall: 'lantern', front: 'a', apron: rect('apron-a', 68, 6, 12, 7.5) });
    stage('ws-front-b', 52, 6, 12, 7.5, '前侧摊位 · 靠观景台一侧', { kind: 'stall', stall: 'lantern', front: 'b', apron: rect('apron-b', 52, 6, 12, 7.5) });
  } else if (mission === 'o6') {
    stage('woodshop', 86, 184, 34, 13, '木器行门口', { kind: 'staging' });
    for (let i = 0; i < 6; i++) stage(`spot-${i + 1}`, 168 + (i % 3) * 5, 6 + Math.floor(i / 3) * 5.5, 2.6, 2.6, `方桌 ${i + 1}`, { kind: 'target', accepts: 'square' });
    stage('spot-cabinet', 190, 5, 3.2, 2.4, '高茶柜（立放）', { kind: 'target', accepts: 'cabinet' });
  } else {
    stage('west-dock', 36, 187, 18, 10, '西装货口', { kind: 'staging' });
    stage('east-dock', 86, 187, 22, 10, '东装货口', { kind: 'staging' });
    stage('table-store', 60, 188, 16, 9, '旧址台库', { kind: 'staging' });
    // A front stall counts only on the station side of the strip, and keeps that half (its customer
    // space) clear of vehicles; the south side of the strip stays a 4.5 m lane, so nothing is trapped.
    stage('ws-front-a', 68, 6, 12, 7.5, '前侧摊位 · 靠气象站一侧', { kind: 'workface', stall: 'lantern', front: 'a', apron: rect('apron-a', 68, 6, 12, 7.5) });
    stage('ws-front-b', 52, 6, 12, 7.5, '前侧摊位 · 靠观景台一侧', { kind: 'workface', stall: 'lantern', front: 'b', apron: rect('apron-b', 52, 6, 12, 7.5) });
    stage('ws-sweet', 66, 20, 10, 6, '糖水摊工作面', { kind: 'workface', stall: 'sweet' });
    stage('ws-grill', 52, 20, 10, 6, '烤串摊工作面', { kind: 'workface', stall: 'grill' });
    stage('ws-public', 80, 20, 10, 6, '公共服务面', { kind: 'workface', stall: 'public' });
    stage('frame-sweet', 66, 27, 10, 4, '糖水摊棚架位', { kind: 'frame', stall: 'sweet' });
    stage('frame-grill', 52, 27, 10, 4, '烤串摊棚架位', { kind: 'frame', stall: 'grill' });
  }

  const labels = [
    { x: 34, y: 146, text: '盘山短路 · 两个发夹弯' }, { x: 214, y: 140, text: '环山长路 · 弯缓路长', vertical: true },
    { x: 100, y: 68, text: '垭口 · 阵风', vertical: true }, { x: 76, y: mission === 'b3' ? -1.2 : 3, text: mission === 'b3' ? '旧气象站 · 公司新址' : '旧气象站' },
    { x: 68, y: 46, text: '西坪 · 不限高' }, { x: 85, y: 30.6, text: '小院 · 院门 1.4 m' }, { x: 158, y: 27.2, text: '茶馆巷口 · 限宽 2.2 m' }, { x: 183, y: 0.8, text: '山顶茶馆' }, { x: mission === 'b3' ? 57 : 74, y: 205, text: '旧夜市棚' },
    ...(mission === 'b3' ? [{ x: 107, y: 205, text: '冬棚 · 只有一扇门' }, { x: 54, y: 3.4, text: '后门步道' }] : []),
  ];
  return {
    mission, bounds: { width: 240, height: 212 }, roads, flats, aprons, walkAreas, steps, obstacles, gates, breakovers, narrows, pass, stops, zones, labels,
    curves: roads.flatMap(r => r.curves),
    spawns: {
      main: { x: 26, y: 176, angle: 0 },
      vans: [{ x: 24, y: 185, angle: 0 }, { x: 24, y: 192, angle: 0 }, { x: 34, y: 192, angle: 0 }],
      players: [{ x: 33, y: 180 }, { x: 33, y: 183 }, { x: 36, y: 180 }, { x: 36, y: 183 }],
    },
  };
}
