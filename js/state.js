/* Application state. Every view reads from here and mutates through these
 * actions — and every storage call goes through store.js, never db.js.
 */

import * as store from './store.js';
import { SEED_EXERCISES } from './exercises-seed.js';
import { isPersonalRecord, recordScore, workingSets as progressionWorking } from './progression.js';
import { buildWeeklySummary, weekRange, summaryFilename } from './summary.js';
import { activityVisualState, frostedDates, trainingDays, effectiveToday } from './consistency.js';
import { monolithFaces, starField, constellationLinks, orreryPlanets } from './skin-data.js';
import { itemsFromSets, updatedItems } from './plans.js';
import { hasMuscles, guessMuscles, migrateMuscles } from './muscles.js';

const state = {
  ready: false,
  settings: { ...store.DEFAULT_SETTINGS },
  exercises: [],
  allSets: [],
  allSessions: [],
  runs: [],
  plans: [],
  session: null,
  sessionSets: [],
  currentExerciseId: null,
  lastSet: null
};

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const listener of listeners) listener(state);
}

export function getState() {
  return state;
}

export function currentExercise() {
  return state.exercises.find((e) => e.id === state.currentExerciseId) || null;
}

export function exerciseById(id) {
  return state.exercises.find((e) => e.id === id) || null;
}

