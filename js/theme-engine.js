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

/** How Forge turns by itself. Kemet spins +1 about the vertical axis; Forge
 *  spins the other way on a turntable, bar level, so the two feel different.
 *  The axis is the one-line switch: 'vertical' (turntable), 'tumble' (end over
 *  end, about the horizontal axis across the bar) or 'roll' (about the bar's
 *  own length — near-invisible on a round bar, which is why it was replaced). */
export const FORGE_AUTO_ROTATION = Object.freeze({ axis: 'vertical', direction: -1 });
export const KEMET_AUTO_ROTATION = Object.freeze({ axis: 'vertical', direction: 1 });

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

/* ---------- drag-to-rotate (the one handler for every 3D scene) ---------- */

/**
 * The user's own rotation, held as a world-space yaw/pitch *offset* applied on
 * top of whatever the scene auto-rotates around. That separation is the point:
 * Forge auto-rotates about the bar's own long axis, which a barbell is nearly
 * symmetric about, so feeding a drag into that same angle (the original bug)
 * turned it invisibly. An offset in world space turns any scene the way the
 * finger moves — end-on, along the bar, upside down — whatever its own axis.
 *
 * Horizontal drag → yaw (about the vertical axis), vertical drag → pitch
 * (about the horizontal axis). On release both ease back to zero along the
 * shortest way round while the scene's auto-rotation carries on; under reduced
 * motion the caller simply never settles it, so the view stays where the user
 * left it, with no animation.
 */
export const ORBIT = Object.freeze({
  radPerPx: 0.012,
  settleSeconds: 0.45        // ease-back time constant after release
});

/** Per-scene orbit behaviour. Kemet and Forge turn freely and, under reduced
 *  motion, stay where they are let go. Terminal is a place you look around
 *  *inside*, so the view is clamped (it can never swing off into empty space),
 *  eases home over about a second, and under reduced motion snaps home. */
const DEG = Math.PI / 180;
export const ORBIT_STYLE = Object.freeze({
  kemet: Object.freeze({ limits: null, settleSeconds: ORBIT.settleSeconds, stillRelease: 'stay' }),
  forge: Object.freeze({ limits: null, settleSeconds: ORBIT.settleSeconds, stillRelease: 'stay' }),
  terminal: Object.freeze({ limits: Object.freeze({ yaw: 40 * DEG, pitch: 25 * DEG }), settleSeconds: 0.3, stillRelease: 'home' })
});

export function createOrbit() {
  return { yaw: 0, pitch: 0, dragging: false };
}

const clampTo = (x, limit) => (limit == null ? x : Math.min(Math.max(x, -limit), limit));

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function orbitGrab(orbit) { orbit.dragging = true; }

/** Clamping the accumulated angle (not the raw finger travel) means a drag
 *  past the stop responds the moment it reverses — no dead zone to unwind. */
export function orbitDrag(orbit, dxPx, dyPx, limits = null) {
  orbit.yaw = clampTo(orbit.yaw + dxPx * ORBIT.radPerPx, limits?.yaw);
  orbit.pitch = clampTo(orbit.pitch + dyPx * ORBIT.radPerPx, limits?.pitch);
}

export function orbitHome(orbit) {
  orbit.yaw = 0;
  orbit.pitch = 0;
}

/** Ends a drag. Angles are folded into (−π, π] so the ease back is the short way. */
export function orbitRelease(orbit) {
  orbit.dragging = false;
  orbit.yaw = wrapPi(orbit.yaw);
  orbit.pitch = wrapPi(orbit.pitch);
}

/** Ease the offset back toward the scene's own rotation. No-op while held. */
export function orbitSettle(orbit, dt, settleSeconds = ORBIT.settleSeconds) {
  if (orbit.dragging) return;
  orbit.yaw = approach(orbit.yaw, 0, dt, settleSeconds);
  orbit.pitch = approach(orbit.pitch, 0, dt, settleSeconds);
  if (Math.abs(orbit.yaw) < 1e-4) orbit.yaw = 0;
  if (Math.abs(orbit.pitch) < 1e-4) orbit.pitch = 0;
}

/* ---------- Forge plates (streakLevel → plates on the bar) ---------- */

/** Plate sizes in scene units. Colours follow the competition convention
 *  (red / blue / green by size), read from --backdrop-plate-* tokens. */
