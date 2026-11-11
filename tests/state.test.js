/* state.js's exercise-dictionary seeding and backfill, run against
 * fake-indexeddb. See the backfill note in state.js for why this exists:
 * SEED_EXERCISES only gets written to an empty dictionary, so an install
 * that already had exercises before a starter category was added (yoga,
 * pilates, ...) never received it otherwise.
 */

import 'fake-indexeddb/auto';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as db from '../js/db.js';
import * as store from '../js/store.js';
import * as state from '../js/state.js';
import { SEED_EXERCISES } from '../js/exercises-seed.js';

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

// Today's Strength section — a stand-in for an older dictionary that
// predates the Calisthenics/Yoga/Pilates starters, not a historically exact
// reconstruction of any particular past release.
const STRENGTH_ONLY = SEED_EXERCISES.slice(0, 18);

test('a fresh install seeds every starter exercise, across every category, and marks the backfill done', async () => {
  const { exercises, settings } = await state.init();
  assert.equal(exercises.length, SEED_EXERCISES.length);
  const categories = new Set(exercises.map((ex) => ex.category));
  for (const cat of ['strength', 'calisthenics', 'yoga', 'pilates']) {
    assert.ok(categories.has(cat), `expected a seeded ${cat} exercise`);
  }
  assert.equal(settings.seedBackfillDone, true);
});

test('a dictionary from before the newer starter categories existed gets backfilled once, without touching what is already there', async () => {
  // Has exercises already, so state.init()'s seed-if-empty branch never runs.
  for (const ex of STRENGTH_ONLY) await store.addExercise(ex);
  assert.equal((await store.listExercises()).length, 18);

  const { exercises, settings } = await state.init();
  assert.equal(exercises.length, SEED_EXERCISES.length, 'every starter not already present should now exist');
  const categories = new Set(exercises.map((ex) => ex.category));
  assert.ok(categories.has('yoga') && categories.has('pilates'), 'newer categories should have been backfilled');

  for (const ex of STRENGTH_ONLY) {
    assert.ok(exercises.some((e) => e.name === ex.name), `${ex.name} should still be present`);
  }
  assert.equal(settings.seedBackfillDone, true);
});

test('the backfill never runs twice — a deliberately deleted starter exercise does not come back', async () => {
  for (const ex of STRENGTH_ONLY) await store.addExercise(ex);
  await state.init();                              // first boot after the update — backfill runs, flag set

  const afterFirstBoot = await store.listExercises();
  const yogaPose = afterFirstBoot.find((ex) => ex.category === 'yoga');
  assert.ok(yogaPose, 'sanity check: the backfill actually added a yoga exercise');
  await store.deleteExercise(yogaPose.id);

  await state.init();                              // a later boot
  const afterSecondBoot = await store.listExercises();
  assert.ok(!afterSecondBoot.some((ex) => ex.id === yogaPose.id), 'a deliberately deleted starter must not reappear');
});

test('the backfill matches by name case-insensitively, so an already-present starter is never duplicated', async () => {
  await store.addExercise({ name: 'bench press', aliases: [], muscleGroup: 'chest' });
  const { exercises } = await state.init();
  const benchPresses = exercises.filter((ex) => ex.name.toLowerCase() === 'bench press');
  assert.equal(benchPresses.length, 1, 'the seed\'s "Bench Press" must not duplicate the existing lower-case one');
});

/* ---------- editing a logged set ---------- */

test('editing a set can create a PR, and can take one away — flags are recomputed across the exercise', async () => {
  await state.init();
  const bench = state.getState().exercises.find((e) => e.name === 'Bench Press');
  const [a] = await state.logSets(bench.id, [{ weight: 60, unit: 'kg', reps: 10 }]);
  const [b] = await state.logSets(bench.id, [{ weight: 50, unit: 'kg', reps: 10 }]);
  const flags = () => Object.fromEntries(state.getState().allSets.map((s) => [s.id, s.isPR]));
  assert.deepEqual(flags(), { [a.id]: true, [b.id]: false });

  // Edit the lighter set up past the first: it becomes the PR.
  await state.updateSetEntry({ ...b, weight: 70 });
  assert.deepEqual(flags(), { [a.id]: true, [b.id]: true }, 'a heavier later set is a PR');

  // Edit the first set up: now the later 70 no longer beats it.
  await state.updateSetEntry({ ...a, weight: 80 });
  assert.deepEqual(flags(), { [a.id]: true, [b.id]: false }, 'an edit can remove a PR');

  // And it is stored, not just in memory.
  const stored = Object.fromEntries((await store.allSets()).map((s) => [s.id, s.isPR]));
  assert.deepEqual(stored, flags());
  assert.equal(state.getState().lastSet.weight, 70, 'the last set reflects its edit');
});

/* ---------- Stage 3: muscle backfill ---------- */

const oldShaped = (ex) => { const { primaryMuscles, secondaryMuscles, ...rest } = ex; return rest; };

test('muscle backfill: starters by name, others from muscleGroup, never overwriting, once', async () => {
  const bench = await store.addExercise({ name: 'bench press', muscleGroup: 'chest' });           // starter, other case
  const custom = await store.addExercise({ name: 'Sled Push', muscleGroup: 'legs' });             // not a starter
  const chosen = await store.addExercise({ name: 'Deadlift', primaryMuscles: ['glutes'] });       // already set
  const legacy = await store.addExercise({ name: 'Cable Fly', muscleGroup: 'chest' });
  await store.updateExercise(oldShaped(legacy));                                                   // field absent
  const { exercises, settings } = await state.init();
  const get = (id) => exercises.find((e) => e.id === id);
  assert.deepEqual(get(bench.id).secondaryMuscles, ['front-delts', 'triceps']);
  assert.deepEqual(get(custom.id).primaryMuscles, ['quads', 'hamstrings', 'glutes']);
  assert.deepEqual(get(custom.id).secondaryMuscles, []);
  assert.deepEqual(get(chosen.id).primaryMuscles, ['glutes'], 'a non-empty choice is never overwritten');
  assert.deepEqual(get(legacy.id).primaryMuscles, ['chest']);
  assert.equal(settings.muscleBackfillDone, true);

  // Once: an exercise someone later cleared stays cleared on the next boot.
  await store.updateExercise({ ...get(custom.id), primaryMuscles: [], secondaryMuscles: [] });
  const again = await state.init();
  assert.deepEqual(again.exercises.find((e) => e.id === custom.id).primaryMuscles, []);
});

test('a schema-1 backup with no muscle fields imports, and its exercises get muscles', async () => {
  await state.init();
  const backup = {
    app: 'reptrack', schemaVersion: 1, sessions: [], sets: [], runs: [], settings: [],
    exercises: [
      { id: 'ex_old_1', name: 'Pull Up', aliases: [], muscleGroup: 'back', category: 'calisthenics', mode: 'reps', isCustom: false, isBodyweight: true },
      { id: 'ex_old_2', name: 'Arm Wrestle', aliases: [], muscleGroup: 'arms', category: 'strength', mode: 'reps', isCustom: true, isBodyweight: false }
    ]
  };
  for (const mode of ['replace', 'merge']) {
    await store.importAll(backup, { mode });
    await state.reloadAll();
    const ex = state.getState().exercises;
    assert.deepEqual(ex.find((e) => e.id === 'ex_old_1').secondaryMuscles, ['biceps', 'upper-back', 'rear-delts'], mode);
    assert.deepEqual(ex.find((e) => e.id === 'ex_old_2').primaryMuscles, ['biceps', 'triceps'], mode);
  }
});
