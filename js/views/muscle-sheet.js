/* The sheet behind a tap on the body map (and, in Stage 5, an Orrery planet):
 * the user's own exercises for a muscle or a group of muscles, in the order
 * muscles.suggestionsFor() decides, each with "Log this". It suggests and
 * never blocks: the recovery note is a line of text, and every button works.
 */

import * as state from '../state.js';
import { el, openSheet, toast, humanDate } from '../ui.js';
import { MUSCLE_LABELS, suggestionsFor, recentlyTrained, weeklyMuscleSets } from '../muscles.js';
import { todayISO } from '../store.js';
import { logExercise } from './today.js';
import { exerciseSheet } from './exercises.js';

const formatSets = (v) => { const n = Math.round(v * 10) / 10; return `${n} set${n === 1 ? '' : 's'}`; };

/** One muscle's suggestions, or a region's merged: an exercise appears once, as
 *  primary if it is primary for any muscle in the region. */
function merged(muscles, s, today) {
  const best = new Map();
  for (const m of muscles) {
    for (const sug of suggestionsFor(m, s.exercises, s.allSets, today)) {
      const seen = best.get(sug.exercise.id);
      if (!seen || (seen.role === 'secondary' && sug.role === 'primary')) best.set(sug.exercise.id, sug);
    }
  }
  return [...best.values()].sort((a, b) => (a.role === b.role ? 0 : a.role === 'primary' ? -1 : 1)
    || a.setsThisWeek - b.setsThisWeek || a.lastISO.localeCompare(b.lastISO) || a.exercise.name.localeCompare(b.exercise.name));
}

/**
 * @param {string[]} muscles one muscle, or a region's muscles
 * @param {string} [title] defaults to the muscle's name
 */
export async function openMuscleSheet(muscles, title = MUSCLE_LABELS[muscles[0]]) {
  const s = state.getState();
  const today = todayISO();
  const byId = new Map(s.exercises.map((ex) => [ex.id, ex]));
  const week = weeklyMuscleSets(s.allSets, byId, today).current;
  const thisWeek = muscles.reduce((sum, m) => sum + (week[m] || 0), 0);
  const recent = muscles.some((m) => recentlyTrained(m, s.allSets, byId, today));
  const suggestions = merged(muscles, s, today);
  const titleId = 'confirm-sheet-title';

  const action = await openSheet('confirm-sheet', (ctx) => el('div', { class: 'stack', id: 'muscle-sheet' },
    el('h2', { id: titleId, text: title }),
    el('p', { class: 'small muted', style: 'margin:0', text: `${formatSets(thisWeek)} this week` }),
    recent ? el('p', { class: 'small', id: 'recovery-note', style: 'margin:0' }, el('span', { class: 'badge badge-warn', text: 'Note' }), ' Trained recently — rest may serve it better.') : null,
    suggestions.length
      ? el('ul', { class: 'list' }, ...suggestions.map((sug) => el('li', {},
        el('div', { class: 'grow' },
          el('strong', { text: sug.exercise.name }), ' ',
          el('span', { class: 'badge', text: sug.role === 'primary' ? 'Primary' : 'Secondary' }),
          el('p', { class: 'small muted', style: 'margin:0', text: `${formatSets(sug.setsThisWeek)} this week · ${sug.lastISO ? `last ${humanDate(sug.lastISO)}` : 'not trained yet'}` })
        ),
        el('button', {
          class: 'btn btn-sm btn-primary', type: 'button', 'aria-label': `Log ${sug.exercise.name}`,
          onclick: () => ctx.close({ log: sug.exercise.id })
        }, 'Log this')
      )))
      : el('p', { class: 'empty', text: 'None of your exercises work this yet.' }),
    suggestions.length ? null : el('button', {
      class: 'btn btn-block', type: 'button', id: 'add-exercise-for-muscle',
      onclick: () => ctx.close({ add: true })
    }, `Add an exercise for ${title}`),
    el('div', { class: 'sheet-actions' },
      el('button', { class: 'btn', type: 'button', 'data-autofocus': '', onclick: () => ctx.close(null) }, 'Close'))
  ), { labelledBy: titleId });

  if (action?.log) await logExercise(action.log);
  if (action?.add) {
    const input = await exerciseSheet(null, { preselectMuscle: muscles[0] });
    if (input) { await state.addExercise({ ...input, isCustom: true }); toast(`Added ${input.name}.`); }
  }
}
