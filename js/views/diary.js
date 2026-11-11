/* Diary — calendar navigable by year, month, week and day, plus the one-tap
 * weekly plain-text summary.
 */

import * as state from '../state.js';
import { editSet } from './today.js';
import { el, clear, toast, confirmSheet, promptSheet, shareOrDownloadText, MONTHS, DOW, monthLabel, longDate, humanDate, parseISO, clockTime } from '../ui.js';
import { describeSet } from '../parser.js';
import { formatDuration, totalVolume, formatVolumeLine } from '../progression.js';
import { weekRange, weekLabel, pace } from '../summary.js';
import { todayISO } from '../store.js';

const today = new Date();
const view = {
  scope: 'month',                 // 'year' | 'month' | 'week' | 'day'
  year: today.getFullYear(),
  month: today.getMonth(),        // 0-indexed
  dateISO: todayISO(today)
};

let containerRef = null;

function iso(y, m, d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

function shiftDays(dateISO, delta) {
  const d = parseISO(dateISO);
  d.setDate(d.getDate() + delta);
  return todayISO(d);
}

function sessionsOn(dateISO) {
  return state.getState().allSessions.filter((s) => s.dateISO === dateISO);
}

function trainedDates() {
  const s = state.getState();
  return new Set([...s.allSessions.map((x) => x.dateISO), ...s.runs.map((r) => r.dateISO)]);
}

function setsOf(sessionId) {
  return state.getState().allSets
    .filter((s) => s.sessionId === sessionId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function scopeSwitcher(rerender) {
  const mk = (key, label) => el('button', {
    class: `btn btn-sm ${view.scope === key ? 'btn-primary' : ''}`,
    type: 'button',
    'aria-pressed': view.scope === key ? 'true' : 'false',
    onclick: () => { view.scope = key; rerender(); }
  }, label);
  return el('div', { class: 'row', role: 'group', 'aria-label': 'Calendar scope' },
    mk('year', 'Year'), mk('month', 'Month'), mk('week', 'Week'), mk('day', 'Day'));
}

function pager(label, onPrev, onNext, prevLabel, nextLabel) {
  return el('div', { class: 'cal-head' },
    el('button', { class: 'btn btn-sm', type: 'button', 'aria-label': prevLabel, onclick: onPrev }, '‹'),
    el('h2', { style: 'margin:0', text: label }),
    el('button', { class: 'btn btn-sm', type: 'button', 'aria-label': nextLabel, onclick: onNext }, '›')
  );
}

/* ---------- weekly summary ---------- */

function summaryCard() {
  const { startISO, endISO } = weekRange(view.dateISO);
  return el('div', { class: 'card stack' },
    el('h3', { style: 'margin:0', text: 'Weekly summary' }),
    el('p', { class: 'small muted', style: 'margin:0', text: `Sessions, lifts, PRs, volume and runs for ${weekLabel(startISO, endISO)} as a plain-text file. Built on this device — it never goes near a network.` }),
    el('button', {
      class: 'btn btn-primary btn-block', type: 'button', id: 'weekly-summary',
      onclick: async () => {
        const summary = state.weeklySummary(view.dateISO);
        const outcome = await shareOrDownloadText(summary.text, summary.filename, 'RepTrack weekly summary');
        if (outcome === 'shared') toast('Summary shared.');
        else if (outcome === 'downloaded') toast(`Saved ${summary.filename}.`);
      }
    }, 'Share or save this week (.txt)')
  );
}

/* ---------- scopes ---------- */

function yearView(rerender) {
  const counts = new Map();
  for (const s of state.getState().allSessions) {
    const [y, m] = s.dateISO.split('-').map(Number);
    if (y !== view.year) continue;
    counts.set(m - 1, (counts.get(m - 1) || 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);

  return el('div', { class: 'card' },
    pager(String(view.year), () => { view.year -= 1; rerender(); }, () => { view.year += 1; rerender(); }, 'Previous year', 'Next year'),
    el('p', { class: 'small muted', text: `${total} session${total === 1 ? '' : 's'} in ${view.year}` }),
    el('div', { class: 'cal-grid', style: 'grid-template-columns:repeat(3,1fr)' },
      ...MONTHS.map((name, index) => el('button', {
        class: `cal-day ${counts.get(index) ? 'has-session' : ''}`,
        type: 'button',
        style: 'aspect-ratio:auto;min-height:64px;flex-direction:column;justify-content:center;padding:8px',
        'aria-label': `${name} ${view.year}, ${counts.get(index) || 0} sessions`,
        onclick: () => { view.month = index; view.scope = 'month'; rerender(); }
      },
        el('span', { text: name.slice(0, 3) }),
        el('span', { class: 'mono small', text: String(counts.get(index) || 0) })
      ))
    )
  );
}

function monthView(rerender) {
  const first = new Date(view.year, view.month, 1);
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;   // Monday-first
  const dates = trainedDates();
  const todayIso = todayISO(new Date());

  // Frost is a Forge-skin easter egg, and it lives on calendar day cells only —
  // never on the logging UI, never on the charts. js/consistency.js decides
  // whether any of it is earned; most of the time this Set is empty. It is
  // purely decorative, so it carries no aria-label text: the calendar must not
  // announce a lapse.
  const frosted = document.documentElement.getAttribute('data-theme') === 'forge'
    ? state.frostedCalendarDates()
    : new Set();

  const grid = el('div', { class: 'cal-grid' });
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
    grid.append(el('div', { class: 'cal-dow', 'aria-hidden': 'true', text: d }));
  }
  for (let i = 0; i < lead; i += 1) grid.append(el('div', { class: 'cal-day is-blank', 'aria-hidden': 'true' }));

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateISO = iso(view.year, view.month, day);
    const has = dates.has(dateISO);
    grid.append(el('button', {
      class: `cal-day ${has ? 'has-session' : ''} ${dateISO === todayIso ? 'is-today' : ''} ${frosted.has(dateISO) ? 'is-frosted' : ''}`,
      type: 'button',
      'aria-pressed': dateISO === view.dateISO ? 'true' : 'false',
      'aria-label': `${humanDate(dateISO)}${has ? ', has a session' : ', no session'}`,
      onclick: () => { view.dateISO = dateISO; view.scope = 'day'; rerender(); }
    }, String(day), has ? el('span', { class: 'cal-dot', 'aria-hidden': 'true' }) : null));
  }

  return el('div', { class: 'card' },
    pager(monthLabel(view.year, view.month),
      () => { if (view.month === 0) { view.month = 11; view.year -= 1; } else view.month -= 1; rerender(); },
      () => { if (view.month === 11) { view.month = 0; view.year += 1; } else view.month += 1; rerender(); },
      'Previous month', 'Next month'),
    grid
  );
}

function weekView(rerender) {
  const { startISO, endISO } = weekRange(view.dateISO);
  const days = Array.from({ length: 7 }, (_, i) => shiftDays(startISO, i));

  return el('div', { class: 'card' },
    pager(`${longDate(startISO)} – ${longDate(endISO)}`,
      () => { view.dateISO = shiftDays(view.dateISO, -7); rerender(); },
      () => { view.dateISO = shiftDays(view.dateISO, 7); rerender(); },
      'Previous week', 'Next week'),
    el('ul', { class: 'list' }, ...days.map((dateISO) => {
      const sessions = sessionsOn(dateISO);
      const sets = sessions.flatMap((s) => setsOf(s.id));
      const runs = state.runsOn(dateISO);
      const bits = [];
      if (sets.length) bits.push(`${sets.length} sets`);
      for (const run of runs) bits.push(`${run.distance} ${run.distanceUnit}`);
      return el('li', {},
        el('button', {
          class: 'btn btn-sm btn-ghost grow', type: 'button', style: 'justify-content:flex-start',
          onclick: () => { view.dateISO = dateISO; view.scope = 'day'; rerender(); }
        },
          el('span', { class: 'grow truncate', text: `${DOW[parseISO(dateISO).getDay()]} ${dateISO.slice(8)} ${MONTHS[parseISO(dateISO).getMonth()].slice(0, 3)}` }),
          el('span', { class: 'small muted mono', text: bits.length ? bits.join(' · ') : '—' })
        )
      );
    }))
  );
}

function runList(dateISO, rerender) {
  const runs = state.runsOn(dateISO);
  if (!runs.length) return null;
  return el('div', { class: 'card stack' },
    el('h3', { style: 'margin:0', text: 'Runs' }),
    el('ul', { class: 'list' }, ...runs.map((run) => {
      const p = pace(run.durationSec, run.distance);
      return el('li', {},
        el('span', { class: 'grow mono', text: `${run.distance} ${run.distanceUnit} · ${formatDuration(run.durationSec)}${p ? ` · ${p} /${run.distanceUnit}` : ''}` }),
        el('button', {
          class: 'btn btn-sm btn-ghost', type: 'button', 'aria-label': `Delete run of ${run.distance} ${run.distanceUnit}`,
          onclick: async () => {
            const yes = await confirmSheet({ title: 'Delete run?', message: `${run.distance} ${run.distanceUnit} on ${longDate(run.dateISO)}. This cannot be undone.`, confirmLabel: 'Delete', danger: true });
            if (!yes) return;
            await state.removeRun(run.id);
            toast('Run deleted.');
            rerender();
          }
        }, '✕')
      );
    }))
  );
}

function dayView(rerender) {
  const sessions = sessionsOn(view.dateISO);
  const s = state.getState();
  const runs = runList(view.dateISO, rerender);

  const sessionCards = sessions.map((session) => {
    const sets = setsOf(session.id);
    const groups = [];
    for (const entry of sets) {
      const last = groups.at(-1);
      if (last && last.exerciseId === entry.exerciseId) last.sets.push(entry);
      else groups.push({ exerciseId: entry.exerciseId, sets: [entry] });
    }
    return el('div', { class: 'card stack' },
      el('div', { class: 'row-between' },
        el('h3', { style: 'margin:0', text: session.endTs ? `Session · ${formatDuration(session.durationSec)}` : 'Session in progress' }),
        el('p', { class: 'small muted mono', text: `${clockTime(session.startTs)}${session.endTs ? `–${clockTime(session.endTs)}` : ''}` })
      ),
      el('p', { class: 'small muted mono', text: formatVolumeLine(sets.length, totalVolume(sets, s.settings.unit), s.settings.unit) }),
      ...groups.map((group) => el('div', {},
        el('h4', { style: 'margin:8px 0 4px', text: state.exerciseById(group.exerciseId)?.name || 'Unknown exercise' }),
        el('ul', { class: 'list' }, ...group.sets.map((entry, i) => el('li', {},
          el('span', { class: 'set-index', text: String(i + 1) }),
          el('button', {
            class: 'set-edit grow mono', type: 'button',
            'aria-label': `Edit set ${i + 1} of ${state.exerciseById(entry.exerciseId)?.name || 'exercise'}: ${describeSet(entry)}`,
            onclick: () => editSet(entry)
          }, describeSet(entry)),
          entry.isWarmup ? el('span', { class: 'badge', text: 'Warm-up' }) : null,
          entry.isPR ? el('span', { class: 'badge badge-pr', text: 'PR' }) : null
        )))
      )),
      session.notes ? el('p', { class: 'small', text: session.notes }) : null,
      session.endTs && sets.length ? el('button', {
        class: 'btn btn-sm', type: 'button', 'aria-label': `Save the session on ${longDate(session.dateISO)} as a plan`,
        onclick: async () => {
          const name = await promptSheet({ title: 'Save as plan', label: 'Plan name', value: `Plan from ${session.dateISO}`, confirmLabel: 'Save plan' });
          if (!name) return;
          await state.planFromSession(session.id, name);
          toast(`Saved ${name}. Find it under Exercises → Plans.`);
        }
      }, 'Save as plan') : null,
      el('button', {
        class: 'btn btn-sm btn-danger', type: 'button',
        onclick: async () => {
          const yes = await confirmSheet({
            title: 'Delete session?',
            message: `${longDate(session.dateISO)} — ${sets.length} sets. This cannot be undone.`,
            confirmLabel: 'Delete',
            danger: true
          });
          if (!yes) return;
          await state.deleteSessionById(session.id);
          toast('Session deleted.');
          rerender();
        }
      }, 'Delete session')
    );
  });

  const body = sessionCards.length || runs
    ? [...sessionCards, runs].filter(Boolean)
    : [el('p', { class: 'empty', text: 'Nothing logged on this day.' })];

  return el('div', {},
    el('div', { class: 'card' },
      pager(longDate(view.dateISO),
        () => { view.dateISO = shiftDays(view.dateISO, -1); rerender(); },
        () => { view.dateISO = shiftDays(view.dateISO, 1); rerender(); },
        'Previous day', 'Next day'),
      el('p', { class: 'small muted', text: humanDate(view.dateISO) })
    ),
    ...body
  );
}

export function render(container) {
  containerRef = container || containerRef;
  if (!containerRef) return;
  const rerender = () => render(containerRef);

  clear(containerRef);
  containerRef.append(
    el('h2', { class: 'visually-hidden', text: 'Diary' }),
    el('div', { class: 'card' }, scopeSwitcher(rerender))
  );

  if (view.scope === 'year') containerRef.append(yearView(rerender));
  else if (view.scope === 'month') containerRef.append(monthView(rerender));
  else if (view.scope === 'week') containerRef.append(weekView(rerender));
  else containerRef.append(dayView(rerender));

  containerRef.append(summaryCard());
}
