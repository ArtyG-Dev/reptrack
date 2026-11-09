import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  intensity, approach, rotationSpeed, ROTATION, haloStages,
  createFlashLimiter, maxInWindow, FLASH,
  createBoltTrack, updateBoltTrack, LIGHTNING_TRACKS, boltBranches,
  createOrbit, orbitGrab, orbitDrag, orbitRelease, orbitSettle,
  PLATE_TABLE, PLATE_SIZES, SLEEVE, PLATE_MOTION, platesForLevel, plateLayout,
  createPlateRack, setRackTarget, stepRack, rackPlates, rackSettled, snapRack
} from '../js/theme-engine.js';

/** Deterministic PRNG so a failure reproduces. */
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

test('intensity is 0.6 × streak/10 + 0.4 × month, clamped to 0..1', () => {
  assert.equal(intensity({ streakLevel: 0, monthPercent: 0 }), 0);
  assert.equal(intensity({ streakLevel: 10, monthPercent: 1 }), 1);
  assert.ok(Math.abs(intensity({ streakLevel: 10, monthPercent: 0 }) - 0.6) < 1e-9);
  assert.ok(Math.abs(intensity({ streakLevel: 0, monthPercent: 1 }) - 0.4) < 1e-9);
  assert.ok(Math.abs(intensity({ streakLevel: 5, monthPercent: 0.5 }) - 0.5) < 1e-9);
  assert.equal(intensity({ streakLevel: 99, monthPercent: 7 }), 1);
  assert.equal(intensity({ streakLevel: -3, monthPercent: Number.NaN }), 0);
  assert.equal(intensity(), 0);
});

test('each metric moves intensity on its own — neither is drowned by the other', () => {
  const base = intensity({ streakLevel: 3, monthPercent: 0.3 });
  assert.ok(intensity({ streakLevel: 4, monthPercent: 0.3 }) > base);
  assert.ok(intensity({ streakLevel: 3, monthPercent: 0.4 }) > base);
});

test('approach glides toward the target without overshooting, independent of frame rate', () => {
  let a = 0;
  let b = 0;
  for (let i = 0; i < 30; i += 1) a = approach(a, 1, 1 / 30);
  for (let i = 0; i < 60; i += 1) b = approach(b, 1, 1 / 60);
  assert.ok(a > 0 && a < 1);
  assert.ok(Math.abs(a - b) < 1e-9, 'one second at 30fps and at 60fps must land in the same place');
  assert.equal(approach(0.4, 1, 0), 0.4);
});

test('auto-rotation never exceeds one revolution per 8 seconds', () => {
  for (let k = -1; k <= 2; k += 0.01) assert.ok(rotationSpeed(k) <= ROTATION.maxRadPerS + 1e-12);
  assert.ok(Math.abs(ROTATION.maxRadPerS - (2 * Math.PI) / 8) < 1e-12);
  assert.ok(rotationSpeed(1) > rotationSpeed(0.5) && rotationSpeed(0.5) > rotationSpeed(0));
  assert.ok(rotationSpeed(0) > 0, 'it still turns slowly at zero intensity');
});

test('halo stages ease in at 25 / 50 / 90 % rather than snapping', () => {
  assert.equal(haloStages(0).presence, 0);
  assert.ok(haloStages(0.25).presence > 0.3);
  assert.ok(Math.abs(haloStages(0.24).presence - haloStages(0.25).presence) < 0.15, 'crossing 25% is a fade');
  assert.equal(haloStages(0.3).brighten, 0);
  assert.ok(haloStages(0.6).brighten > 0.99);
  assert.equal(haloStages(0.8).strike, 0);
  assert.equal(haloStages(1).strike, 1);
});

test('the flash limiter is a sliding window: never four grants inside any 1 s span', () => {
  const limiter = createFlashLimiter();
  const granted = [];
  // Hammer it: a request every 10 ms for 10 s.
  for (let t = 0; t <= 10_000; t += 10) if (limiter.request(t)) granted.push(t);
  assert.ok(maxInWindow(granted) <= FLASH.maxFlashes, `got ${maxInWindow(granted)} in one window`);
  assert.ok(granted.length >= 27, 'it should still allow up to the cap — this is a limiter, not a ban');
  // The bucket-boundary trap: three just before a second ticks over and three just after.
  const trap = createFlashLimiter();
  const t2 = [];
  for (const t of [900, 920, 940, 1100, 1120, 1140]) if (trap.request(t)) t2.push(t);
  assert.deepEqual(t2, [900, 920, 940], 'a per-second bucket would have allowed six here');
});

test('maxInWindow counts the worst one-second window', () => {
  assert.equal(maxInWindow([]), 0);
  assert.equal(maxInWindow([0, 999, 1000]), 2);
  assert.equal(maxInWindow([0, 300, 600, 900]), 4);
});

