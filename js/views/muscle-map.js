/* The muscle map on Progress: a rotatable 3D mannequin (js/mannequin*.js), or
 * the flat front/back figures (js/bodymap.js) where WebGL2 is unavailable or
 * reduced motion is asked for, always beside a ranked list of every muscle
 * group so nothing depends on colour alone.
 *
 * Period (7 / 30 / 90 days) and counting mode (Sets / Weight) are settings;
 * switching them changes nothing that's stored. All counting is
 * muscles.muscleTotals(), the same numbers in every view.
 *
 * The 3D view draws on demand: on Progress nothing runs between frames. The
 * full-screen view turns slowly by itself at up to 30 fps, pausing whenever
 * the page is hidden, and the drag goes through the shared orbit handler in
 * theme-engine.js, as Kemet and Forge do.
 */

import * as state from '../state.js';
import { el, clear } from '../ui.js';
import { MUSCLES, MUSCLE_LABELS } from '../exercises-seed.js';
import { PERIODS, periodRange, muscleTotals, rankMuscles, heatLevelFor, definitionLevel, HEAT_THRESHOLDS } from '../muscles.js';
import { renderBody } from '../bodymap.js';
import { mannequinParts, cameraPose, rayThrough, pickMuscle, projectToNDC, partCentre, THREE_QUARTER_YAW } from '../mannequin.js';
import { createMannequinRenderer } from '../mannequin-gl.js';
import { createOrbit, orbitGrab, orbitDrag, orbitRelease, orbitSettle, ROTATION } from '../theme-engine.js';
import { formatWeight } from '../progression.js';
import { todayISO } from '../store.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEG = Math.PI / 180;
const LIMITS = Object.freeze({ yaw: null, pitch: 30 * DEG });   // turn freely, tilt at most ±30°
const FRAME_MS = 1000 / 30;
const AUTO_SPEED = ROTATION.minRadPerS;                        // the slowest speed any scene turns at
const TAP_SLOP_PX = 6;

const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false, addEventListener() {} };

/* One canvas and one WebGL context for the life of the page. The Progress
 * view is rebuilt on every state change, so the canvas is moved, never
 * recreated: a context per render would be dropped by the browser. */
const mm = {
  canvas: null,
  renderer: null,
  failed: false,
  orbit: createOrbit(),
  heading: THREE_QUARTER_YAW,
  selected: -1,
  levels: new Array(MUSCLES.length).fill(0),
  figure: 'neutral',
  colours: null,
  full: null,                  // the full-screen overlay while open
  raf: 0,
  lastFrame: 0,
  frames: 0,
  flatSide: 'front',
  onPick: () => {},
  rerender: () => {}
};

function wants3D() {
  if (mm.failed || reducedMotion.matches) return false;
  if (!mm.canvas) {
    mm.canvas = el('canvas', { class: 'mm-canvas', role: 'img', 'aria-label': '3D muscle map. Drag to turn it; the list below gives every muscle group.' });
    mm.renderer = createMannequinRenderer(mm.canvas);
    if (!mm.renderer) { mm.failed = true; mm.canvas = null; return false; }
    wireCanvas(mm.canvas);
    // A lost context hands over to the flat figures for good, never a blank card.
    mm.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); mm.failed = true; closeFull(); mm.rerender(); });
  }
  return true;
}

/* ---------- drawing ---------- */

function readColours() {
  const cs = getComputedStyle(document.documentElement);
  const rgb = (name) => {
    const h = cs.getPropertyValue(name).trim().replace('#', '');
    const n = Number.parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h, 16);
    return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [128, 128, 128];
  };
  return { heat: [0, 1, 2, 3].map((i) => rgb(`--heat-${i}`)), base: rgb('--border'), select: rgb('--accent') };
}

function sizeCanvas() {
  const rect = mm.canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (mm.canvas.width !== w || mm.canvas.height !== h) { mm.canvas.width = w; mm.canvas.height = h; }
}

/** Heading as the camera sees it: the resting angle plus the drag. Dragging
 *  right turns the figure's front to the right. */
const viewYaw = () => mm.heading - mm.orbit.yaw;

function draw() {
  if (!mm.renderer || !mm.canvas?.isConnected) return;
  sizeCanvas();
  mm.colours ??= readColours();
  mm.renderer.render({ figure: mm.figure, yaw: viewYaw(), pitch: mm.orbit.pitch, levels: mm.levels, selected: mm.selected, colours: mm.colours });
  mm.frames += 1;
}

