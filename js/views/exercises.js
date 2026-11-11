/* Exercises — the local dictionary the voice parser matches against. */

import * as state from '../state.js';
import { el, clear, toast, openSheet, confirmSheet, disclosure, titleCase } from '../ui.js';
import { CATEGORIES, MUSCLES } from '../exercises-seed.js';
import { MUSCLE_LABELS } from '../muscles.js';
import { describeTarget } from '../plans.js';

let filter = '';
let containerRef = null;

/** A row of toggle buttons, one per muscle. `other` is the opposite list: a
 *  muscle is primary or secondary, never both, so choosing it here drops it there.
 *  `sync` updates every chip in place, so keyboard focus stays where it was. */
function muscleChips(kind, chosen, other, sync) {
  return el('div', { class: 'chips', role: 'group', 'aria-label': `${kind === 'primary' ? 'Primary' : 'Secondary'} muscles`, id: `ex-${kind}-muscles` },
    ...MUSCLES.map((m) => el('button', {
      class: 'chip', type: 'button', 'aria-pressed': chosen.has(m) ? 'true' : 'false', dataset: { muscle: m },
      onclick: () => { if (chosen.has(m)) chosen.delete(m); else { chosen.add(m); other.delete(m); } sync(); }
    }, MUSCLE_LABELS[m])));
}

