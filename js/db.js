/* IndexedDB primitives. This module owns the schema and the raw reads/writes.
 * Feature code does not import it directly — it goes through store.js, which is
 * the single seam a future sync adapter plugs into (see PHASE_ROADMAP Phase 3).
 *
 * Stores
 *   exercises  { id, name, aliases[], muscleGroup, category, mode,
 *                isCustom, isBodyweight }                                     key: id, index by_name
 *   sessions   { id, dateISO, startTs, endTs, durationSec, notes,
 *                lastModified, visibility, sessionType,
 *                className, instructor, location, attendance }              key: id, index by_date
 *   sets       { id, sessionId, exerciseId, dateISO, order, weight, unit,
 *                reps, rpe, holdSeconds, side, isPR, lastModified, visibility } key: id, indexes by_session / by_exercise
 *   runs       { id, dateISO, distance, distanceUnit, durationSec, notes,
 *                lastModified, visibility }                                   key: id, index by_date
 *   settings   { key, value }                                                 key: key
 *
 * `dateISO` on a set is denormalised from its session so per-exercise history
 * can be read without joining every session (see DECISIONS.md).
 *
 * Every record carries a UUID, a `lastModified` timestamp and a `visibility`
 * flag (`private` by default). Nothing reads `visibility` yet — it exists now so
 * that adding sharing later is a feature, not a data migration.
 *
 * `category` (strength | cardio | calisthenics | yoga | pilates | ...) and `mode`
 * ('reps' — weight/reps/sets, or 'hold' — timed duration) are additive: a set
 * logged before these existed simply has `holdSeconds`/`side` as undefined,
 * which every reader treats the same as null. No IndexedDB version bump was
 * needed for this — no index changed, only optional fields on existing stores.
 *
 * Reserved for Phase 2 (do not create yet): nutrition { id, dateISO, kcal, protein, carbs, fat, note }
 *
 * Reserved for class / PT attendance (schema only — nothing reads these yet;
 * see docs/PHASE_ROADMAP.md): `sessionType` is 'gym' | 'run' | 'class' | 'pt'
 * and defaults to 'gym'; `className`, `instructor`, `location` and
 * `attendance` ('attended' | 'missed' | 'cancelled') default to null. Version 2
 * of the database exists only to stamp `sessionType` onto sessions written
 * before it — every one of those is a gym session, since runs live in their
 * own store.
 */

export const DB_NAME = 'reptrack';
export const DB_VERSION = 3;
export const SCHEMA_VERSION = 2;          // 2 adds `plans`; schema 1 backups are still accepted

export const STORES = Object.freeze({
  exercises: 'exercises',
  sessions: 'sessions',
  sets: 'sets',
  runs: 'runs',
  settings: 'settings',
  plans: 'plans'
});

/** Default sharing state for anything the user records. Phase 3 flips this on. */
export const PRIVATE = 'private';

export const DEFAULT_SETTINGS = Object.freeze({
  unit: 'kg',
  defaultRestSec: 90,
  theme: 'light',
  voiceEnabled: true,
  confirmBeforeLog: true,
  progressionStepKg: 2.5,
  progressionStepLb: 5,
  // Skin controls. `reduceBackgroundEffects` is the manual counterpart to
  // prefers-reduced-motion; `pauseActivityEffects` freezes the Forge/Fractal
  // activity visuals (see js/consistency.js) as of `activityPausedAt`, which is
  // stamped when the toggle goes on and cleared when it goes off.
  reduceBackgroundEffects: false,
  pauseActivityEffects: false,
  activityPausedAt: null,
  // The streak level whose Forge plates the user last watched settle, so a
  // level gained between visits is shown going on once (js/backdrop.js).
  forgePlatesSeenLevel: null,
  // Fractal colours chosen by dragging in the full-screen view (theme-engine
  // TINT), and whether the one-time "drag to recolour" hint has been shown.
  fractalColour: { hue: 0, warmth: 0 },
  fractalHintSeen: false,
  // Rest timer and session conveniences, both on by default.
  vibrateOnRest: true,
  keepScreenOn: true,
  // Backups: when the last export happened, and when the reminder last showed.
  lastExportAt: null,
  backupNudgeShownAt: null,
  // Set once state.init() has merged any starter exercises added to
  // exercises-seed.js after this install's dictionary was first created —
  // see the backfill note in state.js. Never re-checked after that, so a
  // starter exercise a user deliberately deletes doesn't come back.
  seedBackfillDone: false
});

let dbPromise = null;
let dbHandle = null;

