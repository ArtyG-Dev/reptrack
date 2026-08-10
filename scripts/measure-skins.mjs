/* Measures what each skin actually costs.
 *
 * Method: serve the app, load it with `?theme=<skin>`, let the backdrop run,
 * and sample Chrome DevTools' `Performance.getMetrics` before and after.
 * `TaskDuration` is cumulative main-thread task time in seconds, so
 * ΔTaskDuration / Δwallclock is the fraction of one core the renderer's main
 * thread spent working. The Light theme (no canvas at all) is measured the same
 * way as a baseline, and each skin is reported both absolutely and as the
 * increment over that baseline — the increment is the number that answers
 * "what did adding this skin cost".
 *
 * Honest limits, repeated in ACCEPTANCE.md rather than buried here:
 *   - This is headless Chromium on a desktop-class CPU, not a mid-range Android
 *     phone. It is a proxy for the budget in the brief, not a measurement of it.
 *     The device check stays in MANUAL_TEST.md.
 *   - It counts main-thread work only. GPU compositing of the backdrop-filter
 *     blur does not appear here, and on a phone that blur is likely the larger
 *     cost of the two.
 *
 * Run: npm run skins
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { chromium } from 'playwright';
import { listen } from './serve.mjs';
import { findChromium, launch } from '../tests/helpers/browser.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_MS = Number(process.env.SAMPLE_MS || 6000);
const SETTLE_MS = 1500;
const BUDGET_PERCENT = 5;             // the brief's budget, on a mid-range Android
const SKINS = ['terminal', 'fractal', 'forge'];

if (!findChromium()) {
  console.error('No Chromium available — cannot measure skins.');
  process.exit(1);
}

const { server, port } = await listen(0);
const browser = await launch(chromium);

async function metricsOf(client) {
  const { metrics } = await client.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

/** One measured run at a given theme. `staticMode` forces the reduced-effects path. */
async function measure(theme, { staticMode = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 412, height: 900 } });
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await client.send('Performance.enable');

  const query = `?theme=${theme}${staticMode ? '&static=1' : ''}`;
  await page.goto(`http://127.0.0.1:${port}/index.html${query}`, { waitUntil: 'load' });
  await page.waitForSelector('#start-session');
  await page.waitForTimeout(SETTLE_MS);          // ignore boot cost

  const before = await metricsOf(client);
  const framesBefore = await page.evaluate(() => window.__backdrop?.getDiagnostics().frames ?? 0);
  const wallBefore = Date.now();

  await page.waitForTimeout(SAMPLE_MS);

  const after = await metricsOf(client);
  const wallMs = Date.now() - wallBefore;
  const diagnostics = await page.evaluate(() => window.__backdrop?.getDiagnostics() ?? null);
  const frames = (diagnostics?.frames ?? 0) - framesBefore;

  const taskMs = (after.TaskDuration - before.TaskDuration) * 1000;
  const scriptMs = (after.ScriptDuration - before.ScriptDuration) * 1000;

  await context.close();

  return {
    theme,
    staticMode,
    wallMs,
    frames,
    fps: Math.round((frames / wallMs) * 1000 * 10) / 10,
    cpuPercent: Math.round((taskMs / wallMs) * 1000) / 10,
    scriptPercent: Math.round((scriptMs / wallMs) * 1000) / 10,
    backingStore: diagnostics?.backingStore ?? null,
    running: diagnostics?.running ?? false,
    static: diagnostics?.static ?? false
  };
}

const report = { measuredAt: new Date().toISOString(), sampleMs: SAMPLE_MS, budgetPercent: BUDGET_PERCENT, runs: {} };

try {
  const baseline = await measure('light');
  report.baseline = baseline;

  for (const skin of SKINS) {
    const animated = await measure(skin);
    const still = await measure(skin, { staticMode: true });
    report.runs[skin] = {
      animated,
      static: still,
      overBaselinePercent: Math.round((animated.cpuPercent - baseline.cpuPercent) * 10) / 10,
      withinBudget: (animated.cpuPercent - baseline.cpuPercent) <= BUDGET_PERCENT
    };
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

mkdirSync(join(ROOT, '.reports'), { recursive: true });
writeFileSync(join(ROOT, '.reports/skins.json'), `${JSON.stringify(report, null, 2)}\n`);

console.log(`Skin cost — headless Chromium, ${SAMPLE_MS / 1000}s samples, main thread only\n`);
console.log(`  baseline (light, no canvas)   ${report.baseline.cpuPercent.toFixed(1)}% CPU`);
console.log('');
for (const skin of SKINS) {
  const r = report.runs[skin];
  console.log(`  ${skin.padEnd(10)} animated  ${String(r.animated.cpuPercent).padStart(5)}% CPU  (+${r.overBaselinePercent}% over baseline)  ${r.animated.fps} fps  ${r.animated.backingStore.w}×${r.animated.backingStore.h}  ${r.withinBudget ? 'PASS' : 'OVER BUDGET'}`);
  console.log(`  ${' '.repeat(10)} static    ${String(r.static.cpuPercent).padStart(5)}% CPU  ${r.static.frames} frames drawn while sampling (expected 0 — the frame is held)`);
}

const allWithin = SKINS.every((s) => report.runs[s].withinBudget);
console.log(`\n${allWithin ? '✅' : '❌'} ${allWithin ? 'Every skin is within the budget' : 'A skin exceeds the budget and must be simplified'} (+${BUDGET_PERCENT}% over baseline).`);
process.exit(allWithin ? 0 : 1);
