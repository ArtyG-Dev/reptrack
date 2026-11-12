/* Muscle maths — pure. Weekly set counts per muscle and the per-muscle weekly
 * series, from sets and the exercise dictionary. No storage, no DOM, no clock:
 * the caller passes the dates. Covered by tests/muscles.test.js.
 *
 * Counting rule: each working set counts 1 toward each of its exercise's
 * primary muscles and 0.5 toward each secondary. Warm-ups count toward
 * nothing (progression.workingSets()).
 */

import { MUSCLES, MUSCLE_LABELS, SEED_EXERCISES, MUSCLE_GROUP_MUSCLES } from './exercises-seed.js';
import { workingSets, toKg, fromKg } from './progression.js';
import { weekRange } from './summary.js';
import { shiftDays } from './consistency.js';

export { MUSCLE_LABELS };

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

/* ---------- Muscle map v2: counting modes, periods, Unassigned ---------- */

/** The periods the muscle map can show, in days, and its two counting modes.
 *  Both read the same stored data; switching changes nothing that's stored. */
export const PERIODS = Object.freeze([7, 30, 90]);
export const COUNT_MODES = Object.freeze(['sets', 'weight']);

/** The last `days` days ending today, inclusive. */
export function periodRange(todayISO, days) {
  return { fromISO: shiftDays(todayISO, -(days - 1)), toISO: todayISO };
}

/** Does a set have added weight to count in Weight mode? Hold-mode and
 *  bodyweight exercises do not: they are excluded, never counted as zero. */
export function countsForWeight(set, exercise) {
  if (!exercise || exercise.mode === 'hold' || exercise.isBodyweight) return false;
  if (set.holdSeconds != null) return false;
  return toKg(set.weight, set.unit) > 0 && Number(set.reps) > 0;
}

/** An exercise with no muscles chosen. Counted on its own row, never spread
 *  over the body or guessed at. */
export const isUnassigned = (exercise) => !hasMuscles(exercise);

/**
 * Totals per muscle for a date range, in the chosen mode.
 *   sets:   1 per working set to each main muscle, 0.5 to each supporting one
 *   weight: weight × reps (in `unit`) to each main muscle, half to each supporting one
 * @returns {{ totals: Object<string, number>, unassigned: number, excludedOnly: Set<string>, excluded: number }}
 *   `excludedOnly`: in Weight mode, muscles that were trained in the range only
 *   by excluded (bodyweight / timed) sets, so the view can say so instead of 0.
 */
export function muscleTotals({ sets = [], exercisesById = new Map(), fromISO = '', toISO = '9999-12-31', mode = 'sets', unit = 'kg' }) {
  const totals = Object.fromEntries(MUSCLES.map((m) => [m, 0]));
  const touchedByExcluded = new Set();
  let unassigned = 0;
  let excluded = 0;
  for (const s of workingSets(sets)) {
    if (!s?.dateISO || s.dateISO < fromISO || s.dateISO > toISO) continue;
    const ex = exercisesById.get(s.exerciseId);
    if (!ex) continue;
    let amount = 1;
    if (mode === 'weight') {
      if (!countsForWeight(s, ex)) {
        excluded += 1;
        for (const m of [...(ex.primaryMuscles || []), ...(ex.secondaryMuscles || [])]) touchedByExcluded.add(m);
        continue;
      }
      amount = fromKg(toKg(s.weight, s.unit) * Number(s.reps), unit);
    }
    if (isUnassigned(ex)) { unassigned += amount; continue; }
    for (const m of ex.primaryMuscles || []) if (m in totals) totals[m] += amount * PRIMARY;
    for (const m of ex.secondaryMuscles || []) if (m in totals) totals[m] += amount * SECONDARY;
  }
  const excludedOnly = new Set([...touchedByExcluded].filter((m) => m in totals && totals[m] === 0));
  return { totals, unassigned, excludedOnly, excluded };
}

/** Muscle groups, most-trained first (ties in list order), for the ranked list. */
export function rankMuscles({ totals, excludedOnly = new Set() }) {
  return MUSCLES
    .map((muscle, i) => ({ muscle, i, value: totals[muscle] || 0, excludedOnly: excludedOnly.has(muscle) }))
    .sort((a, b) => b.value - a.value || a.i - b.i)
    .map(({ muscle, value, excludedOnly: ex }) => ({ muscle, value, excludedOnly: ex }));
}

