/* Exercises — the local dictionary the voice parser matches against. */

import * as state from '../state.js';
import { el, clear, toast, openSheet, confirmSheet, disclosure, titleCase } from '../ui.js';
import { CATEGORIES } from '../exercises-seed.js';

let filter = '';
let containerRef = null;

function exerciseSheet(existing = null) {
  const titleId = 'confirm-sheet-title';
  return openSheet('confirm-sheet', (ctx) => {
    const name = el('input', { type: 'text', id: 'ex-name', value: existing?.name || '', required: true, 'data-autofocus': '' });
    const aliases = el('input', { type: 'text', id: 'ex-aliases', value: (existing?.aliases || []).join(', '), placeholder: 'bench, flat bench' });
    const group = el('select', { id: 'ex-group' }, ...['chest', 'back', 'legs', 'shoulders', 'arms', 'core', 'other']
      .map((g) => el('option', { value: g, selected: (existing?.muscleGroup || 'other') === g }, g)));

    // Category is a suggestion list, not a fixed enum — the datalist offers
    // CATEGORIES ∪ whatever is already in use, but any typed value is accepted.
    const inUse = new Set([...CATEGORIES, ...state.getState().exercises.map((ex) => ex.category || 'strength')]);
    const category = el('input', {
      type: 'text', id: 'ex-category', list: 'ex-category-options',
      value: existing?.category || 'strength', placeholder: 'strength'
    });
    const categoryOptions = el('datalist', { id: 'ex-category-options' },
      ...[...inUse].sort().map((c) => el('option', { value: c }))
    );

    const mode = el('select', { id: 'ex-mode' },
      el('option', { value: 'reps', selected: (existing?.mode || 'reps') !== 'hold' }, 'Reps (weight × reps × sets)'),
      el('option', { value: 'hold', selected: existing?.mode === 'hold' }, 'Hold (timed duration)')
    );

    const bodyweight = el('input', { type: 'checkbox', id: 'ex-bodyweight', style: 'width:auto;min-height:auto', checked: Boolean(existing?.isBodyweight) });

    return el('form', {
      method: 'dialog',
      onsubmit: (e) => {
        e.preventDefault();
        if (!name.value.trim()) { toast('Give the exercise a name.'); return; }
        ctx.close({
          name: name.value.trim(),
          aliases: aliases.value.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean),
          muscleGroup: group.value,
          category: (category.value.trim() || 'strength').toLowerCase(),
          mode: mode.value,
          isBodyweight: bodyweight.checked
        });
      }
    },
      el('h2', { id: titleId, text: existing ? 'Edit exercise' : 'Add exercise' }),
      el('div', { class: 'field' }, el('label', { for: 'ex-name', text: 'Name' }), name),
      el('div', { class: 'field' }, el('label', { for: 'ex-aliases', text: 'Aliases the voice parser should accept (comma separated)' }), aliases),
      el('div', { class: 'field-row' },
        el('div', {}, el('label', { for: 'ex-group', text: 'Muscle group' }), group),
        el('div', {}, el('label', { for: 'ex-category', text: 'Category' }), category, categoryOptions)
      ),
      el('div', { class: 'field' },
        el('label', { for: 'ex-mode', text: 'How it’s logged' }), mode,
        el('p', { class: 'small muted', style: 'margin:4px 0 0', text: 'Reps covers strength and calisthenics (weight is optional). Hold covers yoga poses, pilates holds, and timed calisthenics like a plank.' })
      ),
      el('div', { class: 'field row' }, bodyweight, el('label', { for: 'ex-bodyweight', style: 'margin:0', text: 'Bodyweight exercise (a lone number means reps, in reps mode)' })),
      el('div', { class: 'sheet-actions' },
        el('button', { class: 'btn', type: 'button', onclick: () => ctx.close(null) }, 'Cancel'),
        el('button', { class: 'btn btn-primary', type: 'submit' }, 'Save')
      )
    );
  }, { labelledBy: titleId });
}

