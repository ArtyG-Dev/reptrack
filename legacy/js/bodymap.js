/* The body map — a hand-built inline SVG figure, front and back, one <path> per
 * muscle. No image, no library: every shape is generated here from a handful of
 * proportions, so the three figures (neutral, male, female) are the same drawing
 * with different shoulder, waist and hip widths.
 *
 * bodyGeometry() is pure (tests/bodymap.test.js); renderBody() turns it into DOM.
 * Colours come only from CSS custom properties: --heat-0…--heat-3 for the
 * fills, --text for outlines, --accent for the figure's glow.
 */

import { MUSCLE_LABELS, heatLevel } from './muscles.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Half-widths in viewBox units (the figure is 200 wide, 440 tall). */
export const FIGURES = {
  neutral: { shoulder: 46, waist: 30, hip: 35 },
  male: { shoulder: 52, waist: 32, hip: 33 },
  female: { shoulder: 41, waist: 26, hip: 39 }
};

/* Which view each muscle is pressed on. Side delts, forearms and calves show on
 * both; they are interactive on one only, so each muscle is one control. */
export const VIEW_OF = {
  chest: 'front', 'front-delts': 'front', 'side-delts': 'front', biceps: 'front', forearms: 'front',
  abs: 'front', obliques: 'front', quads: 'front', adductors: 'front', 'hip-flexors': 'front',
  'rear-delts': 'back', triceps: 'back', lats: 'back', 'upper-back': 'back', 'lower-back': 'back',
  glutes: 'back', hamstrings: 'back', calves: 'back'
};

const r2 = (n) => Math.round(n * 100) / 100;
const C = 100;

/** An ellipse as a path, with its centre and radii kept for the detail lines. */
function ellipse(cx, cy, rx, ry) {
  return { cx, cy, rx, ry, d: `M${r2(cx - rx)},${r2(cy)}a${r2(rx)},${r2(ry)} 0 1,0 ${r2(2 * rx)},0a${r2(rx)},${r2(ry)} 0 1,0 ${r2(-2 * rx)},0Z` };
}
/** A pair mirrored about the centre line (dx is the right-hand offset). */
const pair = (dx, cy, rx, ry) => [ellipse(C - dx, cy, rx, ry), ellipse(C + dx, cy, rx, ry)];

function shapes(f, view) {
  const { shoulder: S, waist: W, hip: H } = f;
  const front = {
    chest: pair(S * 0.36, 94, S * 0.32, 12),
    'front-delts': pair(S - 7, 77, 8, 9),
    'side-delts': pair(S + 1, 84, 5, 10),
    biceps: pair(S + 1, 120, 6.5, 19),
    forearms: pair(S + 4, 182, 6, 24),
    abs: [ellipse(C, 138, Math.min(12, W * 0.42), 30)],
    obliques: pair(W * 0.68, 146, 5.5, 20),
    'hip-flexors': pair(H * 0.36, 198, 6.5, 10),
    quads: pair(H * 0.52, 258, 12.5, 38),
    adductors: pair(H * 0.2, 240, 4.5, 20),
    calves: pair(H * 0.48, 345, 6.5, 26)
  };
  const back = {
    'rear-delts': pair(S - 7, 79, 8, 8),
    'side-delts': pair(S + 1, 84, 5, 10),
    triceps: pair(S + 1, 121, 6.5, 19),
    forearms: pair(S + 4, 182, 6, 24),
    'upper-back': [ellipse(C, 90, S * 0.46, 16)],
    lats: pair(S * 0.5, 128, 10, 26),
    'lower-back': [ellipse(C, 166, Math.min(15, W * 0.5), 13)],
    glutes: pair(H * 0.42, 212, 14, 14),
    hamstrings: pair(H * 0.5, 266, 11, 34),
    calves: pair(H * 0.48, 342, 8.5, 27)
  };
  return view === 'front' ? front : back;
}

