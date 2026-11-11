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
const SKINS = ['kemet', 'forge', 'fractal', 'terminal', 'monolith', 'constellation'];
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

  /* Forge plates: levels 0/3/6/10, cool and white-hot, in a held (reduced
   * motion) frame so each shot shows exactly its level's plates; the mixed
   * colours at heat 1; one slide-on caught mid-way; and a drag. */
  const shoot = async (page, name) => {
    await page.screenshot({ path: join(outDir, `${name}.jpg`), type: 'jpeg', quality: 85 });
    console.log(`  ${name}`);
  };
  const setLevel = (page, lv, mp) => page.evaluate(([l, m]) => window.__backdrop.setActivity({ glow: l / 10, streakLevel: l, streakFraction: l / 10, monthPercent: m }), [lv, mp]);
  {
    const context = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${base}index.html?theme=forge`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__backdrop?.getDiagnostics().skin === 'forge', null, { timeout: 15000 });
    await page.click('#view-graphic');
    await page.click('#graphic-level-toggle');                 // hide the label: the plates are the subject
    for (const [mp, heat] of [[0, 'cool'], [1, 'hot']]) {
      for (const lv of [0, 3, 6, 10]) { await setLevel(page, lv, mp); await shoot(page, `forge-plates-L${lv}-${heat}`); }
    }
    for (const lv of [4, 5, 9]) { await setLevel(page, lv, 1); await shoot(page, `forge-plates-L${lv}-hot`); }
    await setLevel(page, 6, 0.3);
    await shoot(page, 'forge-drag-before');
    await page.mouse.move(150, 500);
    await page.mouse.down();
    await page.mouse.move(200, 420, { steps: 5 });
    await page.mouse.up();
    await shoot(page, 'forge-drag-after');
    await context.close();
  }
  {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    await page.goto(`${base}index.html?theme=forge`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__backdrop?.getDiagnostics().skin === 'forge', null, { timeout: 15000 });
    await page.click('#view-graphic');
    await page.click('#graphic-level-toggle');
    await setLevel(page, 3, 0.3);
    await page.waitForTimeout(800);
    await setLevel(page, 4, 0.3);                               // a small plate slides on
    await page.waitForFunction(() => { const m = window.__backdrop.getDiagnostics().plates.moving; return m && m.dir === 'on' && m.t > 0.3 && m.t < 0.7; }, null, { timeout: 5000, polling: 16 });
    await shoot(page, 'forge-plates-sliding-on');
    await context.close();
  }

  /* Kemet's base, seen from below; Forge vs Kemet spin ~1 s apart; Terminal
   * katakana at 0.5 and the forced Latin fallback. */
  const openFull = async (theme, { reduced = false, init = null } = {}) => {
    const context = await browser.newContext({ viewport: VIEWPORT, ...(reduced ? { reducedMotion: 'reduce' } : {}) });
    if (init) await context.addInitScript(init);
    const page = await context.newPage();
    await page.goto(`${base}index.html?theme=${theme}`, { waitUntil: 'load' });
    await page.waitForFunction((t) => window.__backdrop?.getDiagnostics().skin === t, theme, { timeout: 15000 });
    return { context, page };
  };
  {
    const { context, page } = await openFull('kemet', { reduced: true });
    await setLevel(page, 6, 0.6);
    await page.click('#view-graphic');
    await page.click('#graphic-level-toggle');
    await page.mouse.move(200, 600);
    await page.mouse.down();
    await page.mouse.move(200, 469, { steps: 8 });                // ~π/2: the underside faces the camera
    await page.mouse.up();
    await shoot(page, 'kemet-base-underside');
    await context.close();
  }
  for (const theme of ['kemet', 'forge']) {
    const { context, page } = await openFull(theme);
    await setLevel(page, 10, 1);
    await page.click('#view-graphic');
    await page.click('#graphic-level-toggle');
    await page.waitForFunction(() => window.__backdrop.getDiagnostics().intensity > 0.95, null, { timeout: 20000 });
    await shoot(page, `${theme}-spin-a`);
    await page.waitForTimeout(1000);
    await shoot(page, `${theme}-spin-b`);
    await context.close();
  }
  for (const [name, init] of [['terminal-katakana', null], ['terminal-latin-fallback', () => {
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, ...r) { return fill.call(this, String(t).replace(/[\uFF66-\uFF9D]/g, '\uFFFF'), ...r); };
  }]]) {
    const { context, page } = await openFull('terminal', { init });
    await setLevel(page, 5, 0.5);
    await page.click('#view-graphic');
    await page.click('#graphic-level-toggle');
    await page.waitForTimeout(2500);
    await shoot(page, name);
    await context.close();
  }

  /* Terminal look-around at its clamps; Fractal recoloured. */
  {
    const { context, page } = await openFull('terminal', { reduced: true });
    await setLevel(page, 6, 0.6);
    await page.click('#view-graphic');
    await page.click('#graphic-level-toggle');
    for (const [name, dx, dy] of [['left', -700, 0], ['right', 700, 0], ['up', 0, -600], ['down', 0, 600], ['corner', 700, -600]]) {
      await page.mouse.move(196, 426);
      await page.mouse.down();
      await page.mouse.move(196 + dx, 426 + dy, { steps: 10 });
      await shoot(page, `terminal-orbit-${name}`);              // held at the clamp, mid-drag
      await page.mouse.up();
    }
    await shoot(page, 'terminal-orbit-centre');
    await context.close();
  }
  {
    const { context, page } = await openFull('fractal', { reduced: true });
    await setLevel(page, 10, 1);
    await page.click('#view-graphic');
    if (await page.$eval('#graphic-hint', (n) => !n.hidden)) await shoot(page, 'fractal-colour-hint');
    await page.click('#graphic-hint-dismiss').catch(() => {});
    await page.click('#graphic-level-toggle');
    for (const [h, w] of [[0, 0], [90, 0], [180, 0], [270, 0], [0, 1], [0, -1]]) {
      await page.evaluate(([hh, ww]) => window.__backdrop.setTint({ hue: (hh * Math.PI) / 180, warmth: ww }), [h, w]);
      await shoot(page, `fractal-colour-h${h}-w${w}`);
    }
    await page.evaluate(() => window.__backdrop.setTint({ hue: Math.PI / 2, warmth: 0.6 }));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await shoot(page, 'fractal-colour-today');                  // the chosen colours, in the normal Today view
    await context.close();
  }
} finally {
  await browser.close();
  if (local) await new Promise((resolve) => local.server.close(resolve));
}

writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\n✔ ${manifest.shots.length * 2} screenshots in ${outDir}`);
