/* Measures the installed footprint: the app shell on disk plus a simulated
 * year of realistic training data written to a real IndexedDB implementation.
 *
 * Run: npm run footprint
 */

import 'fake-indexeddb/auto';
import { readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

import * as db from '../js/db.js';
import { SEED_EXERCISES } from '../js/exercises-seed.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', 'tests', 'scripts', 'docs', 'deploy', '.reports']);

const SESSIONS_PER_WEEK = 3;
const WEEKS = 52;
const SETS_PER_SESSION = 20;
const RUNS_PER_WEEK = 1;

function shellFiles(dir = ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const full = join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) shellFiles(full, out);
    else if (!/\.(md|json)$/.test(name) || name === 'manifest.webmanifest') {
      out.push({ path: relative(ROOT, full), bytes: info.size });
    }
  }
  return out;
}

function isoFor(weekIndex, dayOffset) {
  const start = new Date(2026, 0, 5);              // a Monday
  start.setDate(start.getDate() + weekIndex * 7 + dayOffset);
  return db.todayISO(start);
}

async function seedYearOfData() {
  const exercises = [];
  for (const seed of SEED_EXERCISES) exercises.push(await db.addExercise({ ...seed, isCustom: false }));

  let sets = 0;
  for (let week = 0; week < WEEKS; week += 1) {
    for (let s = 0; s < SESSIONS_PER_WEEK; s += 1) {
      const dateISO = isoFor(week, s * 2);
      const startTs = new Date(`${dateISO}T18:00:00`).getTime();
      const session = await db.startSession({ dateISO, startTs, notes: 'Felt strong, bar speed good on the top set.' });

      for (let i = 0; i < SETS_PER_SESSION; i += 1) {
        const exercise = exercises[(week + s + i) % exercises.length];
        await db.addSet({
          sessionId: session.id,
          exerciseId: exercise.id,
          dateISO,
          order: i,
          weight: 60 + ((week * 2.5) % 60),
          unit: 'kg',
          reps: 5 + (i % 6),
          rpe: 7 + (i % 3),
          isPR: i === 0 && week % 4 === 0
        });
        sets += 1;
      }
      await db.endSession(session.id, startTs + 75 * 60 * 1000);
    }

    for (let r = 0; r < RUNS_PER_WEEK; r += 1) {
      await db.addRun({ dateISO: isoFor(week, 6), distance: 8.2, distanceUnit: 'km', durationSec: 2640, notes: 'Easy pace.' });
    }
  }

  await db.saveSettings({ unit: 'kg', defaultRestSec: 90 });
  return { sets, exercises: exercises.length };
}

function mb(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 1000) / 1000;
}

const shell = shellFiles();
const shellBytes = shell.reduce((sum, f) => sum + f.bytes, 0);

const seeded = await seedYearOfData();
const backup = await db.exportAll();
const dataBytes = Buffer.byteLength(JSON.stringify(backup), 'utf8');

/* IndexedDB stores structured clones with per-record and index overhead. Chrome's
 * LevelDB backing typically lands within ~2× the serialised size for records this
 * small; 3× is used here so the number reported is a pessimistic ceiling. */
const IDB_OVERHEAD = 3;
const estimatedStore = dataBytes * IDB_OVERHEAD;
const total = shellBytes + estimatedStore;

const report = {
  measuredAt: new Date().toISOString(),
  shell: {
    files: shell.length,
    bytes: shellBytes,
    mb: mb(shellBytes),
    largest: [...shell].sort((a, b) => b.bytes - a.bytes).slice(0, 5)
  },
  yearOfData: {
    sessions: backup.sessions.length,
    sets: backup.sets.length,
    runs: backup.runs.length,
    exercises: seeded.exercises,
    serialisedBytes: dataBytes,
    serialisedMB: mb(dataBytes),
    estimatedStoredMB: mb(estimatedStore),
    overheadFactorUsed: IDB_OVERHEAD
  },
  totalMB: mb(total),
  budgetMB: 50,
  withinBudget: mb(total) < 50
};

mkdirSync(join(ROOT, '.reports'), { recursive: true });
writeFileSync(join(ROOT, '.reports/footprint.json'), `${JSON.stringify(report, null, 2)}\n`);

console.log('RepTrack footprint');
console.log('------------------');
console.log(`App shell            ${report.shell.mb} MB across ${report.shell.files} files`);
console.log(`A year of data       ${report.yearOfData.sessions} sessions, ${report.yearOfData.sets} sets, ${report.yearOfData.runs} runs`);
console.log(`  serialised         ${report.yearOfData.serialisedMB} MB`);
console.log(`  stored (×${IDB_OVERHEAD} est.)   ${report.yearOfData.estimatedStoredMB} MB`);
console.log(`TOTAL                ${report.totalMB} MB  (budget ${report.budgetMB} MB) — ${report.withinBudget ? 'PASS' : 'FAIL'}`);

process.exit(report.withinBudget ? 0 : 1);
