import test from 'node:test';
import assert from 'node:assert/strict';

import {
  estimate1RM, toKg, fromKg, bestSet, buildSeries, isPersonalRecord,
  markPRs, suggestProgression, totalVolume, formatDuration, roundToIncrement, recordScore
} from '../js/progression.js';

const set = (dateISO, weight, reps, unit = 'kg', order = 0) => ({ dateISO, weight, reps, unit, order });
const hold = (dateISO, holdSeconds, side = null, order = 0) => ({ dateISO, weight: 0, reps: 0, unit: 'kg', holdSeconds, side, order });

test('unit conversion round-trips', () => {
  assert.ok(Math.abs(toKg(100, 'lb') - 45.359) < 0.01);
  assert.ok(Math.abs(fromKg(toKg(225, 'lb'), 'lb') - 225) < 1e-9);
  assert.equal(toKg(100, 'kg'), 100);
});

test('Epley 1RM: a single is its own max, higher reps estimate higher', () => {
  assert.equal(estimate1RM(100, 1), 100);
  assert.ok(Math.abs(estimate1RM(100, 5) - 116.667) < 0.01);
  assert.ok(estimate1RM(100, 10) > estimate1RM(100, 5));
  assert.equal(estimate1RM(0, 5), 0);
  assert.equal(estimate1RM(100, 0), 0);
});

test('best set is the hardest by estimated 1RM, not merely the heaviest', () => {
  const best = bestSet([set('2026-01-01', 100, 1), set('2026-01-01', 90, 8)]);
  assert.equal(best.weight, 90);   // 90x8 estimates ~114 kg vs 100
});

test('series collapses to one point per session date, oldest first', () => {
  const series = buildSeries([
    set('2026-01-08', 105, 5),
    set('2026-01-01', 100, 5),
    set('2026-01-01', 95, 5)
  ]);
  assert.deepEqual(series.map((p) => p.dateISO), ['2026-01-01', '2026-01-08']);
  assert.equal(series[0].topWeight, 100);
  assert.equal(series[0].sets, 2);
});

test('PRs are flagged on the first session that beats the running best', () => {
  const series = buildSeries([
    set('2026-01-01', 100, 5),
    set('2026-01-08', 100, 5),
    set('2026-01-15', 105, 5)
  ]);
  assert.deepEqual(series.map((p) => p.isPR), [true, false, true]);
});

test('mixed-unit histories compare on a common scale', () => {
  // 225 lb = 102.06 kg, so the second session beats 100 kg despite the unit change.
  const series = buildSeries([set('2026-01-01', 100, 5, 'kg'), set('2026-01-08', 225, 5, 'lb')]);
  assert.deepEqual(series.map((p) => p.isPR), [true, true]);
  assert.ok(series[1].e1rmKg > series[0].e1rmKg);

  // 215 lb = 97.5 kg — not a record.
  const flat = buildSeries([set('2026-01-01', 100, 5, 'kg'), set('2026-01-08', 215, 5, 'lb')]);
  assert.deepEqual(flat.map((p) => p.isPR), [true, false]);
});

test('isPersonalRecord compares against history only', () => {
  const history = [set('2026-01-01', 100, 5)];
  assert.equal(isPersonalRecord({ weight: 105, reps: 5, unit: 'kg' }, history), true);
  assert.equal(isPersonalRecord({ weight: 100, reps: 5, unit: 'kg' }, history), false);
  assert.equal(isPersonalRecord({ weight: 100, reps: 5, unit: 'kg' }, []), true);
});

test('markPRs recomputes flags chronologically after an edit or import', () => {
  const marked = markPRs([
    set('2026-01-15', 105, 5),
    set('2026-01-01', 100, 5),
    set('2026-01-08', 90, 5)
  ]);
  assert.deepEqual(marked.map((s) => [s.dateISO, s.isPR]), [
    ['2026-01-01', true],
    ['2026-01-08', false],
    ['2026-01-15', true]
  ]);
});

test('the nudge fires only after the same top set is repeated', () => {
  const once = suggestProgression([set('2026-01-01', 100, 5), set('2026-01-08', 95, 5)]);
  assert.equal(once, null);

  const twice = suggestProgression([set('2026-01-01', 100, 5), set('2026-01-08', 100, 5)]);
  assert.ok(twice);
  assert.equal(twice.suggestedWeight, 102.5);
  assert.match(twice.message, /100 kg × 5 twice — try 102\.5 kg/);
});

test('the nudge stays quiet with a single session', () => {
  assert.equal(suggestProgression([set('2026-01-01', 100, 5)]), null);
  assert.equal(suggestProgression([]), null);
});