/** The silhouette, one closed path, mirrored. */
function outline(f) {
  const { shoulder: S, waist: W, hip: H } = f;
  const right = [
    [108, 52], [C + S - 8, 66], [C + S + 6, 76], [C + S + 9, 150], [C + S + 10, 212], [C + S + 6, 238],
    [C + S - 2, 238], [C + S - 3, 212], [C + S - 6, 150], [C + S - 12, 98], [C + W, 170], [C + H, 206],
    [C + H - 4, 300], [C + H - 12, 398], [C + H - 6, 420], [C + 6, 420], [C + 6, 398], [C + 5, 300], [C + 3, 228]
  ];
  const left = right.map(([x, y]) => [2 * C - x, y]).reverse();
  const pts = [...right, ...left];
  return `M${pts.map(([x, y]) => `${r2(x)},${r2(y)}`).join('L')}Z`;
}

/**
 * Pure geometry for one view of one figure.
 * @returns {{ viewBox, outline, head, muscles: Array<{muscle, d, interactive, detail}> }}
 * `detail(level)` gives the inner lines drawn as definition grows: none below 3,
 * one line through each shape at 3–4, a cross at 5.
 */
export function bodyGeometry(figure = 'neutral', view = 'front') {
  const f = FIGURES[figure] || FIGURES.neutral;
  const all = shapes(f, view);
  const muscles = Object.entries(all).map(([muscle, parts]) => ({
    muscle,
    d: parts.map((p) => p.d).join(''),
    interactive: VIEW_OF[muscle] === view,
    detail: (level) => (level < 3 ? '' : parts.map((p) => {
      const v = `M${r2(p.cx)},${r2(p.cy - p.ry * 0.6)}L${r2(p.cx)},${r2(p.cy + p.ry * 0.6)}`;
      return level >= 5 ? `${v}M${r2(p.cx - p.rx * 0.6)},${r2(p.cy)}L${r2(p.cx + p.rx * 0.6)},${r2(p.cy)}` : v;
    }).join(''))
  }));
  return { viewBox: '0 0 200 440', outline: outline(f), head: ellipse(C, 30, 15, 19).d, muscles };
}

/** Outline weight grows with definition; it never depends on anything that can fall. */
export const strokeFor = (level) => r2(0.6 + 0.45 * Math.max(0, Math.min(5, level)));

function svg(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, String(v));
  return node;
}

const setsLabel = (n) => {
  const v = Math.round(n * 10) / 10;
  return `${v} set${v === 1 ? '' : 's'} this week`;
};

/**
 * One view as an <svg>. `counts` is this week's weighted sets per muscle,
 * `definition` the 0–5 level per muscle, `glow` 0..1 (already frost-damped).
 */
export function renderBody({ figure, view, counts = {}, definition = {}, glow = 0, onPick = () => {} }) {
  const g = bodyGeometry(figure, view);
  const root = svg('svg', { class: 'body-map', viewBox: g.viewBox, role: 'group', 'aria-label': `${view === 'front' ? 'Front' : 'Back'} of the body` });
  root.append(svg('path', { class: 'body-outline', d: g.outline, 'stroke-opacity': r2(0.35 + 0.65 * glow), 'aria-hidden': 'true' }));
  root.append(svg('path', { class: 'body-head', d: g.head, 'aria-hidden': 'true' }));
  for (const m of g.muscles) {
    const n = counts[m.muscle] || 0;
    const level = definition[m.muscle] || 0;
    const label = `${MUSCLE_LABELS[m.muscle]}: ${setsLabel(n)}`;
    const path = svg('path', {
      class: `muscle heat-${heatLevel(n)}`, d: m.d, 'stroke-width': strokeFor(level),
      'data-muscle': m.muscle, 'data-definition': level
    });
    if (m.interactive) {
      path.setAttribute('role', 'button');
      path.setAttribute('tabindex', '0');
      path.setAttribute('aria-label', label);
      path.addEventListener('click', () => onPick(m.muscle));
      path.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(m.muscle); } });
    } else {
      path.setAttribute('aria-hidden', 'true');
    }
    const title = svg('title');
    title.textContent = label;
    path.append(title);
    root.append(path);
    const detail = m.detail(level);
    if (detail) root.append(svg('path', { class: 'muscle-detail', d: detail, 'aria-hidden': 'true' }));
  }
  return root;
}
