import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWeeklySummary, weekRange, weekLabel, summaryFilename, pace, groupDigits } from '../js/summary.js';

const exercises = [
  { id: 'ex1', name: 'Bench Press' },
  { id: 'ex2', name: 'Back Squat' }
];

const sessions = [
  { id: 's1', dateISO: '2026-08-03', durationSec: 3600 },
  { id: 's2', dateISO: '2026-08-06', durationSec: 2700 },
  { id: 's0', dateISO: '2026-07-30', durationSec: 9999 }   // previous week — must be excluded
];

const sets = [
  ...Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, sessionId: 's1', exerciseId: 'ex1', dateISO: '2026-08-03', order: i, weight: 60, unit: 'kg', reps: 10, isPR: i === 0 })),
  ...Array.from({ length: 3 }, (_, i) => ({ id: `q${i}`, sessionId: 's2', exerciseId: 'ex2', dateISO: '2026-08-06', order: i, weight: 100, unit: 'kg', reps: 5, isPR: false })),
  { id: 'old', sessionId: 's0', exerciseId: 'ex1', dateISO: '2026-07-30', order: 0, weight: 999, unit: 'kg', reps: 9, isPR: true }
];

const runs = [
  { id: 'r1', dateISO: '2026-08-04', distance: 5, distanceUnit: 'km', durationSec: 1500 },
  { id: 'r2', dateISO: '2026-08-08', distance: 10, distanceUnit: 'km', durationSec: 3300 },
  { id: 'r0', dateISO: '2026-07-31', distance: 42, distanceUnit: 'km', durationSec: 12_000 }
];

const summary = () => buildWeeklySummary({ sessions, sets, runs, exercises, weekStartISO: '2026-08-03', unit: 'kg' });

test('the week is Monday-first and covers seven days', () => {
  assert.deepEqual(weekRange('2026-08-06'), { startISO: '2026-08-03', endISO: '2026-08-09' });
  assert.deepEqual(weekRange('2026-08-03'), { startISO: '2026-08-03', endISO: '2026-08-09' });
  assert.deepEqual(weekRange('2026-08-09'), { startISO: '2026-08-03', endISO: '2026-08-09' });   // Sunday belongs to the week just gone
  assert.equal(weekLabel('2026-08-03', '2026-08-09'), '3 Aug – 9 Aug 2026');
});

test('the summary is plain text with a dated header', () => {
  const text = summary();
  assert.equal(typeof text, 'string');
  assert.ok(!text.includes('<'), 'must be plain text, not markup');
  assert.match(text, /^RepTrack — weekly summary\n3 Aug – 9 Aug 2026\n/);
});

test('headline counts cover sessions, sets, volume and runs', () => {
  const text = summary();
  assert.match(text, /SESSIONS {3}2 · 1:45:00 training time/);
  assert.match(text, /SETS {7}6 across 2 exercises/);
  assert.match(text, /VOLUME {5}3,300 kg/);                       // 3×60×10 + 3×100×5
  assert.match(text, /RUNS {7}2 · 15 km in 1:20:00 \(5:20 \/km\)/);
});

test('lifts are broken down per exercise, heaviest volume first', () => {
  const text = summary();
  const lifts = text.split('LIFTS\n')[1].split('\n\n')[0].split('\n');
  assert.equal(lifts.length, 2);
  assert.match(lifts[0], /Bench Press\s+3 sets · top 60 kg × 10 · 1,800 kg/);
  assert.match(lifts[1], /Back Squat\s+3 sets · top 100 kg × 5 · 1,500 kg/);
});

test('personal records set that week are called out with their date', () => {
  const text = summary();
  assert.match(text, /PERSONAL RECORDS \(1\)/);
  assert.match(text, /Bench Press\s+60 kg × 10\s+\(Mon 3 Aug\)/);
});

test('a week without records says so kindly rather than omitting the section', () => {
  const text = buildWeeklySummary({
    sessions: [sessions[1]],
    sets: sets.filter((s) => s.sessionId === 's2'),
    runs: [],
    exercises,
    weekStartISO: '2026-08-03'
  });
  assert.match(text, /PERSONAL RECORDS\n {2}None this week — consistency still counts\./);
  assert.match(text, /RUNS {7}none/);
});

test('a day-by-day breakdown covers all seven days, resting days included', () => {
  const text = summary();
  const block = text.split('DAY BY DAY\n')[1].split('\n\n')[0].split('\n');
  assert.equal(block.length, 7);
  assert.match(block[0], /Mon 3 Aug\s+3 sets/);
  assert.match(block[1], /Tue 4 Aug\s+run 5 km/);
  assert.match(block[2], /Wed 5 Aug\s+rest/);
  assert.match(block[3], /Thu 6 Aug\s+3 sets/);
  assert.match(block[5], /Sat 8 Aug\s+run 10 km/);
});

test('anything outside the week is excluded', () => {
  const text = summary();
  assert.ok(!text.includes('999'), 'a previous-week PR must not appear');
  assert.ok(!text.includes('42 km'), 'a previous-week run must not appear');
});

test('an empty week produces a short honest note, not a broken report', () => {
  const text = buildWeeklySummary({ sessions: [], sets: [], runs: [], exercises, weekStartISO: '2026-08-03' });
  assert.match(text, /No sessions or runs logged this week\./);
  assert.ok(!text.includes('LIFTS'));
});

test('the summary states it was generated on-device', () => {
  assert.match(summary(), /Generated on-device by RepTrack\. Nothing left your phone\.$/);
});

test('pounds users get pounds throughout', () => {
  const text = buildWeeklySummary({
    sessions: [sessions[1]],
    sets: sets.filter((s) => s.sessionId === 's2'),
    runs: [],
    exercises,
    weekStartISO: '2026-08-03',
    unit: 'lb'
  });
  assert.match(text, /VOLUME {5}3,307 lb/);      // 1500 kg → 3307 lb
  assert.match(text, /top 220\.46 lb × 5/);
});

test('mixed run units are reported separately rather than silently added up', () => {
  const text = buildWeeklySummary({
    sessions: [],
    sets: [],
    runs: [
      { dateISO: '2026-08-04', distance: 5, distanceUnit: 'km', durationSec: 1500 },
      { dateISO: '2026-08-05', distance: 3, distanceUnit: 'mi', durationSec: 1440 }
    ],
    exercises,
    weekStartISO: '2026-08-03'
  });
  assert.match(text, /5 km in 25:00 \(5:00 \/km\)/);
  assert.match(text, /3 mi in 24:00 \(8:00 \/mi\)/);
});

test('pace and digit grouping behave at the edges', () => {
  assert.equal(pace(1500, 5), '5:00');
  assert.equal(pace(1505, 5), '5:01');
  assert.equal(pace(1500, 0), null);
  assert.equal(pace(0, 5), null);
  assert.equal(groupDigits(0), '0');
  assert.equal(groupDigits(999), '999');
  assert.equal(groupDigits(1000), '1,000');
  assert.equal(groupDigits(1234567.6), '1,234,568');
});

test('the filename is stable and week-stamped', () => {
  assert.equal(summaryFilename('2026-08-03'), 'reptrack-week-2026-08-03.txt');
});