let drawQueued = false;
function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}

/* ---------- touch and pointer ---------- */

function pickAt(clientX, clientY) {
  const rect = mm.canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2 - 1;
  const y = 1 - ((clientY - rect.top) / rect.height) * 2;
  const aspect = rect.width / Math.max(rect.height, 1);
  return pickMuscle(mannequinParts(mm.figure), rayThrough(cameraPose(viewYaw(), mm.orbit.pitch, aspect), x, y, aspect));
}

function wireCanvas(canvas) {
  let start = null;
  let last = null;
  canvas.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY, moved: false };
    last = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture?.(e.pointerId);
    orbitGrab(mm.orbit);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP_PX) start.moved = true;
    if (start.moved) { orbitDrag(mm.orbit, e.clientX - last.x, e.clientY - last.y, LIMITS); requestDraw(); }
    last = { x: e.clientX, y: e.clientY };
  });
  const end = (e) => {
    if (!start) return;
    const tapped = !start.moved && e.type === 'pointerup';
    start = null;
    // Fold the turn into the heading; tilt stays where it was left (Progress)
    // or eases back while the full-screen view turns by itself.
    mm.heading -= mm.orbit.yaw;
    mm.orbit.yaw = 0;
    orbitRelease(mm.orbit);
    if (tapped) {
      const muscle = pickAt(e.clientX, e.clientY);
      if (muscle) mm.onPick(muscle);
    }
    requestDraw();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

/* ---------- full screen ---------- */

function loop(now) {
  if (!mm.full) { mm.raf = 0; return; }
  if (document.hidden) { mm.raf = 0; return; }
  mm.raf = requestAnimationFrame(loop);
  const elapsed = now - mm.lastFrame;
  if (elapsed < FRAME_MS - 1) return;                       // 30 fps cap
  const dt = Math.min(elapsed / 1000, 0.1);
  mm.lastFrame = now;
  if (!mm.orbit.dragging) mm.heading += AUTO_SPEED * dt;
  orbitSettle(mm.orbit, dt);
  draw();
}

function startLoop() {
  if (mm.raf || !mm.full || document.hidden) return;
  mm.lastFrame = performance.now() - FRAME_MS;
  mm.raf = requestAnimationFrame(loop);
}

document.addEventListener?.('visibilitychange', () => { if (!document.hidden) startLoop(); });

const SHELL = ['.app-bar', '#main', '.tabbar', '.skip-link'];
let returnFocus = null;

function openFull() {
  if (mm.full || !mm.canvas) return;
  returnFocus = document.activeElement;
  const close = el('button', { class: 'btn graphic-btn', id: 'mm-full-close', type: 'button', 'aria-label': 'Close full-screen muscle map', onclick: () => closeFull() }, '✕');
  const overlay = el('div', { class: 'mm-full', id: 'mm-full', role: 'dialog', 'aria-modal': 'true', 'aria-label': '3D muscle map, full screen' },
    el('div', { class: 'graphic-bar' }, el('p', { class: 'small mm-full-hint', text: 'Drag to turn it · tap a muscle' }), close));
  overlay.prepend(mm.canvas);
  document.body.append(overlay);
  for (const sel of SHELL) document.querySelector(sel)?.setAttribute('inert', '');
  mm.full = overlay;
  // On the document, not the overlay: a drag moves focus to the page body,
  // and Esc must still close the view (as in the skins' graphic view).
  document.addEventListener('keydown', onFullKey);
  history.pushState({ muscleMap: true }, '', location.href);
  close.focus();
  startLoop();
}

addEventListener?.('popstate', () => { if (mm.full) closeFull({ fromHistory: true }); });

function onFullKey(e) {
  if (!mm.full || document.querySelector('dialog[open]')) return;   // a panel over the view handles its own keys
  if (e.key === 'Escape') { e.preventDefault(); closeFull(); }
  if (e.key === 'Tab') { e.preventDefault(); document.getElementById('mm-full-close')?.focus(); }
}

function closeFull({ fromHistory = false } = {}) {
  if (!mm.full) return;
  const overlay = mm.full;
  mm.full = null;
  document.removeEventListener('keydown', onFullKey);
  if (mm.raf) cancelAnimationFrame(mm.raf);
  mm.raf = 0;
  overlay.remove();
  for (const sel of SHELL) document.querySelector(sel)?.removeAttribute('inert');
  if (!fromHistory) history.back();
  mm.orbit.pitch = 0;
  document.getElementById('mm-stage')?.prepend(mm.canvas);
  requestDraw();
  (document.getElementById('mm-open-full') || returnFocus)?.focus?.();
}

/* ---------- the card ---------- */

function valueText(value, mode, unit) {
  if (mode === 'weight') return `${formatWeight(Math.round(value))} ${unit}`;
  const n = Math.round(value * 10) / 10;
  return `${n} set${n === 1 ? '' : 's'}`;
}

function segmented(label, options, current, onPick) {
  return el('div', { class: 'mm-seg', role: 'group', 'aria-label': label },
    ...options.map(([value, text]) => el('button', {
      class: `btn btn-sm ${value === current ? 'btn-primary' : ''}`, type: 'button',
      'aria-pressed': value === current ? 'true' : 'false', dataset: { value: String(value) },
      onclick: () => { if (value !== current) onPick(value); }
    }, text)));
}

function swatch(level, text) {
  const square = document.createElementNS(SVG_NS, 'svg');
  square.setAttribute('class', 'legend-swatch');
  square.setAttribute('viewBox', '0 0 12 12');
  square.setAttribute('aria-hidden', 'true');
  const rect = document.createElementNS(SVG_NS, 'rect');
  for (const [k, v] of Object.entries({ class: `muscle heat-${level}`, width: 12, height: 12, rx: 3 })) rect.setAttribute(k, String(v));
  square.append(rect);
  return el('span', { class: 'legend-item' }, square, text);
}

/**
 * The muscle map card. `openPanel(muscle)` shows a muscle's panel (name,
 * total and trend for the period, and the exercises that work it).
 */
export function muscleMapCard(s, { openPanel, rerender = () => {} }) {
  const days = PERIODS.includes(Number(s.settings.musclePeriodDays)) ? Number(s.settings.musclePeriodDays) : 7;
  const mode = s.settings.muscleCountMode === 'weight' ? 'weight' : 'sets';
  const unit = s.settings.unit || 'kg';
  const byId = new Map(s.exercises.map((ex) => [ex.id, ex]));
  const result = muscleTotals({ sets: s.allSets, exercisesById: byId, ...periodRange(todayISO(), days), mode, unit });
  const ranked = rankMuscles(result);
  const max = ranked[0]?.value || 0;
  const levelOf = (m) => heatLevelFor(result.totals[m], { mode, days, max });
  mm.levels = MUSCLES.map(levelOf);
  mm.figure = s.settings.bodyFigure || 'neutral';
  mm.colours = null;                                           // the theme may have changed
  mm.onPick = (muscle) => openPanel(muscle);
  mm.rerender = rerender;

  const period = days === 7 ? 'the last 7 days' : `the last ${days} days`;
  const describe = (m) => (result.excludedOnly.has(m)
    ? 'bodyweight or timed work only, not counted in the weight view'
    : result.totals[m] > 0 ? valueText(result.totals[m], mode, unit) : 'none');

  // The figure: 3D where it can run, otherwise the flat front and back.
  let figure;
  if (wants3D()) {
    const stage = el('div', { class: 'mm-stage', id: 'mm-stage' });
    if (!mm.full) stage.append(mm.canvas);
    figure = el('div', { class: 'stack' }, stage,
      el('div', { class: 'row-between' },
        el('p', { class: 'small muted', style: 'margin:0', text: 'Drag to turn it · tap a muscle' }),
        el('button', { class: 'btn btn-sm', type: 'button', id: 'mm-open-full', onclick: openFull }, 'Full screen')));
    requestDraw();
  } else {
    const definition = Object.fromEntries(MUSCLES.map((m) => [m, definitionLevel(m, s.allSets, byId)]));
    const { glow: rawGlow, frostHint } = state.activityVisual();
    const glow = rawGlow * (1 - 0.35 * frostHint);             // the outline glow, damped by frost as the Forge is
    const views = el('div', { class: 'body-views', 'data-show': mm.flatSide },
      ...['front', 'back'].map((side) => el('div', { class: 'body-view', 'data-side': side },
        el('p', { class: 'small muted', style: 'margin:0;text-align:center', text: side === 'front' ? 'Front' : 'Back' }),
        renderBody({ figure: mm.figure, view: side, definition, glow, onPick: (m) => openPanel(m), levelOf, labelOf: (m) => `${MUSCLE_LABELS[m]}: ${describe(m)} in ${period}` }))));
    figure = el('div', { class: 'stack' }, views,
      el('button', {
        class: 'btn btn-sm body-flip', type: 'button', id: 'body-flip',
        'aria-label': `Show the ${mm.flatSide === 'front' ? 'back' : 'front'} of the body`,
        onclick: (e) => {
          mm.flatSide = mm.flatSide === 'front' ? 'back' : 'front';
          views.dataset.show = mm.flatSide;
          e.currentTarget.setAttribute('aria-label', `Show the ${mm.flatSide === 'front' ? 'back' : 'front'} of the body`);
        }
      }, 'Flip'));
  }

  const [lo, hi] = HEAT_THRESHOLDS;
  const legend = el('div', { class: 'body-legend', role: 'group', 'aria-label': 'Colour key' },
    ...(mode === 'sets'
      ? [swatch(0, 'None'), swatch(1, `Under ${lo} a week`), swatch(2, `${lo}–${hi - 1} a week`), swatch(3, `${hi}+ a week`)]
      : [swatch(0, 'None'), swatch(1, 'Lighter'), swatch(2, 'More'), swatch(3, 'Most (vs your top group)')]));

  const rows = ranked.map(({ muscle, value, excludedOnly }) => el('li', {},
    el('button', {
      class: 'mm-row', type: 'button', dataset: { muscle },
      'aria-label': `${MUSCLE_LABELS[muscle]}: ${describe(muscle)} in ${period}`,
      onclick: () => openPanel(muscle)
    },
      el('span', { class: `mm-dot muscle heat-${levelOf(muscle)}`, 'aria-hidden': 'true' }),
      el('span', { class: 'grow', text: MUSCLE_LABELS[muscle] }),
      el('span', { class: 'mono small', text: excludedOnly ? 'bodyweight / timed only' : value > 0 ? valueText(value, mode, unit) : '—' }))
  ));
  if (result.unassigned > 0) {
    rows.push(el('li', { class: 'mm-unassigned', id: 'mm-unassigned' },
      el('span', { class: 'grow', text: 'Unassigned' }),
      el('span', { class: 'mono small', text: valueText(result.unassigned, mode, unit) }),
      el('p', { class: 'small muted', style: 'margin:0;width:100%', text: 'Exercises with no muscles set. Set them under Exercises to see them on the map.' })));
  }

  return el('div', { class: 'card stack', id: 'muscle-map' },
    el('h3', { style: 'margin:0', text: 'Your muscles' }),
    segmented('Period', PERIODS.map((d) => [d, `${d} days`]), days, (v) => state.updateSettings({ musclePeriodDays: v })),
    segmented('Count by', [['sets', 'Sets'], ['weight', 'Weight']], mode, (v) => state.updateSettings({ muscleCountMode: v })),
    figure,
    mode === 'weight' ? el('p', { class: 'small', id: 'mm-weight-note', style: 'margin:0', text: 'Weight view excludes bodyweight and timed exercises (e.g. push-ups, planks).' }) : null,
    legend,
    el('ol', { class: 'mm-rank', id: 'mm-rank', 'aria-label': `Muscle groups, most trained first, ${period}` }, ...rows)
  );
}

/** Highlight a group in the 3D view while its panel is open (−1: none). */
export function setSelected(muscle) {
  mm.selected = muscle ? MUSCLES.indexOf(muscle) : -1;
  requestDraw();
}

/** For tests and screenshots. */
export const muscleMapDiagnostics = {
  get() {
    return { mode: mm.canvas && !mm.failed && !reducedMotion.matches ? '3d' : 'flat', heading: mm.heading, viewYaw: viewYaw(), pitch: mm.orbit.pitch, frames: mm.frames, running: Boolean(mm.raf), full: Boolean(mm.full), levels: [...mm.levels], selected: mm.selected, figure: mm.figure };
  },
  /** Where a muscle's first primitive is on screen, in client px (for a test's tap). */
  screenPointOf(muscle) {
    const rect = mm.canvas.getBoundingClientRect();
    const aspect = rect.width / Math.max(rect.height, 1);
    const part = mannequinParts(mm.figure).find((p) => p.muscle === muscle);
    const [nx, ny] = projectToNDC(cameraPose(viewYaw(), mm.orbit.pitch, aspect), partCentre(part), aspect);
    return { x: rect.left + ((nx + 1) / 2) * rect.width, y: rect.top + ((1 - ny) / 2) * rect.height };
  },
  setView(heading, pitch = 0) { mm.heading = heading; mm.orbit.yaw = 0; mm.orbit.pitch = pitch; draw(); },
  readPixels() { draw(); return mm.renderer ? mm.renderer.readPixels() : null; }
};
