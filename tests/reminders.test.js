import test from 'node:test';
import assert from 'node:assert/strict';
import { backupNudgeDue, BACKUP_NUDGE } from '../js/reminders.js';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 11);

test('never backed up: due only once there are at least 5 sessions worth keeping', () => {
  assert.equal(backupNudgeDue({ sessionCount: 4, now }), false);
  assert.equal(backupNudgeDue({ sessionCount: BACKUP_NUDGE.minSessionsIfNever, now }), true);
});

test('backed up: due after 30 days, not before', () => {
  assert.equal(backupNudgeDue({ lastExportAt: now - 29 * DAY, sessionCount: 50, now }), false);
  assert.equal(backupNudgeDue({ lastExportAt: now - 30 * DAY, sessionCount: 1, now }), true);
});

test('at most once every 7 days, whatever else is true', () => {
  const stale = { lastExportAt: now - 90 * DAY, sessionCount: 50, now };
  assert.equal(backupNudgeDue({ ...stale, nudgeShownAt: now - 6 * DAY }), false);
  assert.equal(backupNudgeDue({ ...stale, nudgeShownAt: now - 7 * DAY }), true);
});
