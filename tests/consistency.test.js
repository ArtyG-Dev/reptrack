/* The consistency score and, more importantly, the frost gating — the rules
 * that decide whether the app ever shows someone a cold visual. Most of these
 * tests exist to prove a *kindness* constraint holds, not just that maths works.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONSISTENCY, STREAK, MONTH, trainingDays, daysBetween, shiftDays, baselineTarget,
  consistencyScore, streakState, monthProgress, hasEstablishedRun, frostState, frostedDates, activityVisualState
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

/* ---------- streak level (the progression metric the skins' graphics read) ---------- */

/** `perWeek` sessions a week for `weeks` weeks, ending today, optionally
 *  dropping the most recent `dropRecent` training days — i.e. taking that many
 *  extra rest days on top of the usual pattern. */
function weeklyPattern(perWeek, { weeks = 8, dropRecent = 0 } = {}) {
  const slots = { 7: [0, 1, 2, 3, 4, 5, 6], 5: [0, 1, 3, 4, 6], 4: [0, 2, 4, 6], 3: [0, 2, 4], 2: [0, 3] }[perWeek];
  const offsets = [];
  for (let w = 0; w < weeks; w += 1) for (const s of slots) offsets.push(w * 7 + s);
  offsets.sort((a, b) => a - b);
  return offsets.slice(dropRecent).map((o) => ago(o));
}

test('sustained 4-5 sessions a week reaches the top level — daily training is not required', () => {
  for (const perWeek of [4, 5]) {
    const { level } = streakState({ days: weeklyPattern(perWeek), todayISO: TODAY });
    assert.equal(level, STREAK.levels, `${perWeek}x/week should be able to max the level out`);
  }
  // …and training every single day is not *more* than maximum.
  assert.equal(streakState({ days: weeklyPattern(7), todayISO: TODAY }).level, STREAK.levels);
});

test('a single rest day never resets the level, and does not move it at all at 4-5x/week', () => {
  for (const perWeek of [4, 5, 7]) {
    const before = streakState({ days: weeklyPattern(perWeek), todayISO: TODAY }).level;
    const after = streakState({ days: weeklyPattern(perWeek, { dropRecent: 1 }), todayISO: TODAY }).level;
    assert.equal(after, before, `one extra rest day should be invisible at ${perWeek}x/week`);
  }
});

test('below the target rate a rest day eases the level down by a tier, never to zero', () => {
  // Honest about the limit of the above: at 2-3x/week you sit under the target,
  // so the window count genuinely is what moves. What must never happen is the
  // reset-to-zero a consecutive-day streak would inflict.
  for (const perWeek of [2, 3]) {
    const before = streakState({ days: weeklyPattern(perWeek), todayISO: TODAY }).level;
    const after = streakState({ days: weeklyPattern(perWeek, { dropRecent: 1 }), todayISO: TODAY }).level;
    assert.ok(before - after <= 1, `${perWeek}x/week should lose at most one tier to a rest day`);
    assert.ok(after > 0, 'a rest day must never zero the level');
  }
});

test('the level climbs visibly from the very first session', () => {
  const first = streakState({ days: [ago(0)], todayISO: TODAY });
  assert.ok(first.level >= 1, 'one session must be worth at least one lit tier');

  // …and keeps climbing, so a beginner sees progress rather than a plateau.
  const seen = [0, 1, 2, 3, 4, 6].map((n) => {
    const days = Array.from({ length: n }, (_, i) => ago(i * 2));
    return streakState({ days, todayISO: TODAY }).level;
  });
  assert.equal(seen[0], 0, 'no training at all is level 0');
  for (let i = 1; i < seen.length; i += 1) {
    assert.ok(seen[i] >= seen[i - 1], `level must not go backwards as sessions accumulate: ${seen}`);
  }
  assert.ok(seen.at(-1) > seen[1], 'six sessions should read higher than one');
});

test('the level stays inside 0..10 for empty, sparse and relentless histories', () => {
  for (const days of [[], [ago(400)], history({ every: 1, spanDays: 400 })]) {
    const { level, fraction } = streakState({ days, todayISO: TODAY });
    assert.ok(Number.isInteger(level) && level >= 0 && level <= STREAK.levels, `level out of range: ${level}`);
    assert.ok(fraction >= 0 && fraction <= 1);
  }
});

test('pausing activity effects freezes the level where it was', () => {
  const days = weeklyPattern(5);
  const live = streakState({ days, todayISO: shiftDays(TODAY, 60) });
  const frozen = streakState({
    days,
    todayISO: shiftDays(TODAY, 60),
    pauseActivityEffects: true,
    activityPausedAt: TODAY
  });
  assert.equal(live.level, 0, 'sanity check: two months of silence would otherwise empty it');
  assert.equal(frozen.level, STREAK.levels, 'pausing holds the level at what it was when switched on');
  assert.equal(frozen.paused, true);
});

