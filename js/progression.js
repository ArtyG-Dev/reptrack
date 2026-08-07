/* Progression maths — estimated 1RM, PR detection, and the "add some weight"
 * nudge. Pure functions, unit-tested in tests/progression.test.js.
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

/** The single hardest set in a list, by estimated 1RM. */
export function bestSet(sets = []) {
  let best = null;
  let bestScore = -1;
  for (const s of sets) {
    const score = estimate1RM(s.weight, s.reps, s.unit);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

/**
 * Groups sets into one point per session date, ordered oldest → newest.
 * @returns {Array<{dateISO, topWeightKg, topWeight, unit, reps, e1rm, sets, isPR}>}
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
    const e1rm = estimate1RM(top.weight, top.reps, top.unit);
    const isPR = e1rm > runningBest + 1e-6;
    if (isPR) runningBest = e1rm;
    return {
      dateISO,
      sets: daySets.length,
      unit: displayUnit,
      topWeightKg: toKg(top.weight, top.unit),
      topWeight: fromKg(toKg(top.weight, top.unit), displayUnit),
      reps: top.reps,
      e1rm: fromKg(e1rm, displayUnit),
      e1rmKg: e1rm,
      isPR
    };
  });
}

/**
 * Is this set a personal record against everything logged before it?
 * `history` is every previously stored set for the same exercise.
 */
export function isPersonalRecord(candidate, history = []) {
  const score = estimate1RM(candidate.weight, candidate.reps, candidate.unit);
  if (score <= 0) return false;
  const best = history.reduce((max, s) => Math.max(max, estimate1RM(s.weight, s.reps, s.unit)), 0);
  return score > best + 1e-6;
}

/** Recomputes isPR across a chronological list — used after import or an edit. */
export function markPRs(sets = []) {
  const ordered = [...sets].sort((a, b) => (a.dateISO === b.dateISO ? (a.order ?? 0) - (b.order ?? 0) : String(a.dateISO).localeCompare(String(b.dateISO))));
  let best = 0;
  return ordered.map((s) => {
    const score = estimate1RM(s.weight, s.reps, s.unit);
    const isPR = score > best + 1e-6;
    if (isPR) best = score;
    return { ...s, isPR };
  });
}

/**
 * Quiet Jefit-style nudge: if the same top set has been repeated in two or more
 * sessions, suggest the next increment. Returns null when there's nothing to say.
 */
export function suggestProgression(sets = [], { unit = 'kg', stepKg = 2.5, stepLb = 5 } = {}) {
  if (!sets.length) return null;

  const series = buildSeries(sets, unit);
  if (series.length < 2) return null;

  const latest = series.at(-1);
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

/** Total volume (weight × reps) in the display unit. */
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
