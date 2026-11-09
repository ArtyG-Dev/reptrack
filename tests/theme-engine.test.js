import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  intensity, approach, rotationSpeed, ROTATION, haloStages,
  createFlashLimiter, maxInWindow, FLASH,
  createBoltTrack, updateBoltTrack, LIGHTNING_TRACKS, boltBranches
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
