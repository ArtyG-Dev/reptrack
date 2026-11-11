/* Visual verification for the WebGL2 skins and the full-screen view — proof
 * that the scenes render, move, hold still when they must, stay readable and
 * stay flash-safe, measured from real pixels in real Chromium rather than
 * inferred from the source. Skips cleanly when no Chromium is available.
 *
 * Headless Chromium renders WebGL2 through SwiftShader (on the CPU), so frame
 * *rates* here say nothing about a phone GPU; everything asserted below is
 * about what is drawn, not how fast.
 */

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { listen } from '../scripts/serve.mjs';
import { findChromium, launch } from './helpers/browser.mjs';
import { maxInWindow, FLASH, ROTATION } from '../js/theme-engine.js';

const SKINS = ['kemet', 'forge', 'fractal', 'terminal', 'monolith', 'constellation'];
const VIEWPORT = { width: 393, height: 852 };      // a typical Android phone, CSS px

/** streakLevel / monthPercent pairs that put the shared intensity at 0, 0.5, 1. */
const LEVELS = { 0: [0, 0], 0.5: [5, 0.5], 1: [10, 1] };

describe('visuals', { skip: findChromium() ? false : 'no Chromium build available' }, () => {
  let server;
  let base;
  let browser;

  before(async () => {
    const started = await listen(0);
    server = started.server;
    base = `http://127.0.0.1:${started.port}/index.html`;
    browser = await launch(chromium);
  });

  after(async () => {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  });

  async function open(theme, { query = '', init, context: options = {} } = {}) {
    const context = await browser.newContext({ viewport: VIEWPORT, ...options });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    if (init) await page.addInitScript(init);
    await page.goto(`${base}?theme=${theme}${query}`, { waitUntil: 'load' });
    await page.waitForFunction((t) => window.__backdrop?.getDiagnostics().skin === t, theme, { timeout: 8000 });
    return { context, page, errors };
  }

  async function intensity(page, k) {
    const [streakLevel, monthPercent] = LEVELS[k];
    await page.evaluate(([lv, mp]) => window.__backdrop.setActivity({ glow: lv / 10, streakLevel: lv, streakFraction: lv / 10, monthPercent: mp }), [streakLevel, monthPercent]);
  }

  const diag = (page) => page.evaluate(() => window.__backdrop.getDiagnostics());

  test('every skin renders through WebGL2 at min(devicePixelRatio, 2)', async () => {
    for (const theme of SKINS) {
      const { context, page, errors } = await open(theme, { context: { deviceScaleFactor: 3 } });
      const d = await diag(page);
      assert.equal(d.renderer, 'webgl2', `${theme} should be on the WebGL2 renderer`);
      assert.equal(d.backingStore.w, VIEWPORT.width * 2, `${theme}: DPR 3 must be capped to 2× (got ${d.backingStore.w})`);
      assert.equal(await page.getAttribute('html', 'data-renderer'), 'webgl');
      assert.deepEqual(errors, []);
      await context.close();
    }
  });

  test('the animation is actually running: two frames 500 ms apart differ, on Today and full screen', async () => {
    for (const theme of SKINS) {
      const { context, page } = await open(theme);
      await intensity(page, 0.5);
      await page.waitForTimeout(600);
      const a = await page.screenshot();
      await page.waitForTimeout(500);
      const b = await page.screenshot();
      assert.ok(!a.equals(b), `${theme}: Today view did not change in 500 ms — the scene is frozen`);

      await page.click('#view-graphic');
      await page.waitForTimeout(600);
      const c = await page.screenshot();
      await page.waitForTimeout(500);
      const d = await page.screenshot();
      assert.ok(!c.equals(d), `${theme}: full-screen view did not change in 500 ms`);
      await context.close();
    }
  });

  test('prefers-reduced-motion holds one identical frame, and the ten tiers are still there to count', async () => {
    for (const theme of SKINS) {
      const { context, page } = await open(theme, { context: { reducedMotion: 'reduce' } });
      await intensity(page, 0.5);
      await page.waitForTimeout(300);
      const a = await page.screenshot();
      await page.waitForTimeout(700);
      const b = await page.screenshot();
      assert.ok(a.equals(b), `${theme}: reduced-motion frames must be pixel-identical`);
      const d = await diag(page);
      assert.equal(d.running, false);
      assert.equal(d.renderer, 'webgl2', 'still the 3D scene, just held still');
      await context.close();
    }

    // Kemet: count the tier seams down the middle of the front face in the
    // held frame. Level 6 → six lit tiers, and nine seams between ten tiers.
    const { context, page } = await open('kemet', { context: { reducedMotion: 'reduce' } });
    await page.evaluate(() => window.__backdrop.setActivity({ glow: 0.6, streakLevel: 6, streakFraction: 0.6, monthPercent: 0 }));
    const { lit, seams } = await page.evaluate(() => {
      const d = window.__backdrop.getDiagnostics();
      const { data, width, height } = window.__backdrop.readPixels();
      const x = Math.round(width / 2);
      const top = Math.floor(d.featureBand.y);
      const bottom = Math.floor(d.featureBand.y + d.featureBand.h);
      // Seams are drawn in --backdrop-glyph (teal, green well above red); the
      // unlit stone is violet and the lit gold is warm, both with green at or
      // below red. Measured: seam ≈ +44, stone ≈ −8, gold ≈ −24.
      let inSeam = false;
      let seams = 0;
      for (let y = top; y < bottom; y += 1) {
        const i = (y * width + x) * 4;
        const seam = data[i + 1] - data[i] > 25;
        if (seam && !inSeam) seams += 1;
        inSeam = seam;
      }
      return { lit: d.tierGlow.filter((v) => v > 0.5).length, seams };
    });
    assert.equal(lit, 6, 'six tiers lit at level 6');
    assert.ok(seams >= 8 && seams <= 10, `the static frame should show the tier seams (found ${seams}, expected 9)`);
    await context.close();
  });

  /** Text over the graphic: composite each card's real glass background over
   *  the real backdrop pixels behind it, and check the text against the worst
   *  of them. This is the 4.5:1 floor measured from a frame, not reasoned. */
  async function worstTextContrast(page) {
    return page.evaluate(() => {
      const { data, width, height } = window.__backdrop.readPixels();
      const sx = width / innerWidth;
      const sy = height / innerHeight;
      const ch = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      const lum = ([r, g, b]) => 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const rgba = (s) => (s.match(/[\d.]+/g) || []).map(Number);
      let worst = Infinity;
      let where = '';
      for (const node of document.querySelectorAll('.card h2, .card h3, .card p, .card .btn, .graphic-level, .graphic-btn')) {
        if (!node.offsetParent && node.getClientRects().length === 0) continue;
        const text = rgba(getComputedStyle(node).color).slice(0, 3);
        // The nearest ancestor with a painted background is what sits behind the text.
        let host = node;
        let bg = rgba(getComputedStyle(host).backgroundColor);
        while (host && (bg.length < 3 || bg[3] === 0)) { host = host.parentElement; bg = host ? rgba(getComputedStyle(host).backgroundColor) : []; }
        const [br, bgc, bb, ba = 1] = bg;
        const r = node.getBoundingClientRect();
        for (let y = Math.floor(r.top * sy); y < Math.ceil(r.bottom * sy); y += 2) {
          for (let x = Math.floor(r.left * sx); x < Math.ceil(r.right * sx); x += 2) {
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const i = (y * width + x) * 4;
            const behind = [br * ba + data[i] * (1 - ba), bgc * ba + data[i + 1] * (1 - ba), bb * ba + data[i + 2] * (1 - ba)];
            const c = ratio(text, behind);
            if (c < worst) { worst = c; where = node.textContent.trim().slice(0, 30); }
          }
        }
      }
      return { worst, where };
    });
  }

  test('text over the graphic holds 4.5:1 at intensity 0 and 1, on Today and full screen', async () => {
    for (const theme of SKINS) {
      const { context, page } = await open(theme, { query: '&static=1' });
      for (const k of [0, 1]) {
        await intensity(page, k);
        const today = await worstTextContrast(page);
        assert.ok(today.worst >= 4.5, `${theme} @${k} Today: "${today.where}" at ${today.worst.toFixed(2)}:1`);
      }
      await page.click('#view-graphic');
      for (const k of [0, 1]) {
        await intensity(page, k);
        const full = await worstTextContrast(page);
        assert.ok(full.worst >= 4.5, `${theme} @${k} full screen: "${full.where}" at ${full.worst.toFixed(2)}:1`);
      }
      await context.close();
    }
  });

  test('10 s at maximum intensity never puts more than 3 flashes in any 1 s window, on every skin', async () => {
    // Run concurrently to keep the suite short. Under CPU rendering a busy
    // page draws fewer frames, and the scene clock (which the flash log is
    // stamped in) caps each step at 0.1 s — so "busy" is judged per second of
    // scene time, while the cap is judged on the log itself, which is exact.
    // In batches of at most four: every page shares one CPU rasteriser, and with
    // more at once a scene's clock can barely run in 10 s of wall time.
    const measure = async (theme) => {
      const { context, page } = await open(theme);
      await intensity(page, 1);
      await page.waitForTimeout(1500);            // let the eased intensity arrive
      const start = (await diag(page)).clock;
      await page.waitForTimeout(10_000);
      const d = await diag(page);
      await context.close();
      return { theme, log: d.flashLog, seconds: d.clock - start, recent: d.flashLog.filter((t) => t >= start * 1000).length };
    };
    const runs = [];
    for (let i = 0; i < SKINS.length; i += 4) runs.push(...await Promise.all(SKINS.slice(i, i + 4).map(measure)));
    for (const { theme, log } of runs) {
      assert.ok(maxInWindow(log) <= FLASH.maxFlashes, `${theme}: ${maxInWindow(log)} flashes inside one second`);
    }
    // The lightning skins really are busy at max — the cap is doing work, not idling.
    for (const theme of ['kemet', 'fractal']) {
      const { recent, seconds } = runs.find((r) => r.theme === theme);
      assert.ok(seconds > 2, `${theme}: the scene clock barely ran (${seconds.toFixed(1)} s)`);
      assert.ok(recent >= seconds / 3, `${theme}: ${recent} strikes in ${seconds.toFixed(1)} s of scene time — should strike often at max`);
    }
  });

  test('auto-rotation turns, speeds up with intensity, and never passes one revolution per 8 s', async () => {
    for (const theme of ['kemet', 'forge']) {
      const { context, page } = await open(theme);
      await intensity(page, 0);
      await page.waitForTimeout(300);
      const slow = (await diag(page)).rotationSpeed;
      await intensity(page, 1);
      await page.waitForTimeout(400);
      const a = await diag(page);
      await page.waitForTimeout(600);
      const b = await diag(page);
      assert.ok(a.rotationSpeed > slow, `${theme}: faster at high intensity`);
      assert.ok(b.rotationSpeed <= ROTATION.maxRadPerS + 1e-9, `${theme}: rotation ${b.rotationSpeed} rad/s is past the cap`);
      assert.notEqual(a.spin, b.spin, `${theme}: the scene should be turning`);
      await context.close();
    }
  });

  test('with WebGL2 unavailable the existing 2D skins run instead — never a blank background', async () => {
    const init = () => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return type === 'webgl2' ? null : original.call(this, type, ...rest);
      };
    };
    for (const theme of SKINS) {
      const { context, page, errors } = await open(theme, { init });
      const d1 = await diag(page);
      await page.waitForTimeout(500);
      const d2 = await diag(page);
      assert.equal(d1.renderer, '2d', `${theme} should fall back to 2D`);
      assert.ok(d2.frames > d1.frames, `${theme}: the 2D fallback should be animating`);
      assert.equal(await page.getAttribute('html', 'data-renderer'), '2d');
      assert.equal(await page.$eval('#backdrop', (c) => getComputedStyle(c).display), 'block');
      assert.equal(await page.$eval('#backdrop-gl', (c) => getComputedStyle(c).display), 'none');
      const peak = await page.evaluate(() => { const { data } = window.__backdrop.readPixels(); let m = 0; for (let i = 0; i < data.length; i += 4) m = Math.max(m, data[i] + data[i + 1] + data[i + 2]); return m; });
      assert.ok(peak > 20, `${theme}: the fallback frame is not blank`);
      assert.deepEqual(errors, []);
      await context.close();
    }
  });

  test('a lost WebGL context hands over to 2D at once, and the scene comes back when it is restored', async () => {
    const { context, page } = await open('kemet');
    await page.evaluate(() => { window.__lose = document.getElementById('backdrop-gl').getContext('webgl2').getExtension('WEBGL_lose_context'); window.__lose.loseContext(); });
    await page.waitForFunction(() => window.__backdrop.getDiagnostics().renderer === '2d', null, { timeout: 3000 });
    const a = await diag(page);
    await page.waitForTimeout(400);
    assert.ok((await diag(page)).frames > a.frames, 'still animating while the context is lost — not frozen');

    await page.evaluate(() => window.__lose.restoreContext());
    await page.waitForFunction(() => window.__backdrop.getDiagnostics().renderer === 'webgl2', null, { timeout: 5000 });
    const b = await diag(page);
    await page.waitForTimeout(400);
    assert.ok((await diag(page)).frames > b.frames, 'the restored 3D scene is animating');
    await context.close();
  });

  test('the View button exists only on animated skins and is labelled for what it opens', async () => {
    for (const theme of ['light', 'neon']) {
      const context = await browser.newContext({ viewport: VIEWPORT });
      const page = await context.newPage();
      await page.goto(`${base}?theme=${theme}`, { waitUntil: 'load' });
      await page.waitForSelector('#start-session');
      assert.equal(await page.$('#view-graphic'), null, `${theme} has no graphic to view`);
      await context.close();
    }
    const { context, page } = await open('kemet');
    assert.equal(await page.getAttribute('#view-graphic', 'aria-label'), 'View Kemet graphic full screen');
    await context.close();
  });

  test('full-screen view: opens framed and focused, shows the level, and every exit returns focus', async () => {
    const { context, page } = await open('kemet');
    await intensity(page, 0.5);
    await page.click('#view-graphic');
    await page.waitForSelector('#graphic-view:not([hidden])');

    const state = await page.evaluate(() => ({
      focus: document.activeElement?.id,
      inert: ['.app-bar', '#main', '.tabbar'].every((s) => document.querySelector(s).hasAttribute('inert')),
      level: document.getElementById('graphic-level').textContent,
      role: document.getElementById('graphic-view').getAttribute('role'),
      rect: document.getElementById('graphic-view').getBoundingClientRect().toJSON(),
      d: window.__backdrop.getDiagnostics()
    }));
    assert.equal(state.focus, 'graphic-close', 'focus moves into the view');
    assert.ok(state.inert, 'the app behind is inert while the view is open');
    assert.equal(state.role, 'dialog');
    assert.equal(state.level, 'Tier 5 of 10 · 50% this month');
    assert.equal(state.d.fullView, true);
    assert.equal(state.d.fpsCap, 60, '60 fps is allowed in the full-screen view only');
    assert.equal(Math.round(state.rect.width), VIEWPORT.width);
    assert.equal(Math.round(state.rect.height), VIEWPORT.height);

    // Tap the scene: the level overlay hides; the button shows it again.
    await page.mouse.click(200, 400);
    assert.equal(await page.$eval('#graphic-level', (n) => n.hidden), true);
    assert.equal(await page.textContent('#graphic-level-toggle'), 'Show level');
    await page.click('#graphic-level-toggle');
    assert.equal(await page.$eval('#graphic-level', (n) => n.hidden), false);

    // Keyboard: Tab stays inside the dialog; Esc closes and returns focus.
    await page.focus('#graphic-close');
    await page.keyboard.press('Tab');
    assert.ok(['graphic-level-toggle', 'graphic-close'].includes(await page.evaluate(() => document.activeElement.id)));
    await page.keyboard.press('Escape');
    await page.waitForSelector('#graphic-view', { state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'view-graphic', 'Esc returns focus to View');
    assert.equal((await diag(page)).fullView, false);
    assert.equal((await diag(page)).fpsCap, 30, 'back to the 30 fps cap');

    // The close button.
    await page.click('#view-graphic');
    await page.click('#graphic-close');
    await page.waitForSelector('#graphic-view', { state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'view-graphic');

    // Android back: the history entry pops the view, not the app.
    const before = page.url();
    await page.click('#view-graphic');
    await page.waitForSelector('#graphic-view:not([hidden])');
    await page.goBack();
    await page.waitForSelector('#graphic-view', { state: 'hidden' });
    assert.equal(page.url(), before, 'back closed the view and stayed in the app');
    assert.ok(await page.$('#start-session'), 'still on Today');
    await context.close();
  });

  test('full-screen view without the Fullscreen API still covers the viewport as an overlay', async () => {
    const { context, page } = await open('forge', { init: () => { Element.prototype.requestFullscreen = undefined; } });
    await page.click('#view-graphic');
    await page.waitForSelector('#graphic-view:not([hidden])');
    const r = await page.$eval('#graphic-view', (n) => n.getBoundingClientRect().toJSON());
    assert.equal(Math.round(r.width), VIEWPORT.width);
    assert.equal(Math.round(r.height), VIEWPORT.height);
    assert.equal(await page.$eval('.tabbar', (n) => getComputedStyle(n).visibility), 'hidden');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#graphic-view', { state: 'hidden' });
    await context.close();
  });

  /* ---------- Forge plates ---------- */

  const TABLE = { 0: [], 3: ['large'], 4: ['large', 'small'], 5: ['large', 'medium'], 6: ['large', 'large'], 10: ['large', 'large', 'large', 'large'] };
  async function level(page, lv, month = 0) {
    await page.evaluate(([l, m]) => window.__backdrop.setActivity({ glow: l / 10, streakLevel: l, streakFraction: l / 10, monthPercent: m }), [lv, month]);
  }

  /** Fraction of pixels that changed visibly between two readPixels() frames. */
  const changedFraction = (a, b) => {
    let changed = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) changed += 1;
    }
    return changed / (a.length / 4);
  };
  const frame = (page) => page.evaluate(() => Array.from(window.__backdrop.readPixels().data));

  test('drag visibly turns both Kemet and Forge, about both axes, through the one shared handler', async () => {
    // The live bug: the drag reached Forge, but was applied about the bar's
    // own long axis — a barbell looks the same from every angle around that,
    // so it "turned" by 69° and changed 0.11% of the pixels. This asserts the
    // picture, not the angle.
    for (const theme of ['kemet', 'forge']) {
      const { context, page } = await open(theme, { context: { reducedMotion: 'reduce' } });   // a held frame: only the drag can move it
      await page.evaluate(() => window.__backdrop.setActivity({ glow: 0.6, streakLevel: 6, streakFraction: 0.6, monthPercent: 0.3 }));
      await page.click('#view-graphic');
      await page.waitForSelector('#graphic-view:not([hidden])');
      const where = () => page.evaluate((t) => {
        const s = window.__backdrop.getDiagnostics().scene[t];
        return t === 'forge' ? { right: s.ends[1], left: s.ends[0] } : { right: s.base, left: s.apex };
      }, theme);

      const before = await frame(page);
      const p0 = await where();
      await page.mouse.move(150, 500);
      await page.mouse.down();
      // A small turn first: far enough to measure, short of carrying the near
      // side round past the point that faces the camera.
      await page.mouse.move(170, 500, { steps: 2 });            // right
      const p1 = await where();
      await page.mouse.move(170, 440, { steps: 6 });            // then straight up: pitch only
      const p2 = await where();
      await page.mouse.up();
      const after = await frame(page);

      assert.ok(p1.right[0] > p0.right[0] + 0.02, `${theme}: dragging right should move the near side right (${p0.right[0].toFixed(3)} → ${p1.right[0].toFixed(3)})`);
      if (theme === 'forge') {
        assert.ok(p2.right[1] - p2.left[1] > p1.right[1] - p1.left[1] + 0.05, `forge: dragging up should tilt the near end of the bar up and the far end down — it turns about the horizontal axis too (${(p1.right[1] - p1.left[1]).toFixed(3)} → ${(p2.right[1] - p2.left[1]).toFixed(3)})`);
      } else {
        assert.ok(p2.right[1] > p1.right[1] + 0.02, `kemet: dragging up should lift the front corner — it turns about the horizontal axis too (${p1.right[1].toFixed(3)} → ${p2.right[1].toFixed(3)})`);
      }
      const changed = changedFraction(before, after);
      assert.ok(changed > 0.02, `${theme}: the drag changed only ${(changed * 100).toFixed(2)}% of the picture — it must visibly turn`);
      await context.close();
    }
  });

  test('auto-rotation holds while dragging, eases back after release, and resumes', async () => {
    for (const theme of ['kemet', 'forge']) {
      const { context, page } = await open(theme);
      await page.click('#view-graphic');
      await page.waitForSelector('#graphic-view:not([hidden])');
      await page.mouse.move(150, 500);
      await page.mouse.down();
      await page.mouse.move(250, 430, { steps: 5 });
      const held = await diag(page);
      await page.waitForTimeout(400);
      const stillHeld = await diag(page);
      assert.equal(stillHeld.dragging, true);
      assert.ok(Math.abs(stillHeld.spin - held.spin) < 1e-9, `${theme}: no auto-rotation while held`);
      assert.deepEqual(stillHeld.orbit, held.orbit, `${theme}: the view stays where the finger holds it`);
      await page.mouse.up();
      await page.waitForTimeout(300);
      const easing = await diag(page);
      await page.waitForTimeout(2500);
      const settled = await diag(page);
      const size = (o) => Math.hypot(o.yaw, o.pitch);
      assert.ok(size(easing.orbit) < size(held.orbit) && size(easing.orbit) > 0, `${theme}: easing back, not snapping`);
      assert.ok(size(settled.orbit) < 0.02, `${theme}: back to its own rotation`);
      assert.ok(Math.abs(settled.spin - held.spin) > 1e-3, `${theme}: auto-rotation resumed`);
      await context.close();
    }
  });

  test('under reduced motion a drag still turns the scene, but nothing eases or auto-rotates', async () => {
    const { context, page } = await open('forge', { context: { reducedMotion: 'reduce' } });
    await level(page, 6);
    await page.click('#view-graphic');
    const a = await frame(page);
    await page.mouse.move(150, 500);
    await page.mouse.down();
    await page.mouse.move(240, 420, { steps: 4 });
    await page.mouse.up();
    const b = await frame(page);
    assert.ok(changedFraction(a, b) > 0.02, 'the user chose this motion, so it happens');
    const s1 = await page.screenshot();
    await page.waitForTimeout(800);
    const s2 = await page.screenshot();
    assert.ok(s1.equals(s2), 'no easing back and no auto-rotation afterwards');
    assert.ok(Math.hypot((await diag(page)).orbit.yaw, (await diag(page)).orbit.pitch) > 0.5, 'the view stays where it was left');
    await context.close();
  });

  test('the bar carries the plates for its level, symmetrically, and level 10 fits with no clipping', async () => {
    for (const full of [false, true]) {
      const { context, page } = await open('forge', { context: { reducedMotion: 'reduce' } });
      if (full) await page.click('#view-graphic');
      for (const lv of [0, 3, 6, 10]) {
        await level(page, lv);
        const d = await diag(page);
        await page.evaluate(() => window.__backdrop.readPixels());     // make sure scene info is from this level's frame
        const scene = (await diag(page)).scene.forge;
        assert.deepEqual(d.plates.seated, TABLE[lv], `level ${lv}: plates per side`);
        assert.deepEqual(scene.plates.map((p) => p.size), TABLE[lv], `level ${lv}: what was drawn (each side draws this same list, mirrored)`);
        for (const [x, y] of scene.ends) {
          assert.ok(Math.abs(x) < 0.98 && Math.abs(y) < 0.98, `level ${lv}${full ? ' full screen' : ''}: the bar end at (${x.toFixed(2)}, ${y.toFixed(2)}) is clipped`);
        }
      }
      await context.close();
    }
  });

  test('plate colours stay distinguishable at heat 0 and when the bar is white-hot', async () => {
    const { context, page } = await open('forge', { context: { reducedMotion: 'reduce' } });
    await page.click('#view-graphic');
    for (const month of [0, 1]) {
      for (const [lv, [a, b]] of [[4, ['large', 'small']], [5, ['large', 'medium']]]) {
        await level(page, lv, month);
        const sample = await page.evaluate(() => {
          const { data, width, height } = window.__backdrop.readPixels();
          const plates = window.__backdrop.getDiagnostics().scene.forge.plates;
          return plates.map((p) => {
            const x = Math.round((p.rim[0] + 1) / 2 * width);
            const y = Math.round((1 - p.rim[1]) / 2 * height);
            const px = [0, 0, 0];
            for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
              const i = ((y + dy) * width + (x + dx)) * 4;
              for (let c = 0; c < 3; c += 1) px[c] += data[i + c] / 9;
            }
            return { size: p.size, px };
          });
        });
        const [pa, pb] = [sample.find((s) => s.size === a).px, sample.find((s) => s.size === b).px];
        const dist = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
        assert.ok(dist > 60, `heat ${month}, level ${lv}: ${a} ${pa.map(Math.round)} vs ${b} ${pb.map(Math.round)} differ by only ${dist.toFixed(0)}`);
      }
    }
    await context.close();
  });

  test('a level-up slides a plate on; a level easing down slides one off gently', async () => {
    const { context, page } = await open('forge');
    await level(page, 3);
    await page.waitForTimeout(300);
    await level(page, 4);                                          // + a small plate
    const seen = [];
    for (let i = 0; i < 30; i += 1) {
      const d = await diag(page);
      if (d.plates.moving) seen.push(`${d.plates.moving.dir} ${d.plates.moving.size} ${d.plates.moving.t > 0 && d.plates.moving.t < 1 ? 'mid' : ''}`);
      if (d.plates.settled) break;
      await page.waitForTimeout(60);
    }
    assert.ok(seen.some((s) => s.startsWith('on small mid')), `a slide-on should be seen in progress: ${seen.join(', ')}`);
    assert.deepEqual((await diag(page)).plates.seated, ['large', 'small']);

    await level(page, 3);                                          // eases down: the small plate comes off
    const alphas = [];
    for (let i = 0; i < 30; i += 1) {
      await page.evaluate(() => window.__backdrop.readPixels());
      const d = await diag(page);
      const moving = d.scene.forge.plates.find((p) => p.moving === 'off');
      if (moving) alphas.push(moving.alpha);
      if (d.plates.settled) break;
      await page.waitForTimeout(60);
    }
    assert.ok(alphas.length >= 3 && alphas.some((a) => a > 0.2 && a < 0.9), `the plate fades out gradually: ${alphas.map((a) => a.toFixed(2)).join(' ')}`);
    assert.deepEqual((await diag(page)).plates.seated, ['large']);
    await context.close();
  });

  test('a level gained between visits is shown going on once, next time Forge opens', async () => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    await page.goto(`${base}?theme=forge`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__backdrop?.getDiagnostics().skin === 'forge');
    // Ten consecutive training days (level 8+) and plates last seen at level 3.
    await page.evaluate(async () => {
      const iso = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA'); };
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('reptrack');
        req.onsuccess = () => {
          const tx = req.result.transaction(['sessions', 'settings'], 'readwrite');
          for (let i = 0; i < 14; i += 1) {
            const dateISO = iso(i);
            const ts = new Date(`${dateISO}T18:00:00`).getTime();
            tx.objectStore('sessions').put({ id: `seed_${i}`, dateISO, startTs: ts, endTs: ts + 3600_000, durationSec: 3600, notes: '', lastModified: ts, visibility: 'private', sessionType: 'gym' });
          }
          tx.objectStore('settings').put({ key: 'forgePlatesSeenLevel', value: 3 });
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        };
      });
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__backdrop?.getDiagnostics().skin === 'forge');
    const first = await diag(page);
    assert.ok(first.activity.streakLevel > 3, 'sanity: the seeded history is above level 3');
    assert.ok(!first.plates.settled, 'the newly earned plates are going on, not just appearing');
    await page.waitForFunction(() => window.__backdrop.getDiagnostics().plates.settled, null, { timeout: 15000 });
    const saved = await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('reptrack');
      req.onsuccess = () => { const g = req.result.transaction('settings').objectStore('settings').get('forgePlatesSeenLevel'); g.onsuccess = () => resolve(g.result?.value); };
    }));
    assert.equal(saved, first.activity.streakLevel, 'the level is remembered once its plates have been seen');

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__backdrop?.getDiagnostics().skin === 'forge');
    assert.equal((await diag(page)).plates.settled, true, 'shown once — not again on the next open');
    await context.close();
  });

  test('Kemet has a solid base whose inscription reads correctly from below, and is hidden in the default view', async () => {
    const { context, page } = await open('kemet', { context: { reducedMotion: 'reduce' } });
    await page.click('#view-graphic');
    const ins = async () => { await page.evaluate(() => window.__backdrop.readPixels()); return (await diag(page)).scene.kemet.inscription; };
    assert.equal((await ins()).facing, false, 'the default camera never shows the base');

    // Drag up ~π/2: the underside turns to face the camera.
    await page.mouse.move(200, 600);
    await page.mouse.down();
    await page.mouse.move(200, 469, { steps: 8 });
    await page.mouse.up();
    const i = await ins();
    assert.equal(i.facing, true, 'the base faces the camera from below');
    assert.ok(i.end[0] - i.start[0] > 0.3, `the text runs left to right — not mirrored (${i.start[0].toFixed(2)} → ${i.end[0].toFixed(2)})`);
    assert.ok(i.up[1] > i.centre[1] + 0.05, 'and is upright');
    assert.ok(Math.abs(i.centre[0]) < 0.05, 'centred on the face');

    // Lettering really is drawn: bright, gold-leaning pixels in the text band, and the
    // base is solid (no sky showing through between the corners).
    const { gold, solid } = await page.evaluate((c) => {
      const { data, width, height } = window.__backdrop.readPixels();
      const px = (nx, ny) => { const x = Math.round((nx + 1) / 2 * width); const y = Math.round((1 - ny) / 2 * height); const k = (y * width + x) * 4; return [data[k], data[k + 1], data[k + 2]]; };
      let gold = 0;
      for (let dx = -0.5; dx <= 0.5; dx += 0.01) { const [r, g, b] = px(c[0] + dx, c[1]); if (r > 90 && r > b + 30) gold += 1; }
      let solid = 0;
      for (const [ox, oy] of [[-0.35, 0.15], [0.35, 0.15], [-0.35, -0.15], [0.35, -0.15]]) { const [r, g, b] = px(c[0] + ox, c[1] + oy); if (r + g + b > 60) solid += 1; }
      return { gold, solid };
    }, i.centre);
    assert.ok(gold >= 8, `the inscription should be visible along its line (found ${gold} lettered samples)`);
    assert.equal(solid, 4, 'the base is solid stone, not hollow');
    await context.close();
  });
  test('Forge spins level on a turntable, the opposite way to Kemet', async () => {
    const run = async (theme) => {
      const { context, page } = await open(theme);
      await intensity(page, 1);
      // Let the eased intensity actually arrive (scene time runs slow under CPU rendering).
      await page.waitForFunction(() => window.__backdrop.getDiagnostics().intensity > 0.95, null, { timeout: 20000 });
      // Headings are read back-to-back, nothing slow in between: the angle wraps
      // at 2π, so a long gap could carry it round a whole turn unseen.
      const read = () => page.evaluate((t) => { window.__backdrop.readPixels(); const d = window.__backdrop.getDiagnostics(); return { scene: d.scene[t], clock: d.clock }; }, theme);
      const a = await read();
      const pixelsA = await frame(page);
      await page.waitForTimeout(1000);
      const b0 = await read();
      await page.waitForTimeout(150);
      const b = await read();
      const pixelsB = await frame(page);
      await context.close();
      return { a: b0, b, pixelsA, pixelsB, first: a };
    };
    const kemet = await run('kemet');
    const forge = await run('forge');
    const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
    // Angular velocity per second of *scene* time (the backdrop clock), over a
    // short gap so the shortest-way difference is unambiguous.
    const rate = (r) => wrap(r.b.scene.heading - r.a.scene.heading) / (r.b.clock - r.a.clock);
    assert.ok(rate(kemet) > 0.3, `kemet turns positively (${rate(kemet).toFixed(3)} rad/s)`);
    assert.ok(rate(forge) < -0.3, `forge turns the other way (${rate(forge).toFixed(3)} rad/s)`);
    assert.ok(Math.abs(rate(forge)) <= ROTATION.maxRadPerS + 1e-6, `and no faster than the shared cap (${rate(forge).toFixed(3)} rad/s)`);
    for (const s of [forge.first.scene, forge.b.scene]) {
      assert.ok(Math.abs(s.endWorld[1]) < 1e-6, `the bar stays level — its end never rises or falls (${s.endWorld[1]})`);
    }
    assert.ok(Math.hypot(forge.first.scene.endWorld[0] - forge.b.scene.endWorld[0], forge.first.scene.endWorld[2] - forge.b.scene.endWorld[2]) > 0.1, 'the end swings round in the horizontal plane');
    assert.ok(changedFraction(forge.pixelsA, forge.pixelsB) > 0.02, 'and that is visible on screen');
  });

  test('reduced motion: Forge does not auto-rotate', async () => {
    const { context, page } = await open('forge', { context: { reducedMotion: 'reduce' } });
    await intensity(page, 1);
    const h1 = (await diag(page)).spin;
    await page.waitForTimeout(800);
    assert.equal((await diag(page)).spin, h1);
    await context.close();
  });
  test('Terminal: drag looks around the field, clamped at ±40° / ±25°, and eases back to centre', async () => {
    const { context, page } = await open('terminal');
    await intensity(page, 0.5);
    await page.click('#view-graphic');
    await page.waitForSelector('#graphic-view:not([hidden])');
    const deg = (r) => (r * 180) / Math.PI;
    const before = await frame(page);
    for (const [dx, dy, yaw, pitch] of [[-700, 0, -40, 0], [700, 0, 40, 0], [0, -600, 0, -25], [0, 600, 0, 25]]) {
      await page.mouse.move(196, 426);
      await page.mouse.down();
      await page.mouse.move(196 + dx, 426 + dy, { steps: 10 });
      const o = (await diag(page)).orbit;
      // Exact on the dragged axis; the other may still be finishing the previous ease home.
      const [got, want] = dx ? [deg(o.yaw), yaw] : [deg(o.pitch), pitch];
      assert.ok(Math.abs(got - want) < 1e-6, `a long drag stops at the clamp: ${got.toFixed(2)}° (want ${want}°)`);
      if (dx === 700) assert.ok(changedFraction(before, await frame(page)) > 0.02, 'the view really moved');
      await page.mouse.up();
      await page.waitForTimeout(250);
      const mid = (await diag(page)).orbit;
      assert.ok(Math.hypot(mid.yaw, mid.pitch) > 0.01, 'eases back, does not snap (animated)');
      await page.waitForTimeout(1300);
      const home = (await diag(page)).orbit;
      assert.ok(Math.hypot(deg(home.yaw), deg(home.pitch)) < 1, `back to centre after about a second (${deg(home.yaw).toFixed(2)}°, ${deg(home.pitch).toFixed(2)}°)`);
    }
    await context.close();
  });

  test('Terminal under reduced motion: drag still works, and release snaps straight back to the default frame', async () => {
    const { context, page } = await open('terminal', { context: { reducedMotion: 'reduce' } });
    await intensity(page, 0.5);
    await page.click('#view-graphic');
    const home = await frame(page);
    await page.mouse.move(196, 426);
    await page.mouse.down();
    await page.mouse.move(500, 200, { steps: 6 });
    assert.ok(changedFraction(home, await frame(page)) > 0.02, 'the user chose this motion, so it happens');
    await page.mouse.up();
    assert.deepEqual((await diag(page)).orbit, { yaw: 0, pitch: 0 }, 'snapped home on release');
    assert.equal(changedFraction(home, await frame(page)), 0, 'pixel-identical to the default frame');
    await context.close();
  });
  /* ---------- Fractal: drag to recolour ---------- */

  const tintOf = async (page) => (await diag(page)).tint;
  const meanRGB = (px) => { let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < px.length; i += 16) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n += 1; } return [r / n, g / n, b / n]; };
  async function swipe(page, dx, dy, from = [196, 426]) {
    await page.mouse.move(from[0], from[1]);
    await page.mouse.down();
    await page.mouse.move(from[0] + dx, from[1] + dy, { steps: 12 });
    await page.mouse.up();
  }

  test('Fractal: horizontal drag turns the hue (wrapping), vertical drag sets warmth (clamped) — and nothing rotates', async () => {
    const { context, page } = await open('fractal', { context: { reducedMotion: 'reduce' } });
    await intensity(page, 1);
    await page.click('#view-graphic');
    await page.click('#graphic-hint-dismiss');
    const W = VIEWPORT.width;
    const f0 = await frame(page);

    await swipe(page, W / 4, 0, [40, 426]);
    const t1 = await tintOf(page);
    const turned = t1.hue / (2 * Math.PI);
    assert.ok(Math.abs(turned - 0.25) < 0.03, `a quarter-width drag is a quarter turn (${turned.toFixed(3)}), give or take the tap slop`);
    assert.equal(t1.warmth, 0);
    const f1 = await frame(page);
    assert.ok(changedFraction(f0, f1) > 0.2, 'the colours visibly changed');
    assert.deepEqual((await diag(page)).orbit, { yaw: 0, pitch: 0 }, 'recolour only — no rotate, pan or zoom');
    assert.equal((await diag(page)).scene.fractal.half, (await (async () => { await page.evaluate(() => window.__backdrop.readPixels()); return (await diag(page)).scene.fractal.half; })()), 'zoom untouched');

    // Wrap: two full widths more bring the hue back to the same place.
    await swipe(page, W - 20, 0, [10, 426]);
    await swipe(page, W - 20, 0, [10, 426]);
    const t2 = await tintOf(page);
    assert.ok(t2.hue >= 0 && t2.hue < 2 * Math.PI, 'hue stays on the wheel');

    // Warmth: up warms — the picture shifts toward red — and stops at +1; down cools and stops at −1.
    await page.evaluate(() => window.__backdrop.setTint({ hue: 0, warmth: 0 }));
    const neutral = meanRGB(await frame(page));
    await swipe(page, 0, -200);
    const warm = await tintOf(page);
    const warmRGB = meanRGB(await frame(page));
    assert.ok(warm.warmth > 0.3, `dragging up warms (${warm.warmth.toFixed(2)})`);
    assert.ok(warmRGB[0] - warmRGB[2] > neutral[0] - neutral[2] + 5, 'and the frame leans red');
    await swipe(page, 0, -800);
    assert.equal((await tintOf(page)).warmth, 1, 'clamped at warmest');
    await swipe(page, 0, 700, [196, 100]);             // below the button bar
    await swipe(page, 0, 700, [196, 100]);
    assert.equal((await tintOf(page)).warmth, -1, 'clamped at coolest');
    const coolRGB = meanRGB(await frame(page));
    assert.ok(coolRGB[2] - coolRGB[0] > neutral[2] - neutral[0] + 5, 'and the frame leans blue');

    // A tap is not a drag: the colours never jump.
    const before = await tintOf(page);
    await page.mouse.click(300, 300);
    assert.deepEqual(await tintOf(page), before);
    await context.close();
  });

  test('Fractal colours are remembered: across full-screen exits, a reload, and in the Today view', async () => {
    const { context, page } = await open('fractal');
    await page.click('#view-graphic');
    await page.click('#graphic-hint-dismiss');
    await swipe(page, 120, -150);
    const chosen = await tintOf(page);
    assert.ok(chosen.hue > 0 && chosen.warmth > 0);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#graphic-view', { state: 'hidden' });
    assert.deepEqual(await tintOf(page), chosen, 'the Today view shows them straight away');
    await page.click('#view-graphic');
    assert.deepEqual(await tintOf(page), chosen, 'and re-entering full screen keeps them');
    await page.keyboard.press('Escape');

    await page.waitForFunction(() => new Promise((resolve) => {
      const req = indexedDB.open('reptrack');
      req.onsuccess = () => { const g = req.result.transaction('settings').objectStore('settings').get('fractalColour'); g.onsuccess = () => resolve(Boolean(g.result)); };
    }), null, { timeout: 5000 });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__backdrop?.getDiagnostics().skin === 'fractal');
    const after = await tintOf(page);
    assert.ok(Math.abs(after.hue - chosen.hue) < 1e-9 && Math.abs(after.warmth - chosen.warmth) < 1e-9, 'a reload keeps them, in the Today view');
    assert.equal((await diag(page)).fullView, false);

    // The JSON export carries them.
    await page.click('#tab-settings');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
    const chunks = [];
    for await (const c of await download.createReadStream()) chunks.push(c);
    const backup = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const saved = backup.settings.find((r) => r.key === 'fractalColour').value;
    assert.ok(Math.abs(saved.hue - chosen.hue) < 1e-9, 'exported');

    // Reset in Settings.
    await page.click('#set-reset-fractal-colours');
    await page.waitForFunction(() => { const t = window.__backdrop.getDiagnostics().tint; return t.hue === 0 && t.warmth === 0; }, null, { timeout: 3000 });
    // Reset in full screen.
    await page.click('#tab-today');
    await page.click('#view-graphic');
    await swipe(page, 100, -100);
    assert.notDeepEqual(await tintOf(page), { hue: 0, warmth: 0 });
    await page.click('#graphic-reset-colours');
    assert.deepEqual(await tintOf(page), { hue: 0, warmth: 0 }, 'Reset colours restores the theme default');
    await context.close();
  });

  test('Esc closes the full-screen view even after a drag has taken focus off its buttons', async () => {
    const { context, page } = await open('kemet');
    await page.click('#view-graphic');
    await swipe(page, 80, 0);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#graphic-view', { state: 'hidden' });
    await context.close();
  });

  test('Fractal: the hint shows once, the arrow keys recolour, and the overlay text has a dark backing', async () => {
    const { context, page } = await open('fractal');
    await page.click('#view-graphic');
    assert.equal(await page.$eval('#graphic-hint', (n) => n.hidden), false, 'shown the first time');
    assert.match(await page.textContent('#graphic-hint'), /Drag sideways to change colour, up and down for warmth/);
    await page.click('#graphic-hint-dismiss');
    await page.keyboard.press('Escape');
    await page.click('#view-graphic');
    assert.equal(await page.$eval('#graphic-hint', (n) => n.hidden), true, 'and never again');
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__backdrop?.getDiagnostics().skin === 'fractal');
    await page.click('#view-graphic');
    assert.equal(await page.$eval('#graphic-hint', (n) => n.hidden), true, 'not even after a reload');

    await page.focus('#graphic-close');
    const t0 = await tintOf(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    const t1 = await tintOf(page);
    assert.ok(Math.abs(t1.hue - t0.hue - Math.PI / 12) < 1e-9, '→ turns the hue 15°');
    assert.ok(Math.abs(t1.warmth - t0.warmth - 0.1) < 1e-9, '↑ warms by a tenth');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowDown');
    const t2 = await tintOf(page);
    assert.ok(Math.abs(t2.hue - t0.hue) < 1e-9 && Math.abs(t2.warmth - t0.warmth) < 1e-9, '← and ↓ undo them');

    const backing = await page.$eval('#graphic-level', (n) => (getComputedStyle(n).backgroundColor.match(/[\d.]+/g) || []).map(Number));
    assert.ok(backing.length >= 3 && (backing[3] ?? 1) >= 0.85 && backing[0] + backing[1] + backing[2] < 120, `the level text sits on a dark backing (${backing})`);
    await context.close();
  });

  test('Fractal contrast sweep: text over the Today view holds 4.5:1 at 4 hues × 3 warmths × 2 intensities', async () => {
    const { context, page } = await open('fractal', { query: '&static=1' });
    const failures = [];
    let worst = Infinity;
    for (const k of [0, 1]) {
      await intensity(page, k);
      for (const hueDeg of [0, 90, 180, 270]) {
        for (const warmth of [-1, 0, 1]) {
          await page.evaluate(([h, w]) => window.__backdrop.setTint({ hue: (h * Math.PI) / 180, warmth: w }), [hueDeg, warmth]);
          const r = await worstTextContrast(page);
          worst = Math.min(worst, r.worst);
          if (r.worst < 4.5) failures.push(`hue ${hueDeg}° warmth ${warmth} intensity ${k}: "${r.where}" ${r.worst.toFixed(2)}:1`);
        }
      }
    }
    assert.deepEqual(failures, [], `worst ${worst.toFixed(2)}:1`);
    await context.close();
  });

  /* ---------- Stage 5: Monolith ---------- */

  const QUARTER = Math.PI / 2;
  const offFace = (heading) => Math.abs(heading - Math.round(heading / QUARTER) * QUARTER);

  test('Monolith: drag turns freely and tilts at most ±30°; release snaps to the nearest face in ~400 ms, then auto-rotation resumes', async () => {
    const { context, page } = await open('monolith');
    await intensity(page, 0.5);
    await page.click('#view-graphic');
    await page.waitForSelector('#graphic-view:not([hidden])');
    const before = await frame(page);
    await page.mouse.move(196, 426);
    await page.mouse.down();
    await page.mouse.move(196 + 130, 426 - 900, { steps: 12 });
    const held = await diag(page);
    assert.ok(Math.abs(held.orbit.pitch + Math.PI / 6) < 1e-6, `tilt is clamped at 30° (${(held.orbit.pitch * 180 / Math.PI).toFixed(1)}°)`);
    assert.ok(changedFraction(before, await frame(page)) > 0.02, 'the drag visibly turns it');
    await page.mouse.up();
    const snapping = await diag(page);
    assert.equal(snapping.snapping, true, 'a snap starts on release');
    await page.waitForTimeout(550);
    const landed = await diag(page);
    assert.equal(landed.snapping, false, 'the snap is over in about 400 ms');
    // It landed on a face; auto-rotation has since moved it on only a little.
    assert.ok(offFace(landed.spin) < landed.rotationSpeed * 0.3 + 1e-3, `landed square to a face (${offFace(landed.spin).toFixed(4)} rad off)`);
    await page.waitForTimeout(500);
    assert.ok(Math.abs((await diag(page)).spin - landed.spin) > 1e-3, 'auto-rotation resumed');
    await context.close();
  });

  test('Monolith under reduced motion: the snap is instant and the frame stays held', async () => {
    const { context, page } = await open('monolith', { context: { reducedMotion: 'reduce' } });
    await intensity(page, 0.5);
    await page.click('#view-graphic');
    await page.mouse.move(196, 426);
    await page.mouse.down();
    await page.mouse.move(196 + 61, 426, { steps: 4 });
    await page.mouse.up();
    const d = await diag(page);
    assert.equal(d.snapping, false);
    assert.ok(offFace(d.spin) < 1e-9, `square to a face at once (${offFace(d.spin)})`);
    assert.equal(d.running, false);
    const a = await page.screenshot();
    await page.waitForTimeout(600);
    assert.ok(a.equals(await page.screenshot()), 'still one held frame');
    await context.close();
  });

  test('Monolith: this week is the front face, a training day lights its bar, a frosted day stays visible', async () => {
    const { context, page } = await open('monolith', { context: { reducedMotion: 'reduce' } });
    const states = new Array(28).fill(0);
    const frost = new Array(28).fill(0);
    await page.evaluate(([s, f]) => window.__backdrop.setSkinData({ monolith: { states: s, frost: f } }), [states, frost]);
    const dark = await frame(page);
    states[0] = 1; states[1] = 2;                       // Monday trained, Tuesday a PR, on the front face
    await page.evaluate(([s, f]) => window.__backdrop.setSkinData({ monolith: { states: s, frost: f } }), [states, frost]);
    const lit = await frame(page);
    assert.ok(changedFraction(dark, lit) > 0.001, 'training days light bars on the face toward the camera');
    states[0] = 0; states[1] = 0; frost[0] = 1;
    await page.evaluate(([s, f]) => window.__backdrop.setSkinData({ monolith: { states: s, frost: f } }), [states, frost]);
    const frosted = await frame(page);
    assert.ok(changedFraction(dark, frosted) > 0, 'a frosted bar is drawn, cooled — not removed');
    assert.equal((await diag(page)).scene.monolith.frontFace, 0, 'at rest the front is this week');
    await context.close();
  });

  /* ---------- Stage 5: Constellation ---------- */

  /** Mean relative luminance of each 48×48-pixel block of a readPixels() frame. */
  const blockLuminance = (px, size = 48) => {
    const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const out = [];
    for (let by = 0; by + size <= px.height; by += size) {
      for (let bx = 0; bx + size <= px.width; bx += size) {
        let sum = 0;
        for (let y = by; y < by + size; y += 2) {
          for (let x = bx; x < bx + size; x += 2) {
            const i = (y * px.width + x) * 4;
            sum += 0.2126 * lin(px.data[i]) + 0.7152 * lin(px.data[i + 1]) + 0.0722 * lin(px.data[i + 2]);
          }
        }
        out.push(sum / ((size / 2) * (size / 2)));
      }
    }
    return out;
  };

  test('Constellation: at maximum intensity, twinkle moves any area’s luminance far below the WCAG flash threshold', async () => {
    const { context, page } = await open('constellation');
    const stars = [];
    for (let i = 0; i < 300; i += 1) stars.push({ dateISO: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, lon: (i / 300) * Math.PI * 2, lat: ((i * 37) % 84) / 100 - 0.42, pr: i % 7 === 0, phase: i });
    await page.evaluate((st) => window.__backdrop.setSkinData({ constellation: { stars: st, links: [], peakLevel: 10 } }), stars);
    await intensity(page, 1);
    await page.click('#view-graphic');                 // full screen: the stars at their largest
    await page.waitForTimeout(400);
    const worstChange = async () => {
      const frames = [];
      for (let i = 0; i < 24; i += 1) {
        frames.push(blockLuminance(await page.evaluate(() => { const p = window.__backdrop.readPixels(); return { width: p.width, height: p.height, data: Array.from(p.data) }; })));
        await page.waitForTimeout(40);
      }
      let worst = 0;
      for (let i = 1; i < frames.length; i += 1) for (let b = 0; b < frames[i].length; b += 1) worst = Math.max(worst, Math.abs(frames[i][b] - frames[i - 1][b]));
      return worst;
    };
    // WCAG 2.3.1 counts a flash at a 10% change in relative luminance. Turning
    // at full speed, stars crossing block edges stay well under it:
    const moving = await worstChange();
    assert.ok(moving < 0.1, `turning at maximum speed: ${(moving * 100).toFixed(3)}% (WCAG threshold 10%)`);
    // Held still by a press that doesn't move (auto-rotation waits while held),
    // only the twinkle is left, and it must sit at a tenth of the threshold.
    await page.mouse.move(196, 426);
    await page.mouse.down();
    const twinkleOnly = await worstChange();
    await page.mouse.up();
    assert.ok(twinkleOnly < 0.01, `twinkle alone: ${(twinkleOnly * 100).toFixed(3)}% (limit 1%)`);
    assert.equal((await diag(page)).flashLog.length, 0, 'no lightning, no flash requests at all');
    await context.close();
  });

  test('Constellation: one star per training day reaches the scene; drag is unclamped and eases back', async () => {
    const { context, page } = await open('constellation');
    const stars = [0, 1, 2, 3, 4].map((i) => ({ dateISO: `2026-11-0${i + 1}`, lon: i * 0.05, lat: 0.1 * i, pr: i === 2, phase: i }));
    await page.evaluate((st) => window.__backdrop.setSkinData({ constellation: { stars: st, links: [{ from: 0, to: 1, bright: true }], peakLevel: 3 } }), stars);
    await page.waitForTimeout(100);
    assert.equal((await diag(page)).scene.constellation.stars, 5);
    await page.click('#view-graphic');
    await page.mouse.move(196, 426);
    await page.mouse.down();
    await page.mouse.move(196 + 900, 426 + 500, { steps: 12 });
    const held = (await diag(page)).orbit;
    assert.ok(Math.abs(held.yaw) > Math.PI / 2 && Math.abs(held.pitch) > Math.PI / 6, `turns past where Terminal or Monolith would stop (${held.yaw.toFixed(2)}, ${held.pitch.toFixed(2)})`);
    await page.mouse.up();
    await page.waitForTimeout(2500);
    const home = (await diag(page)).orbit;
    assert.ok(Math.hypot(home.yaw, home.pitch) < 0.05, 'eases back after release');
    await context.close();
  });

});
