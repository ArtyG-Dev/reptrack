/* What the 3D muscle map costs, measured the way scripts/measure-skins.mjs
 * measures the skins: Chrome DevTools' Performance.getMetrics before and after
 * a sample, so ΔScriptDuration / Δwallclock is the share of one core spent in
 * the app's JavaScript (ΔTaskDuration, all main-thread work, is reported too).
 *
 *   1. baseline   — the Today screen in Light: no canvas, nothing animating
 *   2. progress   — Progress with the 3D figure on screen, untouched
 *                   (drawn on demand, so this should cost nothing)
 *   3. fullscreen — the full-screen view turning by itself at ≤ 30 fps
 *
 * The same honest limits apply as for the skins: headless Chromium on a
 * desktop CPU, with WebGL on SwiftShader, so the per-pixel work lands on the
 * CPU in the GPU process and is not in these numbers. A proxy for a phone, not
 * a phone; the device check is in MANUAL_TEST.md.
 *
 * Run: node scripts/measure-musclemap.mjs   (writes .reports/musclemap.json)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { listen } from './serve.mjs';
import { findChromium, launch } from '../tests/helpers/browser.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_MS = Number(process.env.SAMPLE_MS || 6000);
const BUDGET_PERCENT = 5;

if (!findChromium()) { console.error('No Chromium available.'); process.exit(1); }

const { server, port } = await listen(0);
const browser = await launch(chromium);

async function sample(page, cdp) {
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const frames0 = await page.evaluate(() => window.__muscleMap.get().frames);
  const before = await metrics();
  const t0 = Date.now();
  await page.waitForTimeout(SAMPLE_MS);
  const after = await metrics();
  const wallMs = Date.now() - t0;
  const frames = (await page.evaluate(() => window.__muscleMap.get().frames)) - frames0;
  const pct = (key) => Math.round((((after[key] - before[key]) * 1000) / wallMs) * 1000) / 10;
  return { script: pct('ScriptDuration'), task: pct('TaskDuration'), fps: Math.round((frames / wallMs) * 10000) / 10 };
}

const results = {};
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(`http://127.0.0.1:${port}/index.html?theme=light`, { waitUntil: 'load' });
  await page.waitForSelector('#start-session');
  await page.click('#start-session');
  for (const p of ['squat 100 kilos for 5', 'bench press 60 kilos for 8', 'deadlift 140 kilos for 3']) {
    await page.click('#mic-button'); await page.fill('#prompt-input', p); await page.click('#prompt-sheet button[type="submit"]');
    await page.click('#confirm-sheet button[type="submit"]'); await page.waitForSelector('#confirm-sheet', { state: 'hidden' });
  }
  await page.waitForTimeout(1500);
  results.baseline = await sample(page, cdp);

  await page.click('#tab-progress');
  await page.waitForSelector('#mm-stage canvas');
  await page.waitForTimeout(1500);
  results.progress = await sample(page, cdp);

  await page.click('#mm-open-full');
  await page.waitForFunction(() => window.__muscleMap.get().running);
  await page.waitForTimeout(1500);
  results.fullscreen = await sample(page, cdp);
  results.mode = (await page.evaluate(() => window.__muscleMap.get())).mode;
  await context.close();
} finally {
  await browser.close();
  server.close();
}

const over = (r) => Math.round((r.script - results.baseline.script) * 10) / 10;
results.progress.overBaselinePercent = over(results.progress);
results.fullscreen.overBaselinePercent = over(results.fullscreen);
results.withinBudget = results.fullscreen.overBaselinePercent <= BUDGET_PERCENT && results.progress.overBaselinePercent <= BUDGET_PERCENT;

console.log(`Muscle map — headless Chromium (WebGL on SwiftShader), ${SAMPLE_MS / 1000}s samples, renderer: ${results.mode}`);
console.log(`  baseline (Today, Light)        app JS ${results.baseline.script}%  main thread ${results.baseline.task}%`);
console.log(`  Progress, 3D figure, untouched app JS +${results.progress.overBaselinePercent}%  ${results.progress.fps} fps (drawn on demand)`);
console.log(`  full screen, turning           app JS +${results.fullscreen.overBaselinePercent}%  main thread ${results.fullscreen.task}%  ${results.fullscreen.fps} fps`);
console.log(results.withinBudget ? `✅ within the budget (+${BUDGET_PERCENT}% over baseline)` : `❌ over the budget (+${BUDGET_PERCENT}%)`);

mkdirSync(join(ROOT, '.reports'), { recursive: true });
writeFileSync(join(ROOT, '.reports', 'musclemap.json'), JSON.stringify(results, null, 2));
process.exit(results.withinBudget ? 0 : 1);
