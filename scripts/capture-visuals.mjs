/* Screenshot evidence for VISUALS.md: every animated skin at intensity 0, 0.5
 * and 1, on the Today view and in the full-screen graphic view.
 *
 * Intensity is set by feeding the renderer simulated metrics through
 * window.__backdrop.setActivity (streak 0/5/10, month 0/50/100%) — the same
 * hook the browser tests use — so each shot shows exactly the level it is
 * named for. The full-screen level label reads the same values.
 *
 *   npm run visuals                     # against a local server → docs/screenshots/
 *   npm run visuals -- --url <site>     # against a deployed copy → docs/screenshots/live/
 *
 * Headless Chromium has no GPU here; WebGL2 runs on SwiftShader. The pixels
 * are the same ones a GPU would produce — only the speed differs.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { chromium } from 'playwright';
import { listen } from './serve.mjs';
import { findChromium, launch } from '../tests/helpers/browser.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKINS = ['kemet', 'forge', 'fractal', 'terminal'];
const LEVELS = [[0, 0, 0], [0.5, 5, 0.5], [1, 10, 1]];   // [intensity, streakLevel, monthPercent]
const VIEWPORT = { width: 393, height: 852 };

if (!findChromium()) {
  console.error('No Chromium available — cannot capture screenshots.');
  process.exit(1);
}

const urlArg = process.argv.indexOf('--url');
const remote = urlArg > -1 ? process.argv[urlArg + 1].replace(/\/?$/, '/') : null;
const outDir = join(ROOT, 'docs/screenshots', remote ? 'live' : '');
mkdirSync(outDir, { recursive: true });

const local = remote ? null : await listen(0);
const base = remote || `http://127.0.0.1:${local.port}/`;
const browser = await launch(chromium);
const manifest = { capturedAt: new Date().toISOString(), source: remote ? 'live' : 'local', shots: [] };

try {
  for (const skin of SKINS) {
    for (const [k, streakLevel, monthPercent] of LEVELS) {
      const context = await browser.newContext({ viewport: VIEWPORT });
      const page = await context.newPage();
      await page.goto(`${base}index.html?theme=${skin}`, { waitUntil: 'load' });
      await page.waitForFunction((s) => window.__backdrop?.getDiagnostics().skin === s, skin, { timeout: 15000 });
      await page.evaluate(([lv, mp]) => window.__backdrop.setActivity({ glow: lv / 10, streakLevel: lv, streakFraction: lv / 10, monthPercent: mp }), [streakLevel, monthPercent]);
      await page.waitForTimeout(2500);

      const name = `${skin}-${String(k).replace('.', '_')}`;
      await page.screenshot({ path: join(outDir, `${name}-today.jpg`), type: 'jpeg', quality: 82 });
      await page.click('#view-graphic');
      await page.waitForTimeout(2500);
      await page.screenshot({ path: join(outDir, `${name}-full.jpg`), type: 'jpeg', quality: 82 });

      const d = await page.evaluate(() => window.__backdrop.getDiagnostics());
      manifest.shots.push({ skin, intensity: k, streakLevel, monthPercent, renderer: d.renderer, frames: d.frames, label: await page.textContent('#graphic-level') });
      console.log(`  ${name}  ${d.renderer}  ${await page.textContent('#graphic-level')}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  if (local) await new Promise((resolve) => local.server.close(resolve));
}

writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\n✔ ${manifest.shots.length * 2} screenshots in ${outDir}`);