for (const [theme, tracks] of Object.entries(LIGHTNING_TRACKS)) {
  for (const fps of [30, 60]) {
    test(`${theme}: 10 s at maximum intensity (${fps} fps) stays within ${FLASH.maxFlashes} flashes per second`, () => {
      const limiter = createFlashLimiter();
      const rand = rng(fps + tracks.length);
      const bolts = tracks.map(() => createBoltTrack());
      const strikes = [];
      for (let frame = 0; frame <= 10 * fps; frame += 1) {
        const t = frame / fps;
        for (const track of bolts) if (updateBoltTrack(track, t, 1, limiter, rand)) strikes.push(t * 1000);
      }
      assert.ok(maxInWindow(strikes) <= FLASH.maxFlashes, `${theme}: ${maxInWindow(strikes)} flashes in one second`);
      if (tracks.length) assert.ok(strikes.length > 5, `${theme}: lightning should actually be frequent at max (${strikes.length})`);
      else assert.equal(strikes.length, 0);
    });
  }
}

test('more intensity means more strikes and more branches, never a faster cap', () => {
  const count = (level) => {
    const limiter = createFlashLimiter();
    const rand = rng(7);
    const tracks = [createBoltTrack(), createBoltTrack()];
    let n = 0;
    for (let f = 0; f <= 60 * 30; f += 1) for (const tr of tracks) if (updateBoltTrack(tr, f / 30, level, limiter, rand)) n += 1;
    return n;
  };
  assert.ok(count(1) > count(0.5) && count(0.5) > count(0));
  assert.ok(boltBranches(1) > boltBranches(0.5) && boltBranches(0.5) >= boltBranches(0));
});

test('lightning responds when intensity jumps — a slow booking is pulled in', () => {
  const limiter = createFlashLimiter();
  const track = createBoltTrack();
  const hi = () => 0.999;                       // longest possible gap at whatever level
  updateBoltTrack(track, 0, 0, limiter, hi);    // booked at level 0: up to ~5 s away
  let struckAt = null;
  for (let f = 1; f <= 30 * 10 && struckAt === null; f += 1) {
    if (updateBoltTrack(track, f / 30, 1, limiter, hi)) struckAt = f / 30;
  }
  assert.ok(struckAt !== null && struckAt <= 1.2 * 1.3 + 0.05, `first strike at max intensity came at ${struckAt}s`);
});

/* ---------- drag-to-rotate ---------- */

test('drag turns about both axes; release eases back the short way; nothing moves while held', () => {
  const o = createOrbit();
  orbitGrab(o);
  orbitDrag(o, 100, -50);
  assert.ok(o.yaw > 1 && o.pitch < -0.5, 'horizontal → yaw, vertical → pitch');
  const held = { ...o };
  orbitSettle(o, 1);
  assert.deepEqual({ ...o }, held, 'no easing while the finger is down');

  orbitDrag(o, 400, 0);                      // well past a half turn
  orbitRelease(o);
  assert.ok(Math.abs(o.yaw) <= Math.PI && Math.abs(o.pitch) <= Math.PI, 'folded into (−π, π] so it eases back the short way');
  let last = Math.hypot(o.yaw, o.pitch);
  for (let i = 0; i < 60; i += 1) {
    orbitSettle(o, 1 / 30);
    const now = Math.hypot(o.yaw, o.pitch);
    assert.ok(now <= last + 1e-12, 'eases monotonically, never overshoots');
    last = now;
  }
  assert.ok(last < 0.05, `back to the scene's own rotation after 2 s (left ${last})`);
});

/* ---------- Forge plates ---------- */

test('the plate table is exactly the brief\'s, inner → outer, per side', () => {
  const expected = [
    [], ['small'], ['medium'], ['large'], ['large', 'small'], ['large', 'medium'],
    ['large', 'large'], ['large', 'large', 'medium'], ['large', 'large', 'large'],
    ['large', 'large', 'large', 'medium'], ['large', 'large', 'large', 'large']
  ];
  assert.deepEqual(PLATE_TABLE.map((r) => [...r]), expected);
  assert.deepEqual(platesForLevel(-2), []);
  assert.deepEqual(platesForLevel(42), expected[10]);
  assert.deepEqual(platesForLevel(6.4), expected[6]);
});

test('every level fits the sleeve, and level 10 just fills it', () => {
  for (let level = 0; level <= 10; level += 1) {
    const layout = plateLayout(platesForLevel(level));
    for (let i = 1; i < layout.length; i += 1) assert.ok(layout[i].x0 >= layout[i - 1].x1, `level ${level}: plates overlap`);
    if (layout.length) assert.ok(layout.at(-1).x1 <= SLEEVE.end, `level ${level} runs past the end collar`);
  }
  const full = plateLayout(platesForLevel(10)).at(-1).x1;
  assert.ok(SLEEVE.end - full < 0.01, `level 10 should just fill the sleeve (${(SLEEVE.end - full).toFixed(3)} spare)`);
});

