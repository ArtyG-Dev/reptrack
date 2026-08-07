/* Exercises — the local dictionary the voice parser matches against. */

import * as state from '../state.js';
import { el, clear, toast, openSheet, confirmSheet } from '../ui.js';

let filter = '';
let containerRef = null;

function exerciseSheet(existing = null) {
  const titleId = 'confirm-sheet-title';
  return openSheet('confirm-sheet', (ctx) => {
    const name = el('input', { type: 'text', id: 'ex-name', value: existing?.name || '', required: true, 'data-autofocus': '' });
    const aliases = el('input', { type: 'text', id: 'ex-aliases', value: (existing?.aliases || []).join(', '), placeholder: 'bench, flat bench' });
    const group = el('select', { id: 'ex-group' }, ...['chest', 'back', 'legs', 'shoulders', 'arms', 'core', 'other']
      .map((g) => el('option', { value: g, selected: (existing?.muscleGroup || 'other') === g }, g)));
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
          isBodyweight: bodyweight.checked
        });
      }
    },
      el('h2', { id: titleId, text: existing ? 'Edit exercise' : 'Add exercise' }),
      el('div', { class: 'field' }, el('label', { for: 'ex-name', text: 'Name' }), name),
      el('div', { class: 'field' }, el('label', { for: 'ex-aliases', text: 'Aliases the voice parser should accept (comma separated)' }), aliases),
      el('div', { class: 'field' }, el('label', { for: 'ex-group', text: 'Muscle group' }), group),
      el('div', { class: 'field row' }, bodyweight, el('label', { for: 'ex-bodyweight', style: 'margin:0', text: 'Bodyweight exercise (a lone number means reps)' })),
      el('div', { class: 'sheet-actions' },
        el('button', { class: 'btn', type: 'button', onclick: () => ctx.close(null) }, 'Cancel'),
        el('button', { class: 'btn btn-primary', type: 'submit' }, 'Save')
      )
    );
  }, { labelledBy: titleId });
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
  const list = el('ul', { class: 'list', id: 'exercise-list' });
  listCard.append(list);
  containerRef.append(listCard);

  function renderList(node) {
    clear(node);
    const needle = filter.trim().toLowerCase();
    const rows = s.exercises.filter((ex) =>
      !needle || ex.name.toLowerCase().includes(needle) || (ex.aliases || []).some((a) => a.includes(needle)));

    if (!rows.length) {
      node.append(el('li', {}, el('p', { class: 'empty', text: 'No exercises match that search.' })));
      return;
    }

    for (const ex of rows) {
      const count = s.allSets.filter((x) => x.exerciseId === ex.id).length;
      node.append(el('li', {},
        el('div', { class: 'grow' },
          el('p', { style: 'margin:0;font-weight:600' }, ex.name, ex.isBodyweight ? el('span', { class: 'small muted', text: ' · bodyweight' }) : null),
          el('p', { class: 'small muted', style: 'margin:0', text: `${ex.muscleGroup} · ${count} set${count === 1 ? '' : 's'} logged${(ex.aliases || []).length ? ` · ${ex.aliases.join(', ')}` : ''}` })
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
      ));
    }
  }

  renderList(list);
}
