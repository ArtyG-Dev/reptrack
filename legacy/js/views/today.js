/* Today / Active Session — the screen you actually use in the gym. */

import * as state from '../state.js';
import * as backdrop from '../backdrop.js';
import { el, clear, toast, openSheet, promptSheet, confirmSheet, clockTime, disclosure, titleCase } from '../ui.js';
import { backupNudgeDue } from '../reminders.js';
import { doExport } from './settings.js';
import { parseTranscript, describeSet, formatNumber } from '../parser.js';
import { listenOnce, isSupported as voiceSupported, VoiceInputError } from '../voice.js';
import { formatDuration, suggestProgression, totalVolume, formatVolumeLine } from '../progression.js';
import { pace } from '../summary.js';
import * as store from '../store.js';
import { todayISO } from '../store.js';
import * as graphicView from '../graphic-view.js';
import { planProgress, prefillFor, describeTarget } from '../plans.js';

let listening = false;
let restEndsAt = null;
let containerRef = null;

/* ---------- ticking clocks (timer + rest countdown) ---------- */

export function startTicker() {
  setInterval(() => {
    const s = state.getState();
    const timerNode = document.getElementById('session-timer');
    if (timerNode && s.session) {
      timerNode.textContent = formatDuration((Date.now() - s.session.startTs) / 1000);
    }
    const restNode = document.getElementById('rest-timer');
    if (restNode) {
      if (restEndsAt) {
        const left = Math.max(0, Math.round((restEndsAt - Date.now()) / 1000));
        restNode.textContent = left > 0 ? `Rest ${formatDuration(left)}` : 'Rest done';
        if (left === 0) { restEndsAt = null; restDone(); }
      } else {
        restNode.textContent = '';
      }
    }
  }, 1000);
}

/** Rest is over. A buzz, if the device can and the user hasn't switched it
 *  off — some Android browsers ignore vibration with the screen off. */
const REST_BUZZ = [200, 100, 200];
function restDone() {
  if (state.getState().settings.vibrateOnRest === false) return;
  try { navigator.vibrate?.(REST_BUZZ); } catch { /* unsupported: nothing to do */ }
}

/* ---------- set editor sheet ---------- */

function modeOf(exerciseId) {
  return state.exerciseById(exerciseId)?.mode === 'hold' ? 'hold' : 'reps';
}

/**
 * Confirm/edit step. Every voice log and every manual add goes through this —
 * nothing is ever written to storage without the user seeing it first. The
 * fields shown depend on the selected exercise's mode: weight/reps/unit for a
 * `reps` exercise, hold duration/side for a `hold` one (yoga, pilates, a timed
 * calisthenics hold) — switching the exercise mid-sheet switches the fields.
 * @returns {Promise<{exerciseId: string, sets: Array}|null>}
 */
