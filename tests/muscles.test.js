import test from 'node:test';
import assert from 'node:assert/strict';
import { MUSCLES, SEED_EXERCISES, MUSCLE_GROUP_MUSCLES } from '../js/exercises-seed.js';
import { MUSCLE_LABELS, muscleSets, weeklyMuscleSets, muscleWeeklySeries } from '../js/muscles.js';

const ex = (id, primaryMuscles, secondaryMuscles = []) => ({ id, primaryMuscles, secondaryMuscles });
const byId = new Map([
  ['dl', ex('dl', ['glutes', 'hamstrings', 'lower-back'], ['upper-back-lats', 'traps', 'forearms', 'quads'])],
  ['bench', ex('bench', ['chest'], ['front-delts', 'triceps'])]
]);
const set = (exerciseId, dateISO, extra = {}) => ({ exerciseId, dateISO, weight: 100, reps: 5, unit: 'kg', ...extra });

test('the taxonomy is the canonical seventeen plus Adductors, each with its label', () => {
  assert.deepEqual(MUSCLES.map((m) => MUSCLE_LABELS[m]), [
    'Chest', 'Front shoulders', 'Side shoulders', 'Rear shoulders', 'Upper back / lats', 'Traps',
    'Biceps', 'Triceps', 'Forearms', 'Abs', 'Obliques', 'Lower back', 'Glutes', 'Hip flexors',
    'Quads', 'Hamstrings', 'Calves', 'Adductors'
  ]);
  assert.equal(new Set(MUSCLES).size, 18);
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
  assert.deepEqual(find('Deadlift').secondaryMuscles, ['upper-back-lats', 'traps', 'forearms', 'quads']);
  assert.deepEqual(find('Bench Press').primaryMuscles, ['chest']);
  assert.deepEqual(find('Bench Press').secondaryMuscles, ['front-delts', 'triceps']);
  assert.deepEqual(find('Pull Up').primaryMuscles, ['upper-back-lats']);
  assert.deepEqual(find('Pull Up').secondaryMuscles, ['biceps', 'rear-delts', 'forearms']);
  for (const seed of SEED_EXERCISES) assert.ok(seed.primaryMuscles.length + seed.secondaryMuscles.length > 0, `${seed.name} is never Unassigned`);
});

