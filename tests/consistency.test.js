/* The consistency score and, more importantly, the frost gating — the rules
 * that decide whether the app ever shows someone a cold visual. Most of these
 * tests exist to prove a *kindness* constraint holds, not just that maths works.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONSISTENCY, trainingDays, daysBetween, shiftDays, baselineTarget,
  consistencyScore, hasEstablishedRun, frostState, frostedDates, activityVisualState
} from '../js/consistency.js';

const TODAY = '2026-06-15';
const ago = (n, from = TODAY) => shiftDays(from, -n);

/** Sessions every `every` days, going back `spanDays` from `endISO`. */
function history({ every = 2, spanDays = 120, endISO = TODAY, skip = [] } = {}) {
  const days = [];
  for (let i = 0; i <= spanDays; i += every) {
    const d = shiftDays(endISO, -i);
    if (!skip.includes(d)) days.push(d);
  }
  return days.sort();
}

const sessionsFrom = (days) => days.map((dateISO, i) => ({ id: `s${i}`, dateISO }));

/* ---------- primitives ---------- */

test('training days merge sessions and runs, dedupe, and sort', () => {
  const days = trainingDays({
    sessions: [{ dateISO: '2026-06-10' }, { dateISO: '2026-06-08' }, { dateISO: '2026-06-10' }],
    runs: [{ dateISO: '2026-06-09' }, { dateISO: '2026-06-08' }]
  });
  assert.deepEqual(days, ['2026-06-08', '2026-06-09', '2026-06-10']);
});

test('date arithmetic is whole-day and direction-aware', () => {
  assert.equal(daysBetween('2026-06-01', '2026-06-15'), 14);
  assert.equal(daysBetween('2026-06-15', '2026-06-01'), -14);
  assert.equal(daysBetween('2026-06-15', '2026-06-15'), 0);
  assert.equal(shiftDays('2026-03-01', -1), '2026-02-28');
});

test('date arithmetic survives a DST boundary', () => {
  // UK clocks go forward 2026-03-29; a 23-hour day must still count as one day.
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
  assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2);
});

/* ---------- baseline + score ---------- */

test('a new user is measured against a modest default, not a stranger\'s baseline', () => {
  const days = [ago(1), ago(3), ago(5)];
  const base = baselineTarget(days, TODAY);
  assert.equal(base.established, false);
  assert.equal(base.target, CONSISTENCY.defaultTargetDays);
});

test('an established user is measured against their own rate, capped both ends', () => {
  const heavy = baselineTarget(history({ every: 1, spanDays: 120 }), TODAY);
  assert.equal(heavy.established, true);
  assert.equal(heavy.target, CONSISTENCY.maxTargetDays, 'a daily trainer is not asked for more than the cap');

  const light = baselineTarget(history({ every: 21, spanDays: 200 }), TODAY);
  assert.equal(light.established, true);
  assert.equal(light.target, CONSISTENCY.minTargetDays, 'a rare trainer is still asked for the floor');
});

test('score and glow stay inside 0..1 for empty, sparse and relentless histories', () => {
  for (const days of [[], history({ every: 30 }), history({ every: 1 })]) {
    const { score, glow } = consistencyScore({ days, todayISO: TODAY });
    assert.ok(score >= 0 && score <= 1, `score ${score} out of range`);
    assert.ok(glow >= 0 && glow <= 1, `glow ${glow} out of range`);
  }
});

test('consistent training reads as hot; a long silence reads as cold', () => {
  const consistent = consistencyScore({ days: history({ every: 2 }), todayISO: TODAY });
  assert.equal(consistent.score, 1);

  const silent = consistencyScore({ days: history({ every: 2, spanDays: 120, endISO: ago(90) }), todayISO: TODAY });
  assert.equal(silent.score, 0);
});

test('dropping a single session is barely perceptible — the core kindness constraint', () => {
  const full = history({ every: 2, spanDays: 120 });
  const dropped = full.filter((d) => d !== ago(2));

  const before = consistencyScore({ days: full, todayISO: TODAY }).glow;
  const after = consistencyScore({ days: dropped, todayISO: TODAY }).glow;

  assert.ok(after <= before);
  assert.ok(before - after < 0.15, `one missed session dimmed the glow by ${(before - after).toFixed(3)} — too punishing`);
});

test('the glow curve compresses the top of the range, so falling off starts gently', () => {
  const at = (score) => score ** CONSISTENCY.glowCurve;
  assert.ok(at(1) - at(0.85) < at(0.35) - at(0.2), 'a drop near "hot" must move less than the same drop near "cold"');
});

/* ---------- frost gating ---------- */

test('a brand-new user is never frosted, however long the gap', () => {
  // Trained a handful of times, then vanished — but the app has only known them 20 days.
  const days = [ago(20), ago(18), ago(16)];
  const frost = frostState({ days, todayISO: TODAY });
  assert.equal(frost.eligible, false);
  assert.equal(frost.active, false);
  assert.equal(frost.reason, 'new-user');
  assert.equal(frostedDates({ days, todayISO: TODAY }).size, 0);
});

