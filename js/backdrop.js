/* The animated backdrop behind the frosted-glass skins.
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
 *     the compositor — see SCALE
 *   - device pixel ratio is ignored on purpose — nobody can see 2× detail
 *     behind a frosted panel, and honouring it would quadruple the fill cost
 *   - per-frame drawing is primitives only: rects, arcs, gradients, polylines
 *   - the ONE piece of per-pixel work in here, the Mandelbrot set, is rendered
 *     to an offscreen canvas at seed time and only ever `drawImage`d per frame.
 *     Never compute it in the loop.
 *
 * Every colour drawn comes from a --backdrop-* custom property on the active
 * theme, so css/styles.css is the single source of truth for what can appear —
 * and tests/contrast.test.js can therefore prove the contrast floor holds
 * across the entire animation range. Two rules keep that proof true:
 *
 *   1. Never paint a colour literal. Read a token (see SKIN_TOKENS).
 *   2. Never use an additive composite op ('lighter', 'screen', …). Normal
 *      source-over alpha blending is a convex combination, so stacked draws can
 *      only ever land *between* the colours involved — which is what bounds
 *      every frame inside [--backdrop-base, --backdrop-ink]. An additive op
 *      would let stacked draws exceed --backdrop-ink and silently break the
 *      contrast proof. tests/contrast.test.js enforces both.
 */

import { createFlashLimiter, intensity, approach, rotationSpeed } from './theme-engine.js';
import { createGLBackdrop } from './backdrop-gl.js';

const FPS = 30;
const FRAME_MS = 1000 / FPS;
const FULL_VIEW_FPS = 60;            // the full-screen graphic view only — see setFullView()
const MAX_DPR = 2;                   // sharp on high-DPI phones without rendering 4× the pixels
const MAX_GL_PIXELS = 2_400_000;     // a desktop-monitor guard; no phone reaches it

/* Backing-store resolution, as a fraction of CSS pixels. Fractal and Kemet run
 * higher than the others because both now carry a *legible* focal graphic (a
 * Mandelbrot, a ten-tier pyramid) rather than a soft wash — detail you can
 * resolve is the entire point of them, and it does not survive being drawn at
 * an eighth scale and blown back up. */
const SCALE = { terminal: 0.5, forge: 0.5, fractal: 0.34, kemet: 0.4 };
const GLASS_SKINS = new Set(['terminal', 'fractal', 'forge', 'kemet']);

/** Which --backdrop-* tokens each skin's renderer actually reads. Exported so
 *  tests/contrast.test.js can assert every skin *declares* the tokens it draws
 *  — otherwise a missing declaration silently falls back to a hardcoded colour
 *  that no contrast test has ever seen. */
export const SKIN_TOKENS = Object.freeze({
  terminal: ['base', 'ink', 'grid', 'stream', 'stream-2'],
  fractal: ['base', 'ink', 'bloom-a', 'bloom-b'],
  forge: ['base', 'ink', 'glow', 'iron', 'ember', 'spark', 'heat-a', 'heat-b', 'heat-c'],
  kemet: ['base', 'ink', 'star', 'halo', 'halo-hot', 'sky', 'stone', 'gold', 'gold-hot', 'glyph', 'arc']
});

// Lightning — a flicker-hazard budget, not a suggestion. The floor applies at
// maximum intensity: however strong the streak, a flash is never closer than
// this to the last one.
//
// There are now two independent bolt tracks on Kemet (the streak-driven pyramid
// crawl and the month-driven halo), so per-track capping is no longer enough —
// two tracks each obeying a 3.5s floor could still put flashes 0.1s apart on
// screen. `lastFlashAt` is a skin-wide gate every track must clear, so the cap
// is on what the eye actually sees rather than on any one layer.
const LIGHTNING = Object.freeze({
  minIntervalS: 3.5,     // hard floor — never more than one flash per ~3.5s
  maxIntervalS: 9,       // at zero intensity a flash is still rare, just not absent
  durationS: 0.15,       // ~4-5 frames at the 30fps cap: brief, not jarring
  maxBranches: 2
});

// Forge — a good handful of embers and a visible dumbbell are always on, even
// at zero consistency (the brief's "base state"); only the flame lick and the
// denser ember field are consistency-gated.
const EMBER_MIN_ACTIVE = 9;
const FLAME_START_HEAT = 0.22;  // no flame lick at all below this

// Pyramid tier easing. Up is quick enough to read as a light-up, down is slow
// enough to read as fading rather than switching off — the brief asks for both
// and they are deliberately not the same number.
const TIER_UP_SECONDS = 0.5;
const TIER_DOWN_SECONDS = 2.0;
const STREAK_LEVELS = 10;

/* The tab bar is fixed to the bottom of the viewport and is opaque-ish glass,
 * so anything drawn under it is simply not visible. `body` reserves 72px + the
 * safe-area inset for it in css/styles.css; 78 covers that with a little room.
 * Without this the bottom two pyramid tiers sat behind the tab bar — which
 * makes "all ten tiers light up" untrue in the only way that matters, since
 * you cannot count what you cannot see. */
const TABBAR_CSS_PX = 78;

/** The bottom third of the viewport, less the tab bar: where each skin's
 *  signature graphic lives. Not a faint background wash — a focal element the
 *  glass panels sit over. */
function featureBand() {
  const { w, h } = dims;
  if (fullView) return { y: h * 0.12, h: h * 0.8, w };
  const inset = Math.min(h * 0.14, TABBAR_CSS_PX * (SCALE[skin] ?? 0.5));
  const y = h * (2 / 3);
  return { y, h: Math.max(8, h - inset - y), w };
}

let canvas = null;
let ctx = null;
let skin = null;
let raf = 0;
let lastFrameAt = 0;
let clock = 0;                       // seconds; only advances while actually running
let voiceActive = false;
let reduceEffects = false;           // the manual Settings toggle
let activity = { glow: 0.5, frostHint: 0, streakLevel: 0, streakFraction: 0, monthPercent: 0 };
let palette = {};
let dims = { w: 0, h: 0 };
let streams = [];
let embers = [];
let stars = [];
let glyphs = [];
let tierGlow = new Float64Array(STREAK_LEVELS);
let mandelbrot = null;               // { low, high } offscreen canvases, or null
/** One independent lightning layer. Kemet runs two (pyramid crawl + halo);
 *  Fractal runs one. All of them clear the shared `lastFlashAt` gate. */
function makeBoltTrack() {
  return { bolt: null, nextAt: 0, flashes: 0 };
}
let boltTrack = makeBoltTrack();     // pyramid surface (Kemet) / bolts (Fractal)
let haloTrack = makeBoltTrack();     // Kemet halo only
let lastFlashAt = -Infinity;         // skin-wide flicker gate, across every track
const baseLimiter = createFlashLimiter();   // the WCAG 2.3.1 cap — one gate for every bolt, 2D and WebGL
let flashLog = [];                          // granted flash times (ms of backdrop clock), for diagnostics
const flashLimiter = {
  request(ms) {
    if (!baseLimiter.request(ms)) return false;
    flashLog.push(ms);
    if (flashLog.length > 256) flashLog = flashLog.slice(-128);
    return true;
  },
  reset() { baseLimiter.reset(); flashLog = []; }
};