test('the nudge uses pound increments when the user works in pounds', () => {
  const s = suggestProgression(
    [set('2026-01-01', 225, 5, 'lb'), set('2026-01-08', 225, 5, 'lb')],
    { unit: 'lb' }
  );
  assert.ok(s);
  assert.equal(s.unit, 'lb');
  assert.equal(s.suggestedWeight, 230);
});

test('increments round to real plate jumps', () => {
  assert.equal(roundToIncrement(101.3, 'kg'), 101.25);
  assert.equal(roundToIncrement(228.7, 'lb'), 230);
});

test('volume totals in the display unit', () => {
  assert.equal(totalVolume([set('2026-01-01', 100, 5), set('2026-01-01', 50, 10)]), 1000);
});

test('durations format as mm:ss and h:mm:ss', () => {
  assert.equal(formatDuration(0), '00:00');
  assert.equal(formatDuration(65), '01:05');
  assert.equal(formatDuration(3725), '1:02:05');
});

/* ---------- hold-mode scoring: yoga, pilates, timed calisthenics ---------- */

test('recordScore scores a hold by its duration and a reps set by estimated 1RM', () => {
  assert.equal(recordScore(hold('2026-01-01', 60)), 60);
  assert.equal(recordScore(set('2026-01-01', 100, 1)), 100);
  assert.equal(recordScore(set('2026-01-01', 0, 0)), 0);
  assert.equal(recordScore(null), 0);
});

test('bestSet picks the longest hold, not merely the first one logged', () => {
  const best = bestSet([hold('2026-01-01', 30), hold('2026-01-01', 45), hold('2026-01-01', 20)]);
  assert.equal(best.holdSeconds, 45);
});

test('a hold series is one point per day, with holdSeconds carried through and PRs flagged', () => {
  const series = buildSeries([
    hold('2026-01-01', 30),
    hold('2026-01-08', 45),
    hold('2026-01-08', 40),
    hold('2026-01-15', 35)
  ]);
  assert.deepEqual(series.map((p) => p.dateISO), ['2026-01-01', '2026-01-08', '2026-01-15']);
  assert.deepEqual(series.map((p) => p.holdSeconds), [30, 45, 35]);
  assert.deepEqual(series.map((p) => p.isPR), [true, true, false]);
});

test('isPersonalRecord compares holds against hold history, on duration', () => {
  const history = [hold('2026-01-01', 30)];
  assert.equal(isPersonalRecord(hold('2026-01-08', 45), history), true);
  assert.equal(isPersonalRecord(hold('2026-01-08', 30), history), false);
  assert.equal(isPersonalRecord(hold('2026-01-08', 20), history), false);
});

test('markPRs works on a hold history the same way it works on a weight history', () => {
  const marked = markPRs([hold('2026-01-15', 40), hold('2026-01-01', 30), hold('2026-01-08', 50)]);
  assert.deepEqual(marked.map((s) => [s.dateISO, s.isPR]), [
    ['2026-01-01', true],
    ['2026-01-08', true],
    ['2026-01-15', false]
  ]);
});

test('the weight-progression nudge stays silent for a hold-mode series', () => {
  assert.equal(suggestProgression([hold('2026-01-01', 30), hold('2026-01-08', 30)]), null);
});

test('a hold contributes nothing to weight×reps volume', () => {
  assert.equal(totalVolume([hold('2026-01-01', 60), set('2026-01-01', 50, 10)]), 500);
});

test('warm-up sets count toward nothing: no PR, no top set, no volume, no nudge', async () => {
  const { recordScore, bestSet, buildSeries, totalVolume, suggestProgression, isPersonalRecord } = await import('../js/progression.js');
  const warm = { dateISO: '2026-01-02', order: 0, weight: 200, unit: 'kg', reps: 10, isWarmup: true };
  const work = { dateISO: '2026-01-02', order: 1, weight: 100, unit: 'kg', reps: 5 };
  assert.equal(recordScore(warm), 0);
  assert.equal(isPersonalRecord(warm, []), false, 'a heavy warm-up is not a PR');
  assert.equal(bestSet([warm, work]), work);
  assert.equal(totalVolume([warm, work]), 500);
  assert.equal(buildSeries([warm, work])[0].topWeight, 100);
  assert.deepEqual(buildSeries([warm]), [], 'a warm-up-only day is not a point on the chart');
  const day = (d) => [{ ...warm, dateISO: d }, { ...work, dateISO: d }];
  assert.ok(suggestProgression([...day('2026-01-01'), ...day('2026-01-08')]), 'working sets still nudge');
  assert.equal(suggestProgression([{ ...warm, dateISO: '2026-01-01' }, { ...warm, dateISO: '2026-01-08' }]), null);
});
