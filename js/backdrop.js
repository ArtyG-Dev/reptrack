/* The animated backdrop behind the three frosted-glass skins.
 *
 * Why a canvas and not CSS animations: this layer has to stop. It stops when
 * the tab is hidden, it stops while speech recognition is running (nothing may
 * compete with the mic), and it renders a single static frame — not a slow one —
 * for prefers-reduced-motion or the manual "reduce background effects" setting.
 * A CSS animation can be paused for the first case and slowed for the third,
 * but not reliably stopped dead for the second.
 *
 * Performance shape, all deliberate:
 *   - one rAF loop, throttled to 30fps; these are ambient textures, not games
 *   - the backing store renders at a fraction of CSS pixels and is scaled up by
 *     the compositor (0.5× for terminal/forge; 0.24× for fractal, which is
 *     then CSS-blurred, so it still costs only tens of thousands of pixels a
 *     frame — see SCALE and fillRadialBounded() below for how)
 *   - device pixel ratio is ignored on purpose — nobody can see 2× detail
 *     through a 14px blur, and honouring it would quadruple the fill cost
 *   - primitives only: rects, arcs and radial gradients. No text, no images,
 *     no per-pixel work, no shaders, no video.
 *
 * Every colour drawn comes from a --backdrop-* custom property on the active
 * theme, so css/styles.css is the single source of truth for what can appear —
 * and tests/contrast.test.js can therefore prove the contrast floor holds
 * across the entire animation range.
 */

const FPS = 30;
const FRAME_MS = 1000 / FPS;
// Fractal was 0.12 — so blurred and so tiny that no bloom read as a shape,
// which is the root cause behind "fractal doesn't appear to run" (see
// DECISIONS.md). 0.24 plus a lighter blur keeps it legible without the CPU
// cost scaling as badly as the resolution bump alone would suggest, because
// every gradient fill below is now bounded to its own radius instead of the
// full canvas — see fillRadialBounded().
const SCALE = { terminal: 0.5, forge: 0.5, fractal: 0.24 };
const GLASS_SKINS = new Set(['terminal', 'fractal', 'forge']);

// Lightning (Fractal) — a flicker-hazard budget, not a suggestion. The floor
// applies even at maximum consistency: however hot the streak, a flash is
// never closer than this to the last one. Recorded here, not just in
// DECISIONS.md, so the cap is the same value the code runs and the value
// documented as "checked".
const LIGHTNING = Object.freeze({
  minIntervalS: 3.5,     // hard floor — never more than one flash per ~3.5s
  maxIntervalS: 9,       // at zero consistency, a flash is still rare, just not absent
  durationS: 0.15,       // ~4-5 frames at the 30fps cap: brief, not jarring
  maxBranches: 2
});

// Forge — a good handful of embers and a hint of dumbbell are always on,
// even at zero consistency (the brief's "base state"); only the flame lick
// and the denser ember field are consistency-gated. Raised from an earlier,
// too-timid pass (5 / 0.35) after real usage showed "only a few faint
// sparks" even after logging sessions — see DECISIONS.md.
const EMBER_MIN_ACTIVE = 9;
const FLAME_START_HEAT = 0.22;  // no flame lick at all below this

let canvas = null;
let ctx = null;
let skin = null;
let raf = 0;
let lastFrameAt = 0;
let clock = 0;                       // seconds; only advances while actually running
let voiceActive = false;
let reduceEffects = false;           // the manual Settings toggle
let activity = { glow: 0.5, frostHint: 0 };
let palette = {};
let dims = { w: 0, h: 0 };
let streams = [];
let embers = [];
let bolt = null;                     // the one active lightning flash, or null
let nextBoltAt = 0;
let boltFlashes = 0;                 // diagnostics/test hook — cumulative flash count
let frames = 0;                      // diagnostics/test hook

const reducedMotionQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false, addEventListener() {} };

export function isGlassSkin(name) {
  return GLASS_SKINS.has(name);
}

/** Static means one frame and no loop — never a slowed-down animation. */
function isStatic() {
  return reduceEffects || reducedMotionQuery.matches;
}

function shouldRun() {
  return Boolean(skin) && !isStatic() && !voiceActive && !document.hidden;
}

