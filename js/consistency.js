/* Consistency score and frost gating — the model behind the Forge and Fractal
 * skins' activity-responsive visuals.
 *
 * Pure functions only: no DOM, no storage, no clock of its own (the caller
 * passes `todayISO`). Everything here is unit-tested in tests/consistency.test.js.
 *
 * The design principle this file exists to enforce, from the skins brief:
 * consistency should feel *rewarding*, never make a gap feel *punishing*. Every
 * threshold below is chosen so that building a habit is visible and losing one
 * is barely so. If you change a constant, re-read that sentence first.
 *
 * See CLAUDE.md → "Consistency score" for the prose version.
 */

const DAY_MS = 86_400_000;

export const CONSISTENCY = Object.freeze({
  windowDays: 14,             // the "recent" window
  longWindowDays: 28,         // the damping window, blended in to soften single misses
  recentWeight: 0.6,          // weight of the 14-day rate vs the 28-day rate
  defaultTargetDays: 3,       // ~1.5×/week, used until a personal baseline exists
  minTargetDays: 2,           // never demand less than this…
  maxTargetDays: 6,           // …nor more than ~3×/week, however high the baseline
  glowCurve: 0.7,             // <1 compresses the top of the range: drops near "hot" are gentle
  historyRequiredDays: 21,    // no frost until the app has been in use this long
  establishedRunDays: 3,      // …and a 14-day window with this many training days has happened
  frostStartGapDays: 10,      // frost cannot appear before this much inactivity
  frostCapDays: 21            // frost stops growing here, in depth AND in extent
});

/**
 * The 0..10 progression level the skins' signature graphics read (pyramid
 * tiers, barbell clarity, Mandelbrot resolution).
 *
 * Deliberately NOT a consecutive-day streak. A strict streak resets to zero on
 * one rest day and therefore only ever climbs if you train daily — which
 * quietly rewards overtraining, when adaptation happens during recovery. This
 * is a rolling-window training-day count instead: nothing ever "breaks", and
 * the level only eases down if activity genuinely thins out across the window.
 *
 * `targetDays: 7` (3.5×/week) is what reaches level 10, deliberately set below
 * the 4–5×/week the brief asks to be *capable* of maxing it. That headroom is
 * the mechanism by which a single rest day is invisible rather than a one-tier
 * drop: at 4×/week the blend sits above the target, so losing one session is
 * absorbed by the clamp instead of moving the level. See CLAUDE.md for the
 * worked numbers.
 */
export const STREAK = Object.freeze({
  levels: 10,                 // discrete tiers — countable progress, not a continuous glow
  targetDays: 7,              // training days per 14 that reaches the top level (3.5×/week)
  curve: 0.7                  // same compressive shape as glowCurve: fast early, forgiving late
});

/* ---------- date helpers (local time, DST-safe via rounding) ---------- */