function editSetsSheet({ title, exerciseId, sets, transcript = '', warnings = [], editing = false }) {
  const s = state.getState();
  const titleId = 'confirm-sheet-title';

  return openSheet('confirm-sheet', (ctx) => {
    let selectedId = exerciseId;
    let mode = modeOf(selectedId);

    const makeRepsRow = (r = {}) => ({ weight: r.weight ?? '', unit: r.unit || s.settings.unit, reps: r.reps ?? '', rpe: r.rpe ?? null, isWarmup: Boolean(r.isWarmup) });
    const makeHoldRow = (r = {}) => ({ holdSeconds: r.holdSeconds ?? '', side: r.side ?? '' });
    const makeRow = (r = {}) => (mode === 'hold' ? makeHoldRow(r) : makeRepsRow(r));

    let rows = sets.length ? sets.map((x) => makeRow(x)) : [makeRow()];

    const rowsWrap = el('div', { class: 'stack' });

    /* Quick adjust: real buttons beside a field, nudging its value by a step
     * without retyping. Reps ±1, weight ± the user's progression step, holds ±5 s. */
    const nudger = (input, row, key, step, { min = 0, label, unitText = '' }) => {
      const bump = (dir) => {
        const now = Number(row[key]) || 0;
        const next = Math.max(min, Math.round((now + dir * step()) * 100) / 100);
        row[key] = next;
        input.value = key === 'weight' ? formatNumber(next) : String(next);
      };
      return el('div', { class: 'adjust' },
        el('button', { class: 'btn btn-adjust', type: 'button', 'aria-label': `${label} down${unitText ? ` by ${step()} ${unitText}` : ''}`, onclick: () => bump(-1) }, '−'),
        el('button', { class: 'btn btn-adjust', type: 'button', 'aria-label': `${label} up${unitText ? ` by ${step()} ${unitText}` : ''}`, onclick: () => bump(1) }, '+')
      );
    };
    const weightStep = (row) => () => (row.unit === 'lb' ? Number(s.settings.progressionStepLb) || 5 : Number(s.settings.progressionStepKg) || 2.5);

    const renderRows = () => {
      clear(rowsWrap);
      rows.forEach((row, index) => {
        if (mode === 'hold') {
          const durationInput = el('input', {
            type: 'number', step: '1', min: '1', inputmode: 'numeric',
            id: `row-hold-${index}`, value: row.holdSeconds === '' ? '' : String(row.holdSeconds),
            oninput: (e) => { row.holdSeconds = e.target.value === '' ? '' : Number(e.target.value); }
          });
          const sideSelect = el('select', {
            id: `row-side-${index}`, 'aria-label': `Side for hold ${index + 1}`,
            onchange: (e) => { row.side = e.target.value || null; }
          },
            el('option', { value: '', selected: !row.side }, 'Both / n/a'),
            el('option', { value: 'left', selected: row.side === 'left' }, 'Left'),
            el('option', { value: 'right', selected: row.side === 'right' }, 'Right')
          );

          rowsWrap.append(el('div', { class: 'field-row' },
            el('div', {}, el('label', { for: `row-hold-${index}`, text: `Hold ${index + 1} — seconds` }), durationInput,
              nudger(durationInput, row, 'holdSeconds', () => 5, { min: 1, label: `Hold ${index + 1} seconds`, unitText: 'seconds' })),
            el('div', {}, el('label', { for: `row-side-${index}`, text: 'Side' }), sideSelect),
            el('div', { class: 'row', style: 'align-items:flex-end;grid-column:1 / -1' },
              el('button', {
                class: 'btn btn-sm btn-ghost', type: 'button',
                'aria-label': `Remove hold ${index + 1}`,
                onclick: () => { rows.splice(index, 1); if (!rows.length) rows.push(makeHoldRow()); renderRows(); }
              }, 'Remove')
            )
          ));
        } else {
          const weightInput = el('input', {
            type: 'number', step: '0.5', min: '0', inputmode: 'decimal',
            id: `row-weight-${index}`, value: row.weight === '' ? '' : formatNumber(row.weight),
            oninput: (e) => { row.weight = e.target.value === '' ? '' : Number(e.target.value); }
          });
          const repsInput = el('input', {
            type: 'number', step: '1', min: '1', inputmode: 'numeric',
            id: `row-reps-${index}`, value: row.reps === '' ? '' : String(row.reps),
            oninput: (e) => { row.reps = e.target.value === '' ? '' : Number(e.target.value); }
          });
          const rpeInput = el('input', {
            type: 'number', step: '0.5', min: '1', max: '10', inputmode: 'decimal', placeholder: '—',
            id: `row-rpe-${index}`, value: row.rpe == null ? '' : formatNumber(row.rpe),
            oninput: (e) => { row.rpe = e.target.value === '' ? null : Number(e.target.value); }
          });
          const warmup = el('input', {
            type: 'checkbox', id: `row-warmup-${index}`, style: 'width:auto;min-height:auto', checked: row.isWarmup,
            onchange: (e) => { row.isWarmup = e.target.checked; }
          });
          const unitSelect = el('select', { id: `row-unit-${index}`, 'aria-label': `Unit for set ${index + 1}`, onchange: (e) => { row.unit = e.target.value; } },
            el('option', { value: 'kg', selected: row.unit !== 'lb' }, 'kg'),
            el('option', { value: 'lb', selected: row.unit === 'lb' }, 'lb')
          );

          rowsWrap.append(el('div', { class: 'field-row' },
            el('div', {}, el('label', { for: `row-weight-${index}`, text: `Set ${index + 1} weight` }), weightInput,
              nudger(weightInput, row, 'weight', weightStep(row), { label: `Set ${index + 1} weight`, unitText: row.unit })),
            el('div', {}, el('label', { for: `row-unit-${index}`, text: 'Unit' }), unitSelect),
            el('div', {}, el('label', { for: `row-reps-${index}`, text: 'Reps' }), repsInput,
              nudger(repsInput, row, 'reps', () => 1, { min: 1, label: `Set ${index + 1} reps` })),
            el('div', {}, el('label', { for: `row-rpe-${index}`, text: 'RPE (optional)' }), rpeInput),
            el('div', { class: 'row', style: 'align-items:center' }, warmup,
              el('label', { for: `row-warmup-${index}`, style: 'margin:0', text: 'Warm-up set' })),
            el('div', { class: 'row', style: 'align-items:flex-end' },
              el('button', {
                class: 'btn btn-sm btn-ghost', type: 'button',
                'aria-label': `Remove set ${index + 1}`,
                onclick: () => { rows.splice(index, 1); if (!rows.length) rows.push(makeRepsRow()); renderRows(); }
              }, 'Remove')
            )
          ));
        }
      });
    };

    const exerciseSelect = el('select', {
      id: 'sheet-exercise', 'aria-label': 'Exercise', disabled: editing,
      onchange: (e) => { selectedId = e.target.value; mode = modeOf(selectedId); rows = [makeRow()]; renderRows(); }
    },
      ...s.exercises.map((ex) => el('option', { value: ex.id, selected: ex.id === exerciseId }, ex.name))
    );

    renderRows();

    const submit = () => {
      let cleaned;
      if (mode === 'hold') {
        cleaned = rows
          .map((r) => ({ holdSeconds: Math.round(Number(r.holdSeconds) || 0), side: r.side || null }))
          .filter((r) => r.holdSeconds > 0);
        if (!cleaned.length) { toast('Add at least one hold with a duration.'); return; }
      } else {
        cleaned = rows
          .map((r) => ({
            weight: Number(r.weight) || 0, unit: r.unit || s.settings.unit, reps: Math.round(Number(r.reps) || 0),
            rpe: r.rpe == null || r.rpe === '' || !Number.isFinite(Number(r.rpe)) ? null : Math.min(10, Math.max(1, Number(r.rpe))),
            isWarmup: Boolean(r.isWarmup)
          }))
          .filter((r) => r.reps > 0);
        if (!cleaned.length) { toast('Add at least one set with reps.'); return; }
      }
      ctx.close({ exerciseId: selectedId, sets: cleaned });
    };

    return el('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); submit(); } },
      el('h2', { id: titleId, text: title }),
      transcript ? el('p', { class: 'transcript', text: `“${transcript}”` }) : null,
      ...warnings.map((w) => el('p', { class: 'small muted', text: w })),
      el('div', { class: 'field' }, el('label', { for: 'sheet-exercise', text: 'Exercise' }), exerciseSelect),
      rowsWrap,
      editing ? null : el('button', {
        class: 'btn btn-sm', type: 'button',
        onclick: () => { rows.push(makeRow(rows.at(-1) || {})); renderRows(); }
      }, mode === 'hold' ? '+ Another hold' : '+ Another set'),
      el('div', { class: 'sheet-actions' },
        el('button', { class: 'btn', type: 'button', onclick: () => ctx.close(null) }, 'Cancel'),
        el('button', { class: 'btn btn-primary', type: 'submit', 'data-autofocus': '' }, 'Save')
      )
    );
  }, { labelledBy: titleId });
}

