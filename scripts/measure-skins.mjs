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
 *   - The gate counts main-thread work only. GPU compositing of the
 *     backdrop-filter blur does not appear in it, and on a phone that blur is
 *     likely the larger cost of the two.
 *   - Since the WebGL2 pass the per-pixel work runs in the GPU process. Headless
 *     Chromium here has no GPU, so SwiftShader does that work *on the CPU*; its
 *     cost is reported separately ("GPU proc") from SystemInfo.getProcessInfo.
 *     That is a deliberately pessimistic stand-in — a phone does it on silicon
 *     built for it — so it is recorded, not gated. Each skin's 2D fallback is
 *     measured too, since that is what runs wherever WebGL2 does not.
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
const SKINS = ['terminal', 'fractal', 'forge', 'kemet', 'monolith'];

if (!findChromium()) {
  console.error('No Chromium available — cannot measure skins.');
  process.exit(1);
}

const { server, port } = await listen(0);
const browser = await launch(chromium);

const browserCDP = await browser.newBrowserCDPSession();

/** Cumulative CPU seconds of the GPU process (SwiftShader, here). */
async function gpuCpuSeconds() {
  try {
    const { processInfo } = await browserCDP.send('SystemInfo.getProcessInfo');
    return processInfo.filter((p) => p.type === 'GPU').reduce((n, p) => n + p.cpuTime, 0);
  } catch {
    return null;
  }
}

async function metricsOf(client) {
  const { metrics } = await client.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

/** One measured run at a given theme. `staticMode` forces the reduced-effects path. */
async function measure(theme, { staticMode = false, renderer = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 412, height: 900 } });
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await client.send('Performance.enable');

  const query = `?theme=${theme}${staticMode ? '&static=1' : ''}${renderer ? `&renderer=${renderer}` : ''}`;
  await page.goto(`http://127.0.0.1:${port}/index.html${query}`, { waitUntil: 'load' });
  await page.waitForSelector('#start-session');
  await page.waitForTimeout(SETTLE_MS);          // ignore boot cost

  const before = await metricsOf(client);
  const gpuBefore = await gpuCpuSeconds();
  const framesBefore = await page.evaluate(() => window.__backdrop?.getDiagnostics().frames ?? 0);
  const wallBefore = Date.now();

  await page.waitForTimeout(SAMPLE_MS);

  const after = await metricsOf(client);
  const gpuAfter = await gpuCpuSeconds();
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
    gpuProcessPercent: gpuBefore === null ? null : Math.round(((gpuAfter - gpuBefore) * 1000 / wallMs) * 1000) / 10,
    renderer: diagnostics?.renderer ?? null,
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
    const fallback = await measure(skin, { renderer: '2d' });
    /* The gate, per renderer. 2D: total main-thread time, which really is
     * CPU work. WebGL2: the app's own JavaScript (ScriptDuration) — the rest of
     * its main-thread time here is the thread blocked on SwiftShader doing GPU
     * work on the CPU, which a phone's GPU does asynchronously. That blocked
     * time and the GPU process's CPU are recorded below, not hidden. */
    const gl = animated.renderer === 'webgl2';
    const appCost = gl ? animated.scriptPercent - baseline.scriptPercent : animated.cpuPercent - baseline.cpuPercent;
    report.runs[skin] = {
      animated,
      static: still,
      fallback2d: fallback,
      gatedOn: gl ? 'script' : 'task',
      overBaselinePercent: Math.round(appCost * 10) / 10,
      withinBudget: appCost <= BUDGET_PERCENT && (fallback.cpuPercent - baseline.cpuPercent) <= BUDGET_PERCENT
    };
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

mkdirSync(join(ROOT, '.reports'), { recursive: true });
writeFileSync(join(ROOT, '.reports/skins.json'), `${JSON.stringify(report, null, 2)}\n`);

console.log(`Skin cost — headless Chromium (no GPU: WebGL2 runs on SwiftShader), ${SAMPLE_MS / 1000}s samples\n`);
console.log(`  baseline (light, no canvas)   ${report.baseline.cpuPercent.toFixed(1)}% CPU`);
console.log('');
for (const skin of SKINS) {
  const r = report.runs[skin];
  console.log(`  ${skin.padEnd(10)} ${r.animated.renderer.padEnd(7)}  app JS +${r.overBaselinePercent}%  (main thread ${r.animated.cpuPercent}% incl. blocked on SwiftShader; GPU proc ${r.animated.gpuProcessPercent ?? 'n/a'}%)  ${r.animated.fps} fps  ${r.animated.backingStore.w}×${r.animated.backingStore.h}  ${r.withinBudget ? 'PASS' : 'OVER BUDGET'}`);
  console.log(`  ${' '.repeat(10)} 2d       ${String(r.fallback2d.cpuPercent).padStart(5)}% CPU  ${r.fallback2d.fps} fps  (the fallback where WebGL2 is unavailable)`);
  console.log(`  ${' '.repeat(10)} static    ${String(r.static.cpuPercent).padStart(5)}% CPU  ${r.static.frames} frames drawn while sampling (expected 0 — the frame is held)`);
}

const allWithin = SKINS.every((s) => report.runs[s].withinBudget);
console.log(`\n${allWithin ? '✅' : '❌'} ${allWithin ? 'Every skin is within the budget' : 'A skin exceeds the budget and must be simplified'} (+${BUDGET_PERCENT}% over baseline).`);
process.exit(allWithin ? 0 : 1);
