/* Palette design aid for the glass skins.
 *
 * Frosted glass means text sits on a translucent scrim over a *moving*
 * backdrop, so "does it pass 4.5:1" has two answers — one over the darkest
 * thing the backdrop can draw, one over the lightest. This composites the
 * scrim over both and reports every pair, so a palette can be tuned here
 * before it reaches the stylesheet. tests/contrast.test.js enforces the same
 * arithmetic against the real CSS.
 *
 * Run: node scripts/check-skin-palettes.mjs
 */

function channel(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function rgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function luminance(hex) {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function toHex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}
/** scrim (with alpha) composited over whatever is behind it */
function composite(scrimHex, alpha, behindHex) {
  const s = rgb(scrimHex);
  const b = rgb(behindHex);
  return toHex(s.map((v, i) => alpha * v + (1 - alpha) * b[i]));
}

const PAIRS = [
  ['text', 'surface'], ['muted', 'surface'], ['accent', 'surface'],
  ['danger', 'surface'], ['ok', 'surface'], ['warn', 'surface'],
  ['text', 'surface-2'], ['muted', 'surface-2'], ['accent', 'surface-2'],
  ['danger', 'surface-2'], ['ok', 'surface-2'], ['warn', 'surface-2'],
  ['on-accent', 'accent'], ['on-danger', 'danger']
];

const THEMES = {
  terminal: {
    backdropBase: '#04070b',
    backdropInk: '#2f5567',
    glass: '#080d14',
    glassAlpha: 0.92,
    text: '#e2edf3',
    muted: '#9db4c2',
    accent: '#63d0e6',
    'on-accent': '#04141a',
    danger: '#ff8a9c',
    'on-danger': '#2a0008',
    ok: '#6ee7a8',
    warn: '#f0c552'
  },
  fractal: {
    backdropBase: '#070510',
    backdropInk: '#4a3a7a',
    glass: '#0d0a18',
    glassAlpha: 0.92,
    text: '#ece7fa',
    muted: '#b3a9d0',
    accent: '#b39cf5',
    'on-accent': '#100726',
    danger: '#ff8fa8',
    'on-danger': '#2c0210',
    ok: '#7fe3c0',
    warn: '#f2c766'
  },
  forge: {
    backdropBase: '#0a0604',
    backdropInk: '#6b3410',
    glass: '#120b07',
    glassAlpha: 0.92,
    text: '#f6e9df',
    muted: '#c4a894',
    accent: '#ff9d4d',
    'on-accent': '#2a1200',
    danger: '#ff8a86',
    'on-danger': '#2c0604',
    ok: '#8fe0a0',
    warn: '#ffc861'
  },
  kemet: {
    backdropBase: '#050410',
    backdropInk: '#5f8f96',
    glass: '#0b0a1a',
    glassAlpha: 0.92,
    text: '#f2ecdc',
    muted: '#bdb4c9',
    accent: '#f2c85a',
    'on-accent': '#241a02',
    danger: '#ff8fa0',
    'on-danger': '#2b0209',
    ok: '#7fe0b4',
    warn: '#ffcf6b'
  }
};

let allPass = true;

for (const [name, t] of Object.entries(THEMES)) {
  const surfaceDark = composite(t.glass, t.glassAlpha, t.backdropBase);
  const surfaceLight = composite(t.glass, t.glassAlpha, t.backdropInk);
  // surface-2 (inputs, chips) is a touch lighter than the panel it sits on
  const s2Scrim = toHex(rgb(t.glass).map((v) => Math.min(255, v + 12)));
  const surface2Dark = composite(s2Scrim, t.glassAlpha, t.backdropBase);
  const surface2Light = composite(s2Scrim, t.glassAlpha, t.backdropInk);

  console.log(`\n=== ${name} ===`);
  console.log(`  glass ${t.glass} @ ${t.glassAlpha} over ${t.backdropBase} → ${surfaceDark}`);
  console.log(`  glass ${t.glass} @ ${t.glassAlpha} over ${t.backdropInk} → ${surfaceLight}`);
  console.log(`  surface-2 scrim ${s2Scrim} → ${surface2Dark} / ${surface2Light}`);
  console.log(`  backdrop luminance range: ${luminance(t.backdropBase).toFixed(4)} … ${luminance(t.backdropInk).toFixed(4)}`);

  for (const [fg, bgName] of PAIRS) {
    const backgrounds = bgName === 'surface'
      ? { dark: surfaceDark, light: surfaceLight }
      : bgName === 'surface-2'
        ? { dark: surface2Dark, light: surface2Light }
        : { only: t[bgName] };

    for (const [variant, bg] of Object.entries(backgrounds)) {
      const ratio = contrast(t[fg], bg);
      const pass = ratio >= 4.5;
      if (!pass) allPass = false;
      if (!pass || process.env.VERBOSE) {
        console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${fg} on ${bgName}(${variant}) = ${ratio.toFixed(2)}:1`);
      }
    }
  }

  // every colour the canvas may draw must sit inside [base, ink]
  const lo = luminance(t.backdropBase);
  const hi = luminance(t.backdropInk);
  console.log(`  all pairs ${allPass ? 'pass' : 'INCLUDE FAILURES'} (range ${lo.toFixed(4)}–${hi.toFixed(4)})`);
}

console.log(allPass ? '\nALL THEMES PASS at both backdrop extremes' : '\nSOME PAIRS FAIL');
process.exit(allPass ? 0 : 1);