/* ---------- logging flows ---------- */

async function commit(result) {
  if (!result) return;
  const created = await state.logSets(result.exerciseId, result.sets);
  const prs = created.filter((c) => c.isPR).length;
  restEndsAt = Date.now() + restSecondsFor(result.exerciseId) * 1000;
  toast(prs ? `Logged ${created.length} set${created.length > 1 ? 's' : ''} — ${prs} personal record!` : `Logged ${created.length} set${created.length > 1 ? 's' : ''}.`);
}

/** An exercise's own rest time if it has one, else the default. */
function restSecondsFor(exerciseId) {
  const own = Number(state.exerciseById(exerciseId)?.restSec);
  return own > 0 ? own : (state.getState().settings.defaultRestSec || 90);
}

/** Reopens a logged set in the same sheet, prefilled; saving updates it (and
 *  recomputes PRs for its exercise). `proposed` lets "make that 8" prefill the
 *  change — it still has to be confirmed, like everything else. */
export async function editSet(entry, proposed = null, transcript = '') {
  const result = await editSetsSheet({
    title: 'Edit set',
    exerciseId: entry.exerciseId,
    sets: [proposed || entry],
    transcript,
    editing: true
  });
  if (!result) return;
  const [row] = result.sets;
  await state.updateSetEntry({ ...entry, ...row });
  toast('Set updated.');
}

