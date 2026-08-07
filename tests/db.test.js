/* IndexedDB round-trips, run against fake-indexeddb (same API surface). */

import 'fake-indexeddb/auto';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as db from '../js/db.js';

async function freshDatabase() {
  db._resetConnection();
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(db.DB_NAME);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
    req.onblocked = resolve;
  });
}

beforeEach(freshDatabase);

test('opens with every store and index the app relies on', async () => {
  const handle = await db.openDB();
  assert.deepEqual([...handle.objectStoreNames].sort(), ['exercises', 'runs', 'sessions', 'sets', 'settings']);
  const tx = handle.transaction(['sets', 'sessions', 'runs'], 'readonly');
  assert.deepEqual([...tx.objectStore('sets').indexNames].sort(), ['by_exercise', 'by_session']);
  assert.deepEqual([...tx.objectStore('sessions').indexNames], ['by_date']);
  assert.deepEqual([...tx.objectStore('runs').indexNames], ['by_date']);
  assert.ok(!handle.objectStoreNames.contains('nutrition'), 'nutrition is Phase 2 — not built yet');
});

test('settings fall back to defaults and persist a patch', async () => {
  assert.deepEqual(await db.getSettings(), { ...db.DEFAULT_SETTINGS });
  const updated = await db.saveSettings({ unit: 'lb', defaultRestSec: 120 });
  assert.equal(updated.unit, 'lb');
  assert.equal(updated.defaultRestSec, 120);
  assert.equal(updated.theme, db.DEFAULT_SETTINGS.theme);

  db._resetConnection();
  assert.equal((await db.getSettings()).unit, 'lb');   // survives a reconnect
});

test('a full session round-trips: start, log sets, end, read back', async () => {
  const bench = await db.addExercise({ name: 'Bench Press', aliases: ['bench'], muscleGroup: 'chest' });
  const session = await db.startSession({ dateISO: '2026-03-02', startTs: 1_000_000 });

  await db.addSet({ sessionId: session.id, exerciseId: bench.id, dateISO: session.dateISO, order: 0, weight: 60, unit: 'kg', reps: 10 });
  await db.addSet({ sessionId: session.id, exerciseId: bench.id, dateISO: session.dateISO, order: 1, weight: 65, unit: 'kg', reps: 8 });

  const ended = await db.endSession(session.id, 1_000_000 + 45 * 60 * 1000);
  assert.equal(ended.durationSec, 2700);

  const sets = await db.setsForSession(session.id);
  assert.equal(sets.length, 2);
  assert.deepEqual(sets.map((s) => s.reps), [10, 8]);

  const byExercise = await db.setsForExercise(bench.id);
  assert.equal(byExercise.length, 2);

  assert.deepEqual([...(await db.sessionDates())], ['2026-03-02']);
  assert.equal((await db.sessionsForDate('2026-03-02')).length, 1);
  assert.equal(await db.activeSession(), null);
});

test('an unfinished session is found again after a reload', async () => {
  const session = await db.startSession({ dateISO: '2026-03-03' });
  db._resetConnection();
  const found = await db.activeSession();
  assert.equal(found.id, session.id);
  assert.equal(found.endTs, null);
});

test('deleting a session removes its sets', async () => {
  const ex = await db.addExercise({ name: 'Squat' });
  const session = await db.startSession({ dateISO: '2026-03-04' });
  await db.addSet({ sessionId: session.id, exerciseId: ex.id, dateISO: '2026-03-04', weight: 100, reps: 5 });
  const removed = await db.deleteSession(session.id);
  assert.equal(removed, 1);
  assert.equal((await db.getAll(db.STORES.sets)).length, 0);
  assert.equal(await db.getSession(session.id), undefined);
});

test('deleting an exercise removes its sets', async () => {
  const ex = await db.addExercise({ name: 'Curl' });
  const session = await db.startSession({});
  await db.addSet({ sessionId: session.id, exerciseId: ex.id, dateISO: '2026-03-05', weight: 20, reps: 12 });
  assert.equal(await db.deleteExercise(ex.id), 1);
  assert.equal((await db.listExercises()).length, 0);
  assert.equal((await db.getAll(db.STORES.sets)).length, 0);
});

