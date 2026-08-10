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
