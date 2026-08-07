/* Weekly plain-text summary.
 *
 * One tap produces a human-readable .txt of the training week: sessions, lifts,
 * PRs, volume and runs. Pure functions — no DOM, no storage — so the text is
 * unit-tested exactly as the user will read it. Generated on-device, offline.
 */

import { toKg, fromKg, estimate1RM, formatDuration, formatWeight } from './progression.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseISO(dateISO) {
  const [y, m, d] = String(dateISO).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function toISO(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shiftDays(dateISO, delta) {
  const d = parseISO(dateISO);
  d.setDate(d.getDate() + delta);
  return toISO(d);
}

/** Monday-first week containing `dateISO`. */
export function weekRange(dateISO) {
  const d = parseISO(dateISO);
  const startISO = shiftDays(dateISO, -((d.getDay() + 6) % 7));
  return { startISO, endISO: shiftDays(startISO, 6) };
}

export function weekLabel(startISO, endISO) {
  const a = parseISO(startISO);
  const b = parseISO(endISO);
  const left = `${a.getDate()} ${MON[a.getMonth()]}`;
  const right = `${b.getDate()} ${MON[b.getMonth()]} ${b.getFullYear()}`;
  return `${left} – ${right}`;
}

function shortDate(dateISO) {
  const d = parseISO(dateISO);
  return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
}

/** 1234567 → "1,234,567" — done by hand so output never varies by locale. */
export function groupDigits(value) {
  const rounded = Math.round(Number(value) || 0);
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Seconds per distance unit as m:ss. */
export function pace(durationSec, distance) {
  const d = Number(distance) || 0;
  if (d <= 0 || !durationSec) return null;
  const secondsPerUnit = Math.round(durationSec / d);
  const m = Math.floor(secondsPerUnit / 60);
  const s = secondsPerUnit % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function pad(text, width) {
  return String(text).length >= width ? String(text) : String(text) + ' '.repeat(width - String(text).length);
}

export function summaryFilename(startISO) {
  return `reptrack-week-${startISO}.txt`;
}

/**
 * @param {object} input
 * @param {Array} input.sessions   every session (filtered here)
 * @param {Array} input.sets       every set
 * @param {Array} input.runs       every run
 * @param {Array} input.exercises  exercise dictionary
 * @param {string} input.weekStartISO  Monday of the week to report
 * @param {string} [input.unit]    display unit, 'kg' | 'lb'
 * @returns {string} plain text, ready to save or share
 */
export function buildWeeklySummary({ sessions = [], sets = [], runs = [], exercises = [], weekStartISO, unit = 'kg' }) {
  const startISO = weekStartISO;
  const endISO = shiftDays(startISO, 6);
  const inWeek = (dateISO) => String(dateISO) >= startISO && String(dateISO) <= endISO;

  const weekSessions = sessions.filter((s) => inWeek(s.dateISO));
  const weekSets = sets.filter((s) => inWeek(s.dateISO));
  const weekRuns = runs.filter((r) => inWeek(r.dateISO));
  const nameOf = (id) => exercises.find((e) => e.id === id)?.name || 'Unknown exercise';

  const lines = [];
  lines.push('RepTrack — weekly summary');
  lines.push(weekLabel(startISO, endISO));
  lines.push('');

  if (!weekSessions.length && !weekRuns.length) {
    lines.push('No sessions or runs logged this week.');
    lines.push('');
    lines.push('Generated on-device by RepTrack. Nothing left your phone.');
    return lines.join('\n');
  }

  /* --- headline numbers --- */
  const totalSec = weekSessions.reduce((sum, s) => sum + (Number(s.durationSec) || 0), 0);
  const volumeKg = weekSets.reduce((sum, s) => sum + toKg(s.weight, s.unit) * (Number(s.reps) || 0), 0);
  const volume = fromKg(volumeKg, unit);

  lines.push(`SESSIONS   ${weekSessions.length}${totalSec ? ` · ${formatDuration(totalSec)} training time` : ''}`);
  lines.push(`SETS       ${weekSets.length}${weekSets.length ? ` across ${new Set(weekSets.map((s) => s.exerciseId)).size} exercises` : ''}`);
  lines.push(`VOLUME     ${groupDigits(volume)} ${unit}`);

  if (weekRuns.length) {
    const byUnit = new Map();
    for (const run of weekRuns) {
      const key = run.distanceUnit || 'km';
      const acc = byUnit.get(key) || { distance: 0, durationSec: 0, count: 0 };
      acc.distance += Number(run.distance) || 0;
      acc.durationSec += Number(run.durationSec) || 0;
      acc.count += 1;
      byUnit.set(key, acc);
    }
    const parts = [...byUnit.entries()].map(([key, acc]) => {
      const p = pace(acc.durationSec, acc.distance);
      return `${Math.round(acc.distance * 100) / 100} ${key} in ${formatDuration(acc.durationSec)}${p ? ` (${p} /${key})` : ''}`;
    });
    lines.push(`RUNS       ${weekRuns.length} · ${parts.join(' · ')}`);
  } else {
    lines.push('RUNS       none');
  }

  /* --- per-exercise breakdown ---
   * A hold-mode set (holdSeconds set — yoga, pilates, a timed calisthenics
   * hold) tracks total/longest hold time instead of weight × reps volume;
   * everything else about the row is the same. */
  if (weekSets.length) {
    const byExercise = new Map();
    for (const set of weekSets) {
      const isHold = set.holdSeconds != null;
      const acc = byExercise.get(set.exerciseId) || { sets: 0, volumeKg: 0, topKg: 0, topReps: 0, best: 0, isHold, totalHoldSec: 0, longestHoldSec: 0 };
      acc.sets += 1;
      if (isHold) {
        acc.isHold = true;
        const holdSec = Number(set.holdSeconds) || 0;
        acc.totalHoldSec += holdSec;
        if (holdSec > acc.longestHoldSec) acc.longestHoldSec = holdSec;
      } else {
        acc.volumeKg += toKg(set.weight, set.unit) * (Number(set.reps) || 0);
        const kg = toKg(set.weight, set.unit);
        const score = estimate1RM(set.weight, set.reps, set.unit);
        if (score > acc.best) { acc.best = score; acc.topKg = kg; acc.topReps = Number(set.reps) || 0; }
      }
      byExercise.set(set.exerciseId, acc);
    }

    const rows = [...byExercise.entries()]
      .map(([id, acc]) => ({ name: nameOf(id), ...acc }))
      .sort((a, b) => (b.volumeKg + b.totalHoldSec) - (a.volumeKg + a.totalHoldSec));
    const width = Math.min(24, Math.max(...rows.map((r) => r.name.length)));

    lines.push('');
    lines.push('LIFTS');
    for (const row of rows) {
      if (row.isHold) {
        lines.push(`  ${pad(row.name, width)}  ${String(row.sets).padStart(2)} holds · longest ${formatDuration(row.longestHoldSec)} · total ${formatDuration(row.totalHoldSec)}`);
        continue;
      }
      const top = row.topKg > 0
        ? `top ${formatWeight(Math.round(fromKg(row.topKg, unit) * 100) / 100)} ${unit} × ${row.topReps}`
        : `top ${row.topReps} reps bodyweight`;
      lines.push(`  ${pad(row.name, width)}  ${String(row.sets).padStart(2)} sets · ${top} · ${groupDigits(fromKg(row.volumeKg, unit))} ${unit}`);
    }
  }

  /* --- PRs --- */
  const prs = weekSets.filter((s) => s.isPR);
  lines.push('');
  if (prs.length) {
    lines.push(`PERSONAL RECORDS (${prs.length})`);
    const width = Math.min(24, Math.max(...prs.map((s) => nameOf(s.exerciseId).length)));
    for (const set of prs) {
      let value;
      if (set.holdSeconds != null) {
        value = `${formatDuration(set.holdSeconds)} hold${set.side ? ` (${set.side})` : ''}`;
      } else if (Number(set.weight) > 0) {
        value = `${formatWeight(Math.round(fromKg(toKg(set.weight, set.unit), unit) * 100) / 100)} ${unit} × ${set.reps}`;
      } else {
        value = `bodyweight × ${set.reps}`;
      }
      lines.push(`  ${pad(nameOf(set.exerciseId), width)}  ${value}  (${shortDate(set.dateISO)})`);
    }
  } else {
    lines.push('PERSONAL RECORDS');
    lines.push('  None this week — consistency still counts.');
  }

  /* --- day by day --- */
  lines.push('');
  lines.push('DAY BY DAY');
  for (let i = 0; i < 7; i += 1) {
    const dateISO = shiftDays(startISO, i);
    const daySessions = weekSessions.filter((s) => s.dateISO === dateISO);
    const daySets = weekSets.filter((s) => s.dateISO === dateISO);
    const dayRuns = weekRuns.filter((r) => r.dateISO === dateISO);
    const bits = [];
    if (daySessions.length) bits.push(`${daySets.length} sets`);
    for (const run of dayRuns) {
      bits.push(`run ${Math.round((Number(run.distance) || 0) * 100) / 100} ${run.distanceUnit || 'km'}`);
    }
    lines.push(`  ${pad(shortDate(dateISO), 10)} ${bits.length ? bits.join(' · ') : 'rest'}`);
  }

  lines.push('');
  lines.push('Generated on-device by RepTrack. Nothing left your phone.');
  return lines.join('\n');
}
