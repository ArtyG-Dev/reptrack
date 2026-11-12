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

/* ---------- Stage 4: the body map ---------- */

/** Heat level from this week's weighted sets: 0 none, 1 under 4, 2 under 10, 3 ten or more.
 *  The one place these thresholds live. */
export const HEAT_THRESHOLDS = [4, 10];
export function heatLevel(weightedSets) {
  const n = Number(weightedSets) || 0;
  if (n <= 0) return 0;
  if (n < HEAT_THRESHOLDS[0]) return 1;
  if (n < HEAT_THRESHOLDS[1]) return 2;
  return 3;
}

/** Weighted sets in the last 48 hours at or above this suggest resting the muscle. */
export const RECOVERY_SETS = 6;

/** Sets carry a date, not a time, so "the last 48 hours" is today and yesterday. */
export function recentlyTrained(muscle, sets, exercisesById, todayISO) {
  const counts = muscleSets(sets, exercisesById, shiftDays(todayISO, -1), todayISO);
  return (counts[muscle] || 0) >= RECOVERY_SETS;
}

/**
 * The user's own exercises that hit `muscle`: primary first, then the fewest
 * working sets this week, then the least recently trained (never-trained first).
 * @returns {Array<{exercise, role: 'primary'|'secondary', setsThisWeek, lastISO}>}
 */
export function suggestionsFor(muscle, exercises = [], sets = [], todayISO) {
  const { startISO, endISO } = weekRange(todayISO);
  const working = workingSets(sets);
  const out = [];
  for (const exercise of exercises) {
    const role = (exercise.primaryMuscles || []).includes(muscle) ? 'primary'
      : (exercise.secondaryMuscles || []).includes(muscle) ? 'secondary' : null;
    if (!role) continue;
    const mine = working.filter((s) => s.exerciseId === exercise.id);
    out.push({
      exercise,
      role,
      setsThisWeek: mine.filter((s) => s.dateISO >= startISO && s.dateISO <= endISO).length,
      lastISO: mine.reduce((latest, s) => (s.dateISO > latest ? s.dateISO : latest), '')
    });
  }
  return out.sort((a, b) => (a.role === b.role ? 0 : a.role === 'primary' ? -1 : 1)
    || a.setsThisWeek - b.setsThisWeek
    || a.lastISO.localeCompare(b.lastISO)
    || a.exercise.name.localeCompare(b.exercise.name));
}

/**
 * Definition 0–5 for a muscle, from everything ever done for it: lifetime
 * weighted sets plus five per PR on an exercise where it is primary. Both only
 * ever grow with time, so a lapse — however long — never lowers it. It is about
 * work done, never about how a body looks.
 */
export const DEFINITION_STEPS = [20, 60, 150, 300, 500];
export function definitionLevel(muscle, sets = [], exercisesById = new Map()) {
  const lifetime = muscleSets(sets, exercisesById)[muscle] || 0;
  const prs = workingSets(sets).filter((s) => s.isPR && exercisesById.get(s.exerciseId)?.primaryMuscles?.includes(muscle)).length;
  const score = lifetime + 5 * prs;
  return DEFINITION_STEPS.filter((step) => score >= step).length;
}
