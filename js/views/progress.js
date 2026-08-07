/* Progress — per-exercise charts, personal bests, and the progression nudge.
 * A `hold`-mode exercise (yoga, pilates, a timed calisthenics hold) charts hold
 * duration instead of weight — everything else about the screen is shared.
 */

import * as state from '../state.js';
import { el, clear, humanDate } from '../ui.js';
import { renderChart } from '../chart.js';
import { buildSeries, suggestProgression, bestSet, estimate1RM, fromKg, toKg, formatWeight, formatDuration } from '../progression.js';
import { describeSet } from '../parser.js';

const view = { exerciseId: null, metric: null };

let containerRef = null;

const METRICS_REPS = {
  e1rm: { label: 'Estimated 1RM', pick: (p) => p.e1rm },
  topWeight: { label: 'Top set weight', pick: (p) => p.topWeight },
  reps: { label: 'Reps at top set', pick: (p) => p.reps }
};

const METRICS_HOLD = {
  holdSeconds: { label: 'Hold duration', pick: (p) => p.holdSeconds || 0 }
};

function metricsFor(exercise) {
  return exercise?.mode === 'hold' ? METRICS_HOLD : METRICS_REPS;
}

function exercisesWithData() {
  const s = state.getState();
  const ids = new Set(s.allSets.map((x) => x.exerciseId));
  return s.exercises.filter((ex) => ids.has(ex.id));
}

function summaryCardReps(sets, unit) {
  const heaviest = [...sets].sort((a, b) => toKg(b.weight, b.unit) - toKg(a.weight, a.unit))[0];
  const best = bestSet(sets);
  const bestE1rm = best ? fromKg(estimate1RM(best.weight, best.reps, best.unit), unit) : 0;
  const mostReps = [...sets].sort((a, b) => b.reps - a.reps)[0];

  const stat = (label, value) => el('div', { class: 'grow' },
    el('p', { class: 'small muted', style: 'margin:0', text: label }),
    el('p', { class: 'mono', style: 'margin:0;font-size:1.15rem;font-weight:700', text: value })
  );

  return el('div', { class: 'card' },
    el('h3', { text: 'Personal bests' }),
    el('div', { class: 'row' },
      stat('Heaviest set', heaviest ? describeSet(heaviest) : '—'),
      stat('Best est. 1RM', best ? `${formatWeight(Math.round(bestE1rm * 10) / 10)} ${unit}` : '—'),
      stat('Most reps', mostReps ? `${mostReps.reps}` : '—')
    ),
    el('p', { class: 'small muted', style: 'margin-top:10px', text: `${sets.length} sets across ${new Set(sets.map((s) => s.dateISO)).size} sessions.` })
  );
}

function summaryCardHold(sets) {
  const longest = bestSet(sets);
  const totalSec = sets.reduce((sum, s) => sum + (Number(s.holdSeconds) || 0), 0);

  const stat = (label, value) => el('div', { class: 'grow' },
    el('p', { class: 'small muted', style: 'margin:0', text: label }),
    el('p', { class: 'mono', style: 'margin:0;font-size:1.15rem;font-weight:700', text: value })
  );

  return el('div', { class: 'card' },
    el('h3', { text: 'Personal bests' }),
    el('div', { class: 'row' },
      stat('Longest hold', longest ? formatDuration(longest.holdSeconds) : '—'),
      stat('Total hold time', formatDuration(totalSec)),
      stat('Holds logged', String(sets.length))
    ),
    el('p', { class: 'small muted', style: 'margin-top:10px', text: `${sets.length} holds across ${new Set(sets.map((s) => s.dateISO)).size} sessions.` })
  );
}