async function handleParsed(parsed) {
  if (!parsed.ok) {
    const retry = await confirmSheet({
      title: 'Could not read that',
      message: `${parsed.error || 'Nothing usable in that phrase.'}${parsed.transcript ? ` Heard: “${parsed.transcript}”.` : ''}`,
      confirmLabel: 'Type it instead',
      cancelLabel: 'Close'
    });
    if (retry) await typeSet(parsed.transcript);
    return;
  }
  if (parsed.intent === 'amend-last') {
    const target = state.getState().sessionSets.find((x) => x.id === parsed.targetSetId);
    if (target) { await editSet(target, parsed.sets[0], parsed.transcript); return; }
  }
  const result = await editSetsSheet({
    title: 'Confirm sets',
    exerciseId: parsed.exercise.id,
    sets: parsed.sets,
    transcript: parsed.transcript,
    warnings: parsed.warnings
  });
  await commit(result);
}

async function typeSet(initial = '') {
  const text = await promptSheet({
    title: 'Type a set',
    label: 'Say it the way you would out loud — “bench press 60 kilos for 10” or “plank for 60 seconds”',
    value: initial,
    placeholder: 'bench press 60 kilos for 10',
    confirmLabel: 'Parse'
  });
  if (text === null || !text.trim()) return;
  await handleParsed(parseTranscript(text, state.parserContext()));
}

async function voiceLog() {
  if (listening) return;
  if (!voiceSupported()) {
    toast('Voice input is not available here — type it instead.');
    await typeSet();
    return;
  }
  listening = true;
  // Nothing may compete with speech recognition — the animated backdrop stops
  // for the duration, and resumes on either exit path below.
  backdrop.setVoiceActive(true);
  render(containerRef);
  try {
    const { transcript } = await listenOnce({});
    listening = false;
    backdrop.setVoiceActive(false);
    render(containerRef);
    await handleParsed(parseTranscript(transcript, state.parserContext()));
  } catch (error) {
    listening = false;
    backdrop.setVoiceActive(false);
    render(containerRef);
    const message = error instanceof VoiceInputError ? error.message : 'Voice input failed — type the set instead.';
    const fallback = await confirmSheet({
      title: 'Voice input',
      message,
      confirmLabel: 'Type it instead',
      cancelLabel: 'Close'
    });
    if (fallback) await typeSet();
  }
}

async function manualAdd() {
  const s = state.getState();
  const exerciseId = s.currentExerciseId || s.exercises[0]?.id;
  if (!exerciseId) { toast('Add an exercise first.'); return; }
  const last = s.lastSet;
  const prefill = last && last.exerciseId === exerciseId
    ? [{ weight: last.weight, unit: last.unit, reps: last.reps, holdSeconds: last.holdSeconds ?? null, side: last.side ?? null }]
    : [];
  const result = await editSetsSheet({ title: 'Add set', exerciseId, sets: prefill });
  await commit(result);
}

/** "Log this" from the body map: the normal confirm sheet for that exercise,
 *  prefilled from its last set. A session starts only once something is saved;
 *  in a plan session an unplanned exercise simply shows under Extra. */
export async function logExercise(exerciseId) {
  const last = state.setsForExerciseSync(exerciseId).filter((x) => !x.isWarmup).at(-1);
  const result = await editSetsSheet({
    title: 'Confirm sets',
    exerciseId,
    sets: last ? [{ weight: last.weight, unit: last.unit, reps: last.reps, holdSeconds: last.holdSeconds ?? null, side: last.side ?? null }] : []
  });
  if (!result) return false;
  if (!state.getState().session) await state.startSession();
  await commit(result);
  return true;
}

/* ---------- runs / cardio ---------- */

/** A run is a few fields, not a form: distance, unit, time. Pace is derived. */
function runSheet() {
  const titleId = 'confirm-sheet-title';
  return openSheet('confirm-sheet', (ctx) => {
    const distance = el('input', { type: 'number', id: 'run-distance', step: '0.01', min: '0', inputmode: 'decimal', 'data-autofocus': '' });
    const unit = el('select', { id: 'run-unit' }, el('option', { value: 'km' }, 'km'), el('option', { value: 'mi' }, 'mi'));
    const minutes = el('input', { type: 'number', id: 'run-minutes', step: '1', min: '0', inputmode: 'numeric', value: '0' });
    const seconds = el('input', { type: 'number', id: 'run-seconds', step: '1', min: '0', max: '59', inputmode: 'numeric', value: '0' });

    return el('form', {
      method: 'dialog',
      onsubmit: (event) => {
        event.preventDefault();
        const dist = Number(distance.value) || 0;
        const durationSec = (Number(minutes.value) || 0) * 60 + (Number(seconds.value) || 0);
        if (dist <= 0 || durationSec <= 0) { toast('A run needs a distance and a time.'); return; }
        ctx.close({ distance: Math.round(dist * 100) / 100, distanceUnit: unit.value, durationSec });
      }
    },
      el('h2', { id: titleId, text: 'Log a run' }),
      el('div', { class: 'field-row' },
        el('div', {}, el('label', { for: 'run-distance', text: 'Distance' }), distance),
        el('div', {}, el('label', { for: 'run-unit', text: 'Unit' }), unit),
        el('div', {}, el('label', { for: 'run-minutes', text: 'Minutes' }), minutes),
        el('div', {}, el('label', { for: 'run-seconds', text: 'Seconds' }), seconds)
      ),
      el('div', { class: 'sheet-actions' },
        el('button', { class: 'btn', type: 'button', onclick: () => ctx.close(null) }, 'Cancel'),
        el('button', { class: 'btn btn-primary', type: 'submit' }, 'Save run')
      )
    );
  }, { labelledBy: titleId });
}

