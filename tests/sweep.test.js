/* The regression sweep: every behaviour that must keep working through every
 * stage of a feature pass, driven through the real UI in real Chromium. Where
 * the unit suites already pin the logic (parser phrases, PR maths, frost
 * gates), this file proves the same behaviour still reaches the screen.
 * Skips cleanly when no Chromium is available.
 */

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { listen } from '../scripts/serve.mjs';
import { findChromium, launch } from './helpers/browser.mjs';

const LIVE_BACKUP = new URL('./fixtures/backup-live-schema1.json', import.meta.url);
const THEMES = ['light', 'neon', 'terminal', 'fractal', 'forge', 'kemet'];

describe('regression sweep', { skip: findChromium() ? false : 'no Chromium build available' }, () => {
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

  async function fresh(query = '', options = {}) {
    const context = await browser.newContext({ acceptDownloads: true, ...options });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
    await page.goto(`${base}${query}`, { waitUntil: 'load' });
    await page.waitForSelector('#start-session');
    return { context, page, errors };
  }

  /** Tap-to-text → confirm sheet → confirm. */
  async function logPhrase(page, phrase) {
    await page.click('#mic-button');
    await page.waitForSelector('#prompt-input', { state: 'visible' });
    await page.fill('#prompt-input', phrase);
    await page.click('#prompt-sheet button[type="submit"]');
    await page.waitForSelector('#confirm-sheet button[type="submit"]', { state: 'visible' });
    await page.click('#confirm-sheet button[type="submit"]');
    await page.waitForSelector('#confirm-sheet', { state: 'hidden' });
  }

  async function finish(page) {
    await page.click('#view-today button:has-text("End session")');
    await page.click('#confirm-sheet button:has-text("End session")');
    await page.waitForSelector('#start-session');
  }

  const count = (page, store) => page.evaluate((s) => new Promise((resolve) => {
    const req = indexedDB.open('reptrack');
    req.onsuccess = () => { const g = req.result.transaction(s).objectStore(s).count(); g.onsuccess = () => resolve(g.result); };
  }), store);

  /** Waits for a store to hold exactly n records — writes finish just after the sheet closes. */
  async function expectCount(page, store, n, message) {
    try {
      await page.waitForFunction(([st, want]) => new Promise((resolve) => {
        const req = indexedDB.open('reptrack');
        req.onsuccess = () => { const g = req.result.transaction(st).objectStore(st).count(); g.onsuccess = () => resolve(g.result === want); };
      }), [store, n], { timeout: 5000, polling: 50 });
    } catch {
      assert.equal(await count(page, store), n, message);
    }
  }

  async function importFile(page, json, mode) {
    await page.click('#tab-settings');
    await page.setInputFiles('#import-file', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
    await page.waitForSelector('#confirm-sheet[open]');
    await page.click(`#confirm-sheet button:has-text("${mode === 'replace' ? 'Replace' : 'Merge'}")`);
    await page.waitForFunction(() => /Imported/.test(document.getElementById('toast')?.textContent || ''), null, { timeout: 8000 });
  }

  test('typed logging: multiple sets in one phrase, "add another set", "same as last time", and holds "each side"', async () => {
    const { context, page, errors } = await fresh();
    await page.click('#start-session');
    await logPhrase(page, 'squat 100 kilos 5 reps 3 sets');
    await expectCount(page, 'sets', 3, 'one phrase, three sets');
    await logPhrase(page, 'add another set');
    await expectCount(page, 'sets', 4);
    await logPhrase(page, 'downward dog 30 seconds each side');
    await expectCount(page, 'sets', 6, 'a hold each side is two sets');
    const sides = await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('reptrack');
      req.onsuccess = () => { const g = req.result.transaction('sets').objectStore('sets').getAll(); g.onsuccess = () => resolve(g.result.filter((s) => s.holdSeconds).map((s) => s.side).sort()); };
    }));
    assert.deepEqual(sides, ['left', 'right']);
    // Finish, start a new session, and replay the previous one for an exercise.
    await finish(page);
    await page.click('#start-session');
    await logPhrase(page, 'squat same as last time');
    await expectCount(page, 'sets', 10, '"same as last time" replays the four squat sets');
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('nothing commits without the confirm sheet: cancelling saves nothing', async () => {
    const { context, page } = await fresh();
    await page.click('#start-session');
    await page.click('#mic-button');
    await page.fill('#prompt-input', 'bench press 60 kilos for 10');
    await page.click('#prompt-sheet button[type="submit"]');
    await page.waitForSelector('#confirm-sheet button[type="submit"]', { state: 'visible' });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#confirm-sheet', { state: 'hidden' });
    await expectCount(page, 'sets', 0);
    await context.close();
  });

  test('a run can be logged and deleted', async () => {
    const { context, page } = await fresh();
    await page.click('#log-run-idle');
    await page.fill('#run-distance', '5');
    await page.fill('#run-minutes', '25');
    await page.click('#confirm-sheet button[type="submit"]');
    await page.waitForSelector('#confirm-sheet', { state: 'hidden' });
    await expectCount(page, 'runs', 1);
    await page.click('button[aria-label^="Delete run of 5"]');
    await page.click('#confirm-sheet button.btn-danger');
    await page.waitForFunction(() => /Run deleted/.test(document.getElementById('toast')?.textContent || ''));
    await expectCount(page, 'runs', 0);
    await context.close();
  });

  test('PR flags and the progression nudge reach the screen', async () => {
    const { context, page } = await fresh();
    await page.click('#start-session');
    await logPhrase(page, 'bench press 60 kilos for 10');
    await logPhrase(page, 'bench press 70 kilos for 10');
    assert.ok(await page.locator('#view-today .badge-pr').count() >= 1, 'a heavier set is flagged PR');
    // The nudge needs the same top set on two different days: seed yesterday's.
    await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('reptrack');
      req.onsuccess = () => {
        const db = req.result;
        const ex = db.transaction('exercises').objectStore('exercises').getAll();
        ex.onsuccess = () => {
          const bench = ex.result.find((e) => e.name === 'Bench Press');
          const d = new Date(); d.setDate(d.getDate() - 1);
          const dateISO = d.toLocaleDateString('en-CA');
          const ts = d.getTime();
          const tx = db.transaction(['sessions', 'sets'], 'readwrite');
          tx.objectStore('sessions').put({ id: 'y1', dateISO, startTs: ts, endTs: ts + 3600e3, durationSec: 3600, notes: '', lastModified: ts, visibility: 'private', sessionType: 'gym' });
          tx.objectStore('sets').put({ id: 'y1s', sessionId: 'y1', exerciseId: bench.id, dateISO, order: 0, weight: 70, unit: 'kg', reps: 10, rpe: null, holdSeconds: null, side: null, isPR: true, lastModified: ts, visibility: 'private' });
          tx.oncomplete = resolve;
        };
      };
    }));
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#view-today');
    await page.click('#tab-progress');
    await page.selectOption('#progress-exercise', { label: 'Bench Press' });
    await page.waitForSelector('#view-progress .badge-warn');
    assert.match(await page.textContent('#view-progress'), /try 72\.5 kg next time/);
    await context.close();
  });

  test('the diary works at year, month, week and day, and the weekly summary downloads', async () => {
    const { context, page } = await fresh();
    await page.click('#start-session');
    await logPhrase(page, 'deadlift 140 kilos for 5');
    await page.click('#tab-diary');
    for (const scope of ['Year', 'Month', 'Week', 'Day']) {
      await page.click(`#view-diary [aria-label="Calendar scope"] button:has-text("${scope}")`);
      assert.equal(await page.getAttribute(`#view-diary [aria-label="Calendar scope"] button:has-text("${scope}")`, 'aria-pressed'), 'true', `${scope} view`);
    }
    assert.match(await page.textContent('#view-diary'), /Deadlift/, 'the day view shows the session');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#weekly-summary')]);
    assert.match(download.suggestedFilename(), /\.txt$/);
    await context.close();
  });

  test('export, then import with Replace and with Merge', async () => {
    const { context, page } = await fresh();
    await page.click('#start-session');
    await logPhrase(page, 'bench press 60 kilos for 10');
    await page.click('#tab-settings');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
    const chunks = [];
    for await (const c of await download.createReadStream()) chunks.push(c);
    const backup = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(backup.sets.length, 1);

    await page.click('#tab-today');
    await logPhrase(page, 'squat 100 kilos for 5');
    await expectCount(page, 'sets', 2);
    await importFile(page, backup, 'replace');
    await expectCount(page, 'sets', 1, 'Replace restores exactly the backup');

    await page.click('#tab-today');
    await logPhrase(page, 'squat 100 kilos for 5');
    await importFile(page, backup, 'merge');
    await expectCount(page, 'sets', 2, 'Merge keeps what is here and adds the backup');
    await context.close();
  });

  test('a backup made by the live build (schema 1) imports complete', async () => {
    const backup = JSON.parse(readFileSync(LIVE_BACKUP, 'utf8'));
    assert.equal(backup.schemaVersion, 1, 'fixture sanity: a schema-1 backup');
    const { context, page, errors } = await fresh();
    await importFile(page, backup, 'replace');
    for (const store of ['sessions', 'sets', 'runs', 'exercises']) {
      assert.equal(await count(page, store), backup[store].length, `${store} all arrived`);
    }
    const session = await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('reptrack');
      req.onsuccess = () => { const g = req.result.transaction('sessions').objectStore('sessions').getAll(); g.onsuccess = () => resolve(g.result[0]); };
    }));
    assert.equal(session.sessionType, 'gym', 'older records are completed on the way in');
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('every theme loads normally, under reduced motion, and with "Reduce background effects"', async () => {
    for (const theme of THEMES) {
      for (const mode of ['normal', 'reduced', 'reduce-effects']) {
        const { context, page, errors } = await fresh(`?theme=${theme}${mode === 'reduce-effects' ? '&static=1' : ''}`,
          mode === 'reduced' ? { reducedMotion: 'reduce' } : {});
        const d = await page.evaluate(() => window.__backdrop.getDiagnostics());
        assert.equal(await page.getAttribute('html', 'data-theme'), theme);
        if (theme === 'light' || theme === 'neon') assert.equal(d.skin, null);
        else {
          assert.equal(d.skin, theme);
          assert.equal(d.static, mode !== 'normal', `${theme}/${mode}: static ${d.static}`);
          assert.ok(d.frames > 0, `${theme}/${mode}: drew a frame`);
        }
        assert.deepEqual(errors, [], `${theme}/${mode}`);
        await context.close();
      }
    }
  });
});
