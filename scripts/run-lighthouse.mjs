/* Runs Lighthouse against a locally served build and records the scores.
 * Gates on Accessibility >= 90 and PWA >= 90 (the acceptance criteria).
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

const { server, port } = await listen(0);
const url = `http://127.0.0.1:${port}/index.html`;

const chromePath = findChromium();
const chrome = await chromeLauncher.launch({
  ...(chromePath ? { chromePath } : {}),
  chromeFlags: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
});

let report;
try {
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

  report = {
    measuredAt: new Date().toISOString(),
    lighthouseVersion: lhr.lighthouseVersion,
    url: lhr.finalDisplayedUrl,
    formFactor: lhr.configSettings.formFactor,
    scores,
    gates: GATES,
    passes: Object.entries(GATES).every(([key, min]) => scores[key] === undefined || scores[key] >= min),
    failedAudits: failedAudits.slice(0, 25)
  };

  mkdirSync(join(ROOT, '.reports'), { recursive: true });
  writeFileSync(join(ROOT, '.reports/lighthouse.json'), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Lighthouse ${lhr.lighthouseVersion} (${lhr.configSettings.formFactor})`);
  for (const [key, value] of Object.entries(scores)) {
    const gate = GATES[key];
    console.log(`  ${key.padEnd(16)} ${String(value).padStart(3)}${gate ? `  (gate ${gate}) ${value >= gate ? 'PASS' : 'FAIL'}` : ''}`);
  }
  for (const key of CATEGORIES) {
    if (scores[key] === undefined) console.log(`  ${key.padEnd(16)}  n/a  (category not provided by this Lighthouse version)`);
  }
} finally {
  await chrome.kill();
  await new Promise((resolve) => server.close(resolve));
}

process.exit(report?.passes ? 0 : 1);