async function addRun() {
  const input = await runSheet();
  if (!input) return;
  const run = await state.logRun(input);
  const p = pace(run.durationSec, run.distance);
  toast(`Run logged: ${run.distance} ${run.distanceUnit}${p ? ` at ${p} /${run.distanceUnit}` : ''}.`);
}

function runsCard() {
  const runs = state.runsOn(todayISO());
  if (!runs.length) return null;
  return el('div', { class: 'card stack' },
    el('h2', { text: "Today's runs" }),
    el('ul', { class: 'list' }, ...runs.map((run) => {
      const p = pace(run.durationSec, run.distance);
      return el('li', {},
        el('span', { class: 'grow mono', text: `${run.distance} ${run.distanceUnit} · ${formatDuration(run.durationSec)}${p ? ` · ${p} /${run.distanceUnit}` : ''}` }),
        el('button', {
          class: 'btn btn-sm btn-ghost', type: 'button', 'aria-label': `Delete run of ${run.distance} ${run.distanceUnit}`,
          onclick: async () => {
            const yes = await confirmSheet({ title: 'Delete run?', message: `${run.distance} ${run.distanceUnit}. This cannot be undone.`, confirmLabel: 'Delete', danger: true });
            if (yes) { await state.removeRun(run.id); toast('Run deleted.'); }
          }
        }, '✕')
      );
    }))
  );
}

/* ---------- render ---------- */

function setsGroupedByExercise(sets) {
  const groups = [];
  for (const entry of sets) {
    const last = groups.at(-1);
    if (last && last.exerciseId === entry.exerciseId) last.sets.push(entry);
    else groups.push({ exerciseId: entry.exerciseId, sets: [entry] });
  }
  return groups;
}

function idleCard(s) {
  const recent = [...s.allSets].sort((a, b) => String(b.dateISO).localeCompare(String(a.dateISO)))[0];
  return el('div', { class: 'card stack' },
    el('h2', { text: 'Ready when you are' }),
    el('p', { class: 'muted', text: 'Start a session, then log sets by voice or by hand. Everything stays on this device.' }),
    el('div', { class: 'row' },
      el('button', { class: 'btn btn-primary btn-lg grow', id: 'start-session', onclick: () => state.startSession() }, 'Start session'),
      s.plans.length ? el('button', { class: 'btn btn-lg grow', id: 'start-from-plan', type: 'button', onclick: startFromPlan }, 'Start from plan') : null
    ),
    el('button', {
      class: 'btn btn-block', id: 'start-earlier-session', type: 'button',
      onclick: async () => { const d = await pickDate('Log an earlier session', 'Which day was it?'); if (d) await state.startSession(d); }
    }, 'Log an earlier session'),
    el('button', { class: 'btn btn-block', id: 'log-run-idle', type: 'button', onclick: addRun }, '🏃 Log a run'),
    recent ? el('p', { class: 'small muted', text: `Last training day: ${recent.dateISO}` }) : null
  );
}

/* ---------- plan sessions ---------- */

function startFromPlan() {
  const titleId = 'confirm-sheet-title';
  return openSheet('confirm-sheet', (ctx) => el('div', {},
    el('h2', { id: titleId, text: 'Start from plan' }),
    el('ul', { class: 'list' }, ...state.getState().plans.map((plan) => el('li', {},
      el('button', {
        class: 'btn btn-block', type: 'button', 'aria-label': `Start ${plan.name}`,
        onclick: () => ctx.close(plan.id)
      }, plan.name)
    ))),
    el('div', { class: 'sheet-actions' }, el('button', { class: 'btn', type: 'button', 'data-autofocus': '', onclick: () => ctx.close(null) }, 'Cancel'))
  ), { labelledBy: titleId }).then((planId) => (planId ? state.startSession(null, planId) : null));
}

