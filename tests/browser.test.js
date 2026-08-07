/* Browser-driven acceptance tests: real Chromium, real IndexedDB, real service
 * worker. Covers the offline guarantee, the voice path and its tap-to-text
 * fallback, the confirm-before-commit rule, runs, the weekly summary (download
 * and Web Share), and an axe-core accessibility scan.
 *
 * Skips (rather than fails) when no Chromium build is available.
 */

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { chromium } from 'playwright';
import { listen } from '../scripts/serve.mjs';
import { findChromium, launch } from './helpers/browser.mjs';

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const hasBrowser = Boolean(findChromium());

/* Headless Chromium ships a SpeechRecognition object that never returns a
 * result, so both paths are stubbed explicitly rather than left to chance. */
const VOICE_STUBS = {
  none: () => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  },
  working: () => {
    class FakeRecognition {
      constructor() { this.continuous = true; this.interimResults = true; this.maxAlternatives = 1; }
      start() {
        setTimeout(() => {
          this.onstart?.();
          const transcript = window.__transcript || '';
          const alternative = { transcript, confidence: 0.94 };
          const result = Object.assign([alternative], { length: 1, isFinal: true });
          this.onresult?.({ results: Object.assign([result], { length: 1 }) });
        }, 20);
      }
      abort() {}
      stop() {}
    }
    window.SpeechRecognition = FakeRecognition;
    window.webkitSpeechRecognition = FakeRecognition;
  }
};

