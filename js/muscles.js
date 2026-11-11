/* Muscle maths — pure. Weekly set counts per muscle and the per-muscle weekly
 * series, from sets and the exercise dictionary. No storage, no DOM, no clock:
 * the caller passes the dates. Covered by tests/muscles.test.js.
 *
 * Counting rule: each working set counts 1 toward each of its exercise's
 * primary muscles and 0.5 toward each secondary. Warm-ups count toward
 * nothing (progression.workingSets()).
 */

import { MUSCLES, SEED_EXERCISES, MUSCLE_GROUP_MUSCLES } from './exercises-seed.js';
import { workingSets } from './progression.js';
import { weekRange } from './summary.js';
import { shiftDays } from './consistency.js';

/** "front-delts" → "Front delts". */
export const MUSCLE_LABELS = Object.fromEntries(MUSCLES.map((m) => [m, m[0].toUpperCase() + m.slice(1).replace(/-/g, ' ')]));

/** Has this exercise any muscles recorded? An absent field (a record from before
 *  muscles existed) and two empty lists both count as none. */
export function hasMuscles(ex) {
  return Boolean(ex?.primaryMuscles?.length || ex?.secondaryMuscles?.length);
}

/** The backfill's guess for an exercise with no muscles: the starter of the same
 *  name (case-insensitive) if there is one, else its old `muscleGroup` as
 *  primaries only. */
export function guessMuscles(ex) {
  const seed = SEED_EXERCISES.find((s) => s.name.trim().toLowerCase() === String(ex?.name || '').trim().toLowerCase());
  if (seed) return { primaryMuscles: [...seed.primaryMuscles], secondaryMuscles: [...seed.secondaryMuscles] };
  return { primaryMuscles: [...(MUSCLE_GROUP_MUSCLES[ex?.muscleGroup] || [])], secondaryMuscles: [] };
}

const PRIMARY = 1;
const SECONDARY = 0.5;

/** { muscle: sets } for every working set whose date is in [startISO, endISO]. */
export function muscleSets(sets = [], exercisesById = new Map(), startISO = '', endISO = '9999-12-31') {
  const out = Object.fromEntries(MUSCLES.map((m) => [m, 0]));
  for (const s of workingSets(sets)) {
    if (!s?.dateISO || s.dateISO < startISO || s.dateISO > endISO) continue;
    const ex = exercisesById.get(s.exerciseId);
    if (!ex) continue;
    for (const m of ex.primaryMuscles || []) if (m in out) out[m] += PRIMARY;
    for (const m of ex.secondaryMuscles || []) if (m in out) out[m] += SECONDARY;
  }
  return out;
}

/** This week's and last week's counts, Monday-based, for the week holding `todayISO`. */
export function weeklyMuscleSets(sets, exercisesById, todayISO) {
  const { startISO, endISO } = weekRange(todayISO);
  const prevStart = shiftDays(startISO, -7);
  return {
    weekStartISO: startISO,
    current: muscleSets(sets, exercisesById, startISO, endISO),
    previous: muscleSets(sets, exercisesById, prevStart, shiftDays(startISO, -1))
  };
}

/** The last `weeks` weeks of one muscle's set count, oldest first, as chart points. */
export function muscleWeeklySeries(sets, exercisesById, muscle, todayISO, weeks = 12) {
  const { startISO } = weekRange(todayISO);
  const points = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = shiftDays(startISO, -7 * i);
    const count = muscleSets(sets, exercisesById, start, shiftDays(start, 6))[muscle] || 0;
    points.push({ label: start, value: count });
  }
  return points;
}