/* WebGL2 state. `glr` is null whenever the 2D renderer is in charge: no WebGL2,
 * a failed build, or a lost context waiting to be restored. The 2D renderers
 * below are the fallback — never a blank background. */
let glCanvas = null;
let glr = null;
let glDims = { w: 0, h: 0 };
let fullView = false;                // the full-screen graphic view (js/views/graphic.js)
let dragging = false;
let spin = 0;                        // radians; integrated from rotationSpeed(), or the user's drag
// What is on screen, eased toward `activity` so nothing snaps (theme-engine approach()).
let shown = { level: 0, month: 0, glow: 0.5, heat: 0, k: 0 };
let snapOnNextActivity = true;
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

function usingGL() {
  return Boolean(glr) && Boolean(skin);
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

/** A radial-gradient fill clipped to its own bounding box instead of the whole
 *  canvas. Canvas fill cost is proportional to the pixel count of the rect
 *  drawn, not the gradient's extent, and everything past the outer stop is
 *  transparent anyway. */
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
 *  between its two endpoints' in general — two saturated colours in different
 *  hues can blend darker or lighter than either. Forge is the only skin that
 *  uses this, on its ember/iron/ink family, and tests/contrast.test.js →
 *  "forge's mixed colours never escape the backdrop range" checks the *actual*
 *  blends it produces across the full parameter space. Don't reach for mix()
 *  on a new colour pair without a matching test; drawing a literal, unblended
 *  token at varying alpha — as Terminal and Kemet do — sidesteps the question
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
    glow: read('--backdrop-glow', '#6b3410'),
    iron: read('--backdrop-iron', '#241813'),
    ember: read('--backdrop-ember', '#5a2a0c'),
    spark: read('--backdrop-spark', '#6b3410'),
    heatA: read('--backdrop-heat-a', '#8a3a12'),
    heatB: read('--backdrop-heat-b', '#c9701f'),
    heatC: read('--backdrop-heat-c', '#f0c25e'),
    star: read('--backdrop-star', '#5f8f96'),
    halo: read('--backdrop-halo', '#d8bf72'),
    haloHot: read('--backdrop-halo-hot', '#f4e7b4'),
    sky: read('--backdrop-sky', '#1d1745'),
    stone: read('--backdrop-stone', '#2a2340'),
    gold: read('--backdrop-gold', '#6d5a24'),
    goldHot: read('--backdrop-gold-hot', '#8f7530'),
    glyph: read('--backdrop-glyph', '#3d7d85'),
    arc: read('--backdrop-arc', '#7a5cc4')
  };
}

/* ---------- sizing ---------- */

function dpr() {
  return Math.min(window.devicePixelRatio || 1, MAX_DPR);
}

function resizeGL() {
  const cssW = window.innerWidth || 360;
  const cssH = window.innerHeight || 640;
  let scale = dpr();
  if (cssW * cssH * scale * scale > MAX_GL_PIXELS) scale = Math.sqrt(MAX_GL_PIXELS / (cssW * cssH));
  const w = Math.max(8, Math.round(cssW * scale));
  const h = Math.max(8, Math.round(cssH * scale));
  if (w === glDims.w && h === glDims.h) return;
  glCanvas.width = w;
  glCanvas.height = h;
  glDims = { w, h };
  glr.resize(w, h);
}

/** The band the GL scenes frame their graphic into, in NDC [bottom, top]. Same
 *  geometry as featureBand(): bottom third, less the tab bar. */
function glBand() {
  if (fullView) return skin === 'fractal' ? [-1, 1] : [-0.74, 0.8];   // the fractal is the whole view
  const cssH = window.innerHeight || 640;
  const inset = Math.min(cssH * 0.14, TABBAR_CSS_PX);
  return [-1 + (2 * inset) / cssH, -1 / 3];
}

function resize() {
  if (!canvas || !skin) return;
  if (usingGL()) { resizeGL(); return; }   // the 2D buffers (and its CPU Mandelbrot) are only built if needed
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

  // Kemet night sky. Only the top two thirds — the pyramid owns the rest.
  stars = Array.from({ length: 34 }, () => ({
    x: Math.random() * w,
    y: Math.random() * h * 0.66,
    size: Math.random() < 0.2 ? 2 : 1,
    alpha: 0.25 + Math.random() * 0.5,
    phase: Math.random() * Math.PI * 2
  }));

  // Neon hieroglyph marks, positioned in pyramid tier space so they ride the
  // geometry: tier index + a horizontal offset within that tier's width.
  glyphs = Array.from({ length: 22 }, () => ({
    tier: Math.floor(Math.random() * STREAK_LEVELS),
    across: Math.random() * 1.4 - 0.7,
    kind: Math.floor(Math.random() * 3),
    phase: Math.random() * Math.PI * 2
  }));

  mandelbrot = skin === 'fractal' ? buildMandelbrot() : null;

  boltTrack = makeBoltTrack();
  haloTrack = makeBoltTrack();
  lastFlashAt = -Infinity;
  flashLimiter.reset();                  // the clock restarts at 0, so old grants must go
}

/* ---------- Mandelbrot (rendered once, drawn every frame) ---------- */

/** Escape-time Mandelbrot into an offscreen canvas.
 *
 *  Two buffers get built, at different iteration ceilings: `low` is coarse and
 *  soft, `high` resolves the filaments around the set's edge. Cross-fading
 *  between them by streak level is what "faint and low-detail → vivid and
 *  sharply resolved" actually is — a real change in resolved structure, not
 *  the same image at two opacities.
 *
 *  Cost lives entirely here, at seed/resize time. The frame loop only ever
 *  calls drawImage on the result. */