test('someone with long history but no consistent run is never frosted', () => {
  const days = [ago(200), ago(150), ago(90), ago(40)];   // never 3 sessions inside 14 days
  assert.equal(hasEstablishedRun(days), false);
  const frost = frostState({ days, todayISO: TODAY });
  assert.equal(frost.active, false);
  assert.equal(frost.reason, 'no-established-run');
});

test('a short gap after real consistency is not a lapse', () => {
  const days = history({ every: 2, spanDays: 120, endISO: ago(5) });
  const frost = frostState({ days, todayISO: TODAY });
  assert.equal(frost.eligible, true);
  assert.equal(frost.active, false, 'five days off must not frost anything');
  assert.equal(frost.reason, 'recent-activity');
});

test('a lapsed veteran may show frost', () => {
  const days = history({ every: 2, spanDays: 120, endISO: ago(30) });
  const frost = frostState({ days, todayISO: TODAY });
  assert.equal(frost.eligible, true);
  assert.equal(frost.active, true);
  assert.equal(frost.gapDays, 30);
});

test('frost caps: a 21-day gap and a 200-day gap look identical', () => {
  const at = (gap) => frostedDates({
    days: history({ every: 2, spanDays: 200, endISO: ago(gap) }),
    todayISO: TODAY
  });

  const capped = at(CONSISTENCY.frostCapDays);
  const enormous = at(200);
  assert.equal(capped.size, enormous.size, 'a longer absence must not spread further');
  assert.equal(enormous.size, CONSISTENCY.frostCapDays);

  // …and the depth cap: the state carries no intensity beyond "active".
  assert.equal(frostState({ days: history({ every: 2, spanDays: 200, endISO: ago(200) }), todayISO: TODAY }).active, true);
});

test('frost covers only the current gap, and never a day that was trained', () => {
  const days = history({ every: 2, spanDays: 120, endISO: ago(30) });
  const frosted = frostedDates({ days, todayISO: TODAY });

  assert.ok(frosted.has(TODAY));
  assert.ok(frosted.has(ago(10)));
  assert.ok(!frosted.has(ago(30)), 'the last trained day stays warm');
  for (const d of days) assert.ok(!frosted.has(d), `${d} was trained and must not be frosted`);
});

test('an old gap in the middle of history is never re-litigated', () => {
  // A three-month hole last year, but training again recently.
  const days = [...history({ every: 2, spanDays: 40, endISO: ago(120) }), ...history({ every: 2, spanDays: 20 })];
  const frosted = frostedDates({ days, todayISO: TODAY });
  assert.equal(frosted.size, 0, 'past gaps must not haunt the calendar');
});

test('logging one comeback session clears every frosted cell', () => {
  const lapsed = history({ every: 2, spanDays: 120, endISO: ago(40) });
  assert.ok(frostedDates({ days: lapsed, todayISO: TODAY }).size > 0);

  const comeback = [...lapsed, TODAY].sort();
  assert.equal(frostedDates({ days: comeback, todayISO: TODAY }).size, 0);
});

/* ---------- the pause ---------- */

test('pausing activity effects stops frost outright', () => {
  const days = history({ every: 2, spanDays: 120, endISO: ago(60) });
  const paused = { days, todayISO: TODAY, pauseActivityEffects: true, activityPausedAt: ago(55) };

  assert.equal(frostState(paused).active, false);
  assert.equal(frostState(paused).reason, 'paused');
  assert.equal(frostedDates(paused).size, 0);
});

test('pausing freezes the glow at the moment it was switched on, without touching history', () => {
  const days = history({ every: 2, spanDays: 120, endISO: ago(40) });
  const pausedAt = ago(38);

  const frozen = consistencyScore({ days, todayISO: TODAY, pauseActivityEffects: true, activityPausedAt: pausedAt });
  const asIfThen = consistencyScore({ days, todayISO: pausedAt });
  assert.equal(frozen.glow, asIfThen.glow, 'the frozen glow is exactly the glow on the pause date');
  assert.equal(frozen.paused, true);

  // Un-pausing resumes from the real clock — the history was never altered.
  const resumed = consistencyScore({ days, todayISO: TODAY });
  assert.ok(resumed.glow < frozen.glow);
  assert.equal(resumed.paused, false);
});

/* ---------- the combined state the skins consume ---------- */

test('the visual state exposes a capped frost hint that never reaches full cold', () => {
  const mild = activityVisualState({ days: history({ every: 2, spanDays: 120, endISO: ago(15) }), todayISO: TODAY });
  const extreme = activityVisualState({ days: history({ every: 2, spanDays: 200, endISO: ago(300) }), todayISO: TODAY });

  assert.ok(mild.frostHint > 0 && mild.frostHint < 1);
  assert.equal(extreme.frostHint, 1, 'the hint caps at 1 and goes no further');
  assert.ok(extreme.glow >= 0);
});

test('a new user gets warmth, not frost, from their very first week', () => {
  const days = [ago(5), ago(3), ago(1)];
  const visual = activityVisualState({ days, todayISO: TODAY });
  assert.ok(visual.glow > 0.5, 'three sessions in a week should read as hot for a newcomer');
  assert.equal(visual.frost.active, false);
  assert.equal(visual.frostHint, 0);
});
