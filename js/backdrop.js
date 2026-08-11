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

const FPS = 30;
const FRAME_MS = 1000 / FPS;

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
  forge: ['base', 'ink', 'iron', 'ember', 'spark'],
  kemet: ['base', 'ink', 'sky', 'stone', 'gold', 'gold-hot', 'glyph', 'arc']
});

// Lightning — a flicker-hazard budget, not a suggestion. The floor applies at
// maximum intensity: however strong the streak, a flash is never closer than
// this to the last one. Shared by the Fractal bolts and the Kemet pyramid
// crawl, so there is exactly one cap to verify rather than two.
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
let activity = { glow: 0.5, frostHint: 0, streakLevel: 0, streakFraction: 0 };
let palette = {};
let dims = { w: 0, h: 0 };
let streams = [];
let embers = [];
let stars = [];
let glyphs = [];
let tierGlow = new Float64Array(STREAK_LEVELS);
let mandelbrot = null;               // { low, high } offscreen canvases, or null
let bolt = null;                     // the one active flash, or null
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
    iron: read('--backdrop-iron', '#241813'),
    ember: read('--backdrop-ember', '#5a2a0c'),
    spark: read('--backdrop-spark', '#6b3410'),
    sky: read('--backdrop-sky', '#1d1745'),
    stone: read('--backdrop-stone', '#2a2340'),
    gold: read('--backdrop-gold', '#6d5a24'),
    goldHot: read('--backdrop-gold-hot', '#8f7530'),
    glyph: read('--backdrop-glyph', '#3d7d85'),
    arc: read('--backdrop-arc', '#7a5cc4')
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

  bolt = null;
  nextBoltAt = 0;
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

/** Schedules once, then re-schedules itself every time a flash finishes.
 *  Interval shortens with intensity but never below LIGHTNING.minIntervalS at
 *  any intensity — the flicker-hazard cap holds at maximum, not just on
 *  average. `makeBolt` supplies the skin-specific geometry. */
function maybeStrikeBolt(t, intensity, makeBolt) {
  if (nextBoltAt === 0) { nextBoltAt = t + LIGHTNING.maxIntervalS * 0.4; return; }
  if (bolt) return;
  if (t < nextBoltAt) return;

  bolt = { bornAt: t, ...makeBolt(intensity) };
  boltFlashes += 1;

  const span = LIGHTNING.maxIntervalS - LIGHTNING.minIntervalS;
  nextBoltAt = t + Math.max(
    LIGHTNING.minIntervalS,
    LIGHTNING.maxIntervalS - span * intensity + (Math.random() - 0.5) * 1.5
  );
}

function drawBolt(t, colour, peak) {
  if (!bolt) return;
  const age = t - bolt.bornAt;
  if (age > LIGHTNING.durationS) { bolt = null; return; }
  const envelope = 1 - age / LIGHTNING.durationS;         // quick linear fade
  strokePath(bolt.points, colour, peak * envelope);
  for (const branch of bolt.branches) strokePath(branch, colour, peak * envelope * 0.7);
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

  maybeStrikeBolt(t, activity.glow, () => {
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
  drawBolt(t, palette.ink, 0.20 + activity.glow * 0.40);
}

/* ---------- Forge ---------- */

function roundedRectPath(x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
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
  const hot = mix(palette.ember, palette.ink, heat);
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
  const edge = mix(iron, palette.ink, 0.4);
  const fillAlpha = 0.5 + 0.42 * clarity;
  const edgeAlpha = 0.16 + 0.5 * clarity;

  ironShape(cx - barW / 2, cy - barH / 2, barW, barH, barH / 2, iron, fillAlpha, edge, edgeAlpha);

  const plate = (offset, pw, ph) => {
    ironShape(cx + offset - pw / 2, cy - ph / 2, pw, ph, Math.min(pw, ph) * 0.28, iron, fillAlpha, edge, edgeAlpha);
  };
  const innerW = barW * 0.085;
  const innerH = band.h * 0.62;
  const outerW = barW * 0.065;
  const outerH = band.h * 0.40;
  for (const dir of [-1, 1]) {
    plate(dir * barW * 0.34, innerW, innerH);
    plate(dir * barW * 0.45, outerW, outerH);
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
    const flameColor = mix(palette.ember, palette.ink, 0.6 + 0.4 * flameT);
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
    ctx.fillStyle = rgba(palette.ink, s.alpha * twinkle * 0.55);
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
      grad.addColorStop(0, rgba(palette.ink, 0.42 * crown * (0.8 + 0.2 * Math.sin(t * 0.6))));
      grad.addColorStop(1, rgba(palette.ink, 0));
    });
  }

  // Lightning crawl across the pyramid face — sparse and faint when the level
  // is low, dense and bright when it is high, under the shared flash cap.
  maybeStrikeBolt(t, fraction, () => {
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
  drawBolt(t, palette.arc, 0.22 + fraction * 0.45);
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

function draw() {
  if (!ctx || !skin) return;
  const render = RENDERERS[skin];
  if (!render) return;
  render(clock);
  frames += 1;
}

function loop(timestamp) {
  if (!shouldRun()) { raf = 0; return; }
  raf = requestAnimationFrame(loop);

  const elapsed = timestamp - lastFrameAt;
  if (elapsed < FRAME_MS) return;          // 30fps cap
  const dt = Math.min(elapsed / 1000, 0.1);
  lastFrameAt = timestamp;
  clock += dt;
  settleTiers(dt);
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
  tierGlow = new Float64Array(STREAK_LEVELS);
  mandelbrot = null;
  if (!skin && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  sync();
}

/** Consistency-driven values from js/consistency.js. */
export function setActivity({ glow = 0.5, frostHint = 0, streakLevel = 0, streakFraction = 0 } = {}) {
  activity = {
    glow: Math.min(Math.max(glow, 0), 1),
    frostHint: Math.min(Math.max(frostHint, 0), 1),
    streakLevel: Math.min(Math.max(Math.round(streakLevel), 0), STREAK_LEVELS),
    streakFraction: Math.min(Math.max(streakFraction, 0), 1)
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
    boltFlashes,                     // the flicker-hazard cap under test
    tierGlow: [...tierGlow],         // Kemet pyramid: which tiers are lit, and how far
    levels: STREAK_LEVELS,
    featureBand: featureBand(),
    hasMandelbrot: Boolean(mandelbrot)
  };
}