function renderMandelbrot(w, h, maxIter, colour) {
  let off;
  try {
    off = document.createElement('canvas');
    off.width = w;
    off.height = h;
  } catch {
    return null;
  }
  const octx = off.getContext('2d');
  if (!octx) return null;

  const img = octx.createImageData(w, h);
  const data = img.data;
  const [cr, cg, cb] = colour;

  // A view of the classic set, letterboxed to the buffer's aspect.
  const centreX = -0.62;
  const halfW = 1.45;
  const halfH = halfW * (h / w);

  // The buffer is a hard-edged rectangle sitting on a soft background, so its
  // top and bottom rows read as a ruled line across the screen unless they
  // fade out. Baked in here rather than masked per frame — it never changes.
  const feather = new Float64Array(h);
  const topFade = Math.max(1, h * 0.20);
  const bottomFade = Math.max(1, h * 0.10);
  for (let py = 0; py < h; py += 1) {
    const fromTop = Math.min(1, py / topFade);
    const fromBottom = Math.min(1, (h - 1 - py) / bottomFade);
    feather[py] = Math.min(fromTop, fromBottom) ** 1.4;
  }

  for (let py = 0; py < h; py += 1) {
    const y0 = (py / h - 0.5) * 2 * halfH;
    for (let px = 0; px < w; px += 1) {
      const x0 = centreX + (px / w - 0.5) * 2 * halfW;
      let x = 0;
      let y = 0;
      let i = 0;
      while (x * x + y * y <= 4 && i < maxIter) {
        const xt = x * x - y * y + x0;
        y = 2 * x * y + y0;
        x = xt;
        i += 1;
      }
      // Inside the set reads solid; outside fades off by escape time, so the
      // silhouette is unmistakable and the filaments are a bonus at high detail.
      const t = i >= maxIter ? 1 : (i / maxIter) ** 0.55;
      const idx = (py * w + px) * 4;
      data[idx] = cr;
      data[idx + 1] = cg;
      data[idx + 2] = cb;
      data[idx + 3] = Math.round(255 * t * feather[py]);
    }
  }
  octx.putImageData(img, 0, 0);
  return off;
}

function buildMandelbrot() {
  const band = featureBand();
  const w = Math.max(8, Math.round(band.w));
  const h = Math.max(8, Math.round(band.h));
  const low = renderMandelbrot(w, h, 14, palette.bloomB);
  const high = renderMandelbrot(w, h, 96, palette.ink);
  return low && high ? { low, high, w, h } : null;
}

/* ---------- shared drawing helpers ---------- */

/** Midpoint-displacement polyline — a cheap way to get an irregular, jagged
 *  path without real physics. */
function displace(x0, y0, x1, y1, depth, amp) {
  if (depth <= 0) return [{ x: x0, y: y0 }, { x: x1, y: y1 }];
  const mx = (x0 + x1) / 2 + (Math.random() - 0.5) * amp;
  const my = (y0 + y1) / 2 + (Math.random() - 0.5) * amp * 0.6;
  const left = displace(x0, y0, mx, my, depth - 1, amp * 0.55);
  const right = displace(mx, my, x1, y1, depth - 1, amp * 0.55);
  return [...left.slice(0, -1), ...right];
}

function strokePath(points, colour, alpha, width = 1) {
  ctx.strokeStyle = rgba(colour, alpha);
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
}

/** Smooth 0→1 ramp. Used for every month-percent threshold, so crossing 25%
 *  eases in rather than snapping from nothing to visible. */