describe('browser', { skip: hasBrowser ? false : 'no Chromium build available' }, () => {
  let server;
  let baseURL;
  let browser;

  before(async () => {
    const started = await listen(0);
    server = started.server;
    baseURL = `http://127.0.0.1:${started.port}/index.html`;
    browser = await launch(chromium);
  });

  after(async () => {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  });

  async function freshPage({ voice = 'none', init } = {}) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (error) => errors.push(String(error)));
    if (VOICE_STUBS[voice]) await page.addInitScript(VOICE_STUBS[voice]);
    if (init) await page.addInitScript(init);
    await page.goto(baseURL, { waitUntil: 'load' });
    await page.waitForSelector('#start-session');
    return { context, page, errors };
  }

  /** Tap-to-text fallback: mic button → text sheet → confirm sheet (left open). */
  async function typeSet(page, phrase) {
    await page.click('#mic-button');
    await page.waitForSelector('#prompt-input', { state: 'visible' });
    await page.fill('#prompt-input', phrase);
    await page.click('#prompt-sheet button[type="submit"]');
    await page.waitForSelector('#confirm-sheet button[type="submit"]', { state: 'visible' });
  }

  async function logSet(page, phrase) {
    await typeSet(page, phrase);
    await page.click('#confirm-sheet button[type="submit"]');
  }

  async function logRun(page, { distance, minutes, seconds = 0 }) {
    await page.click('#log-run, #log-run-idle');
    await page.waitForSelector('#run-distance', { state: 'visible' });
    await page.fill('#run-distance', String(distance));
    await page.fill('#run-minutes', String(minutes));
    await page.fill('#run-seconds', String(seconds));
    await page.click('#confirm-sheet button[type="submit"]');
    await page.waitForSelector('#confirm-sheet', { state: 'hidden' });
  }

  async function readDownload(download) {
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
  }

  test('loads clean with no console errors on any tab', async () => {
    const { context, page, errors } = await freshPage();
    assert.equal(await page.title(), 'RepTrack — offline gym tracker');
    for (const tab of ['diary', 'progress', 'exercises', 'settings', 'today']) {
      await page.click(`#tab-${tab}`);
      await page.waitForTimeout(100);
    }
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('registers a service worker and survives a fully offline reload', async () => {
    const { context, page } = await freshPage();

    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(async () => {
      const keys = await caches.keys();
      if (!keys.length) return false;
      const cache = await caches.open(keys[0]);
      return (await cache.keys()).length > 5;
    }, null, { timeout: 10_000 });

    await context.setOffline(true);
    await page.reload({ waitUntil: 'load' });

    assert.ok(await page.isVisible('#start-session'), 'app shell must render with zero network');
    assert.equal(await page.title(), 'RepTrack — offline gym tracker');
    assert.equal(await page.textContent('.app-title'), 'RepTrack');

    await context.setOffline(false);
    await context.close();
  });

  test('voice logs a set end to end, showing the parse before it commits', async () => {
    const { context, page } = await freshPage({
      voice: 'working',
      init: () => { window.__transcript = 'bench press 60 kilos for 10'; }
    });
    await page.click('#start-session');
    await page.click('#mic-button');

    await page.waitForSelector('#confirm-sheet button[type="submit"]', { state: 'visible' });
    const sheet = await page.textContent('#confirm-sheet');
    assert.match(sheet, /bench press 60 kilos for 10/, 'the transcript is shown for confirmation');
    assert.equal(await page.inputValue('#row-weight-0'), '60');
    assert.equal(await page.inputValue('#row-reps-0'), '10');

    await page.click('#confirm-sheet button[type="submit"]');
    await page.waitForSelector('text=60 kg × 10');

    await context.close();
  });

  test('voice falls back to tap-to-text, and nothing commits without confirmation', async () => {
    const { context, page } = await freshPage({ voice: 'none' });
    await page.click('#start-session');
    await page.waitForSelector('#mic-button');

    assert.equal(await page.evaluate(() => 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window), false);

    await typeSet(page, 'bench press 60 kilos for 10');
    assert.match(await page.textContent('#confirm-sheet'), /bench press 60 kilos for 10/);

    // Cancelling must store nothing.
    await page.click('#confirm-sheet button:has-text("Cancel")');
    await page.waitForSelector('#confirm-sheet', { state: 'hidden' });
    assert.equal(await page.evaluate(() => document.body.textContent.includes('60 kg × 10')), false);
    assert.equal(await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('reptrack');
      req.onsuccess = () => {
        const tx = req.result.transaction('sets', 'readonly');
        tx.objectStore('sets').getAll().onsuccess = (e) => resolve(e.target.result.length);
      };
    })), 0);

    // Confirming does store it.
    await logSet(page, 'bench press 60 kilos for 10');
    await page.waitForSelector('text=60 kg × 10');

    await context.close();
  });

  test('a session round-trips through IndexedDB, the diary and the chart', async () => {
    const { context, page } = await freshPage();

    await page.click('#start-session');
    await logSet(page, 'squat 100 kilos 5 reps 3 sets');
    await page.waitForSelector('text=100 kg × 5');

    const stored = await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('reptrack');
      req.onsuccess = () => {
        const tx = req.result.transaction('sets', 'readonly');
        tx.objectStore('sets').getAll().onsuccess = (e) => resolve(e.target.result);
      };
    }));
    assert.equal(stored.length, 3, 'three sets should be written');
    assert.equal(stored[0].weight, 100);
    assert.ok(stored.every((s) => s.reps === 5));
    assert.ok(stored.some((s) => s.isPR), 'a first-ever set is a personal record');
    assert.ok(stored.every((s) => s.visibility === 'private' && s.lastModified > 0));

    await page.click('button:has-text("End session")');
    await page.click('#confirm-sheet button:has-text("End session")');
    await page.waitForSelector('#start-session');

    await page.click('#tab-diary');
    await page.waitForSelector('.cal-grid');
    assert.ok(await page.isVisible('.cal-day.has-session'), 'the training day must be marked in the calendar');
    await page.click('.cal-day.has-session');
    await page.waitForSelector('text=100 kg × 5');

    await page.click('#tab-progress');
    await page.waitForSelector('svg.chart');
    assert.ok((await page.getAttribute('svg.chart', 'aria-label')).length > 10);

    // Reloading proves persistence, not just in-memory state.
    await page.reload({ waitUntil: 'load' });
    await page.click('#tab-diary');
    await page.waitForSelector('.cal-day.has-session');

    await context.close();
  });

  test('a run is a few fields and shows its pace', async () => {
    const { context, page } = await freshPage();
    await logRun(page, { distance: 5, minutes: 25 });
    await page.waitForSelector('text=5 km · 25:00 · 5:00 /km');

    const runs = await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('reptrack');
      req.onsuccess = () => {
        const tx = req.result.transaction('runs', 'readonly');
        tx.objectStore('runs').getAll().onsuccess = (e) => resolve(e.target.result);
      };
    }));
    assert.equal(runs.length, 1);
    assert.equal(runs[0].distance, 5);
    assert.equal(runs[0].durationSec, 1500);
    assert.equal(runs[0].visibility, 'private');

    await context.close();
  });

  test('one tap saves the weekly summary as a .txt with sessions, lifts, PRs, volume and runs', async () => {
    const { context, page } = await freshPage();

    await page.click('#start-session');
    await logSet(page, 'bench press 60 kilos for 10');
    await page.waitForSelector('text=60 kg × 10');
    await logRun(page, { distance: 5, minutes: 25 });

    await page.click('#tab-diary');
    await page.waitForSelector('#weekly-summary');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#weekly-summary')            // one tap
    ]);

    const text = await readDownload(download);
    assert.match(download.suggestedFilename(), /^reptrack-week-\d{4}-\d{2}-\d{2}\.txt$/);
    assert.match(text, /RepTrack — weekly summary/);
    assert.match(text, /SESSIONS {3}1/);
    assert.match(text, /VOLUME {5}600 kg/);
    assert.match(text, /RUNS {7}1 · 5 km in 25:00 \(5:00 \/km\)/);
    assert.match(text, /LIFTS\n {2}Bench Press\s+1 sets · top 60 kg × 10 · 600 kg/);
    assert.match(text, /PERSONAL RECORDS \(1\)/);
    assert.match(text, /DAY BY DAY/);
    assert.ok(!text.includes('<'), 'plain text only');

    await context.close();
  });

  test('the weekly summary uses Web Share when the platform offers it', async () => {
    const { context, page } = await freshPage({
      init: () => {
        window.__shared = null;
        Object.defineProperty(navigator, 'canShare', { value: (data) => Boolean(data?.files?.length), configurable: true });
        Object.defineProperty(navigator, 'share', {
          value: async (data) => {
            window.__shared = { title: data.title, name: data.files[0].name, text: await data.files[0].text(), type: data.files[0].type };
          },
          configurable: true
        });
      }
    });

    await page.click('#start-session');
    await logSet(page, 'deadlift 140 for 5');
    await page.waitForSelector('text=140 kg × 5');

    await page.click('#tab-diary');
    await page.click('#weekly-summary');
    await page.waitForFunction(() => window.__shared !== null, null, { timeout: 5000 });

    const shared = await page.evaluate(() => window.__shared);
    assert.equal(shared.type, 'text/plain');
    assert.match(shared.name, /^reptrack-week-\d{4}-\d{2}-\d{2}\.txt$/);
    assert.match(shared.title, /RepTrack/);
    assert.match(shared.text, /VOLUME {5}700 kg/);

    await context.close();
  });

  test('the summary is generated with the network cut off', async () => {
    const { context, page } = await freshPage();
    await page.click('#start-session');
    await logSet(page, 'bench press 60 kilos for 10');
    await page.waitForSelector('text=60 kg × 10');

    await page.evaluate(() => navigator.serviceWorker.ready);
    await context.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    await page.click('#tab-diary');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#weekly-summary')
    ]);
    assert.match(await readDownload(download), /RepTrack — weekly summary/);

    await context.setOffline(false);
    await context.close();
  });

  test('data exports as JSON that carries every store', async () => {
    const { context, page } = await freshPage();
    await page.click('#start-session');
    await logSet(page, 'deadlift 140 for 5');
    await page.waitForSelector('text=140 kg × 5');
    await logRun(page, { distance: 10, minutes: 55 });

    await page.click('#tab-settings');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('button:has-text("Export backup")')
    ]);
    const backup = JSON.parse(await readDownload(download));

    assert.equal(backup.app, 'reptrack');
    assert.equal(backup.sets.length, 1);
    assert.equal(backup.sets[0].weight, 140);
    assert.equal(backup.runs.length, 1);
    assert.ok(backup.sessions.length >= 1);
    assert.ok(/^reptrack-backup-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()));

    await context.close();
  });

  test('axe-core finds no accessibility violations on any tab', async () => {
    const { context, page } = await freshPage();
    await page.addScriptTag({ content: AXE_SOURCE });

    const findings = [];
    for (const tab of ['today', 'diary', 'progress', 'exercises', 'settings']) {
      await page.click(`#tab-${tab}`);
      await page.waitForTimeout(120);
      const violations = await page.evaluate(async () => {
        const result = await window.axe.run(document, { resultTypes: ['violations'] });
        return result.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
      });
      findings.push(...violations
        .filter((v) => ['moderate', 'serious', 'critical'].includes(v.impact))
        .map((v) => `${tab}: ${v.id} (${v.impact}, ${v.nodes} nodes)`));
    }

    assert.deepEqual(findings, [], 'axe-core violations');
    await context.close();
  });

  test('a hold-mode exercise logs a duration, not weight/reps, and shows it as a hold', async () => {
    const { context, page } = await freshPage();
    await page.click('#start-session');
    await page.click('#mic-button');
    await page.waitForSelector('#prompt-input', { state: 'visible' });
    await page.fill('#prompt-input', 'plank for 60 seconds');
    await page.click('#prompt-sheet button[type="submit"]');
    await page.waitForSelector('#confirm-sheet button[type="submit"]', { state: 'visible' });

    // The sheet shows a hold-duration field, not weight/reps.
    assert.equal(await page.inputValue('#row-hold-0'), '60');
    assert.equal(await page.locator('#row-weight-0').count(), 0);

    await page.click('#confirm-sheet button[type="submit"]');
    await page.waitForSelector('text=60s hold');

    const stored = await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('reptrack');
      req.onsuccess = () => {
        const tx = req.result.transaction('sets', 'readonly');
        tx.objectStore('sets').getAll().onsuccess = (e) => resolve(e.target.result);
      };
    }));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].holdSeconds, 60);
    assert.equal(stored[0].weight, 0);
    assert.equal(stored[0].reps, 0);

    await context.close();
  });

  test('a mixed strength + yoga session groups into collapsible category sections', async () => {
    const { context, page } = await freshPage();
    await page.click('#start-session');
    await logSet(page, 'bench press 60 kilos for 10');
    await page.waitForSelector('text=60 kg × 10');

    await page.click('#mic-button');
    await page.waitForSelector('#prompt-input', { state: 'visible' });
    await page.fill('#prompt-input', 'downward dog for 30 seconds');
    await page.click('#prompt-sheet button[type="submit"]');
    await page.waitForSelector('#confirm-sheet button[type="submit"]', { state: 'visible' });
    await page.click('#confirm-sheet button[type="submit"]');
    await page.waitForSelector('text=30s hold');

    // Two categories now appear in the session — Strength and Yoga sections.
    const triggers = page.locator('#view-today .disclosure-trigger');
    await triggers.first().waitFor();
    assert.equal(await triggers.count(), 2);
    assert.match(await triggers.nth(0).textContent(), /Strength/);
    assert.match(await triggers.nth(1).textContent(), /Yoga/);

    // The most recently used category (Yoga) starts expanded; the other collapsed.
    assert.equal(await triggers.nth(1).getAttribute('aria-expanded'), 'true');
    assert.equal(await triggers.nth(0).getAttribute('aria-expanded'), 'false');

    await context.close();
  });

  test('collapsible sections are keyboard-operable and remember their state', async () => {
    const { context, page } = await freshPage();
    await page.click('#tab-exercises');
    await page.waitForSelector('.disclosure-trigger');

    const strength = page.locator('.disclosure-trigger', { hasText: 'Strength' });
    const before = await strength.getAttribute('aria-expanded');

    // Real disclosure semantics: hidden via the `hidden` attribute, aria-expanded in sync.
    const panelId = await strength.getAttribute('aria-controls');
    const panel = page.locator(`#${panelId}`);
    if (before === 'true') assert.equal(await panel.getAttribute('hidden'), null);
    else assert.notEqual(await panel.getAttribute('hidden'), null);

    // Space toggles it — a real <button>, no custom key handling needed. The
    // toggle persists to IndexedDB (then re-renders) asynchronously, so wait
    // for the attribute to actually flip rather than reading it immediately.
    await strength.focus();
    await page.keyboard.press(' ');
    await page.waitForFunction(
      (prev) => [...document.querySelectorAll('.disclosure-trigger')]
        .find((el) => el.textContent.includes('Strength'))?.getAttribute('aria-expanded') !== prev,
      before,
      { timeout: 3000 }
    );
    const after = await strength.getAttribute('aria-expanded');
    assert.notEqual(after, before);

    // The choice survives a reload (persisted in settings, not just in memory).
    await page.reload({ waitUntil: 'load' });
    await page.click('#tab-exercises');
    await page.waitForSelector('.disclosure-trigger');
    const reloaded = page.locator('.disclosure-trigger', { hasText: 'Strength' });
    assert.equal(await reloaded.getAttribute('aria-expanded'), after);

    await context.close();
  });

  test('the theme toggle applies immediately and survives a reload', async () => {
    const { context, page } = await freshPage();
    assert.equal(await page.getAttribute('html', 'data-theme'), 'light');

    await page.click('#tab-settings');
    await page.selectOption('#set-theme', 'neon');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'neon', null, { timeout: 3000 });
    assert.equal(await page.getAttribute('html', 'data-theme'), 'neon', 'applies without a reload');

    await page.reload({ waitUntil: 'load' });
    assert.equal(await page.getAttribute('html', 'data-theme'), 'neon', 'the choice persists');

    await context.close();
  });

  test('the exercise category field is a real dropdown with visible options, plus a custom fallback', async () => {
    const { context, page } = await freshPage();
    await page.click('#tab-exercises');
    await page.waitForSelector('.disclosure-trigger');
    await page.click('button:has-text("+ Add exercise")');
    await page.waitForSelector('#ex-category');

    // A real <select> — every option is present in the DOM and visible to
    // the browser's native picker, unlike a <datalist> suggestion list.
    const optionLabels = await page.$$eval('#ex-category option', (opts) => opts.map((o) => o.textContent));
    assert.deepEqual(optionLabels, ['Calisthenics', 'Cardio', 'Pilates', 'Strength', 'Yoga', 'Other (type your own)…']);

    // The custom-category field is hidden until "Other" is chosen.
    assert.equal(await page.isVisible('#ex-category-custom-field'), false);
    await page.selectOption('#ex-category', '__custom__');
    assert.equal(await page.isVisible('#ex-category-custom-field'), true);

    await page.fill('#ex-name', 'Bear Crawl');
    await page.fill('#ex-category-custom', 'Crossfit');
    await page.click('#confirm-sheet button[type="submit"]');
    await page.waitForSelector('.disclosure-trigger:has-text("Crossfit")');

    await context.close();
  });

  test('every interactive control is reachable and labelled', async () => {
    const { context, page } = await freshPage();
    const unlabelled = await page.evaluate(() => {
      const controls = [...document.querySelectorAll('button, a[href], input, select, textarea')];
      return controls
        .filter((c) => c.offsetParent !== null)
        .filter((c) => {
          const label = c.getAttribute('aria-label') || c.textContent.trim()
            || (c.id && document.querySelector(`label[for="${c.id}"]`)?.textContent.trim());
          return !label;
        })
        .map((c) => c.outerHTML.slice(0, 80));
    });
    assert.deepEqual(unlabelled, []);

    await page.focus('#tab-today');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-diary');

    await context.close();
  });
});
