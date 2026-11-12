/* The legacy copy at /legacy/, in real Chromium: its one-time data copy, the
 * banner, data kept separate in both directions afterwards, and two service
 * workers that never touch each other's pages or caches. Skips without
 * Chromium, or when legacy/ hasn't been built (node scripts/build-legacy.mjs).
 */

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { listen } from '../scripts/serve.mjs';
import { findChromium, launch } from './helpers/browser.mjs';

const built = existsSync(new URL('../legacy/index.html', import.meta.url));
const skip = !findChromium() ? 'no Chromium build available' : !built ? 'legacy/ not built' : false;

describe('legacy copy', { skip }, () => {
  let server;
  let origin;
  let browser;

  before(async () => {
    const started = await listen(0);
    server = started.server;
    origin = `http://127.0.0.1:${started.port}`;
    browser = await launch(chromium);
  });

  after(async () => {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  });

  const count = (page, db, store) => page.evaluate(([name, s]) => new Promise((resolve) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => {
      if (!req.result.objectStoreNames.contains(s)) { resolve(-1); return; }
      const g = req.result.transaction(s).objectStore(s).count();
      g.onsuccess = () => { req.result.close(); resolve(g.result); };
    };
  }), [db, store]);

  async function logSet(page, phrase) {
    await page.click('#mic-button');
    await page.fill('#prompt-input', phrase);
    await page.click('#prompt-sheet button[type="submit"]');
    await page.click('#confirm-sheet button[type="submit"]');
    await page.waitForSelector('#confirm-sheet', { state: 'hidden' });
  }

  test('first launch copies the main data once; afterwards each side is separate, with a dismissible banner', async () => {
    const context = await browser.newContext();
    await context.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('#start-session');
    await page.click('#start-session');
    await logSet(page, 'bench press 60 kilos for 8');
    await logSet(page, 'squat 100 kilos for 5');
    assert.equal(await count(page, 'reptrack', 'sets'), 2);

    // Legacy, first launch: it opens with that history.
    await page.goto(`${origin}/legacy/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('#legacy-banner');
    assert.equal(await page.textContent('#legacy-banner p'), 'Legacy version: data here is separate from the main app.');
    assert.equal(await page.title(), 'RepTrack (legacy)');
    await page.waitForSelector('#start-session, #view-today button:has-text("End session")');
    assert.equal(await count(page, 'reptrack-legacy', 'sets'), 2, 'the history was copied');
    const pull = await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('reptrack-legacy');
      req.onsuccess = () => { const g = req.result.transaction('exercises').objectStore('exercises').getAll(); g.onsuccess = () => resolve(g.result.find((e) => e.name === 'Pull Up')); };
    }));
    assert.ok(pull.primaryMuscles.includes('lats'), 'muscle ids mapped back to the ones this version knows');

    // Logged in legacy: the main database does not change.
    const active = await page.$('#view-today button:has-text("End session")');
    if (!active) await page.click('#start-session');
    await logSet(page, 'deadlift 140 kilos for 3');
    assert.equal(await count(page, 'reptrack-legacy', 'sets'), 3);
    assert.equal(await count(page, 'reptrack', 'sets'), 2, 'main untouched by legacy');

    await page.click('#legacy-banner-dismiss');
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#mic-button, #start-session');
    assert.equal(await page.$('#legacy-banner'), null, 'dismissed stays dismissed');

    // Logged in main: the legacy database does not change, and is never re-copied.
    await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('#mic-button, #start-session');
    if (await page.$('#start-session')) await page.click('#start-session');
    await logSet(page, 'curl 12 kilos for 10');
    assert.equal(await count(page, 'reptrack', 'sets'), 3);
    await page.goto(`${origin}/legacy/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('#mic-button, #start-session');
    assert.equal(await count(page, 'reptrack-legacy', 'sets'), 3, 'legacy untouched by main, and not copied again');
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('each page is controlled by its own service worker, and neither caches the other', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: 'load' });
    assert.match(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || ''), /\/sw\.js$/);
    assert.doesNotMatch(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL), /legacy/);

    await page.goto(`${origin}/legacy/index.html`, { waitUntil: 'load' });
    assert.equal(await page.title(), 'RepTrack (legacy)', 'the main worker did not answer with its own shell');
    // serviceWorker.ready would resolve with the main worker, which controls this
    // first load; wait for the legacy registration itself to activate.
    // (waitForFunction does not await an async predicate, so poll by hand.)
    const legacyActive = () => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations())
      .some((r) => r.scope.endsWith('/legacy/') && r.active?.state === 'activated'));
    for (let i = 0; i < 150 && !(await legacyActive()); i += 1) await page.waitForTimeout(100);
    assert.ok(await legacyActive(), 'the legacy worker registered and activated');
    await page.reload({ waitUntil: 'load' });
    assert.match(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || ''), /\/legacy\/sw\.js$/);

    const caches = await page.evaluate(async () => {
      const out = {};
      for (const name of await caches.keys()) out[name] = (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname);
      return out;
    });
    const names = Object.keys(caches);
    assert.ok(names.some((n) => /^reptrack-shell-v\d+$/.test(n)) && names.some((n) => /^reptrack-legacy-shell-v\d+$/.test(n)), names.join(', '));
    for (const [name, paths] of Object.entries(caches)) {
      if (name.startsWith('reptrack-legacy-')) assert.ok(paths.every((p) => p.startsWith('/legacy/')), `${name} holds only legacy files`);
      else assert.ok(paths.every((p) => !p.startsWith('/legacy/')), `${name} holds no legacy files`);
    }
    await context.close();
  });
});