test('competition colours by size: red, blue, green', () => {
  assert.deepEqual([PLATE_SIZES.large.token, PLATE_SIZES.medium.token, PLATE_SIZES.small.token], ['plateRed', 'plateBlue', 'plateGreen']);
  assert.ok(PLATE_SIZES.large.radius > PLATE_SIZES.medium.radius && PLATE_SIZES.medium.radius > PLATE_SIZES.small.radius);
});

/** Run a rack to completion, recording each move. */
function runRack(rack, seconds = 10) {
  const moves = [];
  for (let f = 0; f < seconds * 60; f += 1) {
    stepRack(rack, 1 / 60);
    const m = rack.moving;
    if (m && (!moves.length || moves.at(-1).t > m.t || moves.at(-1).size !== m.size)) moves.push({ ...m });
    else if (m) moves.at(-1).t = m.t;
    if (rackSettled(rack)) break;
  }
  return moves;
}

test('a level-up slides plates on one at a time; a swap takes the old plate off first', () => {
  const rack = createPlateRack(platesForLevel(2));          // one medium
  setRackTarget(rack, platesForLevel(5));                    // large + medium
  const moves = runRack(rack);
  assert.deepEqual(moves.map((m) => `${m.dir} ${m.size}`), ['off medium', 'on large', 'on medium']);
  assert.ok(rackSettled(rack));
  assert.deepEqual(rack.seated, ['large', 'medium']);
});

test('a plate going on slides in from the sleeve end and seats, in about 0.6 s', () => {
  const rack = createPlateRack([]);
  setRackTarget(rack, ['small']);
  stepRack(rack, 0);                                         // starts the move
  const start = rackPlates(rack).at(-1);
  const seat = plateLayout(['small'])[0];
  assert.ok(start.x0 > SLEEVE.end, 'it starts beyond the end of the sleeve');
  let mid = null;
  for (let f = 0; f < 18; f += 1) { stepRack(rack, 1 / 60); mid = rackPlates(rack).at(-1); }
  assert.ok(mid.x0 < start.x0 && mid.x0 > seat.x0, 'part-way along the sleeve after 0.3 s');
  for (let f = 0; f < 30; f += 1) stepRack(rack, 1 / 60);
  assert.ok(rackSettled(rack), `seated within ${PLATE_MOTION.onSeconds + 0.2} s`);
  assert.equal(rackPlates(rack).at(-1).x0, seat.x0);
});

test('a level easing down slides the outer plate off gently and fades it — never a jump', () => {
  const rack = createPlateRack(platesForLevel(4));           // large + small
  setRackTarget(rack, platesForLevel(3));
  stepRack(rack, 0);
  let lastAlpha = 1;
  let lastX = -Infinity;
  while (rack.moving) {
    const p = rackPlates(rack).at(-1);
    assert.equal(p.size, 'small');
    assert.ok(p.alpha <= lastAlpha + 1e-12 && p.x0 >= lastX, 'fades and moves outward steadily');
    assert.ok(lastAlpha - p.alpha < 0.05, 'no sudden drop in a single frame');
    lastAlpha = p.alpha;
    lastX = p.x0;
    stepRack(rack, 1 / 60);
  }
  assert.deepEqual(rack.seated, ['large']);
});

test('snapRack puts the right plates in place at once (reduced motion)', () => {
  const rack = createPlateRack([]);
  setRackTarget(rack, platesForLevel(9));
  snapRack(rack);
  assert.ok(rackSettled(rack));
  assert.ok(rackPlates(rack).every((p) => p.alpha === 1 && !p.moving));
});

test('terminal glyph mirroring: about half, and fixed for each glyph\'s life', async () => {
  const { mirrorFlag } = await import('../js/backdrop-gl.js');
  let mirrored = 0;
  let total = 0;
  for (let seed = 0.5; seed < 72; seed += 1) {
    for (let trail = 0; trail < 14; trail += 1) {
      for (let life = 0; life < 20; life += 1) { mirrored += mirrorFlag(seed, trail, life); total += 1; }
    }
  }
  const share = mirrored / total;
  assert.ok(share > 0.45 && share < 0.55, `about half mirrored (${(share * 100).toFixed(1)}%)`);
  // Its only inputs are column, slot and the glyph's lifetime key — no frame time — so it cannot flip mid-life.
  assert.equal(mirrorFlag.length, 3);
  assert.equal(mirrorFlag(3.5, 2, 7), mirrorFlag(3.5, 2, 7));
});
