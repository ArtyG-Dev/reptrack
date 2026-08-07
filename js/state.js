/* Application state. Every view reads from here and mutates through these
 * actions — and every storage call goes through store.js, never db.js.
 */

import * as store from './store.js';
import { SEED_EXERCISES } from './exercises-seed.js';
import { isPersonalRecord } from './progression.js';
import { buildWeeklySummary, weekRange, summaryFilename } from './summary.js';

const state = {
  ready: false,
  settings: { ...store.DEFAULT_SETTINGS },
  exercises: [],
  allSets: [],
  allSessions: [],
  runs: [],
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
  }
  state.exercises = exercises;

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
  state.session = await store.activeSession();
  state.sessionSets = state.session ? await store.setsForSession(state.session.id) : [];
  state.lastSet = state.sessionSets.length ? withExercise(state.sessionSets.at(-1)) : null;
}

export async function reloadAll() {
  state.settings = await store.getSettings();
  state.exercises = await store.listExercises();
  await reloadRecords();
  emit();
  return state;
}

/* ---------- session lifecycle ---------- */

export async function startSession() {
  if (state.session) return state.session;
  state.session = await store.startSession({});
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

export async function setSessionNotes(notes) {
  if (!state.session) return null;
  state.session = { ...state.session, notes };
  await store.saveSession(state.session);
  state.allSessions = state.allSessions.map((s) => (s.id === state.session.id ? state.session : s));
  emit();
  return state.session;
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

export async function updateSetEntry(entry) {
  await store.updateSet(entry);
  const replace = (list) => list.map((s) => (s.id === entry.id ? entry : s));
  state.sessionSets = replace(state.sessionSets);
  state.allSets = replace(state.allSets);
  emit();
  return entry;
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