function smoothstep(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Schedules once, then re-schedules itself every time a flash finishes.
 *  Interval shortens with intensity but never below LIGHTNING.minIntervalS at
 *  any intensity — the flicker-hazard cap holds at maximum, not just on
 *  average. `makeBolt` supplies the layer-specific geometry.
 *
 *  Two gates, not one: the track's own `nextAt`, and the skin-wide
 *  `lastFlashAt`. The second is what makes the cap a statement about what
 *  reaches the eye — with the halo track running alongside the pyramid track,
 *  per-track floors alone would allow two flashes back to back. */
function maybeStrikeBolt(track, t, intensity, makeBolt) {
  if (track.nextAt === 0) { track.nextAt = t + LIGHTNING.maxIntervalS * 0.4; return; }
  if (track.bolt) return;
  if (t < track.nextAt) return;
  if (t - lastFlashAt < LIGHTNING.minIntervalS) return;    // another layer just flashed
  if (!flashLimiter.request(t * 1000)) return;             // belt and braces: the shared 3-per-second cap

  track.bolt = { bornAt: t, ...makeBolt(intensity) };
  track.flashes += 1;
  lastFlashAt = t;

  const span = LIGHTNING.maxIntervalS - LIGHTNING.minIntervalS;
  track.nextAt = t + Math.max(
    LIGHTNING.minIntervalS,
    LIGHTNING.maxIntervalS - span * intensity + (Math.random() - 0.5) * 1.5
  );
}

function drawBolt(track, t, colour, peak) {
  if (!track.bolt) return;
  const age = t - track.bolt.bornAt;
  if (age > LIGHTNING.durationS) { track.bolt = null; return; }
  const envelope = 1 - age / LIGHTNING.durationS;         // quick linear fade
  strokePath(track.bolt.points, colour, peak * envelope);
  for (const branch of track.bolt.branches) strokePath(branch, colour, peak * envelope * 0.7);
}

/* ---------- Terminal ---------- */

/** A soft grid pulse with data streams drifting down it. Terminal wasn't in
 *  the original brief as consistency-responsive, but a flat ambient texture
 *  reads as "nothing changed" exactly when someone is looking for a reward for
 *  showing up — so streams fall faster and brighter, and more of them draw in
 *  the brightest colour bucket, as the streak builds.
 *
 *  Colour variety without ever blending two tokens: each stream is permanently
 *  assigned to draw --backdrop-stream, --backdrop-stream-2 or --backdrop-ink
 *  outright, via its seeded hueSeed. Only the *bucket boundary* moves with
 *  glow, never the colour itself. */
function drawTerminal(t) {
  const { w, h } = dims;
  ctx.fillStyle = rgba(palette.base, 1);
  ctx.fillRect(0, 0, w, h);

  const glow = activity.glow;
  const brightness = 0.85 + glow * 0.65;
  const speedMul = 1 + glow * 0.85;
  const inkShare = 0.12 + glow * 0.38;

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
    const colour = s.hueSeed < inkShare
      ? palette.ink
      : (s.hueSeed < inkShare + 0.44 ? palette.stream2 : palette.stream);
    const alpha = Math.min(s.alpha * brightness, 0.92);
    const grad = ctx.createLinearGradient(0, y, 0, y + s.len);
    grad.addColorStop(0, rgba(colour, 0));
    grad.addColorStop(0.6, rgba(colour, alpha));
    grad.addColorStop(1, rgba(colour, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(s.x, y, 3, s.len);
  }
}

/* ---------- Fractal ---------- */

/** Slow organic blooms in the upper area, the Mandelbrot set as a focal
 *  graphic in the bottom third, and lightning through both.
 *
 *  The Mandelbrot's *clarity* is the streak-responsive part: a cross-fade from
 *  the coarse buffer to the high-iteration one, plus rising opacity, so the
 *  structure genuinely resolves as the level climbs rather than merely
 *  brightening. Both buffers are pre-rendered — see renderMandelbrot(). */
function drawFractal(t) {
  const { w, h } = dims;
  ctx.fillStyle = rgba(palette.base, 1);
  ctx.fillRect(0, 0, w, h);

  const clarity = activity.streakFraction;
  const lift = 0.55 + activity.glow * 0.45;
  const blooms = [
    { c: palette.bloomA, fx: 0.30, fy: 0.20, sx: 0.11, sy: 0.07, r: 0.50 },
    { c: palette.bloomB, fx: 0.74, fy: 0.34, sx: 0.09, sy: 0.10, r: 0.44 },
    { c: palette.bloomA, fx: 0.18, fy: 0.48, sx: 0.07, sy: 0.12, r: 0.30 }
  ];

  const slow = t * 0.0785;                       // a full cycle takes ~80s: ambient, not busy
  for (const [i, b] of blooms.entries()) {
    const cx = (b.fx + Math.sin(slow + i * 1.7) * b.sx) * w;
    const cy = (b.fy + Math.cos(slow * 0.83 + i * 2.1) * b.sy) * h;
    const radius = b.r * Math.max(w, h) * (0.85 + 0.15 * Math.sin(slow * 1.3 + i));
    fillRadialBounded(cx, cy, radius, (grad) => {
      grad.addColorStop(0, rgba(b.c, 0.62 * lift));
      grad.addColorStop(1, rgba(b.c, 0));
    });
  }

  if (mandelbrot) {
    const band = featureBand();
    // A slow drift so it breathes; frozen automatically in static mode, since
    // `clock` stops advancing there.
    const driftX = Math.sin(slow * 0.7) * band.w * 0.02;
    const driftY = Math.cos(slow * 0.9) * band.h * 0.02;
    const x = driftX;
    const y = band.y + driftY;

    ctx.globalAlpha = 0.34 + 0.30 * (1 - clarity);      // coarse buffer dominates when quiet
    ctx.drawImage(mandelbrot.low, x, y, band.w, band.h);
    ctx.globalAlpha = 0.16 + 0.68 * clarity;            // resolved buffer takes over as it climbs
    ctx.drawImage(mandelbrot.high, x, y, band.w, band.h);
    ctx.globalAlpha = 1;
  }

  maybeStrikeBolt(boltTrack, t, activity.glow, () => {
    const x0 = w * (0.15 + Math.random() * 0.7);
    const y1 = h * (0.5 + Math.random() * 0.3);
    const points = displace(x0, 0, x0 + (Math.random() - 0.5) * w * 0.12, y1, 4, w * 0.06);
    const branchCount = Math.round(activity.glow * LIGHTNING.maxBranches);
    const branches = [];
    for (let i = 0; i < branchCount; i += 1) {
      const from = points[1 + Math.floor(Math.random() * (points.length - 2))];
      const to = {
        x: from.x + (Math.random() - 0.5) * w * 0.18,
        y: Math.min(h, from.y + h * (0.15 + Math.random() * 0.2))
      };
      branches.push(displace(from.x, from.y, to.x, to.y, 2, w * 0.05));
    }
    return { points, branches };
  });
  drawBolt(boltTrack, t, palette.ink, 0.20 + activity.glow * 0.40);
}

/* ---------- Forge ---------- */

function roundedRectPath(x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/** The Forge bar heat ramp: dull red → orange → yellow → white-hot.
 *
 *  Returns at most two adjacent stops with weights summing to 1, so the caller
 *  draws two plain source-over fills of *declared tokens* rather than blending
 *  toward a computed colour. Same reasoning as Terminal's stream buckets: an
 *  alpha-weighted stack of two tokens is a convex combination and therefore
 *  provably inside [--backdrop-base, --backdrop-ink], where a `mix()` of two
 *  arbitrary colours would need its own luminance proof. */
const HEAT_STOPS = ['heatA', 'heatB', 'heatC', 'ink'];

function heatRamp(t) {
  const scaled = Math.min(Math.max(t, 0), 1) * (HEAT_STOPS.length - 1);
  const i = Math.min(Math.floor(scaled), HEAT_STOPS.length - 2);
  const f = scaled - i;
  return [{ key: HEAT_STOPS[i], weight: 1 - f }, { key: HEAT_STOPS[i + 1], weight: f }];
}

/** A bar segment glowing at `heatT` along the ramp, at `intensity` strength.
 *
 *  The bloom is drawn as the shape itself, inflated in a couple of steps with
 *  falling alpha, rather than a radial gradient. A radial gradient only suits
 *  one aspect ratio: centred on the long horizontal rod it either fails to
 *  reach the ends or throws a halo wide enough to wash out the vertical bars,
 *  and centred on a tall vertical bar it lights a circle in the middle and
 *  leaves the ends cold. An inflated outline follows whatever shape it is
 *  given, so the rod and the vertical bars both glow along their length. */
function drawHeatBar(x, y, w, h, r, heatT, intensity) {
  const strength = Math.min(Math.max(intensity, 0), 1);
  if (strength <= 0.001) return;
  const stops = heatRamp(heatT);
  const spread = Math.max(2, Math.min(w, h) * 0.9);

  for (const { key, weight } of stops) {
    if (weight <= 0.001) continue;
    const colour = palette[key];

    for (const [grow, alpha] of [[2.0, 0.05], [1.0, 0.10]]) {
      const pad = spread * grow;
      roundedRectPath(x - pad, y - pad, w + pad * 2, h + pad * 2, r + pad);
      ctx.fillStyle = rgba(colour, Math.min(alpha * weight * strength, 1));
      ctx.fill();
    }

    // The metal itself.
    roundedRectPath(x, y, w, h, r);
    ctx.fillStyle = rgba(colour, Math.min((0.30 + 0.55 * heatT) * weight * strength, 1));
    ctx.fill();
  }
}

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

/** An oversized barbell as a focal graphic in the bottom third, warmed by
 *  consistency and *sharpened* by streak level.
 *
 *  Two scales are at work and they are deliberately different inputs: `heat`
 *  (from the consistency glow, damped by any frost hint) drives the forge glow,
 *  ember density and the flame lick, exactly as before; `clarity` (from the
 *  streak level) drives how solidly and crisply the barbell itself renders —
 *  dim and soft at low levels, bright and sharply edged at high ones.
 *
 *  The barbell is always drawn, at any level: a fresh account with no history
 *  still gets an unmistakable silhouette, because a graphic that scales to
 *  nothing is invisible exactly when someone first opens the app. */
function drawForge(t) {
  const { w, h } = dims;
  ctx.fillStyle = rgba(palette.base, 1);
  ctx.fillRect(0, 0, w, h);

  const heat = Math.min(Math.max(activity.glow * (1 - 0.35 * activity.frostHint), 0), 1);
  const clarity = activity.streakFraction;
  const band = featureBand();
  const cx = w * 0.5;
  const cy = band.y + band.h * 0.46;
  const barW = w * 0.78;
  const barH = Math.max(4, band.h * 0.11);

  // Forge glow behind the bar — breathes very slowly, never pulses.
  const breathe = 0.9 + 0.1 * Math.sin(t * 0.22);
  const hot = mix(palette.ember, palette.glow, heat);
  const glowR = Math.max(w, band.h * 2) * (0.34 + heat * 0.26) * breathe;
  fillRadialBounded(cx, cy, glowR, (grad) => {
    grad.addColorStop(0, rgba(hot, (0.22 + heat * 0.53) * breathe));
    grad.addColorStop(0.55, rgba(hot, (0.09 + heat * 0.24) * breathe));
    grad.addColorStop(1, rgba(hot, 0));
  });

  // The barbell: a bar, two inner plates, two outer plates. Fill and edge both
  // climb with clarity — that is the "dim and softly defined → bright and
  // sharply rendered" the brief asks for.
  const iron = mix(palette.iron, hot, heat * 0.45);
  const edge = mix(iron, palette.glow, 0.4);
  const fillAlpha = 0.5 + 0.42 * clarity;
  const edgeAlpha = 0.16 + 0.5 * clarity;

  ironShape(cx - barW / 2, cy - barH / 2, barW, barH, barH / 2, iron, fillAlpha, edge, edgeAlpha);

  const innerW = barW * 0.085;
  const innerH = band.h * 0.62;
  const outerW = barW * 0.065;
  const outerH = band.h * 0.40;

  /* The vertical bars either side of the rod. Collected rather than drawn
   * inline because the month-to-date layer below needs the same geometry —
   * these are the pieces that carry most of the white-hot glow. */
  const verticals = [];
  for (const dir of [-1, 1]) {
    verticals.push({ x: cx + dir * barW * 0.34 - innerW / 2, y: cy - innerH / 2, w: innerW, h: innerH });
    verticals.push({ x: cx + dir * barW * 0.45 - outerW / 2, y: cy - outerH / 2, w: outerW, h: outerH });
  }
  for (const v of verticals) {
    ironShape(v.x, v.y, v.w, v.h, Math.min(v.w, v.h) * 0.28, iron, fillAlpha, edge, edgeAlpha);
  }

  // ---- month-to-date layer: the bars run white-hot ----
  // Independent of `heat` above, which is streak-driven. This is the metal
  // heating up with how much of the month has been trained, climbing dull red →
  // orange → yellow → white so the top of the range reads as earned rather than
  // switched on. See drawHeatBar().
  //
  // The vertical bars carry the stronger glow: they are the tallest, most
  // readable pieces of the barbell, and a rod-only glow left them looking cold
  // next to a white-hot bar.
  const monthGlow = smoothstep(0.15, 0.30, activity.monthPercent);
  if (monthGlow > 0) {
    const heatT = Math.min(Math.max((activity.monthPercent - 0.22) / (0.95 - 0.22), 0), 1);
    drawHeatBar(cx - barW / 2, cy - barH / 2, barW, barH, barH / 2, heatT, monthGlow);
    for (const v of verticals) {
      drawHeatBar(v.x, v.y, v.w, v.h, Math.min(v.w, v.h) * 0.28, heatT, monthGlow * 1.35);
    }
  }

  // Embers: a few always drift, more join and burn brighter as the forge heats.
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

  // Flame lick above the bar — absent below FLAME_START_HEAT, ramping to a soft
  // sustained flicker at full heat. Slow sine flicker only, no strobe.
  const flameT = Math.max(0, (heat - FLAME_START_HEAT) / (1 - FLAME_START_HEAT));
  if (flameT > 0) {
    const flameColor = mix(palette.ember, palette.glow, 0.6 + 0.4 * flameT);
    const lickCount = flameT > 0.6 ? 4 : 3;
    for (let i = 0; i < lickCount; i += 1) {
      const flicker = 0.85 + 0.15 * Math.sin(t * 0.9 + i * 2.1);
      const fx = cx + (i - (lickCount - 1) / 2) * barW * 0.09;
      const fy = cy - barH * 0.6 - flameT * band.h * 0.16 * (1 + 0.3 * Math.sin(t * 0.6 + i));
      const fr = (band.h * 0.14 + flameT * band.h * 0.16) * flicker;
      fillRadialBounded(fx, fy, fr, (grad) => {
        grad.addColorStop(0, rgba(flameColor, 0.5 * flameT * flicker));
        grad.addColorStop(1, rgba(flameColor, 0));
      });
    }
  }
}

/* ---------- Kemet ---------- */

/** Pyramid geometry in backing-store space. `t` runs 0 at the base to 1 at the
 *  apex, so a tier is the slab between two t values. */
function pyramidGeometry() {
  const band = featureBand();
  const baseY = band.y + band.h;
  return {
    cx: dims.w * 0.5,
    baseY,
    height: band.h,
    halfBase: dims.w * 0.44
  };
}

function tierTrapezoid(g, index) {
  const t0 = index / STREAK_LEVELS;
  const t1 = (index + 1) / STREAK_LEVELS;
  return {
    yBottom: g.baseY - t0 * g.height,
    yTop: g.baseY - t1 * g.height,
    halfBottom: g.halfBase * (1 - t0),
    halfTop: g.halfBase * (1 - t1)
  };
}

function tierPath(g, index) {
  const { yBottom, yTop, halfBottom, halfTop } = tierTrapezoid(g, index);
  ctx.beginPath();
  ctx.moveTo(g.cx - halfBottom, yBottom);
  ctx.lineTo(g.cx + halfBottom, yBottom);
  ctx.lineTo(g.cx + halfTop, yTop);
  ctx.lineTo(g.cx - halfTop, yTop);
  ctx.closePath();
}

/** Cyberpunk Egypt: night sky, neon hieroglyphs, and a ten-tier Pyramid of
 *  Power that lights up cumulatively with the streak level.
 *
 *  Discrete tiers are the whole point — a continuous glow tells a beginner
 *  nothing, whereas "one more block lit up" is countable progress. Tiers ease
 *  rather than snap (see settleTiers), and lit tiers stay lit while the level
 *  holds; a level that eases down dims them gradually instead of switching
 *  them off. */
function drawKemet(t) {
  const { w, h } = dims;
  const fraction = activity.streakFraction;

  // Night sky: base at the horizon, --backdrop-sky overhead.
  const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
  skyGrad.addColorStop(0, rgba(palette.sky, 1));
  skyGrad.addColorStop(0.62, rgba(palette.base, 1));
  skyGrad.addColorStop(1, rgba(palette.base, 1));
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, w, h);

  for (const s of stars) {
    const twinkle = 0.7 + 0.3 * Math.sin(t * 0.5 + s.phase);
    ctx.fillStyle = rgba(palette.star, s.alpha * twinkle * 0.55);
    ctx.fillRect(s.x, s.y, s.size, s.size);
  }

  const g = pyramidGeometry();

  // Unlit stone first, whole silhouette — the pyramid is always fully visible,
  // whatever the level; the tiers change how much of it is *lit*, not whether
  // there is a pyramid there at all.
  ctx.beginPath();
  ctx.moveTo(g.cx - g.halfBase, g.baseY);
  ctx.lineTo(g.cx + g.halfBase, g.baseY);
  ctx.lineTo(g.cx, g.baseY - g.height);
  ctx.closePath();
  ctx.fillStyle = rgba(palette.stone, 0.82);
  ctx.fill();
  ctx.strokeStyle = rgba(palette.glyph, 0.3);
  ctx.lineWidth = 1;
  ctx.stroke();

  // Lit tiers, bottom up. Gold at the tier's own eased glow, then a hotter gold
  // layered on as the overall level climbs — both plain source-over fills of
  // declared tokens, so the stack stays inside the proven range.
  for (let i = 0; i < STREAK_LEVELS; i += 1) {
    const lit = tierGlow[i];
    if (lit <= 0.001) continue;
    tierPath(g, i);
    ctx.fillStyle = rgba(palette.gold, lit * (0.5 + 0.35 * fraction));
    ctx.fill();
    if (fraction > 0) {
      ctx.fillStyle = rgba(palette.goldHot, lit * fraction * 0.45);
      ctx.fill();
    }
  }

  // Tier seams — reads as courses of stone, and makes the count legible.
  ctx.strokeStyle = rgba(palette.glyph, 0.22 + 0.18 * fraction);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < STREAK_LEVELS; i += 1) {
    const { yBottom, halfBottom } = tierTrapezoid(g, i);
    ctx.moveTo(g.cx - halfBottom, yBottom + 0.5);
    ctx.lineTo(g.cx + halfBottom, yBottom + 0.5);
  }
  ctx.stroke();

  // Neon hieroglyph marks on lit tiers only.
  for (const mark of glyphs) {
    const lit = tierGlow[mark.tier];
    if (lit <= 0.05) continue;
    const { yBottom, yTop, halfBottom } = tierTrapezoid(g, mark.tier);
    const midY = (yBottom + yTop) / 2;
    const x = g.cx + mark.across * halfBottom * 0.8;
    const size = Math.max(1.5, g.height * 0.022);
    const pulse = 0.55 + 0.45 * Math.sin(t * 0.8 + mark.phase);
    ctx.fillStyle = rgba(palette.glyph, lit * pulse * 0.55);
    if (mark.kind === 0) ctx.fillRect(x - size / 2, midY - size / 2, size, size);
    else if (mark.kind === 1) ctx.fillRect(x - size / 2, midY - size * 0.15, size, size * 0.3);
    else ctx.fillRect(x - size * 0.15, midY - size / 2, size * 0.3, size);
  }

  // Apex spark — only once the pyramid is genuinely near complete.
  if (fraction > 0.85) {
    const crown = (fraction - 0.85) / 0.15;
    fillRadialBounded(g.cx, g.baseY - g.height, g.height * 0.22, (grad) => {
      grad.addColorStop(0, rgba(palette.star, 0.42 * crown * (0.8 + 0.2 * Math.sin(t * 0.6))));
      grad.addColorStop(1, rgba(palette.star, 0));
    });
  }

  // Lightning crawl across the pyramid face — sparse and faint when the level
  // is low, dense and bright when it is high, under the shared flash cap.
  maybeStrikeBolt(boltTrack, t, fraction, () => {
    const side = Math.random() < 0.5 ? -1 : 1;
    const startT = Math.random() * 0.35;
    const endT = Math.min(1, startT + 0.35 + Math.random() * 0.45);
    const startHalf = g.halfBase * (1 - startT);
    const endHalf = g.halfBase * (1 - endT);
    const points = displace(
      g.cx + side * startHalf * (0.2 + Math.random() * 0.8), g.baseY - startT * g.height,
      g.cx + side * endHalf * (0.1 + Math.random() * 0.6), g.baseY - endT * g.height,
      4, g.halfBase * 0.10
    );
    const branchCount = Math.round(fraction * LIGHTNING.maxBranches);
    const branches = [];
    for (let i = 0; i < branchCount; i += 1) {
      const from = points[1 + Math.floor(Math.random() * (points.length - 2))];
      branches.push(displace(
        from.x, from.y,
        from.x + (Math.random() - 0.5) * g.halfBase * 0.5, from.y + g.height * (0.05 + Math.random() * 0.15),
        2, g.halfBase * 0.07
      ));
    }
    return { points, branches };
  });
  drawBolt(boltTrack, t, palette.arc, 0.22 + fraction * 0.45);

  drawHalo(t, g);
}

/**
 * The month-to-date halo above the pyramid apex — a second, independent layer
 * over the streak-driven tiers below it.
 *
 * Three staged bands, all eased with smoothstep so crossing a threshold fades
 * in rather than snapping (24% → 25% must not be a hard cut):
 *   ~25%   a faint ring appears, dropping small golden sparks
 *   ~50%   it brightens, and lightning crawls within the ring itself
 *   90%+   brightest; sparks spill past the ring, and arcs strike down from the
 *          halo to the pyramid — a connection, not just ambient crawl
 *
 * The halo's lightning is its own track, so it is genuinely distinct from the
 * pyramid-surface crawl — but both clear the shared `lastFlashAt` gate, so the
 * flicker cap applies to what the eye sees rather than per layer.
 */
function drawHalo(t, g) {
  const mp = activity.monthPercent;
  const presence = smoothstep(0.15, 0.30, mp);
  if (presence <= 0.001) return;

  const brighten = smoothstep(0.42, 0.58, mp);
  const strike = smoothstep(0.82, 0.92, mp);

  const apexX = g.cx;
  const apexY = g.baseY - g.height;
  const breathe = 0.9 + 0.1 * Math.sin(t * 0.35);

  /* A flattened torus, not a circle. Two reasons for the ellipse: a true circle
   * above the apex reads as a drawn ring with a hole punched in the middle
   * rather than a halo, and a circle wide enough to look deliberate is also
   * tall enough to reach the card panel above it — which would force either
   * overlapping the UI or shortening the pyramid to make room. Flattening buys
   * the width without the height, so it sits in the gap and the pyramid keeps
   * its full ten tiers. */
  const ringRX = g.halfBase * (0.46 + 0.06 * brighten);
  const ringRY = ringRX * 0.32;
  const ringY = apexY - ringRY - g.height * 0.08;         // clear of the apex

  const ellipsePath = (rx, ry) => {
    ctx.beginPath();
    if (typeof ctx.ellipse === 'function') ctx.ellipse(apexX, ringY, rx, ry, 0, 0, Math.PI * 2);
    else ctx.arc(apexX, ringY, rx, 0, Math.PI * 2);
  };

  /* The torus is one radial gradient with a transparent core and a bright band,
   * drawn through a y-scale so it comes out elliptical.
   *
   * The obvious implementation — several concentric strokes of the ring at
   * decreasing width — looked right and cost 10.8% of a core, double the
   * budget, dropping Kemet to 16fps: stroking an ellipse with a ~32px line is a
   * large antialiased fill, and there were four of them a frame. A gradient
   * with the band shaped into its colour stops draws the same thing in a single
   * fill over a rect the size of the torus. Caught by `npm run skins`, which is
   * why that gate runs on every acceptance pass rather than once per feature.
   *
   * `strike` feeds brightness as well as the connecting arcs: the brief calls
   * for the halo to be "at its brightest" in the 90–100% band, and an earlier
   * pass had `brighten` saturating at 58%, so the top forty points of the range
   * added sparks and arcs but no actual light. */
  const lift = presence * breathe;
  const body = Math.min((0.20 + 0.16 * brighten + 0.16 * strike) * lift, 1);
  const core = Math.min(0.20 * (0.5 + brighten + 0.9 * strike) * lift, 1);

  ctx.save();
  ctx.translate(apexX, ringY);
  ctx.scale(1, ringRY / ringRX);
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, ringRX * 1.5);
  grad.addColorStop(0, rgba(palette.halo, body * 0.10));      // hollow centre — a torus, not a disc
  grad.addColorStop(0.42, rgba(palette.halo, body * 0.22));
  grad.addColorStop(0.63, rgba(palette.haloHot, core));        // the band itself
  grad.addColorStop(0.74, rgba(palette.halo, body));
  grad.addColorStop(1, rgba(palette.halo, 0));                 // falls off outward
  ctx.fillStyle = grad;
  ctx.fillRect(-ringRX * 1.5, -ringRX * 1.5, ringRX * 3, ringRX * 3);
  ctx.restore();

  // A single thin rim keeps the torus's edge crisp against the sky.
  ctx.strokeStyle = rgba(palette.haloHot, Math.min((0.12 + 0.20 * brighten) * lift, 1));
  ctx.lineWidth = Math.max(1, ringRY * 0.16);
  ellipsePath(ringRX * 0.95, ringRY * 0.95);
  ctx.stroke();

  // Golden sparks falling from the ring toward the apex. At 90%+ they also
  // spill outward past the ring's edge rather than staying inside it.
  /** A point on the torus at angle `a`, optionally scaled off the band. */
  const onRing = (a, scale = 1) => ({
    x: apexX + Math.cos(a) * ringRX * scale,
    y: ringY + Math.sin(a) * ringRY * scale
  });

  const sparkCount = Math.round(5 + 9 * presence + 4 * strike);
  const spill = 1 + 0.55 * strike;
  for (let i = 0; i < sparkCount; i += 1) {
    const phase = (i * 2.399) % (Math.PI * 2);              // stable, evenly scattered
    const drop = ((t * 0.22 + i / sparkCount) % 1);
    const p = onRing(phase + t * 0.05, spill * (0.7 + 0.3 * Math.sin(phase * 3)));
    const fade = Math.sin(drop * Math.PI);                  // in and out, never a pop
    const size = Math.max(1, g.height * 0.012);
    ctx.fillStyle = rgba(palette.haloHot, 0.55 * presence * fade * breathe);
    ctx.fillRect(p.x, p.y + drop * g.height * 0.26, size, size);
  }

  // Halo lightning. Below the 90% band it crawls around the ring; in it, most
  // flashes become a connecting arc down to the pyramid.
  maybeStrikeBolt(haloTrack, t, brighten, () => {
    const connecting = strike > 0 && Math.random() < strike;
    if (connecting) {
      const from = onRing(Math.random() * Math.PI * 2, 0.9);
      const landT = Math.random() * 0.5;                    // somewhere on the upper pyramid
      const to = {
        x: g.cx + (Math.random() - 0.5) * g.halfBase * (1 - landT) * 1.2,
        y: g.baseY - (1 - landT) * g.height
      };
      return { points: displace(from.x, from.y, to.x, to.y, 4, g.halfBase * 0.09), branches: [] };
    }
    const a0 = Math.random() * Math.PI * 2;
    const a1 = a0 + (0.6 + Math.random() * 1.1) * (Math.random() < 0.5 ? -1 : 1);
    const from = onRing(a0);
    const to = onRing(a1);
    return { points: displace(from.x, from.y, to.x, to.y, 3, ringRY * 0.7), branches: [] };
  });
  drawBolt(haloTrack, t, palette.haloHot, (0.25 + 0.40 * brighten) * presence);
}