function exerciseRow(ex, rerender) {
  const count = state.getState().allSets.filter((x) => x.exerciseId === ex.id).length;
  return el('li', {},
    el('div', { class: 'grow' },
      el('p', { style: 'margin:0;font-weight:600' },
        ex.name,
        ex.mode === 'hold' ? el('span', { class: 'small muted', text: ' · hold' }) : null,
        ex.isBodyweight ? el('span', { class: 'small muted', text: ' · bodyweight' }) : null
      ),
      el('p', { class: 'small muted', style: 'margin:0', text: `${ex.muscleGroup} · ${count} logged${(ex.aliases || []).length ? ` · ${ex.aliases.join(', ')}` : ''}` })
    ),
    el('button', {
      class: 'btn btn-sm', type: 'button', 'aria-label': `Edit ${ex.name}`,
      onclick: async () => {
        const input = await exerciseSheet(ex);
        if (!input) return;
        await state.updateExercise({ ...ex, ...input });
        toast('Exercise updated.');
        rerender();
      }
    }, 'Edit'),
    el('button', {
      class: 'btn btn-sm btn-ghost', type: 'button', 'aria-label': `Delete ${ex.name}`,
      onclick: async () => {
        const yes = await confirmSheet({
          title: `Delete ${ex.name}?`,
          message: count ? `${count} logged set${count === 1 ? '' : 's'} will be deleted with it. This cannot be undone.` : 'This cannot be undone.',
          confirmLabel: 'Delete',
          danger: true
        });
        if (!yes) return;
        await state.deleteExercise(ex.id);
        toast('Exercise deleted.');
        rerender();
      }
    }, '✕')
  );
}

/** Canonical categories first (in CATEGORIES order), then any custom ones alphabetically. */
function orderedCategories(rows) {
  const present = new Set(rows.map((r) => r.category || 'strength'));
  const known = CATEGORIES.filter((c) => present.has(c));
  const extra = [...present].filter((c) => !CATEGORIES.includes(c)).sort();
  return [...known, ...extra];
}

export function render(container) {
  containerRef = container || containerRef;
  if (!containerRef) return;
  const s = state.getState();
  const rerender = () => render(containerRef);

  clear(containerRef);
  containerRef.append(el('h2', { class: 'visually-hidden', text: 'Exercises' }));

  const search = el('input', {
    type: 'search', id: 'ex-search', value: filter, placeholder: 'Search exercises',
    oninput: (e) => {
      filter = e.target.value;
      const list = document.getElementById('exercise-list');
      if (list) renderList(list);
    }
  });

  containerRef.append(el('div', { class: 'card stack' },
    el('div', { class: 'field' }, el('label', { for: 'ex-search', text: 'Search' }), search),
    el('button', {
      class: 'btn btn-primary btn-block', type: 'button',
      onclick: async () => {
        const input = await exerciseSheet(null);
        if (!input) return;
        await state.addExercise({ ...input, isCustom: true });
        toast(`Added ${input.name}.`);
        rerender();
      }
    }, '+ Add exercise')
  ));

  const listCard = el('div', { class: 'card' });
  const list = el('div', { id: 'exercise-list' });
  listCard.append(list);
  containerRef.append(listCard);

  function renderList(node) {
    clear(node);
    const needle = filter.trim().toLowerCase();
    const rows = s.exercises.filter((ex) =>
      !needle || ex.name.toLowerCase().includes(needle) || (ex.aliases || []).some((a) => a.includes(needle)));

    if (!rows.length) {
      node.append(el('p', { class: 'empty', text: 'No exercises match that search.' }));
      return;
    }

    for (const cat of orderedCategories(rows)) {
      const catRows = rows.filter((r) => (r.category || 'strength') === cat);
      const expanded = state.isPanelExpanded('exercises', cat);
      node.append(disclosure({
        id: `exercises-cat-${cat}`,
        summary: `${titleCase(cat)} (${catRows.length})`,
        expanded,
        onToggle: async (next) => { await state.setPanelExpanded('exercises', cat, next); rerender(); },
        content: el('ul', { class: 'list' }, ...catRows.map((ex) => exerciseRow(ex, rerender)))
      }));
    }
  }

  renderList(list);
}