export function uid(prefix = 'id') {
  const rnd = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rnd}`;
}

export function todayISO(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function idb() {
  const impl = globalThis.indexedDB;
  if (!impl) throw new Error('IndexedDB is unavailable in this browser.');
  return impl;
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = idb().open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (event.oldVersion < 1) {
        const ex = db.createObjectStore(STORES.exercises, { keyPath: 'id' });
        ex.createIndex('by_name', 'name', { unique: false });

        const se = db.createObjectStore(STORES.sessions, { keyPath: 'id' });
        se.createIndex('by_date', 'dateISO', { unique: false });

        const st = db.createObjectStore(STORES.sets, { keyPath: 'id' });
        st.createIndex('by_session', 'sessionId', { unique: false });
        st.createIndex('by_exercise', 'exerciseId', { unique: false });

        const ru = db.createObjectStore(STORES.runs, { keyPath: 'id' });
        ru.createIndex('by_date', 'dateISO', { unique: false });

        db.createObjectStore(STORES.settings, { keyPath: 'key' });
      }
      if (event.oldVersion >= 1 && event.oldVersion < 2) {
        // v1 → v2: give every existing session its type and the reserved
        // attendance fields. Runs are a separate store, so all of them are gym.
        const cursorReq = req.transaction.objectStore(STORES.sessions).openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          cursor.update(withSessionDefaults(cursor.value));
          cursor.continue();
        };
      }
      if (event.oldVersion < 3) {
        // v3: session plans. A new store only — nothing existing changes.
        db.createObjectStore(STORES.plans, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      dbHandle = req.result;
      // Another tab upgrading the schema must not be blocked by this connection.
      dbHandle.onversionchange = () => { _resetConnection(); };
      resolve(dbHandle);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database upgrade blocked by another open tab.'));
  });
  return dbPromise;
}

/** Closes and forgets the connection, so the next open() starts clean. */
export function _resetConnection() {
  try { dbHandle?.close(); } catch { /* already closed */ }
  dbHandle = null;
  dbPromise = null;
}

function tx(db, storeNames, mode) {
  const t = db.transaction(storeNames, mode);
  const done = new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
  return { t, done };
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ---------- generic access ---------- */

/** Every record write is stamped, so a future sync has a change clock to use. */
function stamp(value) {
  if (value && typeof value === 'object' && 'id' in value) {
    value.lastModified = Date.now();
    if (value.visibility === undefined) value.visibility = PRIVATE;
  }
  return value;
}

export async function put(storeName, value) {
  const db = await openDB();
  const { t, done } = tx(db, [storeName], 'readwrite');
  t.objectStore(storeName).put(stamp(value));
  await done;
  return value;
}

export async function putMany(storeName, values) {
  if (!values.length) return values;
  const db = await openDB();
  const { t, done } = tx(db, [storeName], 'readwrite');
  const store = t.objectStore(storeName);
  for (const v of values) store.put(stamp(v));
  await done;
  return values;
}

export async function get(storeName, key) {
  const db = await openDB();
  const { t } = tx(db, [storeName], 'readonly');
  return wrap(t.objectStore(storeName).get(key));
}

export async function getAll(storeName) {
  const db = await openDB();
  const { t } = tx(db, [storeName], 'readonly');
  return wrap(t.objectStore(storeName).getAll());
}

export async function getAllByIndex(storeName, indexName, key) {
  const db = await openDB();
  const { t } = tx(db, [storeName], 'readonly');
  return wrap(t.objectStore(storeName).index(indexName).getAll(key));
}

export async function del(storeName, key) {
  const db = await openDB();
  const { t, done } = tx(db, [storeName], 'readwrite');
  t.objectStore(storeName).delete(key);
  await done;
}

export async function clearStore(storeName) {
  const db = await openDB();
  const { t, done } = tx(db, [storeName], 'readwrite');
  t.objectStore(storeName).clear();
  await done;
}

/* ---------- settings ---------- */

export async function getSettings() {
  const rows = await getAll(STORES.settings);
  const saved = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { ...DEFAULT_SETTINGS, ...saved };
}

export async function saveSettings(patch) {
  const entries = Object.entries(patch).map(([key, value]) => ({ key, value }));
  await putMany(STORES.settings, entries);
  return getSettings();
}

/* ---------- exercises ---------- */

export async function listExercises() {
  const all = await getAll(STORES.exercises);
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export function makeExercise({
  name, aliases = [], muscleGroup = 'other', category = 'strength', mode = 'reps',
  isCustom = true, isBodyweight = false
}) {
  return {
    id: uid('ex'),
    name: name.trim(),
    aliases: aliases.map((a) => a.trim().toLowerCase()),
    muscleGroup,
    category: (category || 'strength').trim().toLowerCase(),
    mode: mode === 'hold' ? 'hold' : 'reps',
    isCustom,
    isBodyweight
  };
}

export async function addExercise(input) {
  const exercise = makeExercise(input);
  await put(STORES.exercises, exercise);
  return exercise;
}

export async function updateExercise(exercise) {
  return put(STORES.exercises, exercise);
}

/** Removes an exercise and every set logged against it. */
export async function deleteExercise(exerciseId) {
  const sets = await getAllByIndex(STORES.sets, 'by_exercise', exerciseId);
  const db = await openDB();
  const { t, done } = tx(db, [STORES.sets, STORES.exercises], 'readwrite');
  const setStore = t.objectStore(STORES.sets);
  for (const s of sets) setStore.delete(s.id);
  t.objectStore(STORES.exercises).delete(exerciseId);
  await done;
  return sets.length;
}

/* ---------- sessions ---------- */

export const SESSION_TYPES = Object.freeze(['gym', 'run', 'class', 'pt']);

/** Fills the class/PT fields on a session that predates them. Never
 *  overwrites a value that is already there. */
export function withSessionDefaults(session) {
  return {
    ...session,
    sessionType: SESSION_TYPES.includes(session.sessionType) ? session.sessionType : 'gym',
    className: session.className ?? null,
    instructor: session.instructor ?? null,
    location: session.location ?? null,
    attendance: session.attendance ?? null
  };
}

/** `planId` records the plan a session was started from (null otherwise);
 *  `planMarks` holds the user's own ticks for it — { [itemIndex]: 'done' |
 *  'open' | 'skipped' } — for this session only. Both additive: older
 *  sessions simply lack them, which reads as "no plan". */
export function makeSession({ dateISO = todayISO(), startTs = Date.now(), notes = '', planId = null } = {}) {
  return withSessionDefaults({ id: uid('ses'), dateISO, startTs, endTs: null, durationSec: 0, notes, planId, planMarks: {}, lastModified: Date.now(), visibility: PRIVATE });
}

export async function startSession(input) {
  const session = makeSession(input);
  await put(STORES.sessions, session);
  return session;
}

export async function endSession(sessionId, endTs = Date.now()) {
  const session = await get(STORES.sessions, sessionId);
  if (!session) return null;
  session.endTs = endTs;
  session.durationSec = Math.max(0, Math.round((endTs - session.startTs) / 1000));
  await put(STORES.sessions, session);
  return session;
}

export async function getSession(sessionId) {
  return get(STORES.sessions, sessionId);
}

export async function listSessions() {
  const all = await getAll(STORES.sessions);
  return all.sort((a, b) => b.startTs - a.startTs);
}

export async function sessionsForDate(dateISO) {
  return getAllByIndex(STORES.sessions, 'by_date', dateISO);
}

export async function activeSession() {
  const all = await getAll(STORES.sessions);
  return all.filter((s) => s.endTs === null).sort((a, b) => b.startTs - a.startTs)[0] || null;
}

/** Removes a session and its sets. */
export async function deleteSession(sessionId) {
  const sets = await getAllByIndex(STORES.sets, 'by_session', sessionId);
  const db = await openDB();
  const { t, done } = tx(db, [STORES.sets, STORES.sessions], 'readwrite');
  const setStore = t.objectStore(STORES.sets);
  for (const s of sets) setStore.delete(s.id);
  t.objectStore(STORES.sessions).delete(sessionId);
  await done;
  return sets.length;
}

/* ---------- sets ---------- */

/**
 * `holdSeconds`/`side` are only meaningful for a `mode: 'hold'` exercise (yoga,
 * pilates, a timed calisthenics hold like a plank). A `reps` exercise leaves
 * both null — `weight`/`reps` cover strength and calisthenics rep work alike.
 */
export function makeSet({
  sessionId, exerciseId, dateISO, order = 0, weight = 0, unit = 'kg', reps = 0, rpe = null,
  holdSeconds = null, side = null, isPR = false, isWarmup = false
}) {
  return {
    id: uid('set'), sessionId, exerciseId, dateISO, order, weight, unit, reps, rpe,
    holdSeconds, side, isPR, isWarmup: Boolean(isWarmup), lastModified: Date.now(), visibility: PRIVATE
  };
}

export async function addSet(input) {
  const entry = makeSet(input);
  await put(STORES.sets, entry);
  return entry;
}

export async function updateSet(entry) {
  return put(STORES.sets, entry);
}

export async function deleteSet(setId) {
  return del(STORES.sets, setId);
}

export async function setsForSession(sessionId) {
  const sets = await getAllByIndex(STORES.sets, 'by_session', sessionId);
  return sets.sort((a, b) => a.order - b.order);
}

export async function setsForExercise(exerciseId) {
  const sets = await getAllByIndex(STORES.sets, 'by_exercise', exerciseId);
  return sets.sort((a, b) => (a.dateISO === b.dateISO ? a.order - b.order : a.dateISO.localeCompare(b.dateISO)));
}

/** Dates (ISO) that have at least one session, as a Set — powers the calendar dots. */
export async function sessionDates() {
  const all = await getAll(STORES.sessions);
  return new Set(all.map((s) => s.dateISO));
}

/* ---------- runs / cardio ---------- */

export function makeRun({ dateISO = todayISO(), distance = 0, distanceUnit = 'km', durationSec = 0, notes = '' }) {
  return { id: uid('run'), dateISO, distance, distanceUnit, durationSec, notes, lastModified: Date.now(), visibility: PRIVATE };
}

export async function addRun(input) {
  const run = makeRun(input);
  await put(STORES.runs, run);
  return run;
}

export async function updateRun(run) {
  return put(STORES.runs, run);
}

export async function deleteRun(runId) {
  return del(STORES.runs, runId);
}

export async function listRuns() {
  const all = await getAll(STORES.runs);
  return all.sort((a, b) => String(b.dateISO).localeCompare(String(a.dateISO)));
}

export async function runsForDate(dateISO) {
  return getAllByIndex(STORES.runs, 'by_date', dateISO);
}

/* ---------- plans ---------- */

/** Plan { id, name, order, items: [{ exerciseId, targetSets, targetReps,
 *  targetWeight, unit, targetHoldSec, note }], lastModified, visibility } */
export function makePlan({ name = 'New plan', items = [], order = Date.now() } = {}) {
  return { id: uid('plan'), name, order, items, lastModified: Date.now(), visibility: PRIVATE };
}

export async function listPlans() {
  const plans = await getAll(STORES.plans);
  return plans.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function savePlan(plan) {
  return put(STORES.plans, plan);
}

export async function deletePlan(planId) {
  return del(STORES.plans, planId);
}

/* ---------- export / import ---------- */

export async function exportAll() {
  const [exercises, sessions, sets, runs, settings, plans] = await Promise.all([
    getAll(STORES.exercises),
    getAll(STORES.sessions),
    getAll(STORES.sets),
    getAll(STORES.runs),
    getAll(STORES.settings),
    getAll(STORES.plans)
  ]);
  return {
    app: 'reptrack',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    exercises,
    sessions,
    sets,
    runs,
    settings,
    plans
  };
}

export function validateBackup(data) {
  const errors = [];
  if (!data || typeof data !== 'object') errors.push('Backup is not a JSON object.');
  else {
    if (data.app !== 'reptrack') errors.push('Not a RepTrack backup (missing app: "reptrack").');
    if (typeof data.schemaVersion !== 'number') errors.push('Missing schemaVersion.');
    else if (data.schemaVersion > SCHEMA_VERSION) errors.push(`Backup schema v${data.schemaVersion} is newer than this app (v${SCHEMA_VERSION}).`);
    for (const key of ['exercises', 'sessions', 'sets']) {
      if (!Array.isArray(data?.[key])) errors.push(`Missing or invalid "${key}" array.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Restores a backup. mode 'replace' wipes first; mode 'merge' keeps existing
 * rows and overwrites only where ids collide.
 */
