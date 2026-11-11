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
  assert.equal(describeSet({ holdSeconds: 60, side: null }), '60s hold');
  assert.equal(describeSet({ holdSeconds: 30, side: 'left' }), '30s hold (left)');
});

/* ---------- hold mode: yoga, pilates, timed calisthenics ---------- */

test('"plank for 60 seconds" logs a single 60s hold', () => {
  const r = parseTranscript('plank for 60 seconds', ctx());
  assert.equal(r.ok, true);
  assert.equal(r.exercise.name, 'Plank');
  assert.deepEqual(r.sets, [{ holdSeconds: 60, side: null, rpe: null }]);
});

test('"downward dog 30 seconds each side" logs two holds, one per side', () => {
  const r = parseTranscript('downward dog 30 seconds each side', ctx());
  assert.equal(r.ok, true);
  assert.equal(r.exercise.name, 'Downward Dog');
  assert.deepEqual(r.sets, [
    { holdSeconds: 30, side: 'left', rpe: null },
    { holdSeconds: 30, side: 'right', rpe: null }
  ]);
});

test('"child\'s pose for a minute" understands the indefinite article as one', () => {
  const r = parseTranscript("child's pose for a minute", ctx());
  assert.equal(r.ok, true);
  assert.equal(r.exercise.name, "Child's Pose");
  assert.deepEqual(r.sets, [{ holdSeconds: 60, side: null, rpe: null }]);
});

test('a rounds count expands into that many holds, same shape as rep-mode sets', () => {
  const r = parseTranscript('plank 30 seconds 3 rounds', ctx());
  assert.equal(r.ok, true);
  assert.equal(r.sets.length, 3);
  for (const s of r.sets) assert.deepEqual(s, { holdSeconds: 30, side: null, rpe: null });
});

test('"per side" and "both sides" are understood the same as "each side"', () => {
  assert.equal(parseTranscript('warrior two 20 seconds per side', ctx()).sets.length, 2);
  assert.equal(parseTranscript('warrior two 20 seconds both sides', ctx()).sets.length, 2);
});

test('a hold exercise with no duration fails with a clear reason, not a silent zero', () => {
  const r = parseTranscript('plank', ctx());
  assert.equal(r.ok, false);
  assert.match(r.error, /no hold duration/);
});

test('the exercise dictionary decides the grammar, not the phrase — a reps exercise never becomes a hold', () => {
  const r = parseTranscript('bench press for 60 seconds', ctx());
  // "Bench Press" is reps-mode: this reads as weight=60 with an implicit unit,
  // reps missing — the reps-mode error path, not the hold-mode one.
  assert.equal(r.ok, false);
  assert.match(r.error, /no weight and reps/);
});

test('"add another set" repeats a hold correctly, including its side', () => {
  const lastSet = { holdSeconds: 45, side: 'left', weight: 0, unit: 'kg', reps: 0, rpe: null, exercise: byName('Plank') };
  const r = parseTranscript('add another set', ctx({ lastSet }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.sets, [{ weight: 0, unit: 'kg', reps: 0, rpe: null, holdSeconds: 45, side: 'left' }]);
});

test('"same as last time" replays previous holds', () => {
  const plank = byName('Plank');
  const previous = [{ weight: 0, unit: 'kg', reps: 0, rpe: null, holdSeconds: 60, side: null }];
  const r = parseTranscript('plank same as last time', ctx({ lastSetsFor: () => previous }));
  assert.equal(r.ok, true);
  assert.equal(r.exercise.id, plank.id);
  assert.deepEqual(r.sets, previous);
});

test('"make that 8" amends the reps of the most recently logged set', () => {
  const lastSet = { id: 'set_9', weight: 80, unit: 'kg', reps: 10, rpe: null, exercise: byName('Bench Press') };
  for (const phrase of ['make that 8', 'make that eight', 'change that to 8', 'make it 8 reps', 'change it to eight']) {
    const r = parseTranscript(phrase, ctx({ lastSet }));
    assert.equal(r.ok, true, phrase);
    assert.equal(r.intent, 'amend-last', phrase);
    assert.equal(r.targetSetId, 'set_9', 'it names the set it changes');
    assert.equal(r.exercise.name, 'Bench Press');
    assert.deepEqual(r.sets, [{ weight: 80, unit: 'kg', reps: 8, rpe: null }], phrase);
  }
});

test('"make that 45" on a hold amends the seconds, since a hold has no reps', () => {
  const lastSet = { id: 'h1', holdSeconds: 30, side: 'left', weight: 0, unit: 'kg', reps: 0, rpe: null, exercise: byName('Plank') };
  const r = parseTranscript('make that 45', ctx({ lastSet }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.sets, [{ weight: 0, unit: 'kg', reps: 0, rpe: null, holdSeconds: 45, side: 'left' }]);
});

test('"make that 8" with nothing logged, or no number, says why', () => {
  assert.match(parseTranscript('make that 8', ctx()).error, /No set logged yet/);
  const r = parseTranscript('make that', ctx({ lastSet: { id: 's', weight: 60, unit: 'kg', reps: 5, exercise: byName('Bench Press') } }));
  assert.equal(r.ok, false);
});

test('"warm-up" marks the sets as warm-ups, wherever it is said', () => {
  for (const phrase of ['warm up bench press 40 kilos for 10', 'bench press 40 kilos for 10 warm-up', 'warmup set bench press 40 for 10']) {
    const r = parseTranscript(phrase, ctx());
    assert.equal(r.ok, true, phrase);
    assert.equal(r.exercise.name, 'Bench Press', phrase);
    assert.deepEqual(r.sets.map((x) => [x.weight, x.reps, x.isWarmup]), [[40, 10, true]], phrase);
  }
  assert.equal(parseTranscript('bench press 40 kilos for 10', ctx()).sets[0].isWarmup, undefined, 'otherwise unmarked');
});

test('RPE shows in a set description only when there is one', () => {
  assert.equal(describeSet({ weight: 100, unit: 'kg', reps: 5, rpe: 8 }), '100 kg × 5 @ RPE 8');
  assert.equal(describeSet({ weight: 100, unit: 'kg', reps: 5, rpe: null }), '100 kg × 5');
});
