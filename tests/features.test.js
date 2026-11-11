/* New features, driven through the real UI in Chromium. Stage 1: editing a
 * logged set, quick adjust buttons, "make that N", the rest buzz, per-exercise
 * rest, the screen wake lock and the backup reminder. Skips without Chromium.
 */

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { listen } from '../scripts/serve.mjs';
import { findChromium, launch } from './helpers/browser.mjs';

describe('features', { skip: findChromium() ? false : 'no Chromium build available' }, () => {
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

  /* Stubs for the platform APIs this stage uses, recording every call. */
  const PLATFORM_STUBS = () => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    window.__vibrations = [];
    navigator.vibrate = (pattern) => { window.__vibrations.push(pattern); return true; };
    window.__wake = { requests: 0, releases: 0, refuse: false };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          window.__wake.requests += 1;
          if (window.__wake.refuse) throw new DOMException('Not allowed', 'NotAllowedError');
          const listeners = [];
          return {
            addEventListener: (t, f) => listeners.push(f),
            release: async () => { window.__wake.releases += 1; listeners.forEach((f) => f()); }
          };
        }
      }
    });
  };

  async function fresh({ init } = {}) {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(PLATFORM_STUBS);
    if (init) await page.addInitScript(init);
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForSelector('#start-session');
    return { context, page, errors };
  }

  async function typeToSheet(page, phrase) {
    await page.click('#mic-button');
    await page.waitForSelector('#prompt-input', { state: 'visible' });
    await page.fill('#prompt-input', phrase);
    await page.click('#prompt-sheet button[type="submit"]');
    await page.waitForSelector('#confirm-sheet button[type="submit"]', { state: 'visible' });
  }
  async function logPhrase(page, phrase) {
    await typeToSheet(page, phrase);
    await page.click('#confirm-sheet button[type="submit"]');
    await page.waitForSelector('#confirm-sheet', { state: 'hidden' });
  }
  const sets = (page) => page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('reptrack');
    req.onsuccess = () => { const g = req.result.transaction('sets').objectStore('sets').getAll(); g.onsuccess = () => resolve(g.result.sort((a, b) => a.order - b.order)); };
  }));
  const waitSets = (page, predicate) => page.waitForFunction((src) => new Promise((resolve) => {
    const req = indexedDB.open('reptrack');
    req.onsuccess = () => { const g = req.result.transaction('sets').objectStore('sets').getAll(); g.onsuccess = () => resolve(new Function('s', `return (${src})(s)`)(g.result.sort((a, b) => a.order - b.order))); };
  }), predicate.toString(), { timeout: 5000, polling: 50 });
  const putSetting = (page, key, value) => page.evaluate(([k, v]) => new Promise((resolve) => {
    const req = indexedDB.open('reptrack');
    req.onsuccess = () => { const tx = req.result.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ key: k, value: v }); tx.oncomplete = resolve; };
  }), [key, value]);

  test('tapping a logged set reopens it filled in; saving updates it and recomputes its PR', async () => {
    const { context, page, errors } = await fresh();
    await page.click('#start-session');
    await logPhrase(page, 'bench press 60 kilos for 10');
    await logPhrase(page, 'bench press 50 kilos for 10');
    await waitSets(page, (s) => s.length === 2);
    assert.deepEqual((await sets(page)).map((s) => s.isPR), [true, false]);

    await page.click('button[aria-label^="Edit set 2 of Bench Press"]');
    await page.waitForSelector('#confirm-sheet[open]');
    assert.equal(await page.inputValue('#row-weight-0'), '50', 'the set’s own values are filled in');
    assert.equal(await page.inputValue('#row-reps-0'), '10');
    assert.equal(await page.$eval('#sheet-exercise', (n) => n.disabled), true, 'editing keeps the exercise');
    assert.equal(await page.locator('#confirm-sheet button:has-text("+ Another set")').count(), 0, 'one set, edited in place');
    await page.fill('#row-weight-0', '70');
    await page.click('#confirm-sheet button[type="submit"]');
    await waitSets(page, (s) => s[1].weight === 70);
    const after1 = await sets(page);
    assert.equal(after1.length, 2, 'edited, not added');
    assert.deepEqual(after1.map((s) => s.isPR), [true, true], 'the edit made it a PR');
    assert.equal(await page.locator('#view-today .badge-pr').count(), 2);
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('quick adjust buttons: reps ±1, weight ± the progression step, holds ±5 s — real, labelled, 44px+', async () => {
    const { context, page } = await fresh();
    await page.click('#start-session');
    await typeToSheet(page, 'bench press 60 kilos for 10');
    for (const label of ['Set 1 reps up', 'Set 1 reps down', 'Set 1 weight up by 2.5 kg', 'Set 1 weight down by 2.5 kg']) {
      const box = await page.locator(`#confirm-sheet button[aria-label="${label}"]`).boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44, `${label}: ${box?.width}×${box?.height}`);
    }
    await page.click('#confirm-sheet button[aria-label="Set 1 reps up"]');
    await page.click('#confirm-sheet button[aria-label="Set 1 reps up"]');
    await page.click('#confirm-sheet button[aria-label="Set 1 weight up by 2.5 kg"]');
    assert.equal(await page.inputValue('#row-reps-0'), '12');
    assert.equal(await page.inputValue('#row-weight-0'), '62.5');
    await page.click('#confirm-sheet button[type="submit"]');
    await waitSets(page, (s) => s.length === 1 && s[0].reps === 12 && s[0].weight === 62.5);

    await typeToSheet(page, 'plank for 60 seconds');
    await page.click('#confirm-sheet button[aria-label="Hold 1 seconds up by 5 seconds"]');
    assert.equal(await page.inputValue('#row-hold-0'), '65');
    await page.click('#confirm-sheet button[aria-label="Hold 1 seconds down by 5 seconds"]');
    await page.click('#confirm-sheet button[aria-label="Hold 1 seconds down by 5 seconds"]');
    assert.equal(await page.inputValue('#row-hold-0'), '55');
    await context.close();
  });

  test('"make that 8" proposes a change to the last set, and saves only once confirmed', async () => {
    const { context, page } = await fresh();
    await page.click('#start-session');
    await logPhrase(page, 'squat 100 kilos for 10');
    await typeToSheet(page, 'make that 8');
    assert.equal(await page.inputValue('#row-reps-0'), '8', 'proposed');
    assert.equal((await sets(page))[0].reps, 10, 'not saved yet');
    await page.click('#confirm-sheet button[type="submit"]');
    await waitSets(page, (s) => s.length === 1 && s[0].reps === 8);
    await context.close();
  });

  test('rest ends with a buzz, using the exercise’s own rest time; the buzz can be switched off', async () => {
    const { context, page } = await fresh();
    // Squat rests 1 s; everything else keeps the 90 s default.
    await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('reptrack');
      req.onsuccess = () => {
        const tx = req.result.transaction('exercises', 'readwrite');
        const store = tx.objectStore('exercises');
        const g = store.getAll();
        g.onsuccess = () => { const squat = g.result.find((e) => e.name === 'Back Squat'); store.put({ ...squat, restSec: 1 }); };
        tx.oncomplete = resolve;
      };
    }));
    await page.reload({ waitUntil: 'load' });
    await page.click('#start-session');
    await logPhrase(page, 'squat 100 kilos for 5');
    await page.waitForFunction(() => window.__vibrations.length > 0, null, { timeout: 5000 });
    assert.deepEqual(await page.evaluate(() => window.__vibrations), [[200, 100, 200]]);
    assert.match(await page.textContent('#rest-timer'), /Rest done|^$/);

    await logPhrase(page, 'bench press 60 kilos for 10');
    await page.waitForTimeout(2500);
    assert.match(await page.textContent('#rest-timer'), /Rest 01:[12]\d/, 'bench keeps the 90 s default');

    await putSetting(page, 'vibrateOnRest', false);
    await page.reload({ waitUntil: 'load' });
    await page.evaluate(() => { window.__vibrations = []; });
    await logPhrase(page, 'squat 100 kilos for 5');
    await page.waitForTimeout(2500);
    assert.deepEqual(await page.evaluate(() => window.__vibrations), [], 'switched off: no buzz');
    await context.close();
  });

  test('the Exercises editor sets a rest time per exercise', async () => {
    const { context, page } = await fresh();
    await page.click('#tab-exercises');
    const strength = page.locator('#view-exercises button[aria-expanded]:has-text("Strength")');
    if (await strength.getAttribute('aria-expanded') === 'false') await strength.click();
    await page.click('#view-exercises button[aria-label="Edit Deadlift"]');
    await page.fill('#ex-rest', '180');
    await page.click('#confirm-sheet button[type="submit"]');
    await page.waitForSelector('#confirm-sheet', { state: 'hidden' });
    const rest = await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('reptrack');
      req.onsuccess = () => { const g = req.result.transaction('exercises').objectStore('exercises').getAll(); g.onsuccess = () => resolve(g.result.find((e) => e.name === 'Deadlift').restSec); };
    }));
    assert.equal(rest, 180);
    await context.close();
  });

  test('the screen stays awake during a session, is let go after, and a refusal is silent', async () => {
    const { context, page, errors } = await fresh();
    assert.equal(await page.evaluate(() => window.__wake.requests), 0, 'no lock before a session');
    await page.click('#start-session');
    await page.waitForFunction(() => window.__wake.requests === 1);
    await page.click('#view-today button:has-text("End session")');
    await page.click('#confirm-sheet button:has-text("End session")');
    await page.waitForFunction(() => window.__wake.releases === 1);

    // Back from the background: taken again.
    await page.click('#start-session');
    await page.waitForFunction(() => window.__wake.requests === 2);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      // The browser releases the lock itself when hidden; simulate that.
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Refused: nothing visible happens.
    await page.click('#view-today button:has-text("End session")');
    await page.click('#confirm-sheet button:has-text("End session")');
    await page.evaluate(() => { window.__wake.refuse = true; });
    await page.click('#start-session');
    await page.waitForTimeout(400);
    assert.deepEqual(errors, [], 'a refused wake lock is silent');
    assert.doesNotMatch(await page.textContent('#toast'), /wake|screen/i);

    // Switched off: never asked for.
    await page.click('#tab-settings');
    await page.uncheck('#set-keep-screen-on');
    const before = await page.evaluate(() => window.__wake.requests);
    await page.click('#tab-today');
    await page.click('#view-today button:has-text("End session")');
    await page.click('#confirm-sheet button:has-text("End session")');
    await page.click('#start-session');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__wake.requests), before);
    await context.close();
  });

  test('backup reminder: only after finishing, once a week at most, and Settings shows the last backup', async () => {
    const { context, page } = await fresh();
    // Five sessions already, never exported.
    await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('reptrack');
      req.onsuccess = () => {
        const tx = req.result.transaction('sessions', 'readwrite');
        for (let i = 1; i <= 5; i += 1) {
          const d = new Date(); d.setDate(d.getDate() - i);
          tx.objectStore('sessions').put({ id: `old${i}`, dateISO: d.toLocaleDateString('en-CA'), startTs: d.getTime(), endTs: d.getTime() + 3600e3, durationSec: 3600, notes: '', lastModified: 1, visibility: 'private', sessionType: 'gym' });
        }
        tx.oncomplete = resolve;
      };
    }));
    await page.reload({ waitUntil: 'load' });
    await page.click('#tab-settings');
    assert.equal(await page.textContent('#last-backup'), 'Never backed up');
    await page.click('#tab-today');

    await page.click('#start-session');
    await logPhrase(page, 'bench press 60 kilos for 10');
    assert.equal(await page.locator('#toast .toast-action').count(), 0, 'never during a session');
    await page.click('#view-today button:has-text("End session")');
    await page.click('#confirm-sheet button:has-text("End session")');
    await page.waitForSelector('#toast .toast-action', { timeout: 6000 });
    assert.equal(await page.textContent('#toast .toast-action'), 'Export now');
    assert.doesNotMatch(await page.textContent('#toast'), /\d+\s*days?/i, 'no count of days');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#toast .toast-action')]);
    assert.match(download.suggestedFilename(), /^reptrack-backup-/);

    await page.click('#tab-settings');
    await page.waitForFunction(() => /^Last backup: /.test(document.getElementById('last-backup')?.textContent || ''));

    // Already shown this week (and just backed up): not again.
    await page.click('#tab-today');
    await page.click('#start-session');
    await logPhrase(page, 'squat 100 kilos for 5');
    await page.click('#view-today button:has-text("End session")');
    await page.click('#confirm-sheet button:has-text("End session")');
    await page.waitForTimeout(3500);
    assert.equal(await page.locator('#toast .toast-action').count(), 0);
    await context.close();
  });
  /* ---------- Stage 1b ---------- */

  const isoDaysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA'); };
  const sessions = (page) => page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('reptrack');
    req.onsuccess = () => { const g = req.result.transaction('sessions').objectStore('sessions').getAll(); g.onsuccess = () => resolve(g.result); };
  }));

  test('the browser is asked to keep the data once there is something worth keeping, and Settings says where it stands', async () => {
    const { context, page } = await fresh({
      init: () => {
        window.__persist = { granted: false, asks: 0 };
        Object.defineProperty(navigator, 'storage', {
          configurable: true,
          value: {
            estimate: async () => ({ usage: 1e6, quota: 1e9 }),
            persisted: async () => window.__persist.granted,
            persist: async () => { window.__persist.asks += 1; return window.__persist.granted; }
          }
        });
      }
    });
    assert.equal(await page.evaluate(() => window.__persist.asks), 0, 'not asked on a fresh install with nothing in it');
    await page.click('#start-session');
    await logPhrase(page, 'bench press 60 kilos for 10');
    await page.click('#view-today button:has-text("End session")');
    await page.click('#confirm-sheet button:has-text("End session")');
    await page.waitForFunction(() => window.__persist.asks === 1);

    await page.click('#tab-settings');
    await page.waitForFunction(() => /Not yet protected/.test(document.getElementById('persist-line').textContent));
    assert.equal(await page.isVisible('#persist-request'), true);
    await page.evaluate(() => { window.__persist.granted = true; });
    await page.click('#persist-request');
    await page.waitForFunction(() => /^Protected/.test(document.getElementById('persist-line').textContent));
    assert.equal(await page.isVisible('#persist-request'), false);
    await context.close();
  });

  test('a session can be logged for an earlier day, and an open session can be moved to another day', async () => {
    const { context, page } = await fresh();
    await page.click('#start-earlier-session');
    await page.fill('#session-date', isoDaysAgo(3));
    await page.click('#confirm-sheet button:has-text("Use this date")');
    await page.waitForSelector('#mic-button');
    assert.match(await page.textContent('#session-date-line'), new RegExp(isoDaysAgo(3)));
    await logPhrase(page, 'deadlift 140 kilos for 5');
    await waitSets(page, (s) => s.length === 1);
    assert.equal((await sets(page))[0].dateISO, isoDaysAgo(3), 'the set carries the session’s date');

    await page.click('#change-session-date');
    await page.fill('#session-date', isoDaysAgo(5));
    await page.click('#confirm-sheet button:has-text("Use this date")');
    await page.waitForFunction((d) => document.getElementById('session-date-line')?.textContent.includes(d), isoDaysAgo(5));
    assert.equal((await sessions(page))[0].dateISO, isoDaysAgo(5));
    await waitSets(page, (s) => s.every((x) => x.dateISO !== new Date().toLocaleDateString('en-CA')));
    assert.equal((await sets(page))[0].dateISO, isoDaysAgo(5), 'its sets move with it');

    // A future date is refused.
    await page.click('#change-session-date');
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    assert.equal(await page.getAttribute('#session-date', 'max'), new Date().toLocaleDateString('en-CA'));
    await page.keyboard.press('Escape');
    await context.close();
  });

  test('re-dating a session recomputes PRs: moving a heavy session earlier strips a later PR', async () => {
    const { context, page } = await fresh();
    // Yesterday: 100 kg (a PR). Today: 110 kg (a PR, because it came after).
    await page.click('#start-earlier-session');
    await page.fill('#session-date', isoDaysAgo(1));
    await page.click('#confirm-sheet button:has-text("Use this date")');
    await logPhrase(page, 'squat 100 kilos for 5');
    await page.click('#view-today button:has-text("End session")');
    await page.click('#confirm-sheet button:has-text("End session")');
    await page.click('#start-session');
    await logPhrase(page, 'squat 90 kilos for 5');
    await waitSets(page, (s) => s.length === 2);
    assert.deepEqual((await sets(page)).map((x) => [x.weight, x.isPR]).sort(), [[100, true], [90, false]].sort());
    // Move today's 90 to two days ago: now it came first, so it is the first PR.
    await page.click('#change-session-date');
    await page.fill('#session-date', isoDaysAgo(2));
    await page.click('#confirm-sheet button:has-text("Use this date")');
    await waitSets(page, (s) => s.find((x) => x.weight === 90)?.isPR === true);
    assert.deepEqual((await sets(page)).map((x) => [x.weight, x.isPR]).sort(), [[100, true], [90, true]].sort());
    await context.close();
  });

  test('a finished session’s sets can be edited from the Diary', async () => {
    const { context, page } = await fresh();
    await page.click('#start-session');
    await logPhrase(page, 'bench press 60 kilos for 10');
    await page.click('#view-today button:has-text("End session")');
    await page.click('#confirm-sheet button:has-text("End session")');
    await page.click('#tab-diary');
    await page.click('#view-diary [aria-label="Calendar scope"] button:has-text("Day")');
    await page.click('#view-diary button[aria-label^="Edit set 1 of Bench Press"]');
    await page.fill('#row-reps-0', '12');
    await page.click('#confirm-sheet button[type="submit"]');
    await waitSets(page, (s) => s[0].reps === 12);
    assert.match(await page.textContent('#view-diary'), /60 kg × 12/);
    await context.close();
  });

  test('RPE: understood from speech, editable in the sheet, and shown with the set', async () => {
    const { context, page } = await fresh();
    await page.click('#start-session');
    await typeToSheet(page, 'squat 100 kilos for 5 rpe 8');
    assert.equal(await page.inputValue('#row-rpe-0'), '8');
    await page.fill('#row-rpe-0', '8.5');
    await page.click('#confirm-sheet button[type="submit"]');
    await waitSets(page, (s) => s.length === 1 && s[0].rpe === 8.5);
    assert.match(await page.textContent('#view-today'), /100 kg × 5 @ RPE 8\.5/);
    await context.close();
  });

  test('warm-up sets: ticked or spoken, badged, and never a PR however heavy', async () => {
    const { context, page } = await fresh();
    await page.click('#start-session');
    await logPhrase(page, 'bench press 60 kilos for 10');
    await typeToSheet(page, 'warm up bench press 100 kilos for 5');
    assert.equal(await page.isChecked('#row-warmup-0'), true, 'spoken "warm up" pre-ticks it');
    await page.click('#confirm-sheet button[type="submit"]');
    await waitSets(page, (s) => s.length === 2);
    const [, warm] = await sets(page);
    assert.equal(warm.isWarmup, true);
    assert.equal(warm.isPR, false, 'a heavier warm-up is not a PR');
    assert.equal(await page.locator('#view-today .badge:has-text("Warm-up")').count(), 1);

    // Unticking it in the editor makes it a working set — and now it is a PR.
    await page.click('button[aria-label^="Edit set 2 of Bench Press"]');
    await page.uncheck('#row-warmup-0');
    await page.click('#confirm-sheet button[type="submit"]');
    await waitSets(page, (s) => s[1].isWarmup === false && s[1].isPR === true);
    await context.close();
  });
});