test('the visual state carries the streak level and its continuous fraction', () => {
  const visual = activityVisualState({ days: weeklyPattern(5), todayISO: TODAY });
  assert.equal(visual.streakLevel, STREAK.levels);
  assert.ok(visual.streakFraction > 0.99);

  const quiet = activityVisualState({ days: [], todayISO: TODAY });
  assert.equal(quiet.streakLevel, 0);
  assert.equal(quiet.streakFraction, 0);
});

/* ---------- month-to-date completion (the second, independent metric) ---------- */

test('a perfect run reads 100% on any date — the denominator is days elapsed, not days in the month', () => {
  // The whole point: measured against the full month, training every day of the
  // first week could only ever reach 7/31 and the effect would stay dark.
  const first7 = Array.from({ length: 7 }, (_, i) => `2026-07-0${i + 1}`);
  const m = monthProgress({ days: first7, todayISO: '2026-07-07' });
  assert.equal(m.percent, 1, 'seven days trained out of seven elapsed is 100%');
  assert.ok(7 / 31 < 0.25, 'sanity check: the naive full-month denominator would have read under 25%');

  // …and it holds on day 1 of a month too.
  assert.equal(monthProgress({ days: ['2026-09-01'], todayISO: '2026-09-01' }).raw, 1);
});

test('partial months read as the right fraction of elapsed days', () => {
  const everyOther = ['2026-07-01', '2026-07-03', '2026-07-05', '2026-07-07', '2026-07-09', '2026-07-11', '2026-07-13'];
  assert.equal(monthProgress({ days: everyOther, todayISO: '2026-07-14' }).raw, 0.5);
  assert.equal(monthProgress({ days: [], todayISO: '2026-07-14' }).raw, 0);
});

test('only this calendar month counts — last month\'s training does not leak in', () => {
  const june = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}`);
  const m = monthProgress({ days: june, todayISO: '2026-07-15' });
  assert.equal(m.raw, 0, 'a perfect June contributes nothing to July');
  assert.equal(m.previousPercent, 1);
});

test('the month boundary fades over a couple of days instead of snapping off', () => {
  const june = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}`);
  const on = (dateISO) => monthProgress({ days: june, todayISO: dateISO }).percent;

  assert.equal(on('2026-06-30'), 1, 'a perfect June ends at 100%');
  const day1 = on('2026-07-01');
  const day2 = on('2026-07-02');
  const day3 = on('2026-07-03');

  assert.ok(day1 > 0 && day1 < 1, `day 1 should be partway down, got ${day1}`);
  assert.ok(day2 < day1, 'day 2 continues the fade');
  assert.equal(day3, 0, 'by day 3 the carry is finished and the new month stands alone');
  assert.equal(MONTH.carryDays, 2);
});

test('pausing activity effects freezes month progress, not just the streak level', () => {
  const june = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}`);
  const live = monthProgress({ days: june, todayISO: '2026-08-20' });
  const frozen = monthProgress({
    days: june, todayISO: '2026-08-20', pauseActivityEffects: true, activityPausedAt: '2026-06-30'
  });
  assert.equal(live.percent, 0, 'sanity check: two months on, August is empty');
  assert.equal(frozen.percent, 1, 'paused, it holds where it stood');
  assert.equal(frozen.paused, true);
});

test('month progress and streak level are genuinely independent', () => {
  // A month of daily training that has only just started: month-to-date is
  // perfect, but the 14-day rolling window has barely filled.
  const shortPerfect = ['2026-07-01', '2026-07-02', '2026-07-03'];
  const early = { days: shortPerfect, todayISO: '2026-07-03' };
  assert.equal(monthProgress(early).percent, 1, 'three of three days is a perfect month so far');
  assert.ok(streakState(early).level < STREAK.levels, 'but the rolling window is not yet full');

  // And the reverse: a strong rolling window landing on the 1st of a new month.
  const runIntoNewMonth = [];
  for (let d = 20; d <= 31; d += 2) runIntoNewMonth.push(`2026-07-${d}`);
  const turnover = { days: runIntoNewMonth, todayISO: '2026-08-01' };
  assert.ok(streakState(turnover).level > 0, 'the streak carries across the boundary');
  assert.ok(monthProgress(turnover).raw === 0, 'while the new month itself starts empty');
});

test('the visual state carries month percent alongside the streak', () => {
  const first7 = Array.from({ length: 7 }, (_, i) => `2026-07-0${i + 1}`);
  const visual = activityVisualState({ days: first7, todayISO: '2026-07-07' });
  assert.equal(visual.monthPercent, 1);
  assert.equal(activityVisualState({ days: [], todayISO: '2026-07-07' }).monthPercent, 0);
});
