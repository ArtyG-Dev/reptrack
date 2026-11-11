/* Runs Lighthouse against a locally served build and records the scores.
 * Runs twice — once per colour scheme (?theme=light, ?theme=neon), via the
 * preview override app.js reads from the URL — because "High-Contrast Neon"
 * must be exactly as accessible as the default, not just bold-looking.
 * Gates on Accessibility >= 90 for BOTH themes and PWA >= 90 for the default.
 *
 * Run: npm run lighthouse
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

import { listen } from './serve.mjs';
import { findChromium } from '../tests/helpers/browser.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATES = { accessibility: 90, pwa: 90 };
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo', 'pwa'];
const THEMES = ['light', 'neon', 'terminal', 'fractal', 'forge', 'kemet', 'monolith', 'constellation'];

const { server, port } = await listen(0);

const chromePath = findChromium();
const chrome = await chromeLauncher.launch({
  ...(chromePath ? { chromePath } : {}),
  chromeFlags: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
});

async function runOne(theme) {
  const url = `http://127.0.0.1:${port}/index.html?theme=${theme}`;
  const runnerResult = await lighthouse(url, {
    port: chrome.port,
    output: 'json',
    logLevel: 'error',
    onlyCategories: CATEGORIES
  });

  const lhr = runnerResult.lhr;
  const scores = {};
  for (const key of CATEGORIES) {
    const category = lhr.categories[key];
    if (category && category.score !== null) scores[key] = Math.round(category.score * 100);
  }
  const failedAudits = Object.values(lhr.audits)
    .filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'informative')
    .map((a) => ({ id: a.id, title: a.title, score: a.score }));

  return { theme, lighthouseVersion: lhr.lighthouseVersion, url: lhr.finalDisplayedUrl, formFactor: lhr.configSettings.formFactor, scores, failedAudits: failedAudits.slice(0, 25) };
}

let report;
try {
  const runs = {};
  for (const theme of THEMES) runs[theme] = await runOne(theme);

  const light = runs.light;
  const accessibilityPasses = THEMES.every((theme) => (runs[theme].scores.accessibility ?? 0) >= GATES.accessibility);
  const pwaPasses = (light.scores.pwa ?? 0) >= GATES.pwa;

  report = {
    measuredAt: new Date().toISOString(),
    lighthouseVersion: light.lighthouseVersion,
    url: light.url,
    formFactor: light.formFactor,
    scores: light.scores,          // backward-compat: the default/light run
    gates: GATES,
    themes: Object.fromEntries(THEMES.map((t) => [t, { scores: runs[t].scores }])),
    passes: accessibilityPasses && pwaPasses,
    failedAudits: light.failedAudits
  };

  mkdirSync(join(ROOT, '.reports'), { recursive: true });
  writeFileSync(join(ROOT, '.reports/lighthouse.json'), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Lighthouse ${light.lighthouseVersion} (${light.formFactor})`);
  for (const theme of THEMES) {
    console.log(`\n  Theme: ${theme}`);
    for (const key of CATEGORIES) {
      const value = runs[theme].scores[key];
      const gate = key === 'pwa' && theme !== 'light' ? undefined : GATES[key];
      if (value === undefined) { console.log(`    ${key.padEnd(16)}  n/a`); continue; }
      console.log(`    ${key.padEnd(16)} ${String(value).padStart(3)}${gate ? `  (gate ${gate}) ${value >= gate ? 'PASS' : 'FAIL'}` : ''}`);
    }
  }
} finally {
  await chrome.kill();
  await new Promise((resolve) => server.close(resolve));
}

process.exit(report?.passes ? 0 : 1);
