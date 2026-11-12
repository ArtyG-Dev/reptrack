/* Keeps the screen awake during a session (Screen Wake Lock API), behind the
 * "Keep screen on during a session" setting. The browser drops the lock when
 * the page is hidden, so it is taken again on return. A refused or unsupported
 * request is silent: no error, no toast — the app just behaves as before. */

let sentinel = null;
let wanted = false;

async function acquire() {
  if (sentinel || !wanted || document.hidden || !navigator.wakeLock?.request) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener?.('release', () => { sentinel = null; });
  } catch {
    sentinel = null;
  }
}

function release() {
  const held = sentinel;
  sentinel = null;
  held?.release?.().catch(() => {});
}

export function keepAwake(on) {
  wanted = Boolean(on);
  if (wanted) acquire();
  else release();
}

export function isHeld() {
  return Boolean(sentinel);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) acquire(); });
}