/* ---------- colour helpers ---------- */

function toRGB(hex) {
  let h = String(hex).trim().replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = Number.parseInt(h, 16);
  return Number.isFinite(n) && h.length === 6
    ? [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    : [0, 0, 0];
}

function rgba([r, g, b], alpha = 1) {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** A radial-gradient fill clipped to its own bounding box instead of the
 *  whole canvas. Canvas fill cost is proportional to the pixel count of the
 *  rect drawn, not the gradient's extent — five full-canvas fills (the old
 *  fractal blooms) cost five times a single one for no visual reason, since
 *  everything past the gradient's outer stop is transparent anyway. This is
 *  what pays for the richer visuals below without a proportional CPU rise. */
function fillRadialBounded(cx, cy, r, addStops) {
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  addStops(grad);
  ctx.fillStyle = grad;
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(dims.w, Math.ceil(cx + r));
  const y1 = Math.min(dims.h, Math.ceil(cy + r));
  if (x1 > x0 && y1 > y0) ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

/** Blend two colours. A linear RGB blend's luminance is NOT guaranteed to sit
 *  between its two endpoints' luminance in general — two saturated colours in
 *  different hues can blend to something darker or lighter than either (e.g.
 *  pure red and pure green blend through a mid-tone dimmer than both). Forge
 *  is the only skin that uses this, on its ember/iron/ink family, and
 *  tests/contrast.test.js → "forge's mixed colours never escape the backdrop
 *  range" checks the *actual* blends it produces (not a hand-wave about the
 *  source colours) across the full heat/flame parameter space. Don't reach
 *  for mix() on a new colour pair without a matching test; drawing a literal,
 *  unblended token — as drawTerminal() does — sidesteps the question
 *  entirely and is preferred wherever the look allows it. */
function mix(a, b, t) {
  const k = Math.min(Math.max(t, 0), 1);
  return a.map((v, i) => Math.round(v + (b[i] - v) * k));
}

function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const read = (name, fallback) => toRGB(cs.getPropertyValue(name).trim() || fallback);
  palette = {
    base: read('--backdrop-base', '#000000'),
    ink: read('--backdrop-ink', '#334455'),
    grid: read('--backdrop-grid', '#12222c'),
    stream: read('--backdrop-stream', '#24485a'),
    stream2: read('--backdrop-stream-2', '#1c5248'),
    bloomA: read('--backdrop-bloom-a', '#2c2154'),
    bloomB: read('--backdrop-bloom-b', '#1c3350'),
    iron: read('--backdrop-iron', '#241813'),
    ember: read('--backdrop-ember', '#5a2a0c'),
    spark: read('--backdrop-spark', '#6b3410')
  };
}

/* ---------- sizing ---------- */

function resize() {
  if (!canvas || !skin) return;
  const scale = SCALE[skin] ?? 0.5;
  const w = Math.max(8, Math.round((window.innerWidth || 360) * scale));
  const h = Math.max(8, Math.round((window.innerHeight || 640) * scale));
  if (w === dims.w && h === dims.h) return;
  canvas.width = w;
  canvas.height = h;
  dims = { w, h };
  seed();
}

function seed() {
  const { w, h } = dims;

  const columnGap = Math.max(12, Math.round(w / 11));
  streams = [];
  for (let x = columnGap / 2; x < w; x += columnGap) {
    streams.push({
      x,
      y: Math.random() * h,
      speed: 9 + Math.random() * 16,      // px/s in backing-store space — a live glow multiplier stacks on top
      len: 8 + Math.random() * 22,
      alpha: 0.32 + Math.random() * 0.26,
      hueSeed: Math.random()              // which colour bucket this stream draws from — see drawTerminal()
    });
  }

  embers = Array.from({ length: 32 }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    drift: (Math.random() - 0.5) * 5,
    rise: 5 + Math.random() * 11,
    size: 0.6 + Math.random() * 1.6,
    phase: Math.random() * Math.PI * 2
  }));

  bolt = null;
  nextBoltAt = 0;
}

/* ---------- skins ---------- */