/** Sets for an exercise from the most recent *other* session — powers "same as last time". */
export function previousSetsFor(exerciseId) {
  const candidates = state.allSets.filter((s) => s.exerciseId === exerciseId && s.sessionId !== state.session?.id);
  if (!candidates.length) return [];
  const latest = candidates.reduce((a, b) => (String(a.dateISO) >= String(b.dateISO) ? a : b));
  return candidates
    .filter((s) => s.sessionId === latest.sessionId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Context object handed to the voice parser. */
export function parserContext() {
  return {
    exercises: state.exercises,
    defaultUnit: state.settings.unit,
    currentExercise: currentExercise(),
    lastSet: state.lastSet,
    lastSetsFor: previousSetsFor
  };
}

function withExercise(entry) {
  return entry ? { ...entry, exercise: exerciseById(entry.exerciseId) } : null;
}

export async function init() {
  state.settings = await store.getSettings();

  let exercises = await store.listExercises();
  if (!exercises.length) {
    for (const seed of SEED_EXERCISES) await store.addExercise({ ...seed, isCustom: false });
    exercises = await store.listExercises();
    state.settings = await store.saveSettings({ seedBackfillDone: true });
  } else if (!state.settings.seedBackfillDone) {
    // An install whose dictionary was created before a starter exercise
    // existed in exercises-seed.js (e.g. before yoga/pilates/calisthenics
    // were added — the seed loop above only ever runs on a genuinely empty
    // store) never receives it. Backfill by name, once: add whatever's
    // missing, touch nothing that's already there. Matching by name means a
    // starter exercise a user renamed re-appears under its original name
    // too, which is the honest cost of not tracking a separate seed id.
    const known = new Set(exercises.map((ex) => ex.name.trim().toLowerCase()));
    const missing = SEED_EXERCISES.filter((seed) => !known.has(seed.name.trim().toLowerCase()));
    for (const seed of missing) await store.addExercise({ ...seed, isCustom: false });
    if (missing.length) exercises = await store.listExercises();
    state.settings = await store.saveSettings({ seedBackfillDone: true });
  }
  state.exercises = exercises;
  await backfillMuscles();

  await reloadRecords();
  state.currentExerciseId = state.lastSet?.exerciseId || null;
  state.ready = true;
  emit();
  return state;
}

async function reloadRecords() {
  state.allSets = await store.allSets();
  state.allSessions = await store.listSessions();
  state.runs = await store.listRuns();
  state.plans = await store.listPlans();
  state.session = await store.activeSession();
  state.sessionSets = state.session ? await store.setsForSession(state.session.id) : [];
  state.lastSet = state.sessionSets.length ? withExercise(state.sessionSets.at(-1)) : null;
}

/**
 * Muscles for exercises that have none. Once per install (settings.muscleBackfillDone):
 * every exercise with no muscles gets the starter mapping of the same name, else a
 * guess from its old `muscleGroup`. Never overwrites a non-empty list. After that,
 * only records whose fields are *absent* — old-shaped exercises arriving in an
 * import — are filled; an empty list someone chose in the editor stays empty.
 */
async function backfillMuscles() {
  const firstTime = !state.settings.muscleBackfillDone;
  const due = state.exercises.filter((ex) => (firstTime ? !hasMuscles(ex) : !Array.isArray(ex.primaryMuscles)));
  for (const ex of due) await store.updateExercise({ ...ex, ...guessMuscles(ex) });
  if (due.length) state.exercises = await store.listExercises();
  if (firstTime) state.settings = await store.saveSettings({ muscleBackfillDone: true });

  // Taxonomy v2: retired ids (lats, upper-back) are always renamed, which also
  // covers an old backup arriving by import. Once per install, a starter still
  // on its original mapping takes the corrected one; an edited one is left alone.
  const correctSeeds = !state.settings.muscleTaxonomyV2Done;
  const moved = state.exercises.map((ex) => migrateMuscles(ex, { correctSeeds })).filter((ex, i) => ex !== state.exercises[i]);
  for (const ex of moved) await store.updateExercise(ex);
  if (moved.length) state.exercises = await store.listExercises();
  if (correctSeeds) state.settings = await store.saveSettings({ muscleTaxonomyV2Done: true });
}

export async function reloadAll() {
  state.settings = await store.getSettings();
  state.exercises = await store.listExercises();
  await backfillMuscles();
  await reloadRecords();
  emit();
  return state;
}

/* ---------- session lifecycle ---------- */

/** Starts a session — today by default, or on an earlier date for a session
 *  logged after the fact. */
export async function startSession(dateISO = null, planId = null) {
  if (state.session) return state.session;
  state.session = await store.startSession({ ...(dateISO ? { dateISO } : {}), planId });
  state.allSessions = [state.session, ...state.allSessions];
  state.sessionSets = [];
  state.lastSet = null;
  emit();
  return state.session;
}

export async function endSession() {
  if (!state.session) return null;
  const finished = await store.endSession(state.session.id);
  state.allSessions = state.allSessions.map((s) => (s.id === finished.id ? finished : s));
  state.session = null;
  state.sessionSets = [];
  state.lastSet = null;
  emit();
  return finished;
}

export async function discardSession() {
  if (!state.session) return null;
  const id = state.session.id;
  await store.deleteSession(id);
  state.allSets = state.allSets.filter((s) => s.sessionId !== id);
  state.allSessions = state.allSessions.filter((s) => s.id !== id);
  state.session = null;
  state.sessionSets = [];
  state.lastSet = null;
  emit();
  return id;
}

export async function deleteSessionById(sessionId) {
  await store.deleteSession(sessionId);
  state.allSets = state.allSets.filter((s) => s.sessionId !== sessionId);
  state.allSessions = state.allSessions.filter((s) => s.id !== sessionId);
  if (state.session?.id === sessionId) {
    state.session = null;
    state.sessionSets = [];
    state.lastSet = null;
  }
  emit();
}

/** Moves the active session to another date. Its sets carry the date too
 *  (denormalised for history reads), so they move with it, and PRs are
 *  recomputed for every exercise in it — order in time is what makes a PR. */
export async function setSessionDate(dateISO) {
  if (!state.session || !dateISO || dateISO === state.session.dateISO) return state.session;
  state.session = { ...state.session, dateISO };
  await store.saveSession(state.session);
  state.allSessions = state.allSessions.map((x) => (x.id === state.session.id ? state.session : x));
  const moved = state.sessionSets.map((x) => ({ ...x, dateISO }));
  for (const x of moved) await store.updateSet(x);
  const byId = new Map(moved.map((x) => [x.id, x]));
  state.sessionSets = moved;
  state.allSets = state.allSets.map((x) => byId.get(x.id) || x);
  for (const exerciseId of new Set(moved.map((x) => x.exerciseId))) await recomputePRs(exerciseId);
  if (state.lastSet) state.lastSet = withExercise(state.allSets.find((x) => x.id === state.lastSet.id) || null);
  emit();
  return state.session;
}

export async function setSessionNotes(notes) {
  if (!state.session) return null;
  state.session = { ...state.session, notes };
  await store.saveSession(state.session);
  state.allSessions = state.allSessions.map((s) => (s.id === state.session.id ? state.session : s));
  emit();
  return state.session;
}

/* ---------- plans ---------- */

export function planById(planId) {
  return state.plans.find((p) => p.id === planId) || null;
}

/** Creates or updates a plan (a plan without an id is new). */
export async function savePlan(plan) {
  const record = plan.id ? { ...plan } : store.makePlan(plan);
  await store.savePlan(record);
  state.plans = (await store.listPlans());
  emit();
  return record;
}

export async function deletePlan(planId) {
  await store.deletePlan(planId);
  state.plans = state.plans.filter((p) => p.id !== planId);
  emit();
}

/** Moves a plan up (−1) or down (+1) the list by swapping order values. */
export async function movePlan(planId, direction) {
  const list = [...state.plans];
  const i = list.findIndex((p) => p.id === planId);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= list.length) return;
  const a = { ...list[i], order: list[j].order ?? j };
  const b = { ...list[j], order: list[i].order ?? i };
  if (a.order === b.order) b.order = a.order + direction * -1;
  await store.savePlan(a);
  await store.savePlan(b);
  state.plans = await store.listPlans();
  emit();
}

/** "Save as plan": a plan built from a session's exercises and top sets. */
export async function planFromSession(sessionId, name) {
  const sets = state.allSets.filter((x) => x.sessionId === sessionId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return savePlan({ name, items: itemsFromSets(sets) });
}

/** "Update plan to what I did". */
export async function updatePlanFromSession(planId, sessionId) {
  const plan = planById(planId);
  if (!plan) return null;
  const sets = state.allSets.filter((x) => x.sessionId === sessionId);
  return savePlan({ ...plan, items: updatedItems(plan, sets) });
}

/** The user's own tick / untick / skip on a plan item, for this session only. */
export async function setPlanMark(index, mark) {
  if (!state.session) return;
  const planMarks = { ...(state.session.planMarks || {}) };
  if (mark == null) delete planMarks[index];
  else planMarks[index] = mark;
  state.session = { ...state.session, planMarks };
  await store.saveSession(state.session);
  state.allSessions = state.allSessions.map((x) => (x.id === state.session.id ? state.session : x));
  emit();
}

/* ---------- sets ---------- */

export function setCurrentExercise(exerciseId) {
  state.currentExerciseId = exerciseId;
  emit();
}

/**
 * Commits parsed/typed sets to the active session (starting one if needed).
 * @param {string} exerciseId
 * @param {Array<{weight, unit, reps, rpe}>} entries
 */
export async function logSets(exerciseId, entries) {
  if (!entries?.length) return [];
  if (!state.session) await startSession();

  const history = state.allSets.filter((s) => s.exerciseId === exerciseId);
  const created = [];

  for (const entry of entries) {
    const isPR = isPersonalRecord(entry, history.concat(created));
    const stored = await store.addSet({
      sessionId: state.session.id,
      exerciseId,
      dateISO: state.session.dateISO,
      order: state.sessionSets.length + created.length,
      weight: Number(entry.weight) || 0,
      unit: entry.unit || state.settings.unit,
      reps: Math.round(Number(entry.reps) || 0),
      rpe: entry.rpe ?? null,
      holdSeconds: entry.holdSeconds ?? null,
      side: entry.side ?? null,
      isWarmup: Boolean(entry.isWarmup),
      isPR
    });
    created.push(stored);
  }

  state.sessionSets = state.sessionSets.concat(created);
  state.allSets = state.allSets.concat(created);
  state.currentExerciseId = exerciseId;
  state.lastSet = withExercise(created.at(-1));
  emit();
  return created;
}

/** Saves an edited set, then recomputes the PR flags for that exercise: an
 *  edit can make a set a record, or stop an earlier/later one being one. */
export async function updateSetEntry(entry) {
  await store.updateSet(entry);
  const replace = (list) => list.map((s) => (s.id === entry.id ? entry : s));
  state.sessionSets = replace(state.sessionSets);
  state.allSets = replace(state.allSets);
  await recomputePRs(entry.exerciseId);
  const fresh = state.allSets.find((s) => s.id === entry.id) || entry;
  if (state.lastSet?.id === entry.id) state.lastSet = withExercise(fresh);
  emit();
  return fresh;
}

/** PR flags for one exercise, recomputed in true chronological order (date,
 *  then session start, then set order) and written back only where they
 *  changed. */
async function recomputePRs(exerciseId) {
  const startOf = new Map(state.allSessions.map((x) => [x.id, x.startTs ?? 0]));
  const ordered = state.allSets
    .filter((x) => x.exerciseId === exerciseId)
    .sort((x, y) => String(x.dateISO).localeCompare(String(y.dateISO))
      || (startOf.get(x.sessionId) ?? 0) - (startOf.get(y.sessionId) ?? 0)
      || (x.order ?? 0) - (y.order ?? 0));
  let best = 0;
  const changed = new Map();
  for (const x of ordered) {
    const score = recordScore(x);
    const isPR = score > best + 1e-6;
    if (isPR) best = score;
    if (Boolean(x.isPR) !== isPR) changed.set(x.id, { ...x, isPR });
  }
  for (const x of changed.values()) await store.updateSet(x);
  const apply = (list) => list.map((x) => changed.get(x.id) || x);
  state.allSets = apply(state.allSets);
  state.sessionSets = apply(state.sessionSets);
}

export async function removeSet(setId) {
  await store.deleteSet(setId);
  state.sessionSets = state.sessionSets.filter((s) => s.id !== setId);
  state.allSets = state.allSets.filter((s) => s.id !== setId);
  if (state.lastSet?.id === setId) state.lastSet = withExercise(state.sessionSets.at(-1) || null);
  emit();
}

export function setsForExerciseSync(exerciseId) {
  return state.allSets
    .filter((s) => s.exerciseId === exerciseId)
    .sort((a, b) => (a.dateISO === b.dateISO ? (a.order ?? 0) - (b.order ?? 0) : String(a.dateISO).localeCompare(String(b.dateISO))));
}

/* ---------- runs ---------- */

export async function logRun({ dateISO, distance, distanceUnit, durationSec, notes }) {
  const run = await store.addRun({
    dateISO: dateISO || store.todayISO(),
    distance: Number(distance) || 0,
    distanceUnit: distanceUnit || 'km',
    durationSec: Math.round(Number(durationSec) || 0),
    notes: notes || ''
  });
  state.runs = [run, ...state.runs];
  emit();
  return run;
}

export async function removeRun(runId) {
  await store.deleteRun(runId);
  state.runs = state.runs.filter((r) => r.id !== runId);
  emit();
}

export function runsOn(dateISO) {
  return state.runs.filter((r) => r.dateISO === dateISO);
}

/* ---------- weekly summary ---------- */

/**
 * Plain-text summary of the week containing `dateISO`.
 * @returns {{text: string, filename: string, startISO: string, endISO: string}}
 */
export function weeklySummary(dateISO = store.todayISO()) {
  const { startISO, endISO } = weekRange(dateISO);
  const text = buildWeeklySummary({
    sessions: state.allSessions,
    sets: state.allSets,
    runs: state.runs,
    exercises: state.exercises,
    weekStartISO: startISO,
    unit: state.settings.unit
  });
  return { text, filename: summaryFilename(startISO), startISO, endISO };
}

/* ---------- exercises ---------- */

export async function addExercise(input) {
  const exercise = await store.addExercise(input);
  state.exercises = await store.listExercises();
  emit();
  return exercise;
}

export async function updateExercise(exercise) {
  await store.updateExercise(exercise);
  state.exercises = await store.listExercises();
  emit();
  return exercise;
}

export async function deleteExercise(exerciseId) {
  const removed = await store.deleteExercise(exerciseId);
  state.exercises = await store.listExercises();
  state.allSets = state.allSets.filter((s) => s.exerciseId !== exerciseId);
  state.sessionSets = state.sessionSets.filter((s) => s.exerciseId !== exerciseId);
  if (state.currentExerciseId === exerciseId) state.currentExerciseId = null;
  emit();
  return removed;
}

/* ---------- settings ---------- */

export async function updateSettings(patch) {
  state.settings = await store.saveSettings(patch);
  emit();
  return state.settings;
}

/** Saves bookkeeping that no view displays (e.g. which Forge plates were last
 *  seen) without notifying subscribers — a re-render would be pure waste, and
 *  would re-push the activity values mid-animation. */
export async function rememberSetting(patch) {
  state.settings = await store.saveSettings(patch);
  return state.settings;
}

/* ---------- activity-responsive visuals (Forge / Fractal skins) ---------- */

function activityInput() {
  return {
    sessions: state.allSessions,
    runs: state.runs,
    todayISO: store.todayISO(),
    pauseActivityEffects: Boolean(state.settings.pauseActivityEffects),
    activityPausedAt: state.settings.activityPausedAt || null
  };
}

/** Glow / frost state the skins render from. See js/consistency.js. */
export function activityVisual() {
  return activityVisualState(activityInput());
}

/** What the Stage 5 skins draw (js/skin-data.js), as of the same effective
 *  date as every other activity visual, so "Pause activity effects" freezes
 *  these too. */
export function skinData() {
  const input = activityInput();
  const todayISO = effectiveToday(input);
  const trained = new Set(trainingDays(input));
  const prs = new Set(progressionWorking(state.allSets).filter((s) => s.isPR).map((s) => s.dateISO));
  const { streakLevel } = activityVisualState(input);
  const peakLevel = Math.max(Number(state.settings.constellationPeakLevel) || 0, streakLevel);
  const stars = starField({ trained, prs, todayISO });
  return {
    monolith: monolithFaces({ trained, prs, frosted: frostedDates(input), todayISO }),
    constellation: { stars, links: constellationLinks(stars, { level: streakLevel, peakLevel, todayISO }), peakLevel },
    orrery: { planets: orreryPlanets({ sets: state.allSets, exercisesById: new Map(state.exercises.map((ex) => [ex.id, ex])), todayISO }) }
  };
}

/** Calendar days that show frost — always a Set, empty unless genuinely earned. */
export function frostedCalendarDates() {
  return frostedDates(activityInput());
}

/* ---------- collapsible panel state ----------
 * Persisted in settings so a section's expand/collapse choice survives a
 * revisit. Two independent scopes: 'exercises' (the Exercises list) and
 * 'session' (category grouping on the active session). Within a scope, a
 * category defaults to expanded only if it's the one most recently logged
 * against — everything else starts collapsed — until the user explicitly
 * toggles it, at which point their choice is remembered.
 */

/** The category of the most recently logged set, across all history. */
export function mostRecentCategory() {
  if (!state.allSets.length) return null;
  const latest = state.allSets.reduce((a, b) => ((a.lastModified || 0) >= (b.lastModified || 0) ? a : b));
  return exerciseById(latest.exerciseId)?.category || null;
}

export function isPanelExpanded(scope, category) {
  const explicit = state.settings.panelState?.[scope]?.[category];
  if (typeof explicit === 'boolean') return explicit;
  return category === mostRecentCategory();
}

export async function setPanelExpanded(scope, category, expanded) {
  const panelState = { ...(state.settings.panelState || {}) };
  panelState[scope] = { ...(panelState[scope] || {}), [category]: expanded };
  await updateSettings({ panelState });
}
