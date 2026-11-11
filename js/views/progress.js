/* Progress — per-exercise charts, personal bests, and the progression nudge.
 * A `hold`-mode exercise (yoga, pilates, a timed calisthenics hold) charts hold
 * duration instead of weight — everything else about the screen is shared.
 */

import * as state from '../state.js';
import { el, clear, humanDate } from '../ui.js';
import { renderChart, renderBars } from '../chart.js';
import { MUSCLES } from '../exercises-seed.js';
import { MUSCLE_LABELS, weeklyMuscleSets, muscleWeeklySeries, definitionLevel, HEAT_THRESHOLDS } from '../muscles.js';
import { renderBody } from '../bodymap.js';
import { openMuscleSheet } from './muscle-sheet.js';
import { todayISO } from '../store.js';
import { buildSeries, suggestProgression, bestSet, estimate1RM, fromKg, toKg, formatWeight, formatDuration } from '../progression.js';
import { describeSet } from '../parser.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const view = { exerciseId: null, metric: null, muscle: null, bodySide: 'front' };

let containerRef = null;

const METRICS_REPS = {
  e1rm: { label: 'Estimated 1RM', pick: (p) => p.e1rm },
  topWeight: { label: 'Top set weight', pick: (p) => p.topWeight },
  reps: { label: 'Reps at top set', pick: (p) => p.reps },
  totalReps: { label: 'Total reps per session', pick: (p) => p.totalReps, count: true },
  volume: { label: 'Volume per session', pick: (p) => p.volume }
};

/* A bodyweight exercise has no load to multiply, so its volume is its total
 * reps — said so in the label rather than charting a row of zeros. */
const VOLUME_BODYWEIGHT = { label: 'Volume per session (total reps — bodyweight)', pick: (p) => p.totalReps, count: true };

const METRICS_HOLD = {
  holdSeconds: { label: 'Hold duration', pick: (p) => p.holdSeconds || 0 }
};

function metricsFor(exercise) {
  if (exercise?.mode === 'hold') return METRICS_HOLD;
  return exercise?.isBodyweight ? { ...METRICS_REPS, volume: VOLUME_BODYWEIGHT } : METRICS_REPS;
}

const formatSets = (v) => String(Math.round(v * 10) / 10);

/** "This week's muscles": the body map, front and back (one at a time on a
 *  narrow screen, with a flip button). Fill = this week's heat; outline weight
 *  and inner lines = lifetime definition; the figure's glow follows `glow`
 *  damped by frost, exactly as the Forge does. */
function bodyCard(s) {
  const byId = new Map(s.exercises.map((ex) => [ex.id, ex]));
  const { current } = weeklyMuscleSets(s.allSets, byId, todayISO());
  const definition = Object.fromEntries(MUSCLES.map((m) => [m, definitionLevel(m, s.allSets, byId)]));
  const { glow, frostHint } = state.activityVisual();
  const shownGlow = glow * (1 - 0.35 * frostHint);
  const figure = s.settings.bodyFigure || 'neutral';
  const pick = (muscle) => openMuscleSheet([muscle]);

  const views = el('div', { class: 'body-views', 'data-show': view.bodySide },
    ...['front', 'back'].map((side) => el('div', { class: 'body-view', 'data-side': side },
      el('p', { class: 'small muted', style: 'margin:0;text-align:center', text: side === 'front' ? 'Front' : 'Back' }),
      renderBody({ figure, view: side, counts: current, definition, glow: shownGlow, onPick: pick })
    )));
  const [lo, hi] = HEAT_THRESHOLDS;
  const swatch = (n, text) => {
    const square = document.createElementNS(SVG_NS, 'svg');
    square.setAttribute('class', 'legend-swatch');
    square.setAttribute('viewBox', '0 0 12 12');
    square.setAttribute('aria-hidden', 'true');
    const rect = document.createElementNS(SVG_NS, 'rect');
    for (const [k, v] of Object.entries({ class: `muscle heat-${n}`, width: 12, height: 12, rx: 3 })) rect.setAttribute(k, String(v));
    square.append(rect);
    return el('span', { class: 'legend-item' }, square, text);
  };
  const legend = el('div', { class: 'body-legend', role: 'group', 'aria-label': 'Heat legend' },
    swatch(0, 'None'), swatch(1, `Under ${lo} sets`), swatch(2, `${lo}–${hi - 1} sets`), swatch(3, `${hi}+ sets`));

  return el('div', { class: 'card stack', id: 'body-card' },
    el('div', { class: 'row-between' },
      el('h3', { style: 'margin:0', text: 'This week’s muscles' }),
      el('button', {
        class: 'btn btn-sm body-flip', type: 'button', id: 'body-flip',
        'aria-label': `Show the ${view.bodySide === 'front' ? 'back' : 'front'} of the body`,
        onclick: () => { view.bodySide = view.bodySide === 'front' ? 'back' : 'front'; render(containerRef); }
      }, 'Flip')
    ),
    views,
    legend,
    el('p', { class: 'small muted', style: 'margin:0', text: 'Tap a muscle for your exercises that work it. Colour is this week’s working sets; the outline firms up with everything you’ve done, and never fades.' })
  );
}

/** "Weekly sets by muscle": this week's bars over last week's, then one muscle's 12 weeks. */
function muscleCard(s, rerender) {
  const byId = new Map(s.exercises.map((ex) => [ex.id, ex]));
  const today = todayISO();
  const { current, previous } = weeklyMuscleSets(s.allSets, byId, today);
  const rows = MUSCLES.filter((m) => current[m] || previous[m])
    .map((m) => ({ label: MUSCLE_LABELS[m], value: current[m], previous: previous[m] }));

  const card = el('div', { class: 'card stack', id: 'muscle-card' }, el('h3', { text: 'Weekly sets by muscle' }));
  if (!rows.length) {
    card.append(el('p', { class: 'empty', text: 'No sets for any muscle this week or last. Muscles come from each exercise’s settings in Exercises.' }));
    return card;
  }
  const barsHost = el('div', {});
  card.append(barsHost, el('p', { class: 'small muted', style: 'margin:0', text: 'Solid: this week (Monday to today). Faint: last week. A set counts 1 for each primary muscle, ½ for each secondary; warm-ups don’t count.' }));
  renderBars(barsHost, rows, { title: 'Working sets by muscle, this week and last', currentLabel: 'This week', previousLabel: 'Last week', formatValue: formatSets });

  if (!view.muscle) view.muscle = MUSCLES.filter((m) => current[m] || previous[m]).sort((a, b) => current[b] - current[a])[0];
  const picker = el('select', { id: 'muscle-pick', onchange: (e) => { view.muscle = e.target.value; rerender(); } },
    ...MUSCLES.map((m) => el('option', { value: m, selected: m === view.muscle }, MUSCLE_LABELS[m])));
  const lineHost = el('div', {});
  card.append(el('div', { class: 'field', style: 'margin:0' }, el('label', { for: 'muscle-pick', text: 'Muscle, last 12 weeks' }), picker), lineHost);
  renderChart(lineHost, muscleWeeklySeries(s.allSets, byId, view.muscle, today), {
    title: `Weekly sets for ${MUSCLE_LABELS[view.muscle]} over 12 weeks`,
    unitLabel: ' sets',
    pointNoun: 'weeks',
    formatValue: formatSets
  });
  return card;
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
    unitLabel: isHold || view.metric === 'reps' || metric.count ? '' : ` ${unit}`,
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
  containerRef.append(bodyCard(s));
  containerRef.append(muscleCard(s, rerender));

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