export function render(container) {
  containerRef = container || containerRef;
  if (!containerRef) return;
  const s = state.getState();
  const unit = s.settings.unit;
  const rerender = () => render(containerRef);

  clear(containerRef);
  containerRef.append(el('h2', { class: 'visually-hidden', text: 'Progress' }));

  const available = exercisesWithData();
  if (!available.length) {
    containerRef.append(el('div', { class: 'card' },
      el('p', { class: 'empty', text: 'No sets logged yet. Charts appear once you have a session or two in the diary.' })
    ));
    return;
  }

  if (!view.exerciseId || !available.some((ex) => ex.id === view.exerciseId)) {
    view.exerciseId = state.currentExercise()?.id && available.some((e) => e.id === state.currentExercise().id)
      ? state.currentExercise().id
      : available[0].id;
  }

  const exercise = state.exerciseById(view.exerciseId);
  const metrics = metricsFor(exercise);
  if (!view.metric || !metrics[view.metric]) view.metric = Object.keys(metrics)[0];

  const picker = el('select', {
    id: 'progress-exercise',
    onchange: (e) => { view.exerciseId = e.target.value; view.metric = null; rerender(); }
  }, ...available.map((ex) => el('option', { value: ex.id, selected: ex.id === view.exerciseId }, ex.name)));

  const metricButtons = el('div', { class: 'row', role: 'group', 'aria-label': 'Chart metric' },
    ...Object.entries(metrics).map(([key, meta]) => el('button', {
      class: `btn btn-sm ${view.metric === key ? 'btn-primary' : ''}`,
      type: 'button',
      'aria-pressed': view.metric === key ? 'true' : 'false',
      onclick: () => { view.metric = key; rerender(); }
    }, meta.label))
  );

  containerRef.append(el('div', { class: 'card stack' },
    el('div', { class: 'field' }, el('label', { for: 'progress-exercise', text: 'Exercise' }), picker),
    metricButtons
  ));

  const sets = state.setsForExerciseSync(view.exerciseId);
  const series = buildSeries(sets, unit);
  const metric = metrics[view.metric];
  const isHold = exercise?.mode === 'hold';
  const points = series.map((p) => ({ label: p.dateISO, value: metric.pick(p), isPR: p.isPR }));

  const chartCard = el('div', { class: 'card' },
    el('h3', { text: `${metric.label} — ${exercise?.name || ''}` })
  );
  const chartHost = el('div', {});
  chartCard.append(chartHost);
  renderChart(chartHost, points, {
    title: `${metric.label} over time`,
    unitLabel: isHold || view.metric === 'reps' ? '' : ` ${unit}`,
    formatValue: (v) => (isHold ? formatDuration(v) : formatWeight(Math.round(v * 10) / 10))
  });
  chartCard.append(el('p', { class: 'small muted', style: 'margin-top:8px', text: `Green points are personal records (best ${isHold ? 'hold duration' : 'estimated 1RM'} to date).` }));
  containerRef.append(chartCard);

  if (!isHold) {
    const nudge = suggestProgression(sets, {
      unit,
      stepKg: s.settings.progressionStepKg,
      stepLb: s.settings.progressionStepLb
    });
    if (nudge) {
      containerRef.append(el('div', { class: 'card' },
        el('p', { style: 'margin:0' }, el('span', { class: 'badge badge-warn', text: 'Nudge' }), ` ${nudge.message}`)
      ));
    }
  }

  containerRef.append(isHold ? summaryCardHold(sets) : summaryCardReps(sets, unit));

  const recent = [...series].reverse().slice(0, 12);
  containerRef.append(el('div', { class: 'card' },
    el('h3', { text: 'Session history' }),
    el('ul', { class: 'list' }, ...recent.map((p) => el('li', {},
      el('span', { class: 'grow', text: humanDate(p.dateISO) }),
      el('span', {
        class: 'mono small',
        text: isHold
          ? `${formatDuration(p.holdSeconds)} hold · ${p.sets} holds`
          : `${formatWeight(Math.round(p.topWeight * 10) / 10)} ${unit} × ${p.reps} · ${p.sets} sets`
      }),
      p.isPR ? el('span', { class: 'badge badge-pr', text: 'PR' }) : null
    )))
  ));
}