/* ---------- tier easing ---------- */

/** Eases each tier toward lit/unlit. Up and down rates differ on purpose: a
 *  light-up should feel like an event, a dim-down should not. */
function settleTiers(dt) {
  const level = activity.streakLevel;
  for (let i = 0; i < STREAK_LEVELS; i += 1) {
    const target = i < level ? 1 : 0;
    if (tierGlow[i] < target) tierGlow[i] = Math.min(target, tierGlow[i] + dt / TIER_UP_SECONDS);
    else if (tierGlow[i] > target) tierGlow[i] = Math.max(target, tierGlow[i] - dt / TIER_DOWN_SECONDS);
  }
}

/** Static mode still has to show the *correct* lit tiers — a reduced-motion
 *  user gets the information, just not the transition. */
function snapTiers() {
  const level = activity.streakLevel;
  for (let i = 0; i < STREAK_LEVELS; i += 1) tierGlow[i] = i < level ? 1 : 0;
}

/* ---------- loop ---------- */

const RENDERERS = { terminal: drawTerminal, fractal: drawFractal, forge: drawForge, kemet: drawKemet };

const rand = Math.random;

function draw() {
  if (!skin) return;
  if (usingGL()) {
    let drawn = false;
    try {
      drawn = glr.render({
      skin,
      t: clock,
      still: isStatic(),
      palette,
      tierGlow,
      level: shown.level,
      month: shown.month,
      glow: shown.glow,
      heat: shown.heat,
      k: shown.k,
      spin,
      band: glBand(),
      full: fullView,
      dpr: glDims.w / Math.max(window.innerWidth || 1, 1),
      limiter: flashLimiter,
      rand
      });
    } catch (error) {
      // A scene that cannot build or draw hands over to the 2D renderer for
      // good — never a frozen or blank background.
      console.warn('WebGL2 backdrop failed; using the 2D renderer.', error);
      glr = null;
      markRenderer();
      dims = { w: 0, h: 0 };
      resize();
      return draw();
    }
    if (drawn) frames += 1;
    return;
  }
  if (!ctx) return;
  const render = RENDERERS[skin];
  if (!render) return;
  render(clock);
  frames += 1;
}