test('a set counts 1 per primary muscle and 0.5 per secondary', () => {
  const counts = muscleSets([set('dl', '2026-11-10'), set('dl', '2026-11-10'), set('bench', '2026-11-11')], byId);
  assert.equal(counts.glutes, 2);
  assert.equal(counts['upper-back-lats'], 1);
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

/* ---------- 3D muscle map brief: counting modes, Unassigned, migration ---------- */

import {
  PERIODS, periodRange, countsForWeight, muscleTotals, rankMuscles, heatLevelFor, muscleTrend,
  migrateMuscles, renameRetired, suggestMuscles, reminderDue, REMINDER
} from '../js/muscles.js';

const exs = new Map([
  ['bench', { id: 'bench', name: 'Bench Press', primaryMuscles: ['chest'], secondaryMuscles: ['triceps'] }],
  ['pushup', { id: 'pushup', name: 'Push Up', isBodyweight: true, primaryMuscles: ['chest'], secondaryMuscles: ['triceps'] }],
  ['plank', { id: 'plank', name: 'Plank', mode: 'hold', primaryMuscles: ['abs'], secondaryMuscles: [] }],
  ['cable', { id: 'cable', name: 'Cable Fly', isCustom: true, primaryMuscles: [], secondaryMuscles: [] }]
]);
const T = '2026-11-12';
const sample = [
  { exerciseId: 'bench', dateISO: T, weight: 100, unit: 'kg', reps: 5 },
  { exerciseId: 'bench', dateISO: '2026-11-01', weight: 100, unit: 'kg', reps: 5 },     // outside 7 days, inside 30
  { exerciseId: 'pushup', dateISO: T, weight: 0, unit: 'kg', reps: 20 },
  { exerciseId: 'plank', dateISO: T, weight: 0, unit: 'kg', reps: 0, holdSeconds: 60 },
  { exerciseId: 'cable', dateISO: T, weight: 20, unit: 'kg', reps: 12 },
  { exerciseId: 'bench', dateISO: T, weight: 60, unit: 'kg', reps: 10, isWarmup: true }
];

test('periods are 7, 30 and 90 days ending today', () => {
  assert.deepEqual(PERIODS, [7, 30, 90]);
  assert.deepEqual(periodRange(T, 7), { fromISO: '2026-11-06', toISO: T });
});

test('Sets mode: 1 to main muscles, 0.5 to supporting, every exercise type counts; Unassigned on its own row', () => {
  const r = muscleTotals({ sets: sample, exercisesById: exs, ...periodRange(T, 7), mode: 'sets' });
  assert.equal(r.totals.chest, 2, 'bench + push-up');
  assert.equal(r.totals.triceps, 1);
  assert.equal(r.totals.abs, 1, 'a hold counts as a set');
  assert.equal(r.unassigned, 1, 'the cable fly is not spread over the body');
  assert.equal(Object.values(r.totals).reduce((a, b) => a + b, 0), 4, 'and not guessed at either');
  assert.equal(muscleTotals({ sets: sample, exercisesById: exs, ...periodRange(T, 30) }).totals.chest, 3);
});

test('Weight mode: weight × reps and half; bodyweight and timed sets excluded, never counted as zero', () => {
  const r = muscleTotals({ sets: sample, exercisesById: exs, ...periodRange(T, 7), mode: 'weight' });
  assert.equal(r.totals.chest, 500);
  assert.equal(r.totals.triceps, 250);
  assert.equal(r.totals.abs, 0);
  assert.ok(r.excludedOnly.has('abs'), 'abs were trained, only by an excluded exercise');
  assert.ok(!r.excludedOnly.has('chest'), 'chest has counted work, so it is not "excluded only"');
  assert.equal(r.excluded, 2);
  assert.equal(r.unassigned, 240);
  assert.equal(countsForWeight({ weight: 20, unit: 'kg', reps: 10 }, exs.get('pushup')), false);
  const lb = muscleTotals({ sets: sample, exercisesById: exs, ...periodRange(T, 7), mode: 'weight', unit: 'lb' });
  assert.ok(Math.abs(lb.totals.chest - 500 * 2.2046226218) < 1e-6, 'in the chosen unit');
  const ranked = rankMuscles(r);
  assert.deepEqual(ranked.slice(0, 2).map((x) => x.muscle), ['chest', 'triceps']);
  assert.equal(ranked.find((x) => x.muscle === 'abs').excludedOnly, true);
});

test('editing an exercise’s muscles re-counts its whole history, with nothing stored per set', () => {
  const before = muscleTotals({ sets: sample, exercisesById: exs, ...periodRange(T, 90) });
  const edited = new Map(exs);
  edited.set('cable', { ...exs.get('cable'), primaryMuscles: ['chest'], secondaryMuscles: ['front-delts'] });
  const after = muscleTotals({ sets: sample, exercisesById: edited, ...periodRange(T, 90) });
  assert.equal(after.totals.chest, before.totals.chest + 1);
  assert.equal(after.totals['front-delts'], 0.5);
  assert.equal(after.unassigned, 0);
});

test('heat means the same at any period in Sets mode; Weight mode is relative to the top muscle', () => {
  assert.equal(heatLevelFor(0, { days: 7 }), 0);
  assert.equal(heatLevelFor(9, { days: 7 }), 2);
  assert.equal(heatLevelFor(9 * 30 / 7, { days: 30 }), 2, 'the same weekly rate over 30 days');
  assert.equal(heatLevelFor(10 * 90 / 7, { days: 90 }), 3);
  assert.deepEqual([0, 100, 400, 700, 1000].map((v) => heatLevelFor(v, { mode: 'weight', max: 1000 })), [0, 1, 2, 3, 3]);
});

test('a muscle’s trend: daily over 7 days, weekly over 30 and 90, oldest first, totals add up', () => {
  const sets = [...sample, { exerciseId: 'bench', dateISO: '2026-09-01', weight: 50, unit: 'kg', reps: 10 }];
  const week = muscleTrend({ sets, exercisesById: exs, muscle: 'chest', todayISO: T, days: 7 });
  assert.equal(week.length, 7);
  assert.equal(week.at(-1).label, T);
  assert.equal(week.at(-1).value, 2);
  const month = muscleTrend({ sets, exercisesById: exs, muscle: 'chest', todayISO: T, days: 30 });
  assert.equal(month.length, 5);
  assert.equal(month.reduce((a, p) => a + p.value, 0), 3);
  const quarter = muscleTrend({ sets, exercisesById: exs, muscle: 'chest', todayISO: T, days: 90, mode: 'weight' });
  assert.equal(quarter.length, 13);
  assert.equal(quarter.reduce((a, p) => a + p.value, 0), 1500);
});

test('taxonomy v2: retired ids renamed, starters on their original mapping corrected, edited ones left alone', () => {
  assert.deepEqual(renameRetired({ primaryMuscles: ['lats', 'upper-back'], secondaryMuscles: ['upper-back', 'biceps'] }), { primaryMuscles: ['upper-back-lats'], secondaryMuscles: ['biceps'] });
  const oldPullUp = { name: 'Pull Up', isCustom: false, primaryMuscles: ['lats'], secondaryMuscles: ['biceps', 'upper-back', 'rear-delts'] };
  assert.deepEqual(migrateMuscles(oldPullUp, { correctSeeds: true }).secondaryMuscles, ['biceps', 'rear-delts', 'forearms']);
  const edited = { ...oldPullUp, secondaryMuscles: ['biceps'] };
  assert.deepEqual(migrateMuscles(edited, { correctSeeds: true }).primaryMuscles, ['upper-back-lats'], 'renamed');
  assert.deepEqual(migrateMuscles(edited, { correctSeeds: true }).secondaryMuscles, ['biceps'], 'but not overwritten');
  const current = { name: 'Bench Press', primaryMuscles: ['chest'], secondaryMuscles: ['front-delts', 'triceps'] };
  assert.equal(migrateMuscles(current, { correctSeeds: true }), current, 'nothing to do: the same object back');
});

test('the name suggests muscles from a small keyword table, or nothing', () => {
  const s = (n) => suggestMuscles(n)?.primaryMuscles;
  assert.deepEqual(s('Hammer Curl'), ['biceps']);
  assert.deepEqual(s('Seated Cable Row'), ['upper-back-lats']);
  assert.deepEqual(s('Landmine Press'), ['chest', 'front-delts']);
  assert.deepEqual(s('Goblet Squat'), ['quads', 'glutes']);
  assert.deepEqual(s('Trap Bar Deadlift'), ['hamstrings', 'glutes', 'lower-back']);
  assert.deepEqual(s('Cable Lateral Raise'), ['side-delts']);
  assert.deepEqual(s('Decline Crunch'), ['abs']);
  assert.deepEqual(s('Overhead Tricep Extension'), ['triceps']);
  assert.deepEqual(s('Leg Extension'), ['quads']);
  assert.deepEqual(s('Hanging Knee Raise'), ['abs']);
  assert.equal(suggestMuscles('Sled Push'), null);
});

test('the reminder: after 3 logged sets, once more 10 sets after a "Not now", then never', () => {
  const ex = { primaryMuscles: [], secondaryMuscles: [] };
  assert.deepEqual(REMINDER, { first: 3, again: 10, maxPrompts: 2 });
  assert.equal(reminderDue(ex, 2), false);
  assert.equal(reminderDue(ex, 3), true);
  assert.equal(reminderDue(ex, 12, { prompts: 1, lastAt: 3 }), false);
  assert.equal(reminderDue(ex, 13, { prompts: 1, lastAt: 3 }), true);
  assert.equal(reminderDue(ex, 500, { prompts: 2, lastAt: 13 }), false);
  assert.equal(reminderDue({ primaryMuscles: ['chest'], secondaryMuscles: [] }, 50), false, 'assigned: never');
});