/**
 * Heat level 0–3 for a total, so the colour scale means the same at any period.
 *   sets:   the Stage 4 thresholds, applied per week (a 30-day total is scaled to 7 days)
 *   weight: relative to the most-trained muscle in view; kilograms have no
 *           absolute scale that fits every lifter
 */
export function heatLevelFor(value, { mode = 'sets', days = 7, max = 0 } = {}) {
  if (!(value > 0)) return 0;
  if (mode === 'weight') {
    const share = max > 0 ? value / max : 1;
    return share > 2 / 3 ? 3 : share > 1 / 3 ? 2 : 1;
  }
  return heatLevel((value * 7) / days);
}

/**
 * One muscle's trend across the period, oldest first, as chart points: daily for
 * a 7-day period (a single weekly point would show nothing), weekly otherwise —
 * buckets of 7 days ending today, the oldest possibly shorter.
 */
export function muscleTrend({ sets, exercisesById, muscle, todayISO, days = 7, mode = 'sets', unit = 'kg' }) {
  const step = days <= 7 ? 1 : 7;
  const points = [];
  for (let end = 0; end < days; end += step) {
    const toISO = shiftDays(todayISO, -end);
    const fromISO = shiftDays(todayISO, -Math.min(end + step - 1, days - 1));
    const value = muscleTotals({ sets, exercisesById, fromISO, toISO, mode, unit }).totals[muscle] || 0;
    points.unshift({ label: fromISO, value });
  }
  return points;
}

/* ---------- Taxonomy v2 migration ---------- */

/** Ids from the first taxonomy that no longer exist, and what they became. */
export const RETIRED_MUSCLES = Object.freeze({ lats: 'upper-back-lats', 'upper-back': 'upper-back-lats' });

/**
 * The starter mappings as the first taxonomy shipped them, for the starters
 * whose mapping was corrected (DECISIONS). A starter still on exactly this
 * mapping (after renaming retired ids) gets the corrected one; one the user
 * has edited is left alone.
 */
export const SEED_MUSCLES_V1 = Object.freeze({
  'Overhead Press': [['front-delts'], ['side-delts', 'triceps', 'upper-back']],
  'Front Squat': [['quads'], ['glutes', 'abs', 'upper-back']],
  Deadlift: [['glutes', 'hamstrings', 'lower-back'], ['upper-back', 'lats', 'forearms', 'quads']],
  'Barbell Row': [['lats', 'upper-back'], ['rear-delts', 'biceps', 'lower-back']],
  'Lat Pulldown': [['lats'], ['biceps', 'upper-back']],
  'Face Pull': [['rear-delts'], ['upper-back']],
  'Pull Up': [['lats'], ['biceps', 'upper-back', 'rear-delts']],
  'Downward Dog': [[], ['hamstrings', 'calves']],
  "Child's Pose": [[], []]
});

/** Retired ids renamed, duplicates dropped, and never one muscle in both lists. */
export function renameRetired({ primaryMuscles = [], secondaryMuscles = [] }) {
  const fix = (list) => [...new Set(list.map((m) => RETIRED_MUSCLES[m] || m))];
  const primary = fix(primaryMuscles);
  return { primaryMuscles: primary, secondaryMuscles: fix(secondaryMuscles).filter((m) => !primary.includes(m)) };
}

const sameList = (a, b) => a.length === b.length && a.every((m) => b.includes(m));

/**
 * An exercise moved to taxonomy v2. Always renames retired ids. With
 * `correctSeeds`, a starter still on its original mapping takes the corrected
 * one from SEED_EXERCISES.
 * @returns the exercise, unchanged (same object) if nothing needed changing
 */
export function migrateMuscles(exercise, { correctSeeds = false } = {}) {
  if (!Array.isArray(exercise?.primaryMuscles)) return exercise;
  let next = renameRetired(exercise);
  if (correctSeeds && !exercise.isCustom) {
    const v1 = SEED_MUSCLES_V1[exercise.name];
    const seed = SEED_EXERCISES.find((s) => s.name === exercise.name);
    if (v1 && seed) {
      const original = renameRetired({ primaryMuscles: v1[0], secondaryMuscles: v1[1] });
      if (sameList(next.primaryMuscles, original.primaryMuscles) && sameList(next.secondaryMuscles, original.secondaryMuscles)) {
        next = { primaryMuscles: [...seed.primaryMuscles], secondaryMuscles: [...seed.secondaryMuscles] };
      }
    }
  }
  const changed = !sameList(next.primaryMuscles, exercise.primaryMuscles) || !sameList(next.secondaryMuscles, exercise.secondaryMuscles || []);
  return changed ? { ...exercise, ...next } : exercise;
}