function exerciseSheet(existing = null, { preselectMuscle = null } = {}) {
  const titleId = 'confirm-sheet-title';
  return openSheet('confirm-sheet', (ctx) => {
    const primary = new Set(existing?.primaryMuscles || (preselectMuscle ? [preselectMuscle] : []));
    const secondary = new Set(existing?.secondaryMuscles || []);
    const sync = () => {
      for (const [group, chosen] of [[primaryChips, primary], [secondaryChips, secondary]]) {
        for (const chip of group.children) chip.setAttribute('aria-pressed', chosen.has(chip.dataset.muscle) ? 'true' : 'false');
      }
    };
    const primaryChips = muscleChips('primary', primary, secondary, sync);
    const secondaryChips = muscleChips('secondary', secondary, primary, sync);
    const chipsHost = el('div', { class: 'stack' },
      el('p', { class: 'small', style: 'margin:0', text: 'Primary muscles' }), primaryChips,
      el('p', { class: 'small', style: 'margin:0', text: 'Secondary muscles' }), secondaryChips
    );
    const name = el('input', { type: 'text', id: 'ex-name', value: existing?.name || '', required: true, 'data-autofocus': '' });
    const aliases = el('input', { type: 'text', id: 'ex-aliases', value: (existing?.aliases || []).join(', '), placeholder: 'bench, flat bench' });
    const group = el('select', { id: 'ex-group' }, ...['chest', 'back', 'legs', 'shoulders', 'arms', 'core', 'other']
      .map((g) => el('option', { value: g, selected: (existing?.muscleGroup || 'other') === g }, g)));

    // Category is a suggestion list, not a fixed enum — the dropdown offers
    // CATEGORIES ∪ whatever is already in use, plus an explicit "type your own"
    // option. A real <select> (rather than a text input + <datalist>) is what
    // actually shows a visible list of choices consistently across browsers —
    // datalist suggestion UI is unreliable, especially on mobile.
    const CUSTOM = '__custom__';
    const inUse = [...new Set([...CATEGORIES, ...state.getState().exercises.map((ex) => ex.category || 'strength')])].sort();
    const existingCategory = existing?.category || 'strength';
    const isKnownCategory = inUse.includes(existingCategory);

    const customCategory = el('input', {
      type: 'text', id: 'ex-category-custom', placeholder: 'e.g. crossfit',
      value: isKnownCategory ? '' : existingCategory
    });
    const customCategoryField = el('div', { class: 'field', id: 'ex-category-custom-field', hidden: isKnownCategory },
      el('label', { for: 'ex-category-custom', text: 'Custom category name' }), customCategory
    );

    const category = el('select', {
      id: 'ex-category',
      onchange: (e) => {
        customCategoryField.hidden = e.target.value !== CUSTOM;
        if (e.target.value === CUSTOM) customCategory.focus();
      }
    },
      ...inUse.map((c) => el('option', { value: c, selected: isKnownCategory && c === existingCategory }, titleCase(c))),
      el('option', { value: CUSTOM, selected: !isKnownCategory }, 'Other (type your own)…')
    );

    const mode = el('select', { id: 'ex-mode' },
      el('option', { value: 'reps', selected: (existing?.mode || 'reps') !== 'hold' }, 'Reps (weight × reps × sets)'),
      el('option', { value: 'hold', selected: existing?.mode === 'hold' }, 'Hold (timed duration)')
    );

    const bodyweight = el('input', { type: 'checkbox', id: 'ex-bodyweight', style: 'width:auto;min-height:auto', checked: Boolean(existing?.isBodyweight) });
    const rest = el('input', {
      type: 'number', id: 'ex-rest', min: '0', step: '5', inputmode: 'numeric',
      value: existing?.restSec ? String(existing.restSec) : '',
      placeholder: `Default (${state.getState().settings.defaultRestSec || 90})`
    });

    return el('form', {
      method: 'dialog',
      onsubmit: (e) => {
        e.preventDefault();
        if (!name.value.trim()) { toast('Give the exercise a name.'); return; }
        const chosenCategory = category.value === CUSTOM ? customCategory.value : category.value;
        ctx.close({
          name: name.value.trim(),
          aliases: aliases.value.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean),
          muscleGroup: group.value,
          category: (chosenCategory.trim() || 'strength').toLowerCase(),
          mode: mode.value,
          isBodyweight: bodyweight.checked,
          restSec: Number(rest.value) > 0 ? Math.round(Number(rest.value)) : null,   // blank: use the default
          primaryMuscles: MUSCLES.filter((m) => primary.has(m)),
          secondaryMuscles: MUSCLES.filter((m) => secondary.has(m))
        });
      }
    },
      el('h2', { id: titleId, text: existing ? 'Edit exercise' : 'Add exercise' }),
      el('div', { class: 'field' }, el('label', { for: 'ex-name', text: 'Name' }), name),
      el('div', { class: 'field' }, el('label', { for: 'ex-aliases', text: 'Aliases the voice parser should accept (comma separated)' }), aliases),
      el('div', { class: 'field-row' },
        el('div', {}, el('label', { for: 'ex-group', text: 'Muscle group' }), group),
        el('div', {}, el('label', { for: 'ex-category', text: 'Category' }), category)
      ),
      customCategoryField,
      el('div', { class: 'field' }, chipsHost,
        el('p', { class: 'small muted', style: 'margin:4px 0 0', text: 'A working set counts 1 for each primary muscle and ½ for each secondary in the weekly charts.' })),
      el('div', { class: 'field' },
        el('label', { for: 'ex-mode', text: 'How it’s logged' }), mode,
        el('p', { class: 'small muted', style: 'margin:4px 0 0', text: 'Reps covers strength and calisthenics (weight is optional). Hold covers yoga poses, pilates holds, and timed calisthenics like a plank.' })
      ),
      el('div', { class: 'field' },
        el('label', { for: 'ex-rest', text: 'Rest after a set (seconds)' }), rest,
        el('p', { class: 'small muted', style: 'margin:4px 0 0', text: 'Leave blank to use your default rest time.' })
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

/* ---------- plans ---------- */

/** Create / edit a plan: a name and an ordered list of exercises with targets.
 *  The target fields follow the chosen exercise's mode, as the set sheet does. */
export function planSheet(existing = null, { preselect = null } = {}) {
  const titleId = 'confirm-sheet-title';
  const exercises = state.getState().exercises;
  return openSheet('confirm-sheet', (ctx) => {
    const name = el('input', { type: 'text', id: 'plan-name', value: existing?.name || '', required: true, 'data-autofocus': '' });
    let items = (existing?.items || []).map((i) => ({ ...i }));
    if (!items.length) items.push(blankItem(preselect || exercises[0]?.id));
    const wrap = el('div', { class: 'stack' });

    function blankItem(exerciseId) {
      return { exerciseId, targetSets: 3, targetReps: 8, targetWeight: null, unit: state.getState().settings.unit, targetHoldSec: null, note: '' };
    }
    const isHold = (id) => state.exerciseById(id)?.mode === 'hold';

    const renderItems = () => {
      clear(wrap);
      items.forEach((item, i) => {
        const num = (key, attrs = {}) => el('input', {
          type: 'number', min: '0', inputmode: 'decimal', id: `plan-${key}-${i}`,
          value: item[key] == null ? '' : String(item[key]), ...attrs,
          oninput: (e) => { item[key] = e.target.value === '' ? null : Number(e.target.value); }
        });
        const exSelect = el('select', {
          id: `plan-ex-${i}`,
          onchange: (e) => { item.exerciseId = e.target.value; if (isHold(item.exerciseId)) item.targetHoldSec = item.targetHoldSec ?? 30; renderItems(); }
        }, ...exercises.map((ex) => el('option', { value: ex.id, selected: ex.id === item.exerciseId }, ex.name)));
        const move = (dir) => { const j = i + dir; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; renderItems(); };
        const label = state.exerciseById(item.exerciseId)?.name || `item ${i + 1}`;
        wrap.append(el('div', { class: 'card stack plan-item' },
          el('div', { class: 'field' }, el('label', { for: `plan-ex-${i}`, text: `Exercise ${i + 1}` }), exSelect),
          el('div', { class: 'field-row' },
            el('div', {}, el('label', { for: `plan-targetSets-${i}`, text: 'Sets' }), num('targetSets', { min: '1', step: '1' })),
            ...(isHold(item.exerciseId)
              ? [el('div', {}, el('label', { for: `plan-targetHoldSec-${i}`, text: 'Hold (seconds)' }), num('targetHoldSec', { step: '5' }))]
              : [
                el('div', {}, el('label', { for: `plan-targetReps-${i}`, text: 'Reps' }), num('targetReps', { step: '1' })),
                el('div', {}, el('label', { for: `plan-targetWeight-${i}`, text: `Weight (${item.unit || 'kg'})` }), num('targetWeight', { step: '0.5' }))
              ])
          ),
          el('div', { class: 'field' }, el('label', { for: `plan-note-${i}`, text: 'Note (optional)' }),
            el('input', { type: 'text', id: `plan-note-${i}`, value: item.note || '', oninput: (e) => { item.note = e.target.value; } })),
          el('div', { class: 'row' },
            el('button', { class: 'btn btn-sm', type: 'button', 'aria-label': `Move ${label} up`, disabled: i === 0, onclick: () => move(-1) }, '↑'),
            el('button', { class: 'btn btn-sm', type: 'button', 'aria-label': `Move ${label} down`, disabled: i === items.length - 1, onclick: () => move(1) }, '↓'),
            el('button', { class: 'btn btn-sm btn-ghost', type: 'button', 'aria-label': `Remove ${label} from the plan`, onclick: () => { items.splice(i, 1); renderItems(); } }, 'Remove')
          )
        ));
      });
    };
    renderItems();

    return el('form', {
      method: 'dialog',
      onsubmit: (e) => {
        e.preventDefault();
        if (!name.value.trim()) { toast('Give the plan a name.'); return; }
        if (!items.length) { toast('Add at least one exercise.'); return; }
        // Keep only the fields that fit each exercise's mode.
        ctx.close({
          name: name.value.trim(),
          items: items.map((i) => ({
            ...i,
            targetSets: Math.max(1, Math.round(Number(i.targetSets) || 1)),
            ...(isHold(i.exerciseId) ? { targetReps: null, targetWeight: null } : { targetHoldSec: null })
          }))
        });
      }
    },
      el('h2', { id: titleId, text: existing ? 'Edit plan' : 'New plan' }),
      el('div', { class: 'field' }, el('label', { for: 'plan-name', text: 'Plan name' }), name),
      wrap,
      el('button', { class: 'btn btn-sm', type: 'button', id: 'plan-add-item', onclick: () => { items.push(blankItem(items.at(-1)?.exerciseId || exercises[0]?.id)); renderItems(); } }, '+ Add exercise to plan'),
      el('div', { class: 'sheet-actions' },
        el('button', { class: 'btn', type: 'button', onclick: () => ctx.close(null) }, 'Cancel'),
        el('button', { class: 'btn btn-primary', type: 'submit' }, 'Save plan')
      )
    );
  }, { labelledBy: titleId });
}

function plansSection(rerender) {
  const { plans } = state.getState();
  const rows = plans.map((plan, i) => el('li', {},
    el('div', { class: 'grow' },
      el('strong', { text: plan.name }),
      el('p', { class: 'small muted', style: 'margin:0', text: plan.items.map((it) => `${state.exerciseById(it.exerciseId)?.name || '?'} ${describeTarget(it)}`).join(' · ') || 'No exercises yet' })
    ),
    el('button', { class: 'btn btn-sm', type: 'button', 'aria-label': `Move plan ${plan.name} up`, disabled: i === 0, onclick: () => state.movePlan(plan.id, -1) }, '↑'),
    el('button', { class: 'btn btn-sm', type: 'button', 'aria-label': `Move plan ${plan.name} down`, disabled: i === plans.length - 1, onclick: () => state.movePlan(plan.id, 1) }, '↓'),
    el('button', {
      class: 'btn btn-sm', type: 'button', 'aria-label': `Edit plan ${plan.name}`,
      onclick: async () => { const next = await planSheet(plan); if (next) { await state.savePlan({ ...plan, ...next }); toast(`Saved ${next.name}.`); } }
    }, 'Edit'),
    el('button', {
      class: 'btn btn-sm btn-ghost', type: 'button', 'aria-label': `Delete plan ${plan.name}`,
      onclick: async () => {
        const yes = await confirmSheet({ title: 'Delete plan?', message: `“${plan.name}” will be removed. Sessions already logged from it are kept.`, confirmLabel: 'Delete', danger: true });
        if (yes) { await state.deletePlan(plan.id); toast('Plan deleted.'); }
      }
    }, '✕')
  ));
  return disclosure({
    id: 'exercises-plans',
    summary: `Plans (${plans.length})`,
    expanded: state.isPanelExpanded('exercises', '__plans'),
    onToggle: async (next) => { await state.setPanelExpanded('exercises', '__plans', next); rerender(); },
    content: el('div', { class: 'stack' },
      plans.length ? el('ul', { class: 'list', id: 'plan-list' }, ...rows) : el('p', { class: 'empty', text: 'No plans yet. Build one here, or use “Save as plan” on a finished session in the Diary.' }),
      el('button', {
        class: 'btn btn-block', type: 'button', id: 'new-plan',
        onclick: async () => { const next = await planSheet(null); if (next) { await state.savePlan(next); toast(`Saved ${next.name}.`); } }
      }, '+ New plan')
    )
  });
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

  containerRef.append(el('div', { class: 'card' }, plansSection(rerender)));

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