test('export → wipe → import restores everything (the backup path)', async () => {
  const ex = await db.addExercise({ name: 'Deadlift', aliases: ['dead lift'] });
  const session = await db.startSession({ dateISO: '2026-03-06', startTs: 5_000 });
  await db.addSet({ sessionId: session.id, exerciseId: ex.id, dateISO: '2026-03-06', order: 0, weight: 140, unit: 'kg', reps: 5, isPR: true });
  await db.endSession(session.id, 5_000 + 60_000);
  await db.saveSettings({ unit: 'lb' });

  const backup = await db.exportAll();
  assert.equal(backup.app, 'reptrack');
  assert.equal(backup.schemaVersion, db.SCHEMA_VERSION);

  // Survives a JSON serialise/parse cycle, which is how it leaves the device.
  const roundTripped = JSON.parse(JSON.stringify(backup));

  await db.wipeAll();
  assert.equal((await db.listExercises()).length, 0);
  assert.equal((await db.getSettings()).unit, 'kg');

  const counts = await db.importAll(roundTripped, { mode: 'replace' });
  assert.deepEqual(counts, { exercises: 1, sessions: 1, sets: 1, runs: 0 });

  const sets = await db.getAll(db.STORES.sets);
  assert.equal(sets.length, 1);
  assert.equal(sets[0].weight, 140);
  assert.equal(sets[0].isPR, true);
  assert.equal((await db.getSettings()).unit, 'lb');
  assert.equal((await db.listExercises())[0].name, 'Deadlift');
  assert.equal((await db.getSession(session.id)).durationSec, 60);
});

test('merge import keeps existing rows', async () => {
  const kept = await db.addExercise({ name: 'Row' });
  const backup = {
    app: 'reptrack',
    schemaVersion: 1,
    exercises: [{ id: 'ex_imported', name: 'Pull Up', aliases: [], muscleGroup: 'back', isCustom: false }],
    sessions: [],
    sets: []
  };
  await db.importAll(backup, { mode: 'merge' });
  const names = (await db.listExercises()).map((e) => e.name).sort();
  assert.deepEqual(names, ['Pull Up', 'Row']);
  assert.ok(await db.get(db.STORES.exercises, kept.id));
});

test('rubbish backups are rejected before anything is touched', async () => {
  await db.addExercise({ name: 'Bench Press' });

  assert.equal(db.validateBackup(null).ok, false);
  assert.equal(db.validateBackup({ app: 'other' }).ok, false);
  assert.match(db.validateBackup({ app: 'reptrack', schemaVersion: 99, exercises: [], sessions: [], sets: [] }).errors[0], /newer than this app/);

  await assert.rejects(() => db.importAll({ app: 'nope' }, { mode: 'replace' }), /Not a RepTrack backup/);
  assert.equal((await db.listExercises()).length, 1, 'existing data must survive a rejected import');
});

test('runs round-trip and read back newest first', async () => {
  await db.addRun({ dateISO: '2026-08-04', distance: 5, distanceUnit: 'km', durationSec: 1500 });
  await db.addRun({ dateISO: '2026-08-08', distance: 10, distanceUnit: 'km', durationSec: 3300 });

  const runs = await db.listRuns();
  assert.deepEqual(runs.map((r) => r.dateISO), ['2026-08-08', '2026-08-04']);
  assert.equal(runs[0].distance, 10);

  const onDay = await db.runsForDate('2026-08-04');
  assert.equal(onDay.length, 1);
  assert.equal(onDay[0].durationSec, 1500);

  await db.deleteRun(runs[0].id);
  assert.equal((await db.listRuns()).length, 1);
});

test('runs are carried in a backup alongside sets', async () => {
  const ex = await db.addExercise({ name: 'Deadlift' });
  const session = await db.startSession({ dateISO: '2026-08-04' });
  await db.addSet({ sessionId: session.id, exerciseId: ex.id, dateISO: '2026-08-04', weight: 100, reps: 5 });
  await db.addRun({ dateISO: '2026-08-04', distance: 5, distanceUnit: 'km', durationSec: 1500 });

  const backup = JSON.parse(JSON.stringify(await db.exportAll()));
  assert.equal(backup.runs.length, 1);

  await db.wipeAll();
  const counts = await db.importAll(backup, { mode: 'replace' });
  assert.equal(counts.runs, 1);
  assert.equal((await db.listRuns())[0].distance, 5);
});

