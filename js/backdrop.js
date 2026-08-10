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
 *     the compositor (0.5× for terminal/forge; 0.12× for fractal, which is then
 *     CSS-blurred, so it costs a few thousand pixels a frame)
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
const SCALE = { terminal: 0.5, forge: 0.5, fractal: 0.12 };
const GLASS_SKINS = new Set(['terminal', 'fractal', 'forge']);

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
let sparks = [];
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

/** Blend two colours. Both endpoints are theme tokens, so the result is always
 *  inside the declared [--backdrop-base, --backdrop-ink] luminance range. */
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
      speed: 6 + Math.random() * 14,      // px/s in backing-store space: slow
      len: 8 + Math.random() * 22,
      alpha: 0.18 + Math.random() * 0.22
    });
  }

  sparks = Array.from({ length: 26 }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    drift: (Math.random() - 0.5) * 5,
    rise: 5 + Math.random() * 11,
    size: 0.6 + Math.random() * 1.6,
    phase: Math.random() * Math.PI * 2
  }));
}

/* ---------- skins ---------- */

/** Terminal: a soft grid pulse with slow data streams drifting down it.
 *  Low contrast on purpose — behind the glass it should read as texture. */
function drawTerminal(t) {
  const { w, h } = dims;
  ctx.fillStyle = rgba(palette.base, 1);
  ctx.fillRect(0, 0, w, h);

  const pulse = 0.05 + 0.03 * (0.5 + 0.5 * Math.sin(t * 0.35));
  ctx.strokeStyle = rgba(palette.grid, pulse);
  ctx.lineWidth = 1;
  ctx.beginPath();
  const step = Math.max(14, Math.round(w / 8));
  for (let x = 0; x <= w; x += step) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
  for (let y = 0; y <= h; y += step) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
  ctx.stroke();

  for (const s of streams) {
    const y = (s.y + t * s.speed) % (h + s.len) - s.len;
    const grad = ctx.createLinearGradient(0, y, 0, y + s.len);
    grad.addColorStop(0, rgba(palette.stream, 0));
    grad.addColorStop(0.6, rgba(palette.stream, s.alpha));
    grad.addColorStop(1, rgba(palette.stream, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(s.x, y, 2, s.len);
  }
}

/** Fractal: slow organic blooms. Rendered tiny and blurred by CSS, so the
 *  "morph" is a handful of drifting radial gradients rather than real fractal
 *  maths — same look through an 18px blur, a fraction of the cost.
 *  Overall lightness rises with training consistency. */
function drawFractal(t) {
  const { w, h } = dims;
  ctx.fillStyle = rgba(palette.base, 1);
  ctx.fillRect(0, 0, w, h);

  const lift = 0.25 + activity.glow * 0.6;   // consistency → brightness
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
    const radius = b.r * Math.max(w, h) * (0.85 + 0.15 * Math.sin(slow * 1.3 + i));
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, rgba(b.c, 0.55 * lift));
    grad.addColorStop(1, rgba(b.c, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
}

function roundedBar(x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fill();
}

/** Forge: an oversized dumbbell behind the glass, warmed by consistency.
 *  A lapse cools it a little and no further — `frostHint` is capped upstream,
 *  and the multiplier here keeps at least 65% of the warmth in the worst case.
 *  Nothing here flashes: every value moves on a slow sine or not at all. */
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
  const glowR = Math.max(w, h) * (0.32 + heat * 0.22) * breathe;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
  grad.addColorStop(0, rgba(hot, (0.10 + heat * 0.45) * breathe));
  grad.addColorStop(0.55, rgba(hot, (0.04 + heat * 0.16) * breathe));
  grad.addColorStop(1, rgba(hot, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // The dumbbell itself: a bar, two inner plates, two outer plates.
  const iron = mix(palette.iron, hot, heat * 0.45);
  ctx.fillStyle = rgba(iron, 0.55);
  roundedBar(cx - barW / 2, cy - barH / 2, barW, barH, barH / 2);

  const plate = (offset, pw, ph) => {
    roundedBar(cx + offset - pw / 2, cy - ph / 2, pw, ph, Math.min(pw, ph) * 0.28);
  };
  const innerW = barW * 0.085;
  const innerH = h * 0.20;
  const outerW = barW * 0.065;
  const outerH = h * 0.13;
  for (const dir of [-1, 1]) {
    plate(dir * barW * 0.34, innerW, innerH);
    plate(dir * barW * 0.45, outerW, outerH);
  }

  // Edge sparks: more of them, and brighter, the hotter the forge runs.
  const active = Math.round(6 + heat * sparks.length * 0.75);
  for (let i = 0; i < active; i += 1) {
    const s = sparks[i];
    const y = (s.y - t * s.rise) % h;
    const x = s.x + Math.sin(t * 0.5 + s.phase) * s.drift;
    const twinkle = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.1 + s.phase));
    ctx.fillStyle = rgba(palette.spark, (0.10 + heat * 0.30) * twinkle);
    ctx.fillRect(x, y < 0 ? y + h : y, s.size, s.size);
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
    activity: { ...activity }
  };
}