/** The values the scene shows, eased toward the live metrics. Static mode
 *  snaps them, the same way snapTiers() does for the pyramid. */
function targets() {
  const heat = Math.min(Math.max(activity.glow * (1 - 0.35 * activity.frostHint), 0), 1);
  return { level: activity.streakFraction, month: activity.monthPercent, glow: activity.glow, heat };
}

function settleShown(dt) {
  const t = targets();
  for (const key of Object.keys(t)) shown[key] = dt === null ? t[key] : approach(shown[key], t[key], dt);
  shown.k = intensity({ streakLevel: shown.level * STREAK_LEVELS, monthPercent: shown.month });
  if (dt !== null && !dragging) spin = (spin + rotationSpeed(shown.k) * dt) % (Math.PI * 2);
}

function loop(timestamp) {
  if (!shouldRun()) { raf = 0; return; }
  raf = requestAnimationFrame(loop);

  const elapsed = timestamp - lastFrameAt;
  const frameMs = fullView ? 1000 / FULL_VIEW_FPS : FRAME_MS;
  if (elapsed < frameMs - 1) return;       // 30fps cap (60 in the full-screen view)
  const dt = Math.min(elapsed / 1000, 0.1);
  lastFrameAt = timestamp;
  clock += dt;
  settleTiers(dt);
  settleShown(dt);
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
    snapTiers();
    settleShown(null);
    draw();                                // exactly one frame, held
    return;
  }
  if (!shouldRun()) { stopLoop(); return; }
  startLoop();
}