/* ---------- Custom exercises: a suggestion from the name ---------- */

/**
 * A small on-device keyword table: words in an exercise's name → likely
 * muscles. Only ever shown as a suggestion the user confirms or changes; it
 * is never applied on its own. First match wins, so the more specific words
 * (e.g. "leg curl", "calf raise") come before the general ones.
 */
export const KEYWORD_MUSCLES = Object.freeze([
  [/\b(leg|hamstring|nordic) curls?\b/, ['hamstrings'], ['calves']],
  [/\bcalf|calves\b/, ['calves'], []],
  [/\b(lateral|side|lat) raises?\b/, ['side-delts'], []],
  [/\b(front) raises?\b/, ['front-delts'], []],
  [/\b(rear|reverse) (delt|fly|flye)s?\b|\bface pulls?\b/, ['rear-delts'], ['traps']],
  [/\bshrugs?\b/, ['traps'], ['forearms']],
  [/\b(pull ?ups?|chin ?ups?|pull ?downs?|pulldowns?)\b/, ['upper-back-lats'], ['biceps']],
  [/\bdeadlifts?\b|\brdls?\b|\bgood mornings?\b/, ['hamstrings', 'glutes', 'lower-back'], ['forearms']],
  [/\bsquats?\b|\blunges?\b|\bleg press(es)?\b|\bsplit squats?\b/, ['quads', 'glutes'], ['adductors']],
  [/\bhip thrusts?\b|\bglute bridges?\b|\bkickbacks?\b/, ['glutes'], ['hamstrings']],
  [/\bdips?\b/, ['triceps', 'chest'], ['front-delts']],
  [/\btriceps?\b|\bskull ?crushers?\b|\bpush ?downs?\b|\bpushdowns?\b/, ['triceps'], []],
  [/\b(leg )?extensions?\b/, ['quads'], []],
  [/\bcurls?\b/, ['biceps'], ['forearms']],
  [/\brows?\b/, ['upper-back-lats'], ['biceps', 'rear-delts']],
  [/\b(overhead|shoulder|military|arnold) press(es)?\b/, ['front-delts'], ['side-delts', 'triceps']],
  [/\b(bench|chest|incline|decline) press(es)?\b|\bflyes?\b|\bflys?\b|\bpush ?ups?\b|\bpress ?ups?\b/, ['chest'], ['front-delts', 'triceps']],
  [/\bpress(es)?\b/, ['chest', 'front-delts'], ['triceps']],
  [/\bcrunch(es)?\b|\bsit ?ups?\b|\bplanks?\b|\b(leg|knee) raises?\b|\bab\b|\babs\b/, ['abs'], ['obliques', 'hip-flexors']],
  [/\braises?\b/, ['side-delts'], ['front-delts']],
  [/\b(russian )?twists?\b|\bwoodchop(per)?s?\b|\bside bends?\b/, ['obliques'], ['abs']],
  [/\bwrist|grip|farmer'?s? (walk|carry)\b/, ['forearms'], ['traps']]
]);

/** Suggested muscles for a name, or null when nothing in the table fits. */
export function suggestMuscles(name) {
  const text = String(name || '').toLowerCase();
  for (const [pattern, primary, secondary] of KEYWORD_MUSCLES) {
    if (pattern.test(text)) return { primaryMuscles: [...primary], secondaryMuscles: secondary.filter((m) => !primary.includes(m)) };
  }
  return null;
}

/* ---------- The "set its muscles?" reminder ---------- */

/** After this many logged sets of an unassigned exercise, ask once; after
 *  this many more since a "Not now", ask one last time. */
export const REMINDER = Object.freeze({ first: 3, again: 10, maxPrompts: 2 });

/**
 * Is the reminder due for an unassigned exercise?
 * @param {number} logged   working sets ever logged for it
 * @param {{ prompts?: number, lastAt?: number }} state  stored on the exercise
 */
export function reminderDue(exercise, logged, state = exercise?.muscleReminder || {}) {
  if (!exercise || !isUnassigned(exercise)) return false;
  const prompts = state.prompts || 0;
  if (prompts >= REMINDER.maxPrompts) return false;
  if (prompts === 0) return logged >= REMINDER.first;
  return logged >= (state.lastAt || 0) + REMINDER.again;
}
