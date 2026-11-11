import test from 'node:test';
import assert from 'node:assert/strict';
import { MUSCLES, SEED_EXERCISES, MUSCLE_GROUP_MUSCLES } from '../js/exercises-seed.js';
import { MUSCLE_LABELS, muscleSets, weeklyMuscleSets, muscleWeeklySeries } from '../js/muscles.js';

const ex = (id, primaryMuscles, secondaryMuscles = []) => ({ id, primaryMuscles, secondaryMuscles });
const byId = new Map([
  ['dl', ex('dl', ['glutes', 'hamstrings', 'lower-back'], ['upper-back', 'lats', 'forearms', 'quads'])],
  ['bench', ex('bench', ['chest'], ['front-delts', 'triceps'])]
]);
const set = (exerciseId, dateISO, extra = {}) => ({ exerciseId, dateISO, weight: 100, reps: 5, unit: 'kg', ...extra });

test('the taxonomy is the eighteen muscles the brief names, each with a label', () => {
  assert.equal(MUSCLES.length, 18);
  assert.equal(new Set(MUSCLES).size, 18);
  assert.equal(MUSCLE_LABELS['front-delts'], 'Front delts');
  assert.equal(MUSCLE_LABELS['hip-flexors'], 'Hip flexors');
});

test('every starter exercise maps only to known muscles, never one muscle twice', () => {
  for (const seed of SEED_EXERCISES) {
    const all = [...seed.primaryMuscles, ...seed.secondaryMuscles];
    for (const m of all) assert.ok(MUSCLES.includes(m), `${seed.name}: ${m}`);
    assert.equal(new Set(all).size, all.length, seed.name);
  }
  for (const list of Object.values(MUSCLE_GROUP_MUSCLES)) for (const m of list) assert.ok(MUSCLES.includes(m));
});

test('the mappings the brief spells out', () => {
  const find = (name) => SEED_EXERCISES.find((s) => s.name === name);
  assert.deepEqual(find('Deadlift').primaryMuscles, ['glutes', 'hamstrings', 'lower-back']);
  assert.deepEqual(find('Deadlift').secondaryMuscles, ['upper-back', 'lats', 'forearms', 'quads']);
  assert.deepEqual(find('Bench Press').primaryMuscles, ['chest']);
  assert.deepEqual(find('Bench Press').secondaryMuscles, ['front-delts', 'triceps']);
  assert.deepEqual(find('Pull Up').primaryMuscles, ['lats']);
  assert.deepEqual(find('Pull Up').secondaryMuscles, ['biceps', 'upper-back', 'rear-delts']);
});

test('a set counts 1 per primary muscle and 0.5 per secondary', () => {
  const counts = muscleSets([set('dl', '2026-11-10'), set('dl', '2026-11-10'), set('bench', '2026-11-11')], byId);
  assert.equal(counts.glutes, 2);
  assert.equal(counts.lats, 1);
  assert.equal(counts.chest, 1);
  assert.equal(counts.triceps, 0.5);
  assert.equal(counts.calves, 0);
});

test('warm-ups count toward no muscle', () => {
  const counts = muscleSets([set('bench', '2026-11-11', { isWarmup: true })], byId);
  assert.equal(counts.chest, 0);
});

test('this week and last week, Monday to Sunday', () => {
  // 2026-11-11 is a Wednesday: this week is 9–15 Nov, last week 2–8 Nov.
  const w = weeklyMuscleSets([set('bench', '2026-11-09'), set('bench', '2026-11-08'), set('bench', '2026-11-02'), set('bench', '2026-11-01')], byId, '2026-11-11');
  assert.equal(w.weekStartISO, '2026-11-09');
  assert.equal(w.current.chest, 1);
  assert.equal(w.previous.chest, 2);
});

test('a muscle’s 12-week series is oldest first, one point per Monday, zeros included', () => {
  const series = muscleWeeklySeries([set('bench', '2026-11-11'), set('bench', '2026-08-20')], byId, 'chest', '2026-11-11');
  assert.equal(series.length, 12);
  assert.equal(series.at(-1).label, '2026-11-09');
  assert.equal(series[0].label, '2026-08-24');
  assert.equal(series.at(-1).value, 1);
  assert.equal(series.reduce((a, p) => a + p.value, 0), 1, 'a set before the window is not counted');
});