export const PLATE_SIZES = Object.freeze({
  large: Object.freeze({ radius: 0.62, width: 0.122, token: 'plateRed' }),
  medium: Object.freeze({ radius: 0.48, width: 0.095, token: 'plateBlue' }),
  small: Object.freeze({ radius: 0.34, width: 0.07, token: 'plateGreen' })
});

/** Per side, inner → outer. Levels 1–3 swap one plate for a bigger one (early
 *  progress reads as "heavier"); from 4 they add (later progress reads as
 *  "more"). Always the same list on both sides, so it is never lopsided. */
export const PLATE_TABLE = Object.freeze([
  [],
  ['small'],
  ['medium'],
  ['large'],
  ['large', 'small'],
  ['large', 'medium'],
  ['large', 'large'],
  ['large', 'large', 'medium'],
  ['large', 'large', 'large'],
  ['large', 'large', 'large', 'medium'],
  ['large', 'large', 'large', 'large']
].map((row) => Object.freeze(row)));

/** Plates seat from the inner collar (`seat`) outward; `end` is the inner face
 *  of the end collar. Sized so level 10 — four large — just fills it. */
export const SLEEVE = Object.freeze({ seat: 1.07, gap: 0.008, end: 1.585 });

export function platesForLevel(level) {
  const i = Math.min(Math.max(Math.round(Number(level) || 0), 0), PLATE_TABLE.length - 1);
  return [...PLATE_TABLE[i]];
}

/** Where each plate in a per-side list sits along +x, inner → outer. */
export function plateLayout(list) {
  let x = SLEEVE.seat;
  return list.map((size) => {
    const { width, radius } = PLATE_SIZES[size];
    const plate = { size, x0: x, x1: x + width, radius };
    x += width + SLEEVE.gap;
    return plate;
  });
}

/** One plate moves at a time, like loading a real bar: an outer plate comes
 *  off before an inner one can change, and new plates go on inner-first. */
export const PLATE_MOTION = Object.freeze({
  onSeconds: 0.6,        // slides on from the sleeve end and seats
  offSeconds: 0.9,       // fades and slides off, gently — a level easing down is never a "loss"
  slideFrom: 0.25        // how far past the sleeve end a plate starts / finishes, in scene units
});

export function createPlateRack(list = []) {
  return { seated: [...list], target: [...list], moving: null };
}

export function setRackTarget(rack, list) {
  rack.target = [...list];
}

/** Reduced motion, a hidden page or a first load: the right plates, in place. */
export function snapRack(rack) {
  rack.seated = [...rack.target];
  rack.moving = null;
}

export function rackSettled(rack) {
  return !rack.moving && rack.seated.length === rack.target.length && rack.seated.every((s, i) => s === rack.target[i]);
}

export function stepRack(rack, dt) {
  if (rack.moving) {
    const m = rack.moving;
    m.t = Math.min(1, m.t + dt / (m.dir === 'on' ? PLATE_MOTION.onSeconds : PLATE_MOTION.offSeconds));
    if (m.t >= 1) {
      if (m.dir === 'on') rack.seated.push(m.size);
      rack.moving = null;
    }
    return;
  }
  let i = 0;
  while (i < rack.seated.length && i < rack.target.length && rack.seated[i] === rack.target[i]) i += 1;
  if (i < rack.seated.length) {
    rack.moving = { size: rack.seated.pop(), dir: 'off', t: 0 };       // outermost first
  } else if (i < rack.target.length) {
    rack.moving = { size: rack.target[i], dir: 'on', t: 0 };
  }
}

/** What to draw on one side (+x; the renderer mirrors it): every seated plate,
 *  plus the moving one at its current offset and opacity. */
export function rackPlates(rack) {
  const plates = plateLayout(rack.seated).map((p) => ({ ...p, alpha: 1, moving: null }));
  const m = rack.moving;
  if (m) {
    const [p] = plateLayout([...rack.seated, m.size]).slice(-1);
    const away = SLEEVE.end + PLATE_MOTION.slideFrom - p.x0;           // distance to just past the sleeve end
    const shift = m.dir === 'on' ? away * (1 - m.t) ** 3 : away * m.t * m.t;
    const alpha = m.dir === 'on' ? Math.min(1, m.t * 4) : 1 - m.t;
    plates.push({ ...p, x0: p.x0 + shift, x1: p.x1 + shift, alpha, moving: m.dir, t: m.t });
  }
  return plates;
}
