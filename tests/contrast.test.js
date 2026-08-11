/* WCAG contrast for every foreground/background pair the UI actually uses,
 * in both themes. Reads the real custom properties out of css/styles.css.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SKIN_TOKENS } from '../js/backdrop.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'css/styles.css'), 'utf8');

function block(selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `${selector} block not found`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

function tokens(selector) {
  const out = {};
  for (const match of block(selector).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    out[match[1]] = match[2];
  }
  return out;
}

function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/* Foreground → backgrounds it is actually rendered on. */
const PAIRS = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'],
  ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface-2'],
  ['accent', 'bg'], ['accent', 'surface'], ['accent', 'surface-2'],
  ['danger', 'surface'], ['ok', 'surface'], ['warn', 'surface'],
  ['danger', 'surface-2'], ['ok', 'surface-2'], ['warn', 'surface-2'],
  ['on-accent', 'accent'], ['on-danger', 'danger']
];

const FLAT_THEMES = [['light', ':root {'], ['neon', '[data-theme="neon"] {']];
const GLASS_THEMES = [
  ['terminal', '[data-theme="terminal"] {'],
  ['fractal', '[data-theme="fractal"] {'],
  ['forge', '[data-theme="forge"] {'],
  ['kemet', '[data-theme="kemet"] {']
];

