// Integration: scripted crews finish both missions through the real action API.
// They measure hand moves (H), hand-carry metres (M) and trips; they say nothing about fun.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrew } from '../tools/bot.mjs';
import { planA, planC, planP, planO6 } from '../tools/playthrough.mjs';
import { fourPlayerB2 } from '../tools/four.mjs';

test('B2 solo: fold-and-carry (A), groups everywhere (C) and the mixed plan each win on a different count', () => {
  const a = planA(createCrew({ crew: 1 }));
  const c = planC(createCrew({ crew: 1 }));
  const m = planC(createCrew({ crew: 1 }), { mixed: true });
  for (const r of [a, c, m]) { assert.equal(r.complete, true); assert.equal(r.rollovers, 0, 'a careful driver never tips under the signs'); }
  // (H, L, M) per v0.4 §5: no plan wins on all three.
  assert.ok(c.carried < m.carried && m.carried < a.carried, 'groups save hand-carrying');
  assert.ok(c.moves > a.moves, 'but the yard stall must be unpacked at its 1.4 m gate (the O7 condition in B2), so groups everywhere cost moves');
  assert.ok(m.moves < a.moves, 'groups where they fit and the yard stall folded: the fewest moves');
  assert.ok(a.trips < m.trips && a.trips < c.trips, 'one open table per truck costs trips');
  assert.ok(c.farParks >= 1 && a.farParks === 0, 'tall groups miss the old gate and arrive at the west lot');
  assert.ok(c.review.some(l => l.includes('西坪')), 'the review card names what went to the far side');
});

test('B2 solo: partial groups (low goods on the table, tall goods loose) clear the gate and need no partner', () => {
  const a = planA(createCrew({ crew: 1 })), c = planC(createCrew({ crew: 1 }));
  const p = planP(createCrew({ crew: 1 })), duo = planP(createCrew({ crew: 2 }));
  assert.equal(p.complete, true); assert.equal(p.rollovers, 0);
  assert.equal(p.farParks, 0, 'every partial group goes to the near strip');
  assert.ok(p.trips > a.trips && p.trips < c.trips, `between A and C on trips (${a.trips} < ${p.trips} < ${c.trips})`);
  assert.ok(p.carried < a.carried && p.carried > c.carried, 'and between them on hand-carrying');
  assert.ok(p.moves > a.moves, 'the price is moves: the arrangement decides the gate');
  assert.deepEqual([duo.moves, duo.carried], [p.moves, p.carried], 'nothing to lift, so a second person changes no count');
});

test('B2 with two players: lifting groups over the two steps shortens the far-side carry', () => {
  const solo = planC(createCrew({ crew: 1 }));
  const duo = planC(createCrew({ crew: 2 }));
  assert.equal(duo.complete, true);
  assert.ok(duo.liftSteps >= 1);
  assert.ok(duo.carried < solo.carried, `duo ${duo.carried} m vs solo ${solo.carried} m`);
  assert.equal(duo.moves, solo.moves, 'a joint set-down is one move');
});

test('O6 teaching order: a full main truck stops short of the 2.2 m lane and pays in hand-carrying; vans reach the door and pay in trips', () => {
  const full = planO6(createCrew({ crew: 1, mission: 'o6' }));
  const split = planO6(createCrew({ crew: 1, mission: 'o6' }), { plan: 'split' });
  const vans = planO6(createCrew({ crew: 1, mission: 'o6' }), { plan: 'vans' });
  for (const r of [full, split, vans]) {
    assert.equal(r.complete, true); assert.equal(r.rollovers, 0);
    assert.ok(r.review.some(l => l.includes('高茶柜一路立着')), 'the glass-fronted cabinet only travels standing');
  }
  assert.equal(full.trips, 1); assert.equal(full.teaYard, 0, 'the main truck never gets into the lane');
  assert.ok(full.trips < split.trips && split.trips < vans.trips, `trips ${full.trips} < ${split.trips} < ${vans.trips}`);
  assert.ok(vans.carried < split.carried && split.carried < full.carried, `hand-carry ${vans.carried} < ${split.carried} < ${full.carried} m`);
  // The condition that argues against the low-bed body: a break-over before the lane, and less room.
  const low = planO6(createCrew({ crew: 1, mission: 'o6', build: 'lowbed' }));
  assert.equal(low.complete, true);
  assert.equal(low.teaYard, 0, 'the low-bed never reaches the tea yard');
  assert.ok(low.trips > full.trips && low.carried >= full.carried, `low-bed ${low.trips} trips ${low.carried} m vs ${full.trips} trips ${full.carried} m`);
});

test('B2 with four players acting at once: three groups park at the west lot and are lifted up the steps, the yard stall goes folded, no one tips', () => {
  const r = fourPlayerB2();
  assert.equal(r.complete, true);
  assert.equal(r.rollovers, 0);
  assert.equal(r.farParks, 3, 'no stall group clears the gate on a van (v0.5 §7)');
  assert.equal(r.liftSteps, 3);
  assert.ok(r.nearFirst, 'someone is credited with taking the near strip first');
  // The 3.5 m frames only fit the main truck, so its last trip runs alone: record how long.
  const ends = r.actors.map(a => a.finishedAt).sort((a, b) => a - b);
  assert.ok(ends.at(-1) - ends[1] < 300, `tail of the mission with only the main truck: ${Math.round(ends.at(-1) - ends[1])} s`);
});

test('B3 finale solo: clear the stall at the door, company up, night market down into the shed, shelves up', async () => {
  const { planB3 } = await import('../tools/finale.mjs');
  const r = planB3(createCrew({ crew: 1, mission: 'b3' }));
  assert.equal(r.complete, true);
  assert.equal(r.rollovers, 0);
  assert.equal(r.signDoor, 'front', 'with the stall struck first the sign goes through the front door');
  assert.ok(r.review.some(l => l.includes('夏天挡上')), 'the review card remembers whose stall blocked the door');
  assert.ok(r.review.some(l => l.includes('一路亮着')), 'the gift lantern rack rode up lit');
});

test('B3 plan B: leave the stall standing and walk the long sign in by the back door; neither plan wins on every count', async () => {
  const { planB3 } = await import('../tools/finale.mjs');
  const a = planB3(createCrew({ crew: 1, mission: 'b3' }));
  const b = planB3(createCrew({ crew: 1, mission: 'b3' }), { door: 'back' });
  assert.equal(b.complete, true);
  assert.equal(b.signDoor, 'back');
  assert.ok(b.review.some(l => l.includes('后门步道')), 'the review card says the sign went round the back');
  // v0.5 §8.5: if plan B were better in every respect, the front-door conflict would not hold.
  assert.ok(b.carried > a.carried, `the back walkway costs hand-carrying (${b.carried} m vs ${a.carried} m)`);
  assert.ok(b.moves <= a.moves, 'striking the stall first costs moves');
});
