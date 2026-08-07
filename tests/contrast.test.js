/* WCAG contrast for every foreground/background pair the UI actually uses,
 * in both themes. Reads the real custom properties out of css/styles.css.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

for (const [themeName, selector] of [['light', ':root {'], ['dark', '[data-theme="dark"] {']]) {
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