/** Terminal: a soft grid pulse with data streams drifting down it. Unlike
 *  Fractal/Forge in the original brief, Terminal wasn't meant to respond to
 *  consistency at all — but real usage showed a flat ambient texture reads
 *  as "nothing changed" exactly when someone is looking for a reward for
 *  showing up. So it now does too: streams fall faster and brighter, and a
 *  larger share of them draw in the brightest colour bucket, as the streak
 *  builds. Still texture, not content — the *range* moved, not the ceiling
 *  into something that competes with the foreground UI. See DECISIONS.md.
 *
 *  Colour variety without ever mixing two tokens together (mixing risks
 *  producing a luminance outside [--backdrop-base, --backdrop-ink] — see
 *  the note on mix() above): each stream is permanently assigned to draw
 *  either --backdrop-stream, --backdrop-stream-2, or --backdrop-ink outright,
 *  via its seeded hueSeed. Only the *bucket boundary* moves with glow, never
 *  the colour itself, so every pixel this ever paints is still one literal
 *  declared token — the contrast proof stays exactly as airtight as before. */
function drawTerminal(t) {
  const { w, h } = dims;
  ctx.fillStyle = rgba(palette.base, 1);
  ctx.fillRect(0, 0, w, h);

  const glow = activity.glow;
  const brightness = 0.85 + glow * 0.65;      // consistency → how strongly everything reads
  const speedMul = 1 + glow * 0.85;           // consistency → how fast streams fall
  const inkShare = 0.12 + glow * 0.38;        // consistency → odds a stream draws in the brightest token

  const pulse = (0.11 + 0.07 * (0.5 + 0.5 * Math.sin(t * 0.35))) * brightness;
  ctx.strokeStyle = rgba(palette.grid, pulse);
  ctx.lineWidth = 1;
  ctx.beginPath();
  const step = Math.max(14, Math.round(w / 8));
  for (let x = 0; x <= w; x += step) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
  for (let y = 0; y <= h; y += step) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
  ctx.stroke();

  for (const s of streams) {
    const y = (s.y + t * s.speed * speedMul) % (h + s.len) - s.len;
    const colour = s.hueSeed < inkShare ? palette.ink : (s.hueSeed < inkShare + 0.44 ? palette.stream2 : palette.stream);
    const alpha = Math.min(s.alpha * brightness, 0.92);
    const grad = ctx.createLinearGradient(0, y, 0, y + s.len);
    grad.addColorStop(0, rgba(colour, 0));
    grad.addColorStop(0.6, rgba(colour, alpha));
    grad.addColorStop(1, rgba(colour, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(s.x, y, 3, s.len);
  }
}

/** Midpoint-displacement polyline — a cheap way to get an irregular, jagged
 *  path without real physics. Depth 4 on the main bolt, 2 on a branch, so a
 *  branch reads as a rougher offshoot rather than a clean fork. */
function displace(x0, y0, x1, y1, depth, amp) {
  if (depth <= 0) return [{ x: x0, y: y0 }, { x: x1, y: y1 }];
  const mx = (x0 + x1) / 2 + (Math.random() - 0.5) * amp;
  const my = (y0 + y1) / 2 + (Math.random() - 0.5) * amp * 0.6;
  const left = displace(x0, y0, mx, my, depth - 1, amp * 0.55);
  const right = displace(mx, my, x1, y1, depth - 1, amp * 0.55);
  return [...left.slice(0, -1), ...right];
}

function strokePath(points, alpha) {
  ctx.strokeStyle = rgba(palette.ink, alpha);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
}

/** Schedules once, then re-schedules itself every time a flash finishes —
 *  never both branches of "should a bolt start" and "should the next one be
 *  scheduled" fire in the same check. Interval shortens with consistency but
 *  never below LIGHTNING.minIntervalS, at any glow — the flicker-hazard cap
 *  holds even at maximum consistency, not just on average. */
function maybeStrikeBolt(t) {
  if (nextBoltAt === 0) { nextBoltAt = t + LIGHTNING.maxIntervalS * 0.4; return; }
  if (bolt) return;
  if (t < nextBoltAt) return;

  const branchCount = Math.round(activity.glow * LIGHTNING.maxBranches);
  const x0 = dims.w * (0.15 + Math.random() * 0.7);
  const y1 = dims.h * (0.5 + Math.random() * 0.3);
  const points = displace(x0, 0, x0 + (Math.random() - 0.5) * dims.w * 0.12, y1, 4, dims.w * 0.06);
  const branches = [];
  for (let i = 0; i < branchCount; i += 1) {
    const from = points[1 + Math.floor(Math.random() * (points.length - 2))];
    const to = { x: from.x + (Math.random() - 0.5) * dims.w * 0.18, y: Math.min(dims.h, from.y + dims.h * (0.15 + Math.random() * 0.2)) };
    branches.push(displace(from.x, from.y, to.x, to.y, 2, dims.w * 0.05));
  }

  bolt = { bornAt: t, points, branches };
  boltFlashes += 1;

  const span = LIGHTNING.maxIntervalS - LIGHTNING.minIntervalS;
  nextBoltAt = t + Math.max(LIGHTNING.minIntervalS, LIGHTNING.maxIntervalS - span * activity.glow + (Math.random() - 0.5) * 1.5);
}

function drawBolt(t) {
  if (!bolt) return;
  const age = t - bolt.bornAt;
  if (age > LIGHTNING.durationS) { bolt = null; return; }
  const envelope = 1 - age / LIGHTNING.durationS;         // quick linear fade
  const peak = 0.20 + activity.glow * 0.40;                // faint when quiet, bolder when hot
  strokePath(bolt.points, peak * envelope);
  for (const branch of bolt.branches) strokePath(branch, peak * envelope * 0.7);
}

/** Fractal: slow organic blooms plus lightning. Rendered small and blurred by
 *  CSS, so the "morph" is a handful of drifting radial gradients rather than
 *  real fractal maths — same look through a blur, a fraction of the cost.
 *  Overall lightness *and size* rise with training consistency, and
 *  lightning flickers through it — rare and single-stranded when quiet, more
 *  frequent and branching when consistent (see LIGHTNING above for the
 *  flash-rate cap). The floor here was raised after real usage showed almost
 *  no bloom at all at rest — see DECISIONS.md. */
function drawFractal(t) {
  const { w, h } = dims;
  ctx.fillStyle = rgba(palette.base, 1);
  ctx.fillRect(0, 0, w, h);

  const lift = 0.55 + activity.glow * 0.45;      // consistency → brightness, floor raised so it's never faint
  const grow = 0.85 + activity.glow * 0.30;      // consistency → bloom size, a second reward dimension
  const blooms = [
    { c: palette.bloomA, fx: 0.30, fy: 0.24, sx: 0.11, sy: 0.07, r: 0.55 },
    { c: palette.bloomB, fx: 0.72, fy: 0.62, sx: 0.09, sy: 0.10, r: 0.48 },
    { c: palette.ink, fx: 0.48, fy: 0.82, sx: 0.13, sy: 0.06, r: 0.38 },
    { c: palette.bloomA, fx: 0.18, fy: 0.70, sx: 0.07, sy: 0.12, r: 0.32 },
    { c: palette.bloomB, fx: 0.82, fy: 0.20, sx: 0.10, sy: 0.09, r: 0.30 }
  ];

  // A full cycle takes ~80s: ambient, not busy.
  const slow = t * 0.0785;
  for (const [i, b] of blooms.entries()) {
    const cx = (b.fx + Math.sin(slow + i * 1.7) * b.sx) * w;
    const cy = (b.fy + Math.cos(slow * 0.83 + i * 2.1) * b.sy) * h;
    const radius = b.r * Math.max(w, h) * (0.85 + 0.15 * Math.sin(slow * 1.3 + i)) * grow;
    fillRadialBounded(cx, cy, radius, (grad) => {
      grad.addColorStop(0, rgba(b.c, 0.78 * lift));
      grad.addColorStop(1, rgba(b.c, 0));
    });
  }

  maybeStrikeBolt(t);
  drawBolt(t);
}

function roundedRectPath(x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/** Fill, then a lighter contour stroke — the stroke is what keeps the
 *  silhouette readable at low heat, where fill alone (mixed dark iron on a
 *  near-black backdrop) has very little contrast of its own. */
function ironShape(x, y, w, h, r, fillColor, fillAlpha, edgeColor, edgeAlpha) {
  roundedRectPath(x, y, w, h, r);
  ctx.fillStyle = rgba(fillColor, fillAlpha);
  ctx.fill();
  if (edgeAlpha > 0) {
    ctx.strokeStyle = rgba(edgeColor, edgeAlpha);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** Forge: an oversized dumbbell behind the glass, warmed by consistency.
 *  A lapse cools it a little and no further — `frostHint` is capped upstream,
 *  and the multiplier here keeps at least 65% of the warmth in the worst case.
 *  Nothing here flashes: every value moves on a slow sine or not at all.
 *
 *  Two things are always on, at any consistency, per the brief's "base
 *  state": the dumbbell silhouette (fill + edge stroke, so it reads even
 *  unlit) and a handful of drifting embers (EMBER_MIN_ACTIVE). Only the glow
 *  brightness, ember density and the flame lick above the bar are gated on
 *  heat — the first version tied *everything* to heat, so a brand-new
 *  profile (heat 0, the common case — nobody has training history on first
 *  load) rendered close enough to nothing that it read as broken rather than
 *  as "warms up as you go". See DECISIONS.md. */
function drawForge(t) {
  const { w, h } = dims;
  ctx.fillStyle = rgba(palette.base, 1);
  ctx.fillRect(0, 0, w, h);

  const heat = Math.min(Math.max(activity.glow * (1 - 0.35 * activity.frostHint), 0), 1);
  const cx = w * 0.5;
  const cy = h * 0.46;
  const barW = w * 0.72;
  const barH = Math.max(3, h * 0.035);

  // Forge glow behind the bar — breathes very slowly, never pulses.
  const breathe = 0.9 + 0.1 * Math.sin(t * 0.22);
  const hot = mix(palette.ember, palette.ink, heat);
  const glowR = Math.max(w, h) * (0.34 + heat * 0.26) * breathe;
  fillRadialBounded(cx, cy, glowR, (grad) => {
    grad.addColorStop(0, rgba(hot, (0.22 + heat * 0.53) * breathe));
    grad.addColorStop(0.55, rgba(hot, (0.09 + heat * 0.24) * breathe));
    grad.addColorStop(1, rgba(hot, 0));
  });

  // The dumbbell itself: a bar, two inner plates, two outer plates.
  const iron = mix(palette.iron, hot, heat * 0.45);
  const edge = mix(iron, palette.ink, 0.4);
  ironShape(cx - barW / 2, cy - barH / 2, barW, barH, barH / 2, iron, 0.72, edge, 0.35);

  const plate = (offset, pw, ph) => {
    ironShape(cx + offset - pw / 2, cy - ph / 2, pw, ph, Math.min(pw, ph) * 0.28, iron, 0.72, edge, 0.3);
  };
  const innerW = barW * 0.085;
  const innerH = h * 0.20;
  const outerW = barW * 0.065;
  const outerH = h * 0.13;
  for (const dir of [-1, 1]) {
    plate(dir * barW * 0.34, innerW, innerH);
    plate(dir * barW * 0.45, outerW, outerH);
  }

  // Embers: a few always drift (EMBER_MIN_ACTIVE), more join and they burn
  // brighter as the forge heats up. Each fades in and out near the top/bottom
  // of its rise rather than popping in — "drift and flicker… fade out".
  const active = Math.round(EMBER_MIN_ACTIVE + heat * (embers.length - EMBER_MIN_ACTIVE));
  const edgeBand = h * 0.12;
  for (let i = 0; i < active; i += 1) {
    const s = embers[i];
    const y = ((s.y - t * s.rise) % h + h) % h;
    const x = s.x + Math.sin(t * 0.5 + s.phase) * s.drift;
    const fade = Math.min(y / edgeBand, (h - y) / edgeBand, 1);
    const twinkle = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.1 + s.phase));
    ctx.fillStyle = rgba(palette.spark, (0.24 + heat * 0.48) * twinkle * Math.max(0, fade));
    ctx.fillRect(x, y, s.size, s.size);
  }

  // Flame lick above the bar — absent below FLAME_START_HEAT ("no visible
  // flame" at low consistency), ramping to a soft sustained flicker at heat 1.
  // Slow sine flicker only, same no-strobe rule as everything else here.
  const flameT = Math.max(0, (heat - FLAME_START_HEAT) / (1 - FLAME_START_HEAT));
  if (flameT > 0) {
    const flameColor = mix(palette.ember, palette.ink, 0.6 + 0.4 * flameT);
    // A fourth lick joins only once the streak is genuinely sustained
    // (flameT > 0.6) — one more visible "this is a strong streak" step.
    const lickCount = flameT > 0.6 ? 4 : 3;
    for (let i = 0; i < lickCount; i += 1) {
      const flicker = 0.85 + 0.15 * Math.sin(t * 0.9 + i * 2.1);
      const fx = cx + (i - (lickCount - 1) / 2) * barW * 0.09;
      const fy = cy - barH * 0.6 - flameT * h * 0.06 * (1 + 0.3 * Math.sin(t * 0.6 + i));
      const fr = (h * 0.05 + flameT * h * 0.06) * flicker;
      fillRadialBounded(fx, fy, fr, (grad) => {
        grad.addColorStop(0, rgba(flameColor, 0.5 * flameT * flicker));
        grad.addColorStop(1, rgba(flameColor, 0));
      });
    }
  }
}

const RENDERERS = { terminal: drawTerminal, fractal: drawFractal, forge: drawForge };

function draw() {
  if (!ctx || !skin) return;
  const render = RENDERERS[skin];
  if (!render) return;
  render(clock);
  frames += 1;
}

/* ---------- loop ---------- */

function loop(timestamp) {
  if (!shouldRun()) { raf = 0; return; }
  raf = requestAnimationFrame(loop);

  const elapsed = timestamp - lastFrameAt;
  if (elapsed < FRAME_MS) return;          // 30fps cap
  const dt = Math.min(elapsed / 1000, 0.1);
  lastFrameAt = timestamp;
  clock += dt;
  draw();
}

function startLoop() {
  if (raf || !shouldRun()) return;
  lastFrameAt = performance.now() - FRAME_MS;
  raf = requestAnimationFrame(loop);
}

function stopLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

/** Re-evaluate every pause condition and settle into the right state. */
function sync() {
  if (!canvas) return;
  if (!skin) { stopLoop(); return; }

  readPalette();
  resize();

  if (isStatic()) {
    stopLoop();
    draw();                                // exactly one frame, held
    return;
  }
  if (!shouldRun()) { stopLoop(); return; }
  startLoop();
}

/* ---------- public API ---------- */

export function mount(element) {
  canvas = element;
  if (!canvas) return;
  ctx = canvas.getContext('2d', { alpha: false });

  addEventListener('resize', () => { dims = { w: 0, h: 0 }; sync(); }, { passive: true });
  document.addEventListener('visibilitychange', sync);
  reducedMotionQuery.addEventListener?.('change', sync);
}

export function setSkin(name) {
  const next = GLASS_SKINS.has(name) ? name : null;
  if (next === skin) return;
  skin = next;
  dims = { w: 0, h: 0 };                   // force a resize + reseed
  clock = 0;
  if (!skin && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  sync();
}

/** Consistency-driven values from js/consistency.js. */
export function setActivity({ glow = 0.5, frostHint = 0 } = {}) {
  activity = {
    glow: Math.min(Math.max(glow, 0), 1),
    frostHint: Math.min(Math.max(frostHint, 0), 1)
  };
  if (isStatic()) sync();                  // keep the held frame current
}

/** Speech recognition is starting/finishing — the backdrop gets out of the way. */
export function setVoiceActive(active) {
  voiceActive = Boolean(active);
  sync();
}

export function setReduceEffects(flag) {
  reduceEffects = Boolean(flag);
  sync();
}

export function stop() {
  stopLoop();
}

/** Diagnostics for tests and scripts/measure-skins.mjs. */
export function getDiagnostics() {
  return {
    skin,
    running: raf !== 0,
    static: isStatic(),
    voiceActive,
    hidden: typeof document !== 'undefined' ? document.hidden : false,
    frames,
    fpsCap: FPS,
    backingStore: { ...dims },
    activity: { ...activity },
    boltFlashes                      // fractal only; the flicker-hazard cap under test
  };
}
