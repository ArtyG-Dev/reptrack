import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTranscript, matchExercise, wordsToNumbers, normalizeTranscript, describeSet } from '../js/parser.js';
import { SEED_EXERCISES } from '../js/exercises-seed.js';

const exercises = SEED_EXERCISES.map((ex, i) => ({ id: `ex_${i}`, isCustom: false, ...ex }));
const byName = (name) => exercises.find((e) => e.name === name);
const ctx = (extra = {}) => ({ exercises, defaultUnit: 'kg', ...extra });

test('normalisation strips punctuation but keeps decimals and commas', () => {
  assert.equal(normalizeTranscript('Bench Press 62.5 kilos, for 10!'), 'bench press 62.5 kilos , for 10');
});

test('spoken numbers become digits', () => {
  assert.equal(wordsToNumbers('sixty kilos for ten'), '60 kilos for 10');
  assert.equal(wordsToNumbers('one hundred and five'), '105');
  assert.equal(wordsToNumbers('sixty two point five'), '62.5');
  assert.equal(wordsToNumbers('sixty and a half'), '60.5');
  assert.equal(wordsToNumbers('one hundred kilos five reps'), '100 kilos 5 reps');
});

test('spec case 1 — "bench press 60 kilos for 10"', () => {
  const r = parseTranscript('bench press 60 kilos for 10', ctx());
  assert.equal(r.ok, true);
  assert.equal(r.intent, 'log');
  assert.equal(r.exercise.name, 'Bench Press');
  assert.deepEqual(r.sets, [{ weight: 60, unit: 'kg', reps: 10, rpe: null }]);
});

test('spec case 2 — "squat 100 kilos 5 reps 3 sets" expands to three sets', () => {
  const r = parseTranscript('squat 100 kilos 5 reps 3 sets', ctx());
  assert.equal(r.ok, true);
  assert.equal(r.exercise.name, 'Back Squat');
  assert.equal(r.sets.length, 3);
  for (const s of r.sets) assert.deepEqual(s, { weight: 100, unit: 'kg', reps: 5, rpe: null });
});

test('spec case 3 — "deadlift 140 for 5" falls back to the default unit', () => {
  const kg = parseTranscript('deadlift 140 for 5', ctx());
  assert.equal(kg.exercise.name, 'Deadlift');
  assert.deepEqual(kg.sets, [{ weight: 140, unit: 'kg', reps: 5, rpe: null }]);

  const lb = parseTranscript('deadlift 140 for 5', ctx({ defaultUnit: 'lb' }));
  assert.equal(lb.sets[0].unit, 'lb');
});

test('spec case 4 — "add another set" repeats the last logged set', () => {
  const lastSet = { weight: 80, unit: 'kg', reps: 8, rpe: null, exercise: byName('Bench Press') };
  const r = parseTranscript('add another set', ctx({ lastSet }));
  assert.equal(r.ok, true);
  assert.equal(r.intent, 'repeat-last');
  assert.equal(r.exercise.name, 'Bench Press');
  assert.deepEqual(r.sets, [{ weight: 80, unit: 'kg', reps: 8, rpe: null }]);
});

test('"add another set" with nothing logged yet reports why', () => {
  const r = parseTranscript('add another set', ctx());
  assert.equal(r.ok, false);
  assert.equal(r.intent, 'repeat-last');
  assert.match(r.error, /No set logged yet/);
});

test('spec case 5 — "same as last time" pulls the previous session', () => {
  const bench = byName('Bench Press');
  const previous = [
    { weight: 70, unit: 'kg', reps: 8, rpe: null },
    { weight: 75, unit: 'kg', reps: 6, rpe: null }
  ];
  const r = parseTranscript('bench press same as last time', ctx({ lastSetsFor: () => previous }));
  assert.equal(r.ok, true);
  assert.equal(r.intent, 'same-as-last');
  assert.equal(r.exercise.id, bench.id);
  assert.deepEqual(r.sets, previous);
});