export async function importAll(data, { mode = 'replace' } = {}) {
  const { ok, errors } = validateBackup(data);
  if (!ok) throw new Error(errors.join(' '));

  if (mode === 'replace') await wipeAll();

  await putMany(STORES.exercises, data.exercises);
  await putMany(STORES.sessions, data.sessions.map(withSessionDefaults));   // older backups predate sessionType
  await putMany(STORES.sets, data.sets);
  if (Array.isArray(data.runs)) await putMany(STORES.runs, data.runs);
  if (Array.isArray(data.settings)) await putMany(STORES.settings, data.settings);
  if (Array.isArray(data.plans)) await putMany(STORES.plans, data.plans);     // schema 1 has none

  return {
    exercises: data.exercises.length,
    sessions: data.sessions.length,
    sets: data.sets.length,
    runs: Array.isArray(data.runs) ? data.runs.length : 0
  };
}

export async function wipeAll() {
  for (const store of Object.values(STORES)) await clearStore(store);
}

/** Asks the browser to keep this origin's data even under storage pressure.
 *  Chrome on Android decides without a prompt (an installed PWA is granted);
 *  where the API is missing this reports `null` rather than pretending. */
export async function requestPersistence() {
  if (!navigator?.storage?.persist) return null;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** true / false, or null where the browser cannot say. */
export async function isPersisted() {
  if (!navigator?.storage?.persisted) return null;
  try { return await navigator.storage.persisted(); } catch { return null; }
}

/** Browser storage estimate in bytes, or null where the API is unavailable. */
export async function estimateUsage() {
  if (!navigator?.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}