/** Tapping an item opens the normal confirm sheet, prefilled with its target. */
async function logPlanItem(item) {
  const result = await editSetsSheet({
    title: 'Confirm sets',
    exerciseId: item.exerciseId,
    sets: prefillFor(item, { holdMode: modeOf(item.exerciseId) === 'hold' })
  });
  await commit(result);
}

function planCard(s) {
  const plan = s.session.planId ? state.planById(s.session.planId) : null;
  if (!plan) return null;
  const progress = planProgress(plan, s.sessionSets, s.session.planMarks);
  const nameOf = (id) => state.exerciseById(id)?.name || 'Unknown exercise';
  return el('div', { class: 'card stack', id: 'plan-checklist' },
    el('h2', { text: plan.name }),
    el('ul', { class: 'list' }, ...progress.items.map((item) => el('li', { class: item.skipped ? 'muted' : '' },
      el('button', {
        class: 'btn btn-sm', type: 'button', 'aria-pressed': item.ticked ? 'true' : 'false',
        'aria-label': `${nameOf(item.exerciseId)} done`,
        onclick: () => state.setPlanMark(item.index, item.ticked ? 'open' : 'done')
      }, item.ticked ? '✓' : '○'),
      el('button', {
        class: 'set-edit grow', type: 'button',
        'aria-label': `Log ${nameOf(item.exerciseId)}: ${describeTarget(item)}, ${item.done} of ${item.target} sets done`,
        onclick: () => logPlanItem(item)
      },
        el('strong', { text: nameOf(item.exerciseId) }), ' ',
        el('span', { class: 'mono small', text: describeTarget(item) }),
        item.note ? el('span', { class: 'small muted', text: ` — ${item.note}` }) : null
      ),
      el('span', { class: 'mono plan-count', text: item.skipped ? 'Skipped' : `${item.done} / ${item.target}` }),
      el('button', {
        class: 'btn btn-sm btn-ghost', type: 'button', 'aria-pressed': item.skipped ? 'true' : 'false',
        'aria-label': `Skip ${nameOf(item.exerciseId)} this session`,
        onclick: () => state.setPlanMark(item.index, item.skipped ? null : 'skipped')
      }, 'Skip')
    ))),
    progress.extras.length ? el('div', { id: 'plan-extra' },
      el('h3', { text: 'Extra' }),
      el('p', { class: 'small', text: progress.extras.map(nameOf).join(', ') })
    ) : null
  );
}

/** After a plan session: offer to make the plan match what was done. A sheet,
 *  default No — the plan changes only if asked to. */
async function offerPlanUpdate(finished) {
  if (!finished?.planId || !state.planById(finished.planId)) return;
  const yes = await confirmSheet({
    title: 'Update plan to what I did?',
    message: 'The plan’s targets become this session’s set counts and top sets. Exercises you didn’t do keep their targets.',
    confirmLabel: 'Update plan',
    cancelLabel: 'No'
  });
  if (yes) { await state.updatePlanFromSession(finished.planId, finished.id); toast('Plan updated.'); }
}

/** A date, today or earlier — for a session logged after the fact. */
function pickDate(title, label, value = todayISO()) {
  const titleId = 'confirm-sheet-title';
  return openSheet('confirm-sheet', (ctx) => {
    const input = el('input', { type: 'date', id: 'session-date', value, max: todayISO(), required: true, 'data-autofocus': '' });
    return el('form', {
      method: 'dialog',
      onsubmit: (e) => {
        e.preventDefault();
        if (!input.value || input.value > todayISO()) { toast('Pick today or an earlier day.'); return; }
        ctx.close(input.value);
      }
    },
      el('h2', { id: titleId, text: title }),
      el('div', { class: 'field' }, el('label', { for: 'session-date', text: label }), input),
      el('div', { class: 'sheet-actions' },
        el('button', { class: 'btn', type: 'button', onclick: () => ctx.close(null) }, 'Cancel'),
        el('button', { class: 'btn btn-primary', type: 'submit' }, 'Use this date')
      )
    );
  }, { labelledBy: titleId });
}

