/* Progression maths — estimated 1RM, PR detection, and the "add some weight"
 * nudge. Pure functions, unit-tested in tests/progression.test.js.
 *
 * A set scores one of two ways depending on how it was logged: a `reps`-mode
 * set (weight × reps) scores by estimated 1RM; a `hold`-mode set (yoga,
 * pilates, a timed calisthenics hold) scores by its hold duration. recordScore()
 * is the one place that distinction lives — everything else (PR detection,
 * "best set", the series builder) is written once and works for both.
 */

const LB_PER_KG = 2.2046226218;

export function toKg(weight, unit) {
  const w = Number(weight) || 0;
  return unit === 'lb' ? w / LB_PER_KG : w;
}

export function fromKg(kg, unit) {
  const w = Number(kg) || 0;
  return unit === 'lb' ? w * LB_PER_KG : w;
}

/** Epley estimate, normalised to kg so mixed-unit histories stay comparable. */
export function estimate1RM(weight, reps, unit = 'kg') {
  const kg = toKg(weight, unit);
  const r = Number(reps) || 0;
  if (kg <= 0 || r <= 0) return 0;
  if (r === 1) return kg;
  return kg * (1 + r / 30);
}

/** Round to the nearest loadable jump: a pair of 0.625 kg / 2.5 lb plates. */
export function roundToIncrement(value, unit = 'kg') {
  const step = unit === 'lb' ? 5 : 1.25;
  return Math.round(value / step) * step;
}

/**
 * A single comparable "how hard was this" number for any set, hold-mode or not.
 * Hold-mode sets (identified by a non-null holdSeconds) score by duration;
 * everything else scores by estimated 1RM.
 */
export function recordScore(entry) {
  if (!entry) return 0;
  if (entry.holdSeconds != null) return Number(entry.holdSeconds) || 0;
  return estimate1RM(entry.weight, entry.reps, entry.unit);
}

/** The single hardest set in a list, by recordScore. */
export function bestSet(sets = []) {
  let best = null;
  let bestScore = -1;
  for (const s of sets) {
    const score = recordScore(s);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

/**
 * Groups sets into one point per session date, ordered oldest → newest.
 * `holdSeconds` is populated (raw seconds, not unit-converted) when the day's
 * top set was a hold; the weight/rep fields stay present but are 0 for it.
 * @returns {Array<{dateISO, topWeightKg, topWeight, unit, reps, e1rm, holdSeconds, sets, isPR}>}
 */
export function buildSeries(sets = [], displayUnit = 'kg') {
  const byDate = new Map();
  for (const s of sets) {
    if (!s?.dateISO) continue;
    if (!byDate.has(s.dateISO)) byDate.set(s.dateISO, []);
    byDate.get(s.dateISO).push(s);
  }

  const dates = [...byDate.keys()].sort();
  let runningBest = 0;

  return dates.map((dateISO) => {
    const daySets = byDate.get(dateISO);
    const top = bestSet(daySets);
    const score = recordScore(top);
    const isPR = score > runningBest + 1e-6;
    if (isPR) runningBest = score;
    return {
      dateISO,
      sets: daySets.length,
      unit: displayUnit,
      topWeightKg: toKg(top.weight, top.unit),
      topWeight: fromKg(toKg(top.weight, top.unit), displayUnit),
      reps: top.reps,
      e1rm: fromKg(estimate1RM(top.weight, top.reps, top.unit), displayUnit),
      e1rmKg: estimate1RM(top.weight, top.reps, top.unit),
      holdSeconds: top.holdSeconds ?? null,
      isPR
    };
  });
}

/**
 * Is this set a personal record against everything logged before it?
 * `history` is every previously stored set for the same exercise.
 */
export function isPersonalRecord(candidate, history = []) {
  const score = recordScore(candidate);
  if (score <= 0) return false;
  const best = history.reduce((max, s) => Math.max(max, recordScore(s)), 0);
  return score > best + 1e-6;
}

/** Recomputes isPR across a chronological list — used after import or an edit. */
export function markPRs(sets = []) {
  const ordered = [...sets].sort((a, b) => (a.dateISO === b.dateISO ? (a.order ?? 0) - (b.order ?? 0) : String(a.dateISO).localeCompare(String(b.dateISO))));
  let best = 0;
  return ordered.map((s) => {
    const score = recordScore(s);
    const isPR = score > best + 1e-6;
    if (isPR) best = score;
    return { ...s, isPR };
  });
}

/**
 * Quiet Jefit-style nudge: if the same top set has been repeated in two or more
 * sessions, suggest the next increment. Returns null when there's nothing to say.
 * Weight-based only — a hold-mode series (reps forced to 0) never triggers it,
 * since "add more weight" isn't the right nudge for a timed pose.
 */
export function suggestProgression(sets = [], { unit = 'kg', stepKg = 2.5, stepLb = 5 } = {}) {
  if (!sets.length) return null;

  const series = buildSeries(sets, unit);
  if (series.length < 2) return null;

  const latest = series.at(-1);
  if (!latest.reps) return null;

  const matching = series.filter(
    (p) => Math.abs(p.topWeightKg - latest.topWeightKg) < 1e-6 && p.reps >= latest.reps
  );
  if (matching.length < 2) return null;

  const step = unit === 'lb' ? stepLb : stepKg;
  const next = roundToIncrement(latest.topWeight + step, unit);
  const timesWord = matching.length === 2 ? 'twice' : `${matching.length} times`;

  return {
    currentWeight: latest.topWeight,
    currentReps: latest.reps,
    suggestedWeight: next,
    unit,
    sessions: matching.length,
    message: `You've hit ${formatWeight(latest.topWeight)} ${unit} × ${latest.reps} ${timesWord} — try ${formatWeight(next)} ${unit} next time.`
  };
}

/** Total volume (weight × reps) in the display unit. Hold-mode sets contribute 0. */
export function totalVolume(sets = [], displayUnit = 'kg') {
  const kg = sets.reduce((sum, s) => sum + toKg(s.weight, s.unit) * (Number(s.reps) || 0), 0);
  return fromKg(kg, displayUnit);
}

export function formatWeight(value) {
  const num = Number(value) || 0;
  return Number.isInteger(num) ? String(num) : String(Math.round(num * 100) / 100);
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
