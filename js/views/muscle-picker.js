/* Choosing which muscles an exercise works: optional, always editable later.
 * Three ways in, all kept in step: a suggestion from the name (shown, never
 * applied on its own), tapping the flat figure (none → main → supporting →
 * none), and the two rows of toggle chips. Used by the exercise editor and by
 * "Create … as a new exercise" when a spoken name isn't in the dictionary.
 */

import { el } from '../ui.js';
import { MUSCLES, MUSCLE_LABELS } from '../exercises-seed.js';
import { suggestMuscles } from '../muscles.js';
import { renderBody } from '../bodymap.js';

const ROLE_LEVEL = { primary: 3, secondary: 1, none: 0 };
const ROLE_WORD = { primary: 'main', secondary: 'supporting', none: 'not set' };

/** A row of toggle buttons, one per muscle. Choosing a muscle in one row drops
 *  it from the other: a muscle is main or supporting, never both. */
function chipRow(kind, chosen, other, sync) {
  return el('div', { class: 'chips', role: 'group', 'aria-label': `${kind === 'primary' ? 'Main' : 'Supporting'} muscles`, id: `ex-${kind}-muscles` },
    ...MUSCLES.map((m) => el('button', {
      class: 'chip', type: 'button', 'aria-pressed': chosen.has(m) ? 'true' : 'false', dataset: { muscle: m },
      onclick: () => { if (chosen.has(m)) chosen.delete(m); else { chosen.add(m); other.delete(m); } sync(); }
    }, MUSCLE_LABELS[m])));
}

const listText = (ids) => ids.map((m) => MUSCLE_LABELS[m]).join(', ');

/**
 * @param {{ primary?: string[], secondary?: string[], nameInput?: HTMLInputElement, figure?: string }} opts
 * @returns {{ node: HTMLElement, value: () => { primaryMuscles: string[], secondaryMuscles: string[] } }}
 */
export function musclePicker({ primary = [], secondary = [], nameInput = null, figure = 'neutral' } = {}) {
  const main = new Set(primary);
  const support = new Set(secondary);
  const roleOf = (m) => (main.has(m) ? 'primary' : support.has(m) ? 'secondary' : 'none');

  const figures = el('div', { class: 'body-views picker-figures' },
    ...['front', 'back'].map((side) => el('div', { class: 'body-view', 'data-side': side },
      el('p', { class: 'small muted', style: 'margin:0;text-align:center', text: side === 'front' ? 'Front' : 'Back' }),
      renderBody({
        figure, view: side,
        levelOf: (m) => ROLE_LEVEL[roleOf(m)],
        labelOf: (m) => `${MUSCLE_LABELS[m]}: ${ROLE_WORD[roleOf(m)]}`,
        onPick: (m) => {
          // Tap cycles: not set → main → supporting → not set.
          if (main.has(m)) { main.delete(m); support.add(m); } else if (support.has(m)) support.delete(m); else main.add(m);
          sync();
        }
      }))));

  const suggestion = el('div', { class: 'small', id: 'ex-suggestion', hidden: true });

  // Everything updates in place, so a chip or a muscle keeps keyboard focus.
  function sync() {
    for (const [row, chosen] of [[mainChips, main], [supportChips, support]]) {
      for (const chip of row.children) chip.setAttribute('aria-pressed', chosen.has(chip.dataset.muscle) ? 'true' : 'false');
    }
    for (const path of figures.querySelectorAll('path.muscle')) {
      const m = path.dataset.muscle;
      path.setAttribute('class', `muscle heat-${ROLE_LEVEL[roleOf(m)]}`);
      const label = `${MUSCLE_LABELS[m]}: ${ROLE_WORD[roleOf(m)]}`;
      if (path.getAttribute('role') === 'button') path.setAttribute('aria-label', label);
      const title = path.querySelector('title');
      if (title) title.textContent = label;
    }
    updateSuggestion();
  }

  function updateSuggestion() {
    const s = nameInput ? suggestMuscles(nameInput.value) : null;
    const same = s && s.primaryMuscles.every((m) => main.has(m)) && s.secondaryMuscles.every((m) => support.has(m));
    suggestion.hidden = !s || same;
    suggestion.textContent = '';
    if (!s || same) return;
    suggestion.append(
      el('span', { text: `Suggested from the name: ${listText(s.primaryMuscles)} (main)${s.secondaryMuscles.length ? `, ${listText(s.secondaryMuscles)} (supporting)` : ''}. ` }),
      el('button', {
        class: 'btn btn-sm', type: 'button', id: 'ex-use-suggestion',
        onclick: () => {
          main.clear(); support.clear();
          s.primaryMuscles.forEach((m) => main.add(m));
          s.secondaryMuscles.forEach((m) => support.add(m));
          sync();
          document.getElementById('ex-primary-muscles')?.querySelector('button')?.focus();
        }
      }, 'Use suggestion'));
  }

  const mainChips = chipRow('primary', main, support, sync);
  const supportChips = chipRow('secondary', support, main, sync);
  nameInput?.addEventListener('input', updateSuggestion);
  updateSuggestion();

  const node = el('fieldset', { class: 'field stack muscle-picker' },
    el('legend', { text: 'Muscles (optional)' }),
    el('p', { class: 'small muted', style: 'margin:0', text: 'Leave them empty to assign later: the exercise shows as Unassigned until you do. Tap the figure to cycle main → supporting → none.' }),
    suggestion,
    figures,
    el('p', { class: 'small', style: 'margin:0', text: 'Main muscles' }), mainChips,
    el('p', { class: 'small', style: 'margin:0', text: 'Supporting muscles' }), supportChips,
    el('p', { class: 'small muted', style: 'margin:0', text: 'A set counts 1 for each main muscle and ½ for each supporting one.' })
  );
  return { node, value: () => ({ primaryMuscles: MUSCLES.filter((m) => main.has(m)), secondaryMuscles: MUSCLES.filter((m) => support.has(m)) }) };
}
