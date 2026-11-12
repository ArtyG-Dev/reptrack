/* When to remind someone to back up. Pure: the caller passes the clock.
 *
 * Only ever asked after a session is *finished* — never during one, never on
 * the logging screen. Due when the last export was 30+ days ago, or there has
 * never been one and there are at least 5 sessions worth keeping; and never
 * more than once a week. It says nothing about how long it has been. */

const DAY_MS = 24 * 60 * 60 * 1000;

export const BACKUP_NUDGE = Object.freeze({
  staleAfterDays: 30,
  minSessionsIfNever: 5,
  repeatAfterDays: 7
});

export function backupNudgeDue({ lastExportAt = null, nudgeShownAt = null, sessionCount = 0, now }) {
  if (nudgeShownAt != null && now - nudgeShownAt < BACKUP_NUDGE.repeatAfterDays * DAY_MS) return false;
  if (lastExportAt == null) return sessionCount >= BACKUP_NUDGE.minSessionsIfNever;
  return now - lastExportAt >= BACKUP_NUDGE.staleAfterDays * DAY_MS;
}
