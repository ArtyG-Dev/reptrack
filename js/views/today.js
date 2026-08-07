/* Today / Active Session — the screen you actually use in the gym. */

import * as state from '../state.js';
import { el, clear, toast, openSheet, promptSheet, confirmSheet, clockTime } from '../ui.js';
import { parseTranscript, describeSet, formatNumber } from '../parser.js';
import { listenOnce, isSupported as voiceSupported, VoiceInputError } from '../voice.js';
import { formatDuration, suggestProgression, totalVolume } from '../progression.js';
import { pace } from '../summary.js';
import { todayISO } from '../store.js';

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
        if (left === 0) restEndsAt = null;
      } else {
        restNode.textContent = '';
      }
    }
  }, 1000);
}

/* ---------- set editor sheet ---------- */

/**
 * Confirm/edit step. Every voice log and every manual add goes through this —
 * nothing is ever written to storage without the user seeing it first.
 * @returns {Promise<{exerciseId: string, sets: Array}|null>}
 */
function editSetsSheet({ title, exerciseId, sets, transcript = '', warnings = [] }) {
  const s = state.getState();
  const titleId = 'confirm-sheet-title';

  return openSheet('confirm-sheet', (ctx) => {
    const rows = sets.length ? sets.map((x) => ({ ...x })) : [{ weight: '', unit: s.settings.unit, reps: '', rpe: null }];

    const exerciseSelect = el('select', { id: 'sheet-exercise', 'aria-label': 'Exercise' },
      ...s.exercises.map((ex) => el('option', { value: ex.id, selected: ex.id === exerciseId }, ex.name))
    );

    const rowsWrap = el('div', { class: 'stack' });

    const renderRows = () => {
      clear(rowsWrap);
      rows.forEach((row, index) => {
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
        const unitSelect = el('select', { id: `row-unit-${index}`, 'aria-label': `Unit for set ${index + 1}`, onchange: (e) => { row.unit = e.target.value; } },
          el('option', { value: 'kg', selected: row.unit !== 'lb' }, 'kg'),
          el('option', { value: 'lb', selected: row.unit === 'lb' }, 'lb')
        );

        rowsWrap.append(el('div', { class: 'field-row' },
          el('div', {}, el('label', { for: `row-weight-${index}`, text: `Set ${index + 1} weight` }), weightInput),
          el('div', {}, el('label', { for: `row-unit-${index}`, text: 'Unit' }), unitSelect),
          el('div', {}, el('label', { for: `row-reps-${index}`, text: 'Reps' }), repsInput),
          el('div', { class: 'row', style: 'align-items:flex-end' },
            el('button', {
              class: 'btn btn-sm btn-ghost', type: 'button',
              'aria-label': `Remove set ${index + 1}`,
              onclick: () => { rows.splice(index, 1); if (!rows.length) rows.push({ weight: '', unit: s.settings.unit, reps: '' }); renderRows(); }
            }, 'Remove')
          )
        ));
      });
    };
    renderRows();

    const submit = () => {
      const cleaned = rows
        .map((r) => ({ weight: Number(r.weight) || 0, unit: r.unit || s.settings.unit, reps: Math.round(Number(r.reps) || 0), rpe: r.rpe ?? null }))
        .filter((r) => r.reps > 0);
      if (!cleaned.length) { toast('Add at least one set with reps.'); return; }
      ctx.close({ exerciseId: exerciseSelect.value, sets: cleaned });
    };

    return el('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); submit(); } },
      el('h2', { id: titleId, text: title }),
      transcript ? el('p', { class: 'transcript', text: `“${transcript}”` }) : null,
      ...warnings.map((w) => el('p', { class: 'small muted', text: w })),
      el('div', { class: 'field' }, el('label', { for: 'sheet-exercise', text: 'Exercise' }), exerciseSelect),
      rowsWrap,
      el('button', {
        class: 'btn btn-sm', type: 'button',
        onclick: () => { const last = rows.at(-1) || {}; rows.push({ weight: last.weight ?? '', unit: last.unit || s.settings.unit, reps: last.reps ?? '' }); renderRows(); }
      }, '+ Another set'),
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
  restEndsAt = Date.now() + (state.getState().settings.defaultRestSec || 90) * 1000;
  toast(prs ? `Logged ${created.length} set${created.length > 1 ? 's' : ''} — ${prs} personal record!` : `Logged ${created.length} set${created.length > 1 ? 's' : ''}.`);
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
    label: 'Say it the way you would out loud — “bench press 60 kilos for 10”',
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
  render(containerRef);
  try {
    const { transcript } = await listenOnce({});
    listening = false;
    render(containerRef);
    await handleParsed(parseTranscript(transcript, state.parserContext()));
  } catch (error) {
    listening = false;
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
  const result = await editSetsSheet({
    title: 'Add set',
    exerciseId,
    sets: last && last.exerciseId === exerciseId ? [{ weight: last.weight, unit: last.unit, reps: last.reps }] : []
  });
  await commit(result);
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
    el('button', { class: 'btn btn-primary btn-lg btn-block', id: 'start-session', onclick: () => state.startSession() }, 'Start session'),
    el('button', { class: 'btn btn-block', id: 'log-run-idle', type: 'button', onclick: addRun }, '🏃 Log a run'),
    recent ? el('p', { class: 'small muted', text: `Last training day: ${recent.dateISO}` }) : null
  );
}

function activeCard(s) {
  const elapsed = formatDuration((Date.now() - s.session.startTs) / 1000);
  return el('div', { class: 'card' },
    el('div', { class: 'row-between' },
      el('div', {},
        el('p', { class: 'small muted', text: `Started ${clockTime(s.session.startTs)}` }),
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

function setsCard(s) {
  const groups = setsGroupedByExercise(s.sessionSets);
  if (!groups.length) {
    return el('div', { class: 'card' },
      el('p', { class: 'empty', text: 'No sets yet. Say “bench press 60 kilos for 10”.' })
    );
  }

  const volume = totalVolume(s.sessionSets, s.settings.unit);
  return el('div', { class: 'card stack' },
    el('div', { class: 'row-between' },
      el('h2', { text: 'This session' }),
      el('p', { class: 'small muted mono', text: `${s.sessionSets.length} sets · ${Math.round(volume)} ${s.settings.unit} volume` })
    ),
    ...groups.map((group) => {
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
          el('span', { class: 'grow mono', text: describeSet(entry) }),
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
    })
  );
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
        if (yes) { await state.endSession(); restEndsAt = null; toast('Session saved.'); }
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

export function render(container) {
  containerRef = container || containerRef;
  if (!containerRef) return;
  const s = state.getState();
  clear(containerRef);

  if (!s.session) {
    containerRef.append(el('h2', { class: 'visually-hidden', text: 'Today' }), idleCard(s));
    const runs = runsCard();
    if (runs) containerRef.append(runs);
    return;
  }

  const runs = runsCard();
  containerRef.append(
    el('h2', { class: 'visually-hidden', text: 'Active session' }),
    activeCard(s),
    setsCard(s),
    ...(runs ? [runs] : []),
    finishCard()
  );
}