test('every record carries a UUID, a lastModified stamp and private visibility', async () => {
  const exercise = await db.addExercise({ name: 'Bench Press' });
  const session = await db.startSession({ dateISO: '2026-08-04' });
  const entry = await db.addSet({ sessionId: session.id, exerciseId: exercise.id, dateISO: '2026-08-04', weight: 60, reps: 10 });
  const run = await db.addRun({ dateISO: '2026-08-04', distance: 5, distanceUnit: 'km', durationSec: 1500 });

  for (const record of [session, entry, run]) {
    assert.match(record.id, /^(ses|set|run)_/);
    assert.equal(typeof record.lastModified, 'number');
    assert.ok(record.lastModified > 0);
    assert.equal(record.visibility, db.PRIVATE, 'nothing is shared by default');
  }
});

test('lastModified moves forward on every write — the hook a future sync needs', async () => {
  const session = await db.startSession({ dateISO: '2026-08-04', startTs: 1000 });
  const first = (await db.getSession(session.id)).lastModified;

  await new Promise((resolve) => setTimeout(resolve, 5));
  await db.endSession(session.id, 61_000);

  const second = (await db.getSession(session.id)).lastModified;
  assert.ok(second > first, `${second} should be later than ${first}`);
});

test('exercises default to strength/reps but accept any category and a hold mode', async () => {
  const plain = await db.addExercise({ name: 'Bench Press' });
  assert.equal(plain.category, 'strength');
  assert.equal(plain.mode, 'reps');

  const plank = await db.addExercise({ name: 'Plank', category: 'calisthenics', mode: 'hold' });
  assert.equal(plank.category, 'calisthenics');
  assert.equal(plank.mode, 'hold');

  const custom = await db.addExercise({ name: 'Kettlebell Swing', category: 'Crossfit ' });
  assert.equal(custom.category, 'crossfit', 'category is freeform, not limited to a fixed enum');

  const junkMode = await db.addExercise({ name: 'Something', mode: 'nonsense' });
  assert.equal(junkMode.mode, 'reps', 'an invalid mode falls back to reps');
});

test('a hold-mode set carries holdSeconds and an optional side; a reps set leaves them null', async () => {
  const plank = await db.addExercise({ name: 'Plank', category: 'calisthenics', mode: 'hold' });
  const session = await db.startSession({ dateISO: '2026-08-10' });

  const holdEntry = await db.addSet({ sessionId: session.id, exerciseId: plank.id, dateISO: '2026-08-10', holdSeconds: 45, side: 'left' });
  assert.equal(holdEntry.holdSeconds, 45);
  assert.equal(holdEntry.side, 'left');

  const bench = await db.addExercise({ name: 'Bench Press' });
  const repsEntry = await db.addSet({ sessionId: session.id, exerciseId: bench.id, dateISO: '2026-08-10', weight: 60, reps: 10 });
  assert.equal(repsEntry.holdSeconds, null);
  assert.equal(repsEntry.side, null);
});

test('category and mode round-trip through a backup export/import', async () => {
  await db.addExercise({ name: 'Downward Dog', category: 'yoga', mode: 'hold' });
  const backup = JSON.parse(JSON.stringify(await db.exportAll()));

  await db.wipeAll();
  await db.importAll(backup, { mode: 'replace' });

  const restored = (await db.listExercises())[0];
  assert.equal(restored.category, 'yoga');
  assert.equal(restored.mode, 'hold');
});

test('ids are unique and dates format as YYYY-MM-DD', () => {
  const ids = new Set(Array.from({ length: 500 }, () => db.uid('set')));
  assert.equal(ids.size, 500);
  assert.equal(db.todayISO(new Date(2026, 0, 5)), '2026-01-05');
});
