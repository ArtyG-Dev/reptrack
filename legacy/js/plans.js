/* Session plans — the pure part. No storage, no DOM: state.js stores plans,
 * views/today.js draws the checklist, and everything that decides what is
 * ticked, what is extra, and what a plan built from a session looks like
 * lives here, covered by tests/plans.test.js.
 *
 * Plan { id, name, order, items: [{ exerciseId, targetSets, targetReps,
 *        targetWeight, unit, targetHoldSec, note }], lastModified, visibility }
 * Session.planMarks: { [itemIndex]: 'done' | 'open' | 'skipped' } — the user's
 * own word for this session, which beats the counted sets.
 */

import { workingSets, bestSet } from './progression.js';

/**
 * Where a plan session stands. Logged working sets count toward the item with
 * the same exercise; if a plan lists an exercise twice, sets fill the items in
 * order (the first item's target, then the next). Warm-ups never count.
 */
export function planProgress(plan, sessionSets = [], marks = {}) {
  const counts = new Map();
  for (const s of workingSets(sessionSets)) counts.set(s.exerciseId, (counts.get(s.exerciseId) || 0) + 1);
  const remaining = new Map(counts);

  const items = (plan?.items || []).map((item, index) => {
    const target = Math.max(1, Number(item.targetSets) || 1);
    const available = remaining.get(item.exerciseId) || 0;
    const done = Math.min(available, target);
    remaining.set(item.exerciseId, available - done);
    const mark = marks?.[index] ?? null;
    const skipped = mark === 'skipped';
    const ticked = !skipped && (mark === 'done' || (mark !== 'open' && done >= target));
    return { ...item, index, target, done, ticked, skipped, mark };
  });

  const planned = new Set((plan?.items || []).map((i) => i.exerciseId));
  const extras = [...counts.keys()].filter((id) => !planned.has(id));
  // A planned exercise logged beyond every one of its targets is extra work too.
  for (const [id, left] of remaining) if (left > 0 && planned.has(id) && !extras.includes(id)) extras.push(id);

  return { items, extras, complete: items.length > 0 && items.every((i) => i.ticked || i.skipped) };
}

/** The sets to prefill when a checklist item is tapped: its target, once per
 *  set still to do (at least one, so an item can always be logged again). */
export function prefillFor(item, { holdMode = false } = {}) {
  const count = Math.max(1, (item.target ?? item.targetSets ?? 1) - (item.done || 0));
  const one = holdMode
    ? { holdSeconds: item.targetHoldSec ?? '', side: null }
    : { weight: item.targetWeight ?? '', unit: item.unit || 'kg', reps: item.targetReps ?? '', rpe: null };
  return Array.from({ length: count }, () => ({ ...one }));
}

/** One item per exercise, in the order they were first done: the number of
 *  working sets, and the top set's reps and weight (or hold). */
export function itemsFromSets(sets = []) {
  const order = [];
  const byExercise = new Map();
  for (const s of workingSets(sets)) {
    if (!byExercise.has(s.exerciseId)) { byExercise.set(s.exerciseId, []); order.push(s.exerciseId); }
    byExercise.get(s.exerciseId).push(s);
  }
  return order.map((exerciseId) => {
    const list = byExercise.get(exerciseId);
    const top = bestSet(list);
    const hold = top.holdSeconds != null;
    return {
      exerciseId,
      targetSets: list.length,
      targetReps: hold ? null : top.reps,
      targetWeight: hold ? null : top.weight,
      unit: top.unit || 'kg',
      targetHoldSec: hold ? top.holdSeconds : null,
      note: ''
    };
  });
}

/** "Update plan to what I did": each item whose exercise was logged takes the
 *  logged set count and top set; items not done this time keep their targets. */
export function updatedItems(plan, sessionSets = []) {
  const done = new Map(itemsFromSets(sessionSets).map((i) => [i.exerciseId, i]));
  return (plan?.items || []).map((item) => {
    const now = done.get(item.exerciseId);
    return now ? { ...item, ...now, note: item.note } : item;
  });
}

/** Human-readable target, e.g. "3 × 8 @ 60 kg" or "3 × 45 s". */
export function describeTarget(item) {
  const sets = Math.max(1, Number(item.targetSets) || 1);
  if (item.targetHoldSec != null && item.targetHoldSec !== '') return `${sets} × ${item.targetHoldSec} s`;
  const reps = item.targetReps ?? '?';
  const weight = Number(item.targetWeight) > 0 ? ` @ ${item.targetWeight} ${item.unit || 'kg'}` : '';
  return `${sets} × ${reps}${weight}`;
}
