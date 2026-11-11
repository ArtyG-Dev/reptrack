import test from 'node:test';
import assert from 'node:assert/strict';
import { planProgress, prefillFor, itemsFromSets, updatedItems, describeTarget } from '../js/plans.js';

const plan = {
  items: [
    { exerciseId: 'bench', targetSets: 3, targetReps: 8, targetWeight: 60, unit: 'kg', targetHoldSec: null },
    { exerciseId: 'row', targetSets: 2, targetReps: 10, targetWeight: 50, unit: 'kg', targetHoldSec: null },
    { exerciseId: 'plank', targetSets: 1, targetReps: null, targetWeight: null, unit: 'kg', targetHoldSec: 60 }
  ]
};
const set = (exerciseId, extra = {}) => ({ exerciseId, weight: 60, unit: 'kg', reps: 8, ...extra });

test('logged working sets count toward their item, and tick it at the target', () => {
  const p = planProgress(plan, [set('bench'), set('bench'), set('row'), set('row')]);
  assert.deepEqual(p.items.map((i) => [i.done, i.target, i.ticked]), [[2, 3, false], [2, 2, true], [0, 1, false]]);
  assert.equal(p.complete, false);
});

test('warm-ups never count toward a plan item', () => {
  const p = planProgress(plan, [set('bench', { isWarmup: true }), set('bench')]);
  assert.equal(p.items[0].done, 1);
});

test('the user’s own word beats the count: tick, untick, skip', () => {
  const sets = [set('bench'), set('bench'), set('bench')];
  assert.equal(planProgress(plan, sets, { 0: 'open' }).items[0].ticked, false, 'unticked by hand despite 3/3');
  assert.equal(planProgress(plan, [], { 1: 'done' }).items[1].ticked, true, 'ticked by hand — done, but differently');
  const skipped = planProgress(plan, [], { 2: 'skipped' }).items[2];
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.ticked, false);
  assert.equal(planProgress(plan, [set('bench'), set('bench'), set('bench'), set('row'), set('row')], { 2: 'skipped' }).complete, true);
});

test('exercises outside the plan, or past every target, are Extra', () => {
  const p = planProgress(plan, [set('squat'), set('row'), set('row'), set('row')]);
  assert.deepEqual(p.extras.sort(), ['row', 'squat']);
});

test('an exercise planned twice fills its items in order', () => {
  const twice = { items: [{ exerciseId: 'bench', targetSets: 2 }, { exerciseId: 'bench', targetSets: 2 }] };
  const p = planProgress(twice, [set('bench'), set('bench'), set('bench')]);
  assert.deepEqual(p.items.map((i) => i.done), [2, 1]);
});

test('tapping an item prefills its target, once per set still to do', () => {
  const item = planProgress(plan, [set('bench')]).items[0];
  assert.deepEqual(prefillFor(item), [{ weight: 60, unit: 'kg', reps: 8, rpe: null }, { weight: 60, unit: 'kg', reps: 8, rpe: null }]);
  assert.deepEqual(prefillFor(planProgress(plan, []).items[2], { holdMode: true }), [{ holdSeconds: 60, side: null }]);
  assert.equal(prefillFor({ ...item, done: 3 }).length, 1, 'a finished item can still be logged once more');
});

test('a plan built from a session: one item per exercise in order, set count and top set', () => {
  const items = itemsFromSets([
    set('squat', { weight: 100, reps: 5 }), set('squat', { weight: 110, reps: 3 }), set('squat', { weight: 60, reps: 10, isWarmup: true }),
    { exerciseId: 'plank', holdSeconds: 45, side: null, weight: 0, reps: 0, unit: 'kg' }
  ]);
  assert.deepEqual(items.map((i) => [i.exerciseId, i.targetSets, i.targetReps, i.targetWeight, i.targetHoldSec]), [
    ['squat', 2, 3, 110, null],
    ['plank', 1, null, null, 45]
  ]);
});

test('"update plan to what I did" changes only the items that were done', () => {
  const next = updatedItems(plan, [set('bench', { weight: 65, reps: 8 }), set('bench', { weight: 65, reps: 8 })]);
  assert.deepEqual([next[0].targetSets, next[0].targetWeight], [2, 65]);
  assert.deepEqual(next[1], plan.items[1]);
});

test('targets read the way people say them', () => {
  assert.equal(describeTarget(plan.items[0]), '3 × 8 @ 60 kg');
  assert.equal(describeTarget(plan.items[2]), '1 × 60 s');
  assert.equal(describeTarget({ targetSets: 3, targetReps: 12, targetWeight: 0 }), '3 × 12');
});