/* ---------- public API ---------- */

/** Marks which canvas is live, so css/styles.css shows exactly one of them. */
function markRenderer() {
  document.documentElement.setAttribute('data-renderer', glr ? 'webgl' : '2d');
}

let glTried = false;

/** Created on the first glass skin, not at boot: Light and Neon never pay for a
 *  WebGL context or a single shader compile. */
function ensureGL() {
  if (glTried || !glCanvas) return;
  glTried = true;
  if (new URLSearchParams(location.search).get('renderer') === '2d') return;
  glr = createGLBackdrop(glCanvas);
  markRenderer();
  if (!glr) return;
  // Context loss: hand over to the 2D renderer at once (never a frozen or
  // blank frame), then rebuild every GPU resource when the context returns.
  glCanvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    glr?.lost();
    held = glr;
    glr = null;
    markRenderer();
    dims = { w: 0, h: 0 };
    sync();
  });
  glCanvas.addEventListener('webglcontextrestored', () => {
    if (!held?.restore()) return;
    glr = held;
    held = null;
    glDims = { w: 0, h: 0 };
    markRenderer();
    sync();
  });
}

function mountGL(element) {
  glCanvas = element;
}
let held = null;                     // the GL renderer while its context is lost

export function mount(element, glElement = null) {
  canvas = element;
  if (!canvas) return;
  ctx = canvas.getContext('2d', { alpha: false });
  mountGL(glElement);
  markRenderer();

  addEventListener('resize', () => { dims = { w: 0, h: 0 }; glDims = { w: 0, h: 0 }; sync(); }, { passive: true });
  document.addEventListener('visibilitychange', sync);
  reducedMotionQuery.addEventListener?.('change', sync);
}