test('"same as last time" uses the exercise in focus when none is spoken', () => {
  const r = parseTranscript('same as last time', ctx({
    currentExercise: byName('Deadlift'),
    lastSetsFor: () => [{ weight: 120, unit: 'kg', reps: 5, rpe: null }]
  }));
  assert.equal(r.ok, true);
  assert.equal(r.exercise.name, 'Deadlift');
});

test('spec case 6 — comma-separated ascending sets', () => {
  const r = parseTranscript('60 kilos 10, 65 for 8, 70 for 6', ctx({ currentExercise: byName('Bench Press') }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.sets, [
    { weight: 60, unit: 'kg', reps: 10, rpe: null },
    { weight: 65, unit: 'kg', reps: 8, rpe: null },
    { weight: 70, unit: 'kg', reps: 6, rpe: null }
  ]);
});

test('fuzzy aliases resolve to the canonical exercise', () => {
  assert.equal(matchExercise('bench', exercises).exercise.name, 'Bench Press');
  assert.equal(matchExercise('ohp', exercises).exercise.name, 'Overhead Press');
  assert.equal(matchExercise('overhead press', exercises).exercise.name, 'Overhead Press');
  assert.equal(matchExercise('squats', exercises).exercise.name, 'Back Squat');
  assert.equal(matchExercise('rdls', exercises).exercise.name, 'Romanian Deadlift');
});

test('a near-miss transcription still lands on the right lift', () => {
  const r = parseTranscript('bench pres 60 kilos for 10', ctx());
  assert.equal(r.ok, true);
  assert.equal(r.exercise.name, 'Bench Press');
});

test('pounds are understood and carried through', () => {
  const r = parseTranscript('bench press 135 pounds for 5', ctx());
  assert.deepEqual(r.sets, [{ weight: 135, unit: 'lb', reps: 5, rpe: null }]);
});

test('bodyweight exercises read a lone number as reps', () => {
  const r = parseTranscript('pull ups 12', ctx());
  assert.equal(r.exercise.name, 'Pull Up');
  assert.deepEqual(r.sets, [{ weight: 0, unit: 'kg', reps: 12, rpe: null }]);
});

test('"three sets of five at 100 kilos" parses in either order', () => {
  const r = parseTranscript('squat 3 sets of 5 at 100 kilos', ctx());
  assert.equal(r.sets.length, 3);
  assert.deepEqual(r.sets[0], { weight: 100, unit: 'kg', reps: 5, rpe: null });
});

test('RPE is captured when spoken', () => {
  const r = parseTranscript('deadlift 140 for 5 rpe 8', ctx());
  assert.equal(r.sets[0].rpe, 8);
});

test('"for" misheard as "four" is repaired', () => {
  const r = parseTranscript('bench press sixty kilos four ten', ctx());
  assert.deepEqual(r.sets, [{ weight: 60, unit: 'kg', reps: 10, rpe: null }]);
});

test('an unknown exercise fails loudly instead of guessing', () => {
  const r = parseTranscript('zercher good morning 60 kilos for 10', ctx());
  assert.equal(r.ok, false);
  assert.match(r.error, /No exercise matches/);
});

test('an exercise with no numbers fails with a clear reason', () => {
  const r = parseTranscript('bench press', ctx());
  assert.equal(r.ok, false);
  assert.match(r.error, /no weight and reps/);
});

test('empty input never throws', () => {
  const r = parseTranscript('', ctx());
  assert.equal(r.ok, false);
  assert.equal(r.error, 'Nothing was heard.');
});

test('numbers-only input needs an exercise in focus', () => {
  const r = parseTranscript('60 kilos for 10', ctx());
  assert.equal(r.ok, false);
  assert.match(r.error, /No exercise named/);
});

test('set descriptions read the way people speak', () => {
  assert.equal(describeSet({ weight: 62.5, unit: 'kg', reps: 8 }), '62.5 kg × 8');
  assert.equal(describeSet({ weight: 0, unit: 'kg', reps: 12 }), 'bodyweight × 12');
});