function activeCard(s) {
  const elapsed = formatDuration((Date.now() - s.session.startTs) / 1000);
  const earlier = s.session.dateISO !== todayISO();
  return el('div', { class: 'card' },
    el('div', { class: 'row-between' },
      el('div', {},
        el('p', { class: 'small muted', id: 'session-date-line', text: earlier ? `Session on ${s.session.dateISO}` : `Started ${clockTime(s.session.startTs)}` }),
        el('button', {
          class: 'btn btn-sm btn-ghost', id: 'change-session-date', type: 'button',
          onclick: async () => {
            const d = await pickDate('Change the session date', 'Which day was this session?', s.session.dateISO);
            if (d) { await state.setSessionDate(d); toast(`Session moved to ${d}.`); }
          }
        }, 'Change date'),
        el('p', { class: 'timer mono', id: 'session-timer', text: elapsed })
      ),
      el('div', { class: 'stack' },
        el('p', { class: 'small mono', id: 'rest-timer', text: '' }),
        el('button', { class: 'btn btn-sm', type: 'button', onclick: () => { restEndsAt = null; toast('Rest timer cleared.'); } }, 'Clear rest')
      )
    ),
    el('div', { class: 'row', style: 'margin-top:12px' },
      el('button', {
        class: `btn btn-primary mic-btn ${listening ? 'is-listening' : ''}`,
        id: 'mic-button',
        type: 'button',
        'aria-pressed': listening ? 'true' : 'false',
        'aria-label': listening ? 'Listening — tap to stop' : 'Log a set by voice',
        onclick: voiceLog
      }, listening ? '● Listening…' : '🎤 Log by voice'),
      el('button', { class: 'btn btn-lg grow', type: 'button', onclick: manualAdd }, '+ Add set')
    ),
    el('button', { class: 'btn btn-block', id: 'log-run', type: 'button', style: 'margin-top:10px', onclick: addRun }, '🏃 Log a run'),
    el('p', { class: 'small muted', style: 'margin-top:10px' },
      voiceSupported()
        ? 'One tap, one phrase. Audio is never recorded or stored — only the text.'
        : 'Voice is unavailable in this browser, so the mic button opens quick text entry.')
  );
}

/** One exercise's sets — a heading, a nudge if there is one, and the list. */
function exerciseGroup(group, s) {
  const exercise = state.exerciseById(group.exerciseId);
  const nudge = suggestProgression(state.setsForExerciseSync(group.exerciseId), {
    unit: s.settings.unit,
    stepKg: s.settings.progressionStepKg,
    stepLb: s.settings.progressionStepLb
  });
  return el('div', {},
    el('div', { class: 'row-between' },
      el('h3', { class: 'truncate', text: exercise?.name || 'Unknown exercise' }),
      el('button', {
        class: 'btn btn-sm btn-ghost', type: 'button',
        onclick: () => { state.setCurrentExercise(group.exerciseId); manualAdd(); }
      }, '+ Set')
    ),
    el('ul', { class: 'list' }, ...group.sets.map((entry, i) => el('li', {},
      el('span', { class: 'set-index', text: String(i + 1) }),
      el('button', {
        class: 'set-edit grow mono', type: 'button',
        'aria-label': `Edit set ${i + 1} of ${exercise?.name || 'exercise'}: ${describeSet(entry)}`,
        onclick: () => editSet(entry)
      }, describeSet(entry)),
      entry.isWarmup ? el('span', { class: 'badge', text: 'Warm-up' }) : null,
      entry.isPR ? el('span', { class: 'badge badge-pr', text: 'PR' }) : null,
      el('button', {
        class: 'btn btn-sm btn-ghost',
        type: 'button',
        'aria-label': `Delete set ${i + 1} of ${exercise?.name || 'exercise'}`,
        onclick: async () => {
          const yes = await confirmSheet({
            title: 'Delete set?',
            message: `${exercise?.name || 'Set'} — ${describeSet(entry)}. This cannot be undone.`,
            confirmLabel: 'Delete',
            danger: true
          });
          if (yes) { await state.removeSet(entry.id); toast('Set deleted.'); }
        }
      }, '✕')
    ))),
    nudge ? el('p', { class: 'small' }, el('span', { class: 'badge badge-warn', text: 'Nudge' }), ` ${nudge.message}`) : null
  );
}

