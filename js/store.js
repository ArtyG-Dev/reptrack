/* The storage seam.
 *
 * Every feature module reads and writes through this file — never through
 * db.js directly. Today it is a thin pass-through to IndexedDB. When Phase 3
 * adds sync, the adapter goes *here*: each write already carries a UUID and a
 * `lastModified` stamp, and each record a `visibility` flag, so a delta-sync
 * layer can be slotted in without touching a single view.
 *
 * Rule of thumb: if a module needs data, it imports store.js.
 */

import * as db from './db.js';

export const STORES = db.STORES;
export const DEFAULT_SETTINGS = db.DEFAULT_SETTINGS;
export const SCHEMA_VERSION = db.SCHEMA_VERSION;
export const DB_NAME = db.DB_NAME;
export const PRIVATE = db.PRIVATE;

export const uid = db.uid;
export const todayISO = db.todayISO;

/* lifecycle */
export const open = db.openDB;
export const reset = db._resetConnection;

/* settings */
export const getSettings = db.getSettings;
export const saveSettings = db.saveSettings;

/* exercises */
export const listExercises = db.listExercises;
export const addExercise = db.addExercise;
export const updateExercise = db.updateExercise;
export const deleteExercise = db.deleteExercise;

/* sessions */
export const startSession = db.startSession;
export const endSession = db.endSession;
export const getSession = db.getSession;
export const listSessions = db.listSessions;
export const sessionsForDate = db.sessionsForDate;
export const activeSession = db.activeSession;
export const deleteSession = db.deleteSession;
export const saveSession = (session) => db.put(db.STORES.sessions, session);

/* sets */
export const addSet = db.addSet;
export const updateSet = db.updateSet;
export const deleteSet = db.deleteSet;
export const setsForSession = db.setsForSession;
export const setsForExercise = db.setsForExercise;
export const allSets = () => db.getAll(db.STORES.sets);

/* runs */
export const addRun = db.addRun;
export const updateRun = db.updateRun;
export const deleteRun = db.deleteRun;
export const listRuns = db.listRuns;
export const runsForDate = db.runsForDate;

/* backup */
export const exportAll = db.exportAll;
export const importAll = db.importAll;
export const validateBackup = db.validateBackup;
export const wipeAll = db.wipeAll;
export const estimateUsage = db.estimateUsage;
export const requestPersistence = db.requestPersistence;
export const isPersisted = db.isPersisted;