for (const [themeName, selector] of [...FLAT_THEMES, ...GLASS_THEMES]) {
  test(`${themeName} theme meets 4.5:1 on every text pair`, () => {
    const palette = tokens(selector);
    const failures = [];
    for (const [fg, bg] of PAIRS) {
      assert.ok(palette[fg], `--${fg} missing from ${themeName}`);
      assert.ok(palette[bg], `--${bg} missing from ${themeName}`);
      const ratio = contrast(palette[fg], palette[bg]);
      if (ratio < 4.5) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)}:1`);
    }
    assert.deepEqual(failures, [], `${themeName} theme contrast failures`);
  });
}

/* ---------- glass skins: contrast across the whole animation range ----------
 * A frosted panel is a translucent scrim over a *moving* backdrop, so a single
 * static check proves nothing. These composite the scrim over the darkest and
 * the lightest colour the backdrop is allowed to draw and require 4.5:1 at
 * both ends — which, combined with the range check below, covers every frame
 * the canvas can possibly produce.
 */

function rgbOf(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function compositeOver(scrimTriplet, alpha, behindHex) {
  const behind = rgbOf(behindHex);
  const out = scrimTriplet.map((v, i) => Math.round(alpha * v + (1 - alpha) * behind[i]));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** `--glass: 8 13 20` — space-separated for rgb(... / alpha) */
function tripletOf(block_, name) {
  const match = block_.match(new RegExp(`--${name}:\\s*([\\d]+)\\s+([\\d]+)\\s+([\\d]+)\\s*;`));
  assert.ok(match, `--${name} triplet missing`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

const GLASS_PAIRS = [
  ['text', 'surface'], ['muted', 'surface'], ['accent', 'surface'],
  ['danger', 'surface'], ['ok', 'surface'], ['warn', 'surface'],
  ['text', 'surface-2'], ['muted', 'surface-2'], ['accent', 'surface-2'],
  ['danger', 'surface-2'], ['ok', 'surface-2'], ['warn', 'surface-2']
];

for (const [themeName, selector] of GLASS_THEMES) {
  test(`${themeName}: text over frosted glass holds 4.5:1 at both extremes of the backdrop animation`, () => {
    const raw = block(selector);
    const palette = tokens(selector);
    const alphaMatch = raw.match(/--glass-alpha:\s*([\d.]+)\s*;/);
    assert.ok(alphaMatch, '--glass-alpha missing');
    const alpha = Number(alphaMatch[1]);

    const glass = tripletOf(raw, 'glass');
    const glass2 = tripletOf(raw, 'glass-2');
    const darkest = palette['backdrop-base'];
    const lightest = palette['backdrop-ink'];
    assert.ok(darkest && lightest, 'both backdrop extremes must be declared');

    const surfaces = {
      surface: { darkest: compositeOver(glass, alpha, darkest), lightest: compositeOver(glass, alpha, lightest) },
      'surface-2': { darkest: compositeOver(glass2, alpha, darkest), lightest: compositeOver(glass2, alpha, lightest) }
    };

    const failures = [];
    for (const [fg, surfaceName] of GLASS_PAIRS) {
      for (const [extreme, bg] of Object.entries(surfaces[surfaceName])) {
        const ratio = contrast(palette[fg], bg);
        if (ratio < 4.5) failures.push(`${fg} on ${surfaceName} over ${extreme} backdrop (${bg}): ${ratio.toFixed(2)}:1`);
      }
    }
    assert.deepEqual(failures, [], `${themeName} glass contrast failures`);
  });

  test(`${themeName}: every colour the canvas may draw sits inside the declared backdrop range`, () => {
    // js/backdrop.js only ever draws --backdrop-* tokens. If they all fall
    // between base and ink, the two contrast checks above bracket every frame.
    const palette = tokens(selector);
    const lo = luminance(palette['backdrop-base']);
    const hi = luminance(palette['backdrop-ink']);
    assert.ok(hi > lo, 'ink must be lighter than base');

    const backdropTokens = Object.entries(palette).filter(([name]) => name.startsWith('backdrop-'));
    assert.ok(backdropTokens.length >= 3, 'expected the skin to declare backdrop colours');

    const outside = backdropTokens
      .filter(([, hex]) => luminance(hex) < lo - 1e-9 || luminance(hex) > hi + 1e-9)
      .map(([name, hex]) => `--${name} (${hex})`);
    assert.deepEqual(outside, [], 'a backdrop colour escapes the range the contrast check assumes');
  });
}

/** Mirrors js/backdrop.js's toRGB()/mix() exactly. Forge is the only skin
 *  that blends colours at runtime rather than drawing a declared token
 *  outright, and a linear RGB blend's luminance is not guaranteed to sit
 *  between its two endpoints' (see the note on mix() in backdrop.js) — so
 *  unlike every other backdrop colour, this one has to be checked by actually
 *  running the blend, not by checking its inputs. */
function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function mixRgb(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

function rgbLuminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

test('forge\'s mixed colours never escape the backdrop range', () => {
  const palette = tokens('[data-theme="forge"]');
  const lo = luminance(palette['backdrop-base']);
  const hi = luminance(palette['backdrop-ink']);
  const [ink, iron, ember] = ['backdrop-ink', 'backdrop-iron', 'backdrop-ember'].map((k) => hexToRgb(palette[k]));

  const outside = [];
  const STEP = 0.02;
  for (let heat = 0; heat <= 1 + 1e-9; heat += STEP) {
    const hot = mixRgb(ember, ink, heat);
    const ironShape = mixRgb(iron, hot, heat * 0.45);
    const edge = mixRgb(ironShape, ink, 0.4);
    for (const [label, rgb] of [['hot', hot], ['ironShape', ironShape], ['edge', edge]]) {
      const l = rgbLuminance(rgb);
      if (l < lo - 1e-9 || l > hi + 1e-9) outside.push(`${label} at heat=${heat.toFixed(2)}: luminance ${l.toFixed(4)}`);
    }
  }
  for (let flameT = 0; flameT <= 1 + 1e-9; flameT += STEP) {
    const flameColor = mixRgb(ember, ink, 0.6 + 0.4 * flameT);
    const l = rgbLuminance(flameColor);
    if (l < lo - 1e-9 || l > hi + 1e-9) outside.push(`flameColor at flameT=${flameT.toFixed(2)}: luminance ${l.toFixed(4)}`);
  }
  assert.deepEqual(outside, [], 'a runtime blend escaped [--backdrop-base, --backdrop-ink]');
});

test('every skin declares each --backdrop-* token its renderer actually reads', () => {
  // readPalette() supplies a hardcoded fallback for every token, so a skin that
  // forgets to declare one still renders — in a colour no contrast test has
  // ever seen, silently outside the proven range. This closes that gap by
  // checking the renderers' own declared token list against the stylesheet.
  const missing = [];
  for (const [themeName, selector] of GLASS_THEMES) {
    const palette = tokens(selector);
    for (const token of SKIN_TOKENS[themeName]) {
      if (!palette[`backdrop-${token}`]) missing.push(`${themeName}: --backdrop-${token}`);
    }
  }
  assert.deepEqual(missing, [], 'a renderer reads a token its theme never declares');
});

test('the backdrop never uses an additive composite operation', () => {
  // The whole contrast proof rests on stacked draws being convex combinations:
  // normal source-over alpha blending can only ever land *between* the colours
  // involved, so nothing can exceed --backdrop-ink however many layers pile up.
  // 'lighter'/'screen'/'plus-lighter' break that — two mid-tone draws could sum
  // past the ceiling — and would do so without failing any existing test.
  const source = readFileSync(join(ROOT, 'js/backdrop.js'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /globalCompositeOperation/, 'backdrop.js must stay on the default source-over compositing');
  for (const op of ['lighter', 'plus-lighter', 'screen', 'color-dodge']) {
    assert.ok(!code.includes(`'${op}'`), `additive composite op ${op} would break the contrast proof`);
  }
});

test('the glass skins declare an opaque fallback for browsers without backdrop-filter', () => {
  // Without a blur, a translucent panel over moving content is exactly the
  // contrast failure the scheme exists to avoid — so the glass is applied only
  // inside @supports, and --surface stays an opaque colour underneath it.
  assert.match(css, /@supports \(\(backdrop-filter: blur\(2px\)\) or \(-webkit-backdrop-filter: blur\(2px\)\)\)/);
  for (const [themeName, selector] of GLASS_THEMES) {
    const palette = tokens(selector);
    assert.match(palette.surface, /^#[0-9a-f]{6}$/i, `${themeName} --surface must be an opaque hex fallback`);
  }
});

test('frost changes only the edge — never a background or text colour', () => {
  // Which is why it cannot move any contrast ratio, in any theme.
  const rule = css.slice(css.indexOf('.cal-day.is-frosted'));
  const body = rule.slice(rule.indexOf('{') + 1, rule.indexOf('}'));
  assert.doesNotMatch(body, /(^|[\s;])background\s*:/, 'frost must not repaint the cell');
  assert.doesNotMatch(body, /(^|[\s;])color\s*:/, 'frost must not restyle the text');
  assert.match(body, /border-color|box-shadow/, 'frost should be an edge treatment');
});

test('the contrast maths matches the WCAG reference values', () => {
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 0.01);
  assert.ok(Math.abs(contrast('#777777', '#ffffff') - 4.48) < 0.02);
  assert.equal(contrast('#123456', '#123456'), 1);
});

test('reduced motion is respected and focus is always visible', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /outline: 3px solid var\(--accent\)/);
});

test('tap targets are at least 48px', () => {
  const tap = block(':root {').match(/--tap:\s*(\d+)px/);
  assert.ok(tap && Number(tap[1]) >= 48, 'tap target token must be >= 48px');
});

/** The stylesheet with /* … *​/ comments stripped — these checks are about the
 *  rules the browser applies, not the prose explaining them. */
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, '');

test('no theme flashes, strobes, or animates a glow', () => {
  for (const [, selector] of [...FLAT_THEMES.slice(1), ...GLASS_THEMES]) {
    const paletteBlock = block(selector);
    assert.doesNotMatch(paletteBlock, /animation/, `${selector} must not declare animation`);
    assert.doesNotMatch(paletteBlock, /@keyframes/);
  }

  // Exactly one @keyframes exists in the whole stylesheet — the pre-existing mic
  // recording pulse, which is theme-independent and already gated by
  // prefers-reduced-motion above. The five skins add none: every pixel of skin
  // motion is drawn by js/backdrop.js, precisely so it can be *stopped* when the
  // tab hides or the mic opens. A CSS animation could not be.
  const keyframeCount = (cssRules.match(/@keyframes/g) || []).length;
  assert.equal(keyframeCount, 1, 'no @keyframes beyond the existing mic pulse should exist');
});

test('disclosure panels are hidden with the hidden attribute, not just CSS', () => {
  assert.match(css, /\.disclosure-panel\[hidden\]/);
});
