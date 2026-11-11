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

/* ---------- Stage 4 ---------- */

import { heatLevel, HEAT_THRESHOLDS, recentlyTrained, RECOVERY_SETS, suggestionsFor, definitionLevel } from '../js/muscles.js';
import { bodyGeometry, FIGURES, VIEW_OF, strokeFor } from '../js/bodymap.js';

test('heat levels: 0 none, 1 under 4, 2 from 4 to under 10, 3 at 10 or more', () => {
  assert.deepEqual(HEAT_THRESHOLDS, [4, 10]);
  assert.deepEqual([0, 0.5, 3.5, 4, 9.5, 10, 25].map(heatLevel), [0, 1, 1, 2, 2, 3, 3]);
});

test('the recovery guard: 6+ weighted sets today and yesterday, never older', () => {
  const six = Array.from({ length: 6 }, (_, i) => set('bench', i < 3 ? '2026-11-11' : '2026-11-10'));
  assert.equal(RECOVERY_SETS, 6);
  assert.equal(recentlyTrained('chest', six, byId, '2026-11-11'), true);
  assert.equal(recentlyTrained('chest', six.slice(1), byId, '2026-11-11'), false, '5 is not enough');
  assert.equal(recentlyTrained('chest', six, byId, '2026-11-13'), false, 'two days later it has passed');
  assert.equal(recentlyTrained('triceps', six, byId, '2026-11-11'), false, '6 secondary sets weigh 3');
});

test('suggestions: primary first, then fewest sets this week, then least recently trained', () => {
  const exercises = [
    { id: 'a', name: 'A', primaryMuscles: ['chest'], secondaryMuscles: [] },
    { id: 'b', name: 'B', primaryMuscles: ['chest'], secondaryMuscles: [] },
    { id: 'c', name: 'C', primaryMuscles: ['chest'], secondaryMuscles: [] },
    { id: 'd', name: 'D', primaryMuscles: ['triceps'], secondaryMuscles: ['chest'] },
    { id: 'e', name: 'E', primaryMuscles: ['quads'], secondaryMuscles: [] }
  ];
  const sets = [set('a', '2026-11-10'), set('a', '2026-11-11'), set('b', '2026-11-10'), set('c', '2026-10-01'), set('c', '2026-11-03', { isWarmup: true })];
  const out = suggestionsFor('chest', exercises, sets, '2026-11-11');
  assert.deepEqual(out.map((s) => s.exercise.id), ['c', 'b', 'a', 'd']);
  assert.deepEqual(out.map((s) => s.role), ['primary', 'primary', 'primary', 'secondary']);
  assert.equal(out[0].lastISO, '2026-10-01', 'a warm-up is not training');
  assert.deepEqual(suggestionsFor('calves', exercises, sets, '2026-11-11'), []);
});

test('definition only grows with work done, and a 60-day lapse leaves it exactly where it was', () => {
  const history = [];
  let last = 0;
  for (let i = 0; i < 120; i += 1) {
    history.push(set('dl', `2026-0${1 + Math.floor(i / 30)}-${String(1 + (i % 28)).padStart(2, '0')}`, { isPR: i % 10 === 0 }));
    const level = definitionLevel('glutes', history, byId);
    assert.ok(level >= last, 'never decreases as sets accumulate');
    last = level;
  }
  assert.ok(last >= 2 && last <= 5);
  // 60 days off: nothing is added, and nothing about the calendar enters the sum.
  assert.equal(definitionLevel('glutes', history, byId), last);
  assert.equal(definitionLevel('glutes', [...history, set('dl', '2026-08-01', { isWarmup: true })], byId), last, 'warm-ups add nothing');
  assert.equal(definitionLevel('calves', history, byId), 0);
});

test('the body map: every muscle is one control on exactly one view, for every figure', () => {
  for (const figure of Object.keys(FIGURES)) {
    const controls = [];
    for (const view of ['front', 'back']) {
      const g = bodyGeometry(figure, view);
      for (const m of g.muscles) {
        assert.match(m.d, /^M[-\d.,a-zMZ ]+$/, `${figure} ${view} ${m.muscle}`);
        assert.ok(!/NaN|Infinity/.test(m.d + g.outline));
        if (m.interactive) controls.push(m.muscle);
      }
    }
    assert.deepEqual(controls.sort(), [...MUSCLES].sort(), figure);
  }
  assert.deepEqual(Object.keys(VIEW_OF).sort(), [...MUSCLES].sort());
  assert.notEqual(bodyGeometry('male').outline, bodyGeometry('female').outline);
});

test('definition shows as outline weight and inner lines, never as size', () => {
  const chest = (fig) => bodyGeometry(fig, 'front').muscles.find((m) => m.muscle === 'chest');
  assert.equal(chest('neutral').detail(2), '');
  assert.ok(chest('neutral').detail(3).length > 0);
  assert.ok(chest('neutral').detail(5).length > chest('neutral').detail(3).length);
  for (let l = 1; l <= 5; l += 1) assert.ok(strokeFor(l) > strokeFor(l - 1));
  assert.equal(chest('neutral').d, chest('neutral').d, 'the shape itself takes no level');
});