function parseISO(dateISO) {
  const [y, m, d] = String(dateISO).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function toISO(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whole days from `fromISO` to `toDateISO`. Negative if `fromISO` is later. */
export function daysBetween(fromISO, toDateISO) {
  return Math.round((parseISO(toDateISO) - parseISO(fromISO)) / DAY_MS);
}

export function shiftDays(dateISO, delta) {
  const d = parseISO(dateISO);
  d.setDate(d.getDate() + delta);
  return toISO(d);
}

/** Distinct, sorted dates on which anything at all was trained. */
export function trainingDays({ sessions = [], runs = [] } = {}) {
  const dates = [...sessions, ...runs].map((r) => r?.dateISO).filter(Boolean);
  return [...new Set(dates)].sort();
}

function countInWindow(days, endISO, spanDays) {
  return days.filter((d) => {
    const age = daysBetween(d, endISO);
    return age >= 0 && age < spanDays;
  }).length;
}

/**
 * "Pause activity effects" freezes the visuals at the moment it was switched on,
 * by evaluating everything as of that date instead of today. History is never
 * touched — un-pausing simply resumes from the real clock.
 */
export function effectiveToday({ todayISO, pauseActivityEffects = false, activityPausedAt = null }) {
  return pauseActivityEffects && activityPausedAt ? activityPausedAt : todayISO;
}

/* ---------- the score ---------- */

/**
 * The user's own established rate, expressed as training days per 14, measured
 * over everything before the recent window. Falls back to a gentle default
 * until there is enough history to have a personal baseline at all — a new user
 * is compared to a modest target, never to a stranger's.
 * @returns {{target: number, established: boolean, rate: number|null}}
 */
export function baselineTarget(days, todayISO) {
  const { windowDays, defaultTargetDays, minTargetDays, maxTargetDays } = CONSISTENCY;
  if (!days.length) return { target: defaultTargetDays, established: false, rate: null };

  const baselineEnd = shiftDays(todayISO, -windowDays);
  const spanDays = daysBetween(days[0], baselineEnd) + 1;
  if (spanDays < windowDays) return { target: defaultTargetDays, established: false, rate: null };

  const count = days.filter((d) => daysBetween(d, baselineEnd) >= 0).length;
  const rate = (count / spanDays) * windowDays;
  return {
    target: Math.min(Math.max(rate, minTargetDays), maxTargetDays),
    established: true,
    rate
  };
}

/**
 * @returns {{score, glow, recentDays, longDays, target, established, paused, asOf}}
 *   score 0..1 — recent rate against the user's own baseline
 *   glow  0..1 — score through a compressive curve; what the visuals actually use
 */
export function consistencyScore({ sessions = [], runs = [], days, todayISO, pauseActivityEffects = false, activityPausedAt = null }) {
  const list = days || trainingDays({ sessions, runs });
  const asOf = effectiveToday({ todayISO, pauseActivityEffects, activityPausedAt });
  const { windowDays, longWindowDays, recentWeight, glowCurve } = CONSISTENCY;

  const recentDays = countInWindow(list, asOf, windowDays);
  const longDays = countInWindow(list, asOf, longWindowDays);
  const { target, established } = baselineTarget(list, asOf);

  // Blending the 28-day rate in halves the effect of any single dropped session.
  const blended = recentWeight * recentDays + (1 - recentWeight) * (longDays / 2);
  const score = Math.min(Math.max(blended / target, 0), 1);

  return {
    score,
    glow: score ** glowCurve,
    recentDays,
    longDays,
    target,
    established,
    paused: Boolean(pauseActivityEffects && activityPausedAt),
    asOf
  };
}

/* ---------- streak level ---------- */

/**
 * Rolling-window progression level. See STREAK above for why this is a window
 * count and not a consecutive-day streak.
 *
 * The blend is the same one `consistencyScore` uses — 0.6 × (days in the last
 * 14) + 0.4 × (days in the last 28, halved onto a 14-day footing) — so a single
 * dropped session moves it by well under one session's worth before the curve
 * and the clamp are even applied.
 *
 * @returns {{level, fraction, raw, recentDays, longDays, paused, asOf}}
 *   level    0..10 integer — how many pyramid tiers are lit
 *   fraction 0..1 continuous — what brightness/clarity scaling reads
 */
export function streakState({ sessions = [], runs = [], days, todayISO, pauseActivityEffects = false, activityPausedAt = null }) {
  const list = days || trainingDays({ sessions, runs });
  const asOf = effectiveToday({ todayISO, pauseActivityEffects, activityPausedAt });
  const { windowDays, longWindowDays, recentWeight } = CONSISTENCY;

  const recentDays = countInWindow(list, asOf, windowDays);
  const longDays = countInWindow(list, asOf, longWindowDays);

  const blended = recentWeight * recentDays + (1 - recentWeight) * (longDays / 2);
  const raw = Math.min(Math.max(blended / STREAK.targetDays, 0), 1);
  const fraction = raw ** STREAK.curve;

  return {
    level: Math.round(fraction * STREAK.levels),
    fraction,
    raw,
    recentDays,
    longDays,
    paused: Boolean(pauseActivityEffects && activityPausedAt),
    asOf
  };
}

/* ---------- frost ---------- */

/** Has a 14-day window with enough sessions in it ever happened? */
export function hasEstablishedRun(days) {
  const { windowDays, establishedRunDays } = CONSISTENCY;
  return days.some((d) => countInWindow(days, d, windowDays) >= establishedRunDays);
}

/**
 * Whether frost is permitted at all, and whether it is currently showing.
 *
 * Gates, in order — every one of these is a deliberate kindness, not an
 * optimisation:
 *   paused        → nothing, ever. The pause is the whole point.
 *   no history    → a new user cannot be frosted for not yet having a habit.
 *   no prior run  → nor can someone who never established consistency to lose.
 *   gap too short → a missed week is not a lapse.
 *
 * @returns {{eligible, active, gapDays, reason}}
 */
export function frostState({ sessions = [], runs = [], days, todayISO, pauseActivityEffects = false, activityPausedAt = null }) {
  const list = days || trainingDays({ sessions, runs });
  const asOf = effectiveToday({ todayISO, pauseActivityEffects, activityPausedAt });
  const { historyRequiredDays, frostStartGapDays } = CONSISTENCY;
  const none = { eligible: false, active: false, gapDays: 0 };

  if (pauseActivityEffects) return { ...none, reason: 'paused' };
  if (!list.length) return { ...none, reason: 'no-history' };

  const historySpan = daysBetween(list[0], asOf);
  if (historySpan < historyRequiredDays) return { ...none, reason: 'new-user' };
  if (!hasEstablishedRun(list)) return { ...none, reason: 'no-established-run' };

  const gapDays = daysBetween(list.at(-1), asOf);
  if (gapDays < frostStartGapDays) return { eligible: true, active: false, gapDays, reason: 'recent-activity' };

  return { eligible: true, active: true, gapDays, reason: 'lapsed' };
}

/**
 * The calendar day cells that show frost — and *only* calendar day cells; no
 * other surface in the app ever frosts (see CLAUDE.md).
 *
 * Two caps, both load-bearing:
 *   - Only the current, ongoing gap is ever frosted. Train once and every frosted
 *     cell clears — old gaps are never re-litigated on the calendar.
 *   - At most `frostCapDays` cells, so a long absence looks exactly like a
 *     moderate one rather than painting the year white.
 */
export function frostedDates(input) {
  const { active, gapDays } = frostState(input);
  if (!active) return new Set();

  const list = input.days || trainingDays(input);
  const asOf = effectiveToday(input);
  const span = Math.min(gapDays, CONSISTENCY.frostCapDays);

  const out = new Set();
  for (let i = 0; i < span; i += 1) out.add(shiftDays(asOf, -i));
  out.delete(list.at(-1));      // never frost a day that was actually trained
  return out;
}

/**
 * Everything the skins need, in one call.
 * `frostHint` is a 0..1 nudge the Forge glow uses to cool slightly during a
 * lapse — it is capped like everything else and never reaches zero warmth.
 */
export function activityVisualState(input) {
  const { glow, score, paused, asOf, established } = consistencyScore(input);
  const streak = streakState(input);
  const frost = frostState(input);
  const frostHint = frost.active
    ? Math.min((frost.gapDays - CONSISTENCY.frostStartGapDays) / (CONSISTENCY.frostCapDays - CONSISTENCY.frostStartGapDays), 1)
    : 0;
  return {
    glow,
    score,
    frost,
    frostHint,
    paused,
    asOf,
    established,
    streakLevel: streak.level,
    streakFraction: streak.fraction
  };
}