export function setSkin(name) {
  const next = GLASS_SKINS.has(name) ? name : null;
  if (next === skin) return;
  skin = next;
  if (skin) ensureGL();
  dims = { w: 0, h: 0 };                   // force a resize + reseed
  clock = 0;
  tierGlow = new Float64Array(STREAK_LEVELS);
  mandelbrot = null;
  boltTrack = makeBoltTrack();
  haloTrack = makeBoltTrack();
  lastFlashAt = -Infinity;
  flashLimiter.reset();                  // the clock restarts at 0, so old grants must go
  glr?.resetLightning();
  settleShown(null);
  snapOnNextActivity = true;
  if (!skin && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  sync();
}

/** Consistency-driven values from js/consistency.js. `streakLevel`/
 *  `streakFraction` and `monthPercent` are two independent metrics — see
 *  CLAUDE.md — and the skins layer them rather than combining them. */
export function setActivity({ glow = 0.5, frostHint = 0, streakLevel = 0, streakFraction = 0, monthPercent = 0 } = {}) {
  activity = {
    glow: Math.min(Math.max(glow, 0), 1),
    frostHint: Math.min(Math.max(frostHint, 0), 1),
    streakLevel: Math.min(Math.max(Math.round(streakLevel), 0), STREAK_LEVELS),
    streakFraction: Math.min(Math.max(streakFraction, 0), 1),
    monthPercent: Math.min(Math.max(monthPercent, 0), 1)
  };
  if (snapOnNextActivity) { snapOnNextActivity = false; settleShown(null); }   // open on the real values, not a ramp up from zero
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

/** The full-screen graphic view: graphic re-framed to fill the viewport, and
 *  60fps allowed. Every pause rule still applies — shouldRun() is unchanged. */
export function setFullView(flag) {
  fullView = Boolean(flag);
  dims = { w: 0, h: 0 };                   // 2D fallback reseeds for the new framing
  sync();
}

/** Drag-to-rotate (Kemet, Forge). While held, auto-rotation stops; releasing
 *  resumes it from wherever the user left it. */
export function setDragging(flag) {
  dragging = Boolean(flag);
}

export function rotateBy(radians) {
  spin = (spin + radians) % (Math.PI * 2);
  if (isStatic()) draw();
}

/** The current frame's pixels, top row first, for tests and scripts. Draws a
 *  fresh frame first: a WebGL canvas without preserveDrawingBuffer is only
 *  readable in the same task that drew it. */
export function readPixels() {
  if (!skin) return null;
  draw();
  if (usingGL()) {
    const { width, height, data } = glr.readPixels();
    const rows = new Uint8ClampedArray(data.length);
    const stride = width * 4;
    for (let y = 0; y < height; y += 1) rows.set(data.subarray((height - 1 - y) * stride, (height - y) * stride), y * stride);
    return { width, height, data: rows };
  }
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: img.width, height: img.height, data: img.data };
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
    fpsCap: fullView ? FULL_VIEW_FPS : FPS,
    renderer: usingGL() ? 'webgl2' : '2d',
    fullView,
    dragging,
    spin,
    rotationSpeed: rotationSpeed(shown.k),
    intensity: shown.k,
    flashLog: [...flashLog],         // ms of scene clock, the same clock as `clock`
    clock,
    backingStore: usingGL() ? { ...glDims } : { ...dims },
    activity: { ...activity },
    boltFlashes: boltTrack.flashes,  // the flicker-hazard cap under test
    haloFlashes: haloTrack.flashes,  // Kemet's second, month-driven bolt layer
    totalFlashes: boltTrack.flashes + haloTrack.flashes,
    tierGlow: [...tierGlow],         // Kemet pyramid: which tiers are lit, and how far
    levels: STREAK_LEVELS,
    featureBand: usingGL()
      ? (() => { const [b, t] = glBand(); return { y: ((1 - t) / 2) * glDims.h, h: ((t - b) / 2) * glDims.h, w: glDims.w }; })()
      : featureBand(),
    hasMandelbrot: Boolean(mandelbrot),
    scene: usingGL() ? JSON.parse(JSON.stringify(glr.info)) : null
  };
}
