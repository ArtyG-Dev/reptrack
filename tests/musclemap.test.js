/* The 3D muscle map brief, driven in real Chromium: the mannequin, its
 * fallbacks, the ranked list, counting modes, custom-exercise muscles, the
 * reminder and voice "create". Skips without Chromium.
 */

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { listen } from '../scripts/serve.mjs';
import { findChromium, launch } from './helpers/browser.mjs';
import { THREE_QUARTER_YAW } from '../js/mannequin.js';

describe('muscle map', { skip: findChromium() ? false : 'no Chromium build available' }, () => {
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

  async function fresh({ context: options = {}, init } = {}) {
    const context = await browser.newContext({ viewport: { width: 393, height: 1400 }, ...options });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
    if (init) await page.addInitScript(init);
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForSelector('#start-session');
    return { context, page, errors };
  }

  async function say(page, phrase) {
    await page.click('#mic-button');
    await page.fill('#prompt-input', phrase);
    await page.click('#prompt-sheet button[type="submit"]');
  }
  async function log(page, phrase) {
    await say(page, phrase);
    await page.click('#confirm-sheet button[type="submit"]');
    await page.waitForSelector('#confirm-sheet', { state: 'hidden' });
  }
  async function trainSome(page) {
    await page.click('#start-session');
    for (let i = 0; i < 3; i += 1) await log(page, 'squat 100 kilos for 5');
    await log(page, 'bench press 60 kilos for 8');
    await log(page, 'push ups 20');
  }
  const diag = (page) => page.evaluate(() => window.__muscleMap.get());
  const rowText = (page, muscle) => page.textContent(`#mm-rank button[data-muscle="${muscle}"]`);
  const NO_WEBGL2 = () => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return type === 'webgl2' ? null : original.call(this, type, ...rest); };
  };

  test('Progress shows the 3D mannequin at a three-quarter front angle, held still, beside a ranked list of all groups', async () => {
    const { context, page, errors } = await fresh();
    await trainSome(page);
    await page.click('#tab-progress');
    await page.waitForSelector('#muscle-map canvas.mm-canvas');
    await page.waitForFunction(() => window.__muscleMap.get().frames > 0);
    const d = await diag(page);
    assert.equal(d.mode, '3d');
    assert.ok(Math.abs(d.viewYaw - THREE_QUARTER_YAW) < 1e-9);
    assert.equal(d.running, false, 'no loop on the Progress screen');
    const frames = d.frames;
    await page.waitForTimeout(600);
    assert.equal((await diag(page)).frames, frames, 'nothing redraws until it is touched');
    assert.equal(await page.locator('#mm-rank button.mm-row').count(), 18, 'every muscle group is listed');
    assert.match(await rowText(page, 'quads'), /Quads.*3 sets/);
    const order = await page.$$eval('#mm-rank button.mm-row', (b) => b.map((x) => x.dataset.muscle));
    assert.deepEqual(order.slice(0, 2), ['glutes', 'quads'], 'most trained first; a tie keeps the list order');
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('drag turns it all the way round, tilt stops at ±30°, and a tap ray-picks the muscle under it', async () => {
    const { context, page } = await fresh();
    await trainSome(page);
    await page.click('#tab-progress');
    const box = await (await page.$('#mm-stage')).boundingBox();
    const cx = box.x + box.width / 2; const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 1400, cy - 900, { steps: 20 });
    const held = await diag(page);
    assert.ok(Math.abs(held.viewYaw - THREE_QUARTER_YAW) > 2 * Math.PI, `turns past a full revolution (${(held.viewYaw - THREE_QUARTER_YAW).toFixed(2)} rad)`);
    assert.ok(Math.abs(Math.abs(held.pitch) - Math.PI / 6) < 1e-9, `tilt clamped at 30° (${(held.pitch * 180 / Math.PI).toFixed(1)}°)`);
    await page.mouse.up();
    assert.ok(Math.abs((await diag(page)).pitch) > 0.4, 'on Progress it stays where it was left');

    await page.evaluate((y) => window.__muscleMap.setView(y, 0), 0);
    const at = await page.evaluate(() => window.__muscleMap.screenPointOf('quads'));
    await page.mouse.click(at.x, at.y);
    await page.waitForSelector('#muscle-sheet');
    assert.equal(await page.textContent('#muscle-sheet h2'), 'Quads');
    assert.match(await page.textContent('#muscle-total'), /3 sets in the last 7 days/);
    assert.ok(await page.$('#muscle-trend svg.chart'), 'a trend chart');
    assert.equal((await diag(page)).selected, 14, 'ringed in the figure while its panel is open');
    await page.click('#muscle-sheet button:has-text("Close")');
    await page.waitForFunction(() => window.__muscleMap.get().selected === -1);
    await context.close();
  });

  test('full screen turns slowly by itself, waits while held, resumes after release, and closes with Esc', async () => {
    const { context, page } = await fresh();
    await trainSome(page);
    await page.click('#tab-progress');
    await page.waitForSelector('#mm-open-full');
    await page.click('#mm-open-full');
    await page.waitForFunction(() => window.__muscleMap.get().running);
    const a = (await diag(page)).heading;
    await page.waitForTimeout(800);
    const b = (await diag(page)).heading;
    assert.ok(b > a, 'auto-rotation');
    assert.ok((b - a) / 0.8 <= (2 * Math.PI) / 8 + 1e-6, 'slow, within the shared cap');
    await page.mouse.move(196, 500);
    await page.mouse.down();
    const h1 = (await diag(page)).viewYaw;
    await page.waitForTimeout(500);
    assert.ok(Math.abs((await diag(page)).viewYaw - h1) < 1e-6, 'held: it waits');
    await page.mouse.up();
    await page.waitForTimeout(500);
    assert.ok((await diag(page)).viewYaw > h1, 'released: it carries on');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__muscleMap.get().full);
    assert.equal((await diag(page)).running, false);
    assert.ok(await page.$('#mm-stage canvas'), 'back in the card');
    await context.close();
  });

  test('reduced motion and no WebGL2 both use the flat figures, with the same counts and colours', async () => {
    for (const options of [{ context: { reducedMotion: 'reduce' } }, { init: NO_WEBGL2 }]) {
      const { context, page, errors } = await fresh(options);
      await trainSome(page);
      await page.click('#tab-progress');
      await page.waitForSelector('#muscle-map svg.body-map');
      assert.equal(await page.$('#muscle-map canvas'), null);
      assert.equal((await diag(page)).mode, 'flat');
      assert.equal(await page.locator('#muscle-map path.muscle[role="button"]').count(), 18);
      const level = (await diag(page)).levels[14];
      assert.match(await page.getAttribute('#muscle-map path.muscle[data-muscle="quads"][role="button"]', 'class'), new RegExp(`heat-${level}`));
      assert.match(await page.getAttribute('#mm-rank button[data-muscle="quads"] .mm-dot', 'class'), new RegExp(`heat-${level}`));
      assert.match(await page.getAttribute('#muscle-map path.muscle[data-muscle="quads"][role="button"]', 'aria-label'), /Quads: 3 sets in the last 7 days/);
      assert.equal(await page.locator('#mm-rank button.mm-row').count(), 18, 'the ranked list is there too');
      assert.deepEqual(errors, []);
      await context.close();
    }
  });

  test('counting mode and period persist; Weight mode counts weight × reps and says what it leaves out', async () => {
    const { context, page } = await fresh();
    await trainSome(page);
    await page.click('#tab-progress');
    await page.click('#muscle-map [aria-label="Count by"] button:has-text("Weight")');
    await page.waitForSelector('#mm-weight-note');
    assert.match(await page.textContent('#mm-weight-note'), /excludes bodyweight and timed exercises \(e\.g\. push-ups, planks\)/);
    assert.match(await rowText(page, 'quads'), /1,?500 kg/);
    assert.match(await rowText(page, 'chest'), /480 kg/, 'bench only: the push-ups are left out, not zero');
    await page.click('#muscle-map [aria-label="Period"] button:has-text("30 days")');
    await page.waitForSelector('#muscle-map [aria-label="Period"] button[data-value="30"][aria-pressed="true"]');
    await page.reload();
    await page.click('#tab-progress');
    await page.waitForSelector('#mm-weight-note');
    assert.equal(await page.getAttribute('#muscle-map [aria-label="Count by"] button[data-value="weight"]', 'aria-pressed'), 'true');
    assert.equal(await page.getAttribute('#muscle-map [aria-label="Period"] button[data-value="30"]', 'aria-pressed'), 'true');
    await page.click('#muscle-map [aria-label="Count by"] button:has-text("Sets")');
    await page.waitForFunction(() => !document.getElementById('mm-weight-note'));
    assert.match(await rowText(page, 'chest'), /2 sets/, 'Sets mode counts the push-ups');
    await context.close();
  });

  test('a custom exercise without muscles is Unassigned; editing its muscles later re-counts its history', async () => {
    const { context, page } = await fresh();
    await page.click('#tab-exercises');
    await page.click('#view-exercises button:has-text("Add exercise")');
    await page.fill('#ex-name', 'Hammer Curl');
    await page.waitForSelector('#ex-suggestion:not([hidden])');
    assert.match(await page.textContent('#ex-suggestion'), /Biceps \(main\)/);
    assert.equal(await page.locator('#ex-primary-muscles button[aria-pressed="true"]').count(), 0, 'a suggestion is never applied on its own');
    await page.fill('#ex-name', 'Cable Fly Machine');
    await page.click('#confirm-sheet button[type="submit"]');
    await page.waitForSelector('#confirm-sheet', { state: 'hidden' });
    await page.click('#tab-today');
    await page.click('#start-session');
    await log(page, 'cable fly machine 20 kilos 3 sets of 10');
    await page.click('#tab-progress');
    await page.waitForSelector('#mm-unassigned');
    assert.match(await page.textContent('#mm-unassigned'), /Unassigned.*3 sets/);
    assert.match(await rowText(page, 'chest'), /—/, 'not spread over the body or guessed');

    await page.click('#tab-exercises');
    await page.fill('#ex-search', 'cable');
    await page.click('button[aria-label="Edit Cable Fly Machine"]');
    // The figure, by keyboard: chest → main.
    await page.focus('.picker-figures path.muscle[data-muscle="chest"][role="button"]');
    await page.keyboard.press('Enter');
    assert.equal(await page.getAttribute('#ex-primary-muscles button[data-muscle="chest"]', 'aria-pressed'), 'true');
    await page.click('#confirm-sheet button[type="submit"]');
    await page.waitForSelector('#confirm-sheet', { state: 'hidden' });
    await page.click('#tab-progress');
    await page.waitForFunction(() => !document.getElementById('mm-unassigned'));
    assert.match(await rowText(page, 'chest'), /3 sets/, 'its whole history now counts for chest');
    await context.close();
  });

  test('the reminder: after 3 logged sets, once more 10 sets after "Not now", then never', async () => {
    const { context, page } = await fresh();
    await page.click('#start-session');
    await say(page, 'cable fly 20 kilos 2 sets of 10');
    await page.click('#create-assign-later');
    await page.click('#confirm-sheet button[type="submit"]');
    await page.waitForSelector('#confirm-sheet', { state: 'hidden' });
    assert.equal(await page.$('#muscle-reminder'), null, '2 sets: not yet');
    await log(page, 'cable fly 20 kilos for 10');
    await page.waitForSelector('#muscle-reminder');
    assert.match(await page.textContent('#muscle-reminder'), /Want to set which muscles Cable Fly works\?/);
    await page.click('#reminder-not-now');
    await page.waitForSelector('#muscle-reminder', { state: 'detached' });
    await log(page, 'cable fly 20 kilos 9 sets of 10');
    assert.equal(await page.$('#muscle-reminder'), null, '12 sets: not yet');
    await log(page, 'cable fly 20 kilos for 10');
    await page.waitForSelector('#muscle-reminder');
    await page.click('#reminder-not-now');
    await log(page, 'cable fly 20 kilos 20 sets of 10');
    await log(page, 'cable fly 20 kilos for 10');
    assert.equal(await page.$('#muscle-reminder'), null, 'never a third time');
    const state = await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('reptrack');
      req.onsuccess = () => { const g = req.result.transaction('exercises').objectStore('exercises').getAll(); g.onsuccess = () => resolve(g.result.find((e) => e.name === 'Cable Fly').muscleReminder); };
    }));
    assert.deepEqual(state, { prompts: 2, lastAt: 13 }, 'stored on the exercise');
    await context.close();
  });

  test('saying an unknown exercise offers to create it, muscles optional with a suggestion, then the normal confirm sheet', async () => {
    const { context, page, errors } = await fresh();
    await page.click('#start-session');
    await say(page, 'pec deck fly 12 kilos for 10');
    await page.waitForSelector('#create-exercise');
    assert.match(await page.textContent('#confirm-sheet h2'), /Create “Pec Deck Fly” as a new exercise\?/);
    assert.match(await page.textContent('#ex-suggestion'), /Chest \(main\)/);
    assert.equal(await page.locator('#ex-primary-muscles button[aria-pressed="true"]').count(), 0, 'shown, not applied');
    await page.click('#ex-use-suggestion');
    assert.equal(await page.getAttribute('#ex-primary-muscles button[data-muscle="chest"]', 'aria-pressed'), 'true');
    await page.click('#create-exercise button[type="submit"]');
    await page.waitForSelector('#confirm-sheet h2:has-text("Confirm sets")');
    assert.equal(await page.inputValue('#row-weight-0'), '12');
    await page.click('#confirm-sheet button[type="submit"]');
    await page.waitForSelector('#confirm-sheet', { state: 'hidden' });
    const ex = await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('reptrack');
      req.onsuccess = () => { const g = req.result.transaction('exercises').objectStore('exercises').getAll(); g.onsuccess = () => resolve(g.result.find((e) => e.name === 'Pec Deck Fly')); };
    }));
    assert.deepEqual([ex.isCustom, ex.primaryMuscles], [true, ['chest']]);
    assert.deepEqual(errors, []);
    await context.close();
  });
});