function setsCard(s) {
  const groups = setsGroupedByExercise(s.sessionSets);
  if (!groups.length) {
    return el('div', { class: 'card' },
      el('p', { class: 'empty', text: 'No sets yet. Say “bench press 60 kilos for 10”.' })
    );
  }

  const volume = totalVolume(s.sessionSets, s.settings.unit);

  // A mixed strength+yoga (etc.) session groups by category so it doesn't
  // become one long flat list. A single-category session stays flat, as before.
  const categoryOf = (group) => state.exerciseById(group.exerciseId)?.category || 'strength';
  const categories = [...new Set(groups.map(categoryOf))];

  const body = categories.length > 1
    ? categories.map((cat) => {
      const catGroups = groups.filter((g) => categoryOf(g) === cat);
      const expanded = state.isPanelExpanded('session', cat);
      return disclosure({
        id: `session-cat-${cat}`,
        summary: `${titleCase(cat)} (${catGroups.length})`,
        expanded,
        onToggle: async (next) => { await state.setPanelExpanded('session', cat, next); render(containerRef); },
        content: el('div', { class: 'stack' }, ...catGroups.map((g) => exerciseGroup(g, s)))
      });
    })
    : groups.map((g) => exerciseGroup(g, s));

  return el('div', { class: 'card stack' },
    el('div', { class: 'row-between' },
      el('h2', { text: 'This session' }),
      el('p', { class: 'small muted mono', text: formatVolumeLine(s.sessionSets.length, volume, s.settings.unit) })
    ),
    ...body
  );
}

/** After a session is finished — never during one — a quiet reminder to back
 *  up, at most weekly. One toast with an action; no dialog, no count of days. */
function maybeNudgeBackup() {
  const s = state.getState();
  const now = Date.now();
  if (!backupNudgeDue({ lastExportAt: s.settings.lastExportAt, nudgeShownAt: s.settings.backupNudgeShownAt, sessionCount: s.allSessions.length, now })) return;
  state.rememberSetting({ backupNudgeShownAt: now }).catch(() => {});
  setTimeout(() => toast('Worth saving a backup of your training.', 9000, { action: { label: 'Export now', onClick: doExport } }), 2700);
}

function finishCard() {
  return el('div', { class: 'card stack' },
    el('button', {
      class: 'btn btn-primary btn-lg btn-block', type: 'button',
      onclick: async () => {
        const s = state.getState();
        const yes = await confirmSheet({
          title: 'End session?',
          message: `${s.sessionSets.length} set${s.sessionSets.length === 1 ? '' : 's'} logged. The session is saved to your diary.`,
          confirmLabel: 'End session'
        });
        if (!yes) return;
        const finished = await state.endSession();
        restEndsAt = null; toast('Session saved.'); store.requestPersistence();
        await offerPlanUpdate(finished);
        maybeNudgeBackup();
      }
    }, 'End session'),
    el('button', {
      class: 'btn btn-danger btn-block', type: 'button',
      onclick: async () => {
        const yes = await confirmSheet({
          title: 'Discard session?',
          message: 'The session and every set in it are deleted. This cannot be undone.',
          confirmLabel: 'Discard',
          danger: true
        });
        if (yes) { await state.discardSession(); restEndsAt = null; toast('Session discarded.'); }
      }
    }, 'Discard session'),
    el('div', { class: 'field' },
      el('label', { for: 'session-notes', text: 'Session notes' }),
      el('textarea', {
        id: 'session-notes',
        placeholder: 'How did it feel?',
        onchange: (e) => state.setSessionNotes(e.target.value)
      }, state.getState().session?.notes || '')
    )
  );
}

/** "View" — opens the active skin's graphic full screen. Only offered on the
 *  animated skins; Light and Neon have no graphic to show. */
function viewGraphicButton() {
  const skin = document.documentElement.dataset.theme;
  if (!backdrop.isGlassSkin(skin)) return null;
  return el('div', { class: 'graphic-row' },
    el('button', {
      class: 'btn', id: 'view-graphic', type: 'button',
      'aria-label': `View ${graphicView.skinLabel(skin)} graphic full screen`,
      onclick: () => graphicView.open(skin)
    }, el('span', { 'aria-hidden': 'true', text: '⛶' }), 'View')
  );
}

export function render(container) {
  containerRef = container || containerRef;
  if (!containerRef) return;
  const s = state.getState();
  clear(containerRef);

  if (!s.session) {
    containerRef.append(el('h2', { class: 'visually-hidden', text: 'Today' }), idleCard(s));
    const runs = runsCard();
    if (runs) containerRef.append(runs);
    const view = viewGraphicButton();
    if (view) containerRef.append(view);
    return;
  }

  const runs = runsCard();
  containerRef.append(
    el('h2', { class: 'visually-hidden', text: 'Active session' }),
    activeCard(s),
    ...[planCard(s)].filter(Boolean),
    setsCard(s),
    ...(runs ? [runs] : []),
    finishCard()
  );
  const view = viewGraphicButton();
  if (view) containerRef.append(view);
}
