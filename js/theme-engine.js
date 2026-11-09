/* The one driver every animated theme reads, plus the flash-safety gate.
 *
 * Pure and clock-free: callers pass times in, nothing here reads Date,
 * performance or the DOM. That is what lets tests/theme-engine.test.js run ten
 * simulated seconds at maximum intensity in a few milliseconds and prove the
 * flash cap holds for every theme.
 *
 * Two inputs, both from js/consistency.js and both left exactly as they are:
 *   streakLevel   0–10, rolling 14/28-day window
 *   monthPercent  0–1, training days ÷ days elapsed this month
 *
 *   intensity = clamp(0.6 × streakLevel / 10  +  0.4 × monthPercent, 0, 1)
 *
 * Why 60/40: the streak is the steadier signal (it is damped over 28 days and
 * a rest day never resets it); monthPercent is jumpy early in a month by
 * construction (on the 3rd one missed day is 67%). Weighting the steady one
 * more keeps rotation speed and lightning rate from lurching on the 2nd and 3rd
 * of every month. Both maxed is 1; either alone tops out at 0.6 or 0.4, so
 * each metric visibly moves the scene on its own.
 *
 * `intensity` drives the effects that are shared across themes: rotation
 * speed, glow, particle density, lightning rate, fractal zoom/detail, terminal
 * data velocity. The things that *display a specific metric* still read that
 * metric directly, because that is their job: the ten pyramid tiers are
 * streakLevel, the halo and the forge heat colour are monthPercent.
 */

export const ENGINE = Object.freeze({
  streakWeight: 0.6,
  monthWeight: 0.4,
  levels: 10,
  easeSeconds: 1.2             // intensity glides to a new value; nothing snaps
});

const clamp01 = (x) => Math.min(Math.max(Number(x) || 0, 0), 1);

export function intensity({ streakLevel = 0, monthPercent = 0 } = {}) {
  return clamp01(ENGINE.streakWeight * clamp01(streakLevel / ENGINE.levels) + ENGINE.monthWeight * clamp01(monthPercent));
}

/** Frame-rate-independent exponential approach. */
export function approach(current, target, dt, tauSeconds = ENGINE.easeSeconds) {
  if (!(dt > 0)) return current;
  return current + (target - current) * (1 - Math.exp(-dt / tauSeconds));
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/* ---------- rotation ---------- */

/** Slowest and fastest auto-rotation, rad/s. The fast end is a hard cap: one
 *  revolution per 8 s is lively without being disorienting, and no intensity
 *  can exceed it. Drag-to-rotate in the full-screen view is the user's own
 *  hand and is not limited. */
export const ROTATION = Object.freeze({
  minRadPerS: (Math.PI * 2) / 48,
  maxRadPerS: (Math.PI * 2) / 8
});

export function rotationSpeed(level) {
  const k = clamp01(level);
  return ROTATION.minRadPerS + (ROTATION.maxRadPerS - ROTATION.minRadPerS) * k * k;
}

/* ---------- Kemet halo staging (monthPercent) ---------- */

/** The 25 / 50 / 90–100 % stages of the month halo, each eased so crossing a
 *  threshold fades in rather than cutting. Shared by the WebGL scene and kept
 *  identical to the 2D fallback's numbers. */
export function haloStages(monthPercent) {
  const mp = clamp01(monthPercent);
  return {
    presence: smoothstep(0.15, 0.30, mp),   // ~25%: a ring appears, sparks begin
    brighten: smoothstep(0.42, 0.58, mp),   // ~50%: brighter, lightning in the ring
    strike: smoothstep(0.82, 0.92, mp)      // 90%+: brightest, arcs down to the pyramid
  };
}

/* ---------- flash safety (WCAG 2.3.1) ---------- */

/** No more than three flashes in any one-second window, at any intensity.
 *  A "flash" here is the onset of a lightning bolt — the only sudden luminance
 *  change any theme makes. Everything else (glow, rotation, particles) moves
 *  continuously and is not a flash. */
export const FLASH = Object.freeze({ maxFlashes: 3, windowMs: 1000 });

/**
 * The single gate every lightning effect asks before it flashes. One limiter
 * per renderer, shared by every bolt track on screen, so the cap is on what the
 * eye sees rather than on any one layer.
 *
 * Sliding window, not a bucket: a request at `now` is allowed only if fewer
 * than `maxFlashes` were granted in (now − windowMs, now]. That makes "four
 * flashes inside any 1 s span" impossible, which a per-second bucket would not
 * (three at 0.9 s and three at 1.1 s).
 */
export function createFlashLimiter({ maxFlashes = FLASH.maxFlashes, windowMs = FLASH.windowMs } = {}) {
  let granted = [];
  return {
    request(nowMs) {
      granted = granted.filter((t) => nowMs - t < windowMs);
      if (granted.length >= maxFlashes) return false;
      granted.push(nowMs);
      return true;
    },
    reset() { granted = []; }
  };
}

/** Largest number of timestamps in any half-open window of `windowMs`. The
 *  tests and the browser diagnostics both measure with this. */
export function maxInWindow(timesMs, windowMs = FLASH.windowMs) {
  const t = [...timesMs].sort((a, b) => a - b);
  let best = 0;
  let lo = 0;
  for (let hi = 0; hi < t.length; hi += 1) {
    while (t[hi] - t[lo] >= windowMs) lo += 1;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}

/* ---------- lightning scheduling ---------- */

/** Mean gap between strikes on one track, by intensity. More intensity means
 *  more frequent strikes — the limiter, not this table, is the safety cap. */
export const LIGHTNING = Object.freeze({
  slowDelayS: 8,
  fastDelayS: 1.2,
  durationS: 0.16,
  maxBranches: 5
});

/** Which bolt tracks each theme runs. Exported so the 10 s test drives exactly
 *  the tracks the renderer does. Forge and Terminal have no lightning. */
export const LIGHTNING_TRACKS = Object.freeze({
  kemet: ['pyramid', 'halo'],
  fractal: ['boundary'],
  forge: [],
  terminal: []
});

function meanDelay(level) {
  return LIGHTNING.slowDelayS + (LIGHTNING.fastDelayS - LIGHTNING.slowDelayS) * clamp01(level);
}

export function strikeDelay(level, rand = Math.random) {
  return meanDelay(level) * (0.7 + 0.6 * rand());
}

export function createBoltTrack() {
  return { nextAt: null, lastAt: null, flashes: 0 };
}

/**
 * Advance one track to time `tS`. Returns true when it should strike *now* —
 * the limiter has already counted it. A strike that is due but refused stays
 * due and is retried next frame, so a crowded moment delays a bolt rather than
 * dropping the track's rhythm.
 */
export function updateBoltTrack(track, tS, level, limiter, rand = Math.random) {
  if (track.nextAt === null) { track.lastAt = tS; track.nextAt = tS + strikeDelay(level, rand) * 0.5; return false; }
  // A strike booked while intensity was low must not keep the scene waiting
  // once it rises: never wait longer than the current level's longest gap.
  track.nextAt = Math.min(track.nextAt, track.lastAt + meanDelay(level) * 1.3);
  if (tS < track.nextAt) return false;
  if (!limiter.request(tS * 1000)) return false;
  track.flashes += 1;
  track.lastAt = tS;
  track.nextAt = tS + strikeDelay(level, rand);
  return true;
}

/** Branch count for a bolt: more branching with intensity, not more flashes. */
export function boltBranches(level) {
  return Math.round(clamp01(level) * LIGHTNING.maxBranches);
}
