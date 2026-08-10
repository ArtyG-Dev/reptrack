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

  test('robots.txt serves a plain-text disallow-all, and the rendered page carries noindex', async () => {
    const { context, page } = await freshPage();

    const response = await page.request.get(`http://127.0.0.1:${new URL(baseURL).port}/robots.txt`);
    assert.equal(response.status(), 200);
    assert.match(response.headers()['content-type'] || '', /text\/plain/);
    assert.equal((await response.text()).trim(), 'User-agent: *\nDisallow: /');

    const robotsMeta = await page.evaluate(() => document.querySelector('meta[name="robots"]')?.content || null);
    assert.equal(robotsMeta, 'noindex, nofollow, noarchive, nosnippet');

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

    await page.waitForSelector('#start-session', { timeout: 10_000 });
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

  /* ---------- frosted-glass skins ---------- */

  const GLASS_SKINS = ['terminal', 'fractal', 'forge'];

  /** Writes sessions straight into IndexedDB so a profile with real history can
   *  be simulated. Returns after the write commits; caller reloads to pick it up. */
  async function seedSessions(page, dateISOs) {
    await page.evaluate(async (dates) => {
      await new Promise((resolve, reject) => {
        const open = indexedDB.open('reptrack');
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('sessions', 'readwrite');
          const store = tx.objectStore('sessions');
          dates.forEach((dateISO, i) => {
            const startTs = new Date(`${dateISO}T18:00:00`).getTime();
            store.put({
              id: `seed_${i}_${dateISO}`,
              dateISO,
              startTs,
              endTs: startTs + 3600_000,
              durationSec: 3600,
              notes: '',
              lastModified: startTs,
              visibility: 'private'
            });
          });
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      });
    }, dateISOs);
  }

  /** Waits until the backdrop's frame count holds steady across two samples.
   *  A state change legitimately repaints the held static frame once (so it
   *  reflects current activity), so "is the loop stopped" has to be asked after
   *  things settle rather than against a fixed delay. */
  async function settledFrameCount(page, quietMs = 400, timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      const before = await page.evaluate(() => window.__backdrop.getDiagnostics().frames);
      await page.waitForTimeout(quietMs);
      const after = await page.evaluate(() => window.__backdrop.getDiagnostics().frames);
      if (before === after) return after;
      last = after;
    }
    throw new Error(`backdrop frame count never settled (last seen ${last})`);
  }

  /** Brightest pixel currently on the backdrop canvas — a cheap, theme-agnostic
   *  stand-in for "is anything visibly lit up", used to check that the base
   *  state (a fresh profile, glow 0) is not literally indistinguishable from
   *  the hot state (a consistent profile, glow 1). */
  async function backdropMaxBrightness(page) {
    return page.evaluate(() => {
      const c = document.getElementById('backdrop');
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let max = 0;
      for (let i = 0; i < data.length; i += 4) max = Math.max(max, data[i] + data[i + 1] + data[i + 2]);
      return max;
    });
  }

  /** A prior baseline plus a fortnight of daily training — the "hot" end of
   *  the consistency score, used to drive Forge/Fractal to glow ≈ 1. */
  function consistentDays(dayIndexes) {
    const days = [];
    for (let i = 90; i >= 15; i -= 4) days.push(isoDaysAgo(i));
    for (const i of dayIndexes) days.push(isoDaysAgo(i));
    return days;
  }

  const isoDaysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  test('all five themes are selectable, apply without reload, and persist', async () => {
    const { context, page } = await freshPage();
    await page.click('#tab-settings');

    const options = await page.$$eval('#set-theme option', (opts) => opts.map((o) => o.value));
    assert.deepEqual(options, ['light', 'neon', 'terminal', 'fractal', 'forge']);

    for (const theme of GLASS_SKINS) {
      await page.selectOption('#set-theme', theme);
      await page.waitForFunction((t) => document.documentElement.getAttribute('data-theme') === t, theme, { timeout: 3000 });
      assert.equal(await page.getAttribute('html', 'data-glass'), '1', `${theme} should turn the glass treatment on`);
    }

    await page.reload({ waitUntil: 'load' });
    // Wait for boot to have applied a theme rather than racing it.
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') !== null, null, { timeout: 5000 });
    assert.equal(await page.getAttribute('html', 'data-theme'), 'forge', 'the choice survives a reload');
    assert.equal(await page.getAttribute('html', 'data-glass'), '1');

    // …and switching back to a flat theme takes the glass and the canvas away.
    await page.click('#tab-settings');
    await page.selectOption('#set-theme', 'light');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-glass') === null, null, { timeout: 3000 });
    assert.equal(await page.evaluate(() => window.__backdrop.getDiagnostics().skin), null);

    await context.close();
  });

  test('each skin animates under its 30fps cap and draws only inside its declared palette', async () => {
    const { context, page } = await freshPage();
    for (const theme of GLASS_SKINS) {
      await page.goto(`${baseURL}?theme=${theme}`, { waitUntil: 'load' });
      await page.waitForSelector('#start-session');
      await page.waitForTimeout(200);

      const before = await page.evaluate(() => window.__backdrop.getDiagnostics());
      assert.equal(before.skin, theme);
      assert.equal(before.running, true, `${theme} should be animating`);

      await page.waitForTimeout(1200);
      const after = await page.evaluate(() => window.__backdrop.getDiagnostics());
      const drawn = after.frames - before.frames;
      assert.ok(drawn > 0, `${theme} drew no frames`);
      assert.ok(drawn <= 30 * 1.5, `${theme} drew ${drawn} frames in ~1.2s — above the 30fps cap`);
    }
    await context.close();
  });

  test('prefers-reduced-motion renders a static frame, not a slow one', async () => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${baseURL}?theme=forge`, { waitUntil: 'load' });
    await page.waitForSelector('#start-session');
    await page.waitForTimeout(300);

    const first = await page.evaluate(() => window.__backdrop.getDiagnostics());
    assert.equal(first.static, true, 'reduced motion must put the backdrop in static mode');
    assert.equal(first.running, false, 'no animation loop may be running');
    assert.ok(first.frames > 0, 'a single frame should still have been drawn — the skin is visible, just still');

    await page.waitForTimeout(1200);
    const second = await page.evaluate(() => window.__backdrop.getDiagnostics());
    assert.equal(second.frames, first.frames, 'the frame count must not advance at all');

    await context.close();
  });

  test('the manual "reduce background effects" toggle holds the frame still too', async () => {
    const { context, page } = await freshPage();
    await page.goto(`${baseURL}?theme=terminal`, { waitUntil: 'load' });
    await page.waitForSelector('#start-session');

    await page.click('#tab-settings');
    await page.check('#set-reduce-effects');
    await page.waitForFunction(() => window.__backdrop.getDiagnostics().static === true, null, { timeout: 3000 });

    const settled = await settledFrameCount(page);
    await page.waitForTimeout(900);
    const second = await page.evaluate(() => window.__backdrop.getDiagnostics());
    assert.equal(second.frames, settled, 'frames advanced despite reduced effects');
    assert.equal(second.running, false, 'the animation loop must not be running');

    // The setting persists, and the palette is untouched — colours stay, motion goes.
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__backdrop?.getDiagnostics().skin !== null, null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__backdrop.getDiagnostics().static), true);
    assert.equal(await page.getAttribute('html', 'data-glass'), '1');

    await context.close();
  });

  test('the backdrop stops while the tab is hidden', async () => {
    const { context, page } = await freshPage();
    await page.goto(`${baseURL}?theme=fractal`, { waitUntil: 'load' });
    await page.waitForSelector('#start-session');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__backdrop.getDiagnostics().running), true);

    // Emulating "hidden" is what a backgrounded PWA looks like to the page.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => window.__backdrop.getDiagnostics().running === false, null, { timeout: 3000 });

    const first = await page.evaluate(() => window.__backdrop.getDiagnostics());
    await page.waitForTimeout(700);
    const second = await page.evaluate(() => window.__backdrop.getDiagnostics());
    assert.equal(second.frames, first.frames, 'the backdrop kept drawing while backgrounded');

    await context.close();
  });

  test('the backdrop stops while speech recognition is listening', async () => {
    // A recogniser that stays open, so the paused state can be observed mid-listen.
    const { context, page } = await freshPage({
      voice: 'working',
      init: () => {
        window.__transcript = 'bench press 60 kilos for 10';
        class HangingRecognition {
          constructor() { this.continuous = true; this.interimResults = true; }
          start() { setTimeout(() => this.onstart?.(), 10); }   // never resolves
          abort() {}
          stop() {}
        }
        window.SpeechRecognition = HangingRecognition;
        window.webkitSpeechRecognition = HangingRecognition;
      }
    });
    await page.goto(`${baseURL}?theme=forge`, { waitUntil: 'load' });
    await page.waitForSelector('#start-session');
    await page.click('#start-session');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.__backdrop.getDiagnostics().running), true);

    await page.click('#mic-button');
    await page.waitForFunction(() => window.__backdrop.getDiagnostics().voiceActive === true, null, { timeout: 3000 });

    const diag = await page.evaluate(() => window.__backdrop.getDiagnostics());
    assert.equal(diag.running, false, 'the backdrop must yield to the microphone');

    const first = diag.frames;
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => window.__backdrop.getDiagnostics().frames), first);

    await context.close();
  });

  test('a brand-new profile sees no frost, whatever the gap', async () => {
    const { context, page } = await freshPage();
    // Two weeks of app life, a few sessions, then nothing — but too new to frost.
    await seedSessions(page, [isoDaysAgo(18), isoDaysAgo(16), isoDaysAgo(14)]);
    await page.goto(`${baseURL}?theme=forge`, { waitUntil: 'load' });
    await page.click('#tab-diary');
    await page.waitForSelector('.cal-grid');

    assert.equal(await page.locator('.cal-day.is-frosted').count(), 0, 'a new user must never be frosted');
    await context.close();
  });

  test('a lapsed veteran may show frost — on calendar cells only, and capped', async () => {
    const { context, page } = await freshPage();
    // Four months of steady training, then a long silence.
    const days = [];
    for (let i = 30; i <= 150; i += 2) days.push(isoDaysAgo(i));
    await seedSessions(page, days);
    await page.goto(`${baseURL}?theme=forge`, { waitUntil: 'load' });
    await page.click('#tab-diary');
    await page.waitForSelector('.cal-grid');

    const frostedCount = await page.locator('.cal-day.is-frosted').count();
    assert.ok(frostedCount > 0, 'an established user with a long gap should see some frost');

    // Never anywhere but the calendar.
    await page.click('#tab-today');
    await page.waitForSelector('#start-session');
    assert.equal(await page.locator('#view-today .is-frosted').count(), 0, 'the logging UI must never frost');
    await page.click('#tab-progress');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#view-progress .is-frosted').count(), 0, 'charts must never frost');

    await context.close();
  });

  test('"pause activity effects" clears frost and freezes the glow, keeping the history', async () => {
    const { context, page } = await freshPage();
    const days = [];
    for (let i = 30; i <= 150; i += 2) days.push(isoDaysAgo(i));
    await seedSessions(page, days);
    await page.goto(`${baseURL}?theme=forge`, { waitUntil: 'load' });

    await page.click('#tab-diary');
    await page.waitForSelector('.cal-grid');
    const before = await page.locator('.cal-day.is-frosted').count();
    assert.ok(before > 0);

    await page.click('#tab-settings');
    await page.check('#set-pause-activity');
    await page.waitForTimeout(250);

    await page.click('#tab-diary');
    await page.waitForSelector('.cal-grid');
    assert.equal(await page.locator('.cal-day.is-frosted').count(), 0, 'pausing must clear frost outright');

    // The sessions are all still there — pausing is cosmetic, never destructive.
    const sessionCount = await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('reptrack');
      req.onsuccess = () => {
        const tx = req.result.transaction('sessions', 'readonly');
        tx.objectStore('sessions').getAll().onsuccess = (e) => resolve(e.target.result.length);
      };
    }));
    assert.equal(sessionCount, days.length, 'pausing must not touch training history');

    // …and it is reversible.
    await page.click('#tab-settings');
    await page.uncheck('#set-pause-activity');
    await page.waitForTimeout(250);
    await page.click('#tab-diary');
    await page.waitForSelector('.cal-grid');
    assert.ok(await page.locator('.cal-day.is-frosted').count() > 0, 'un-pausing restores the previous state');

    await context.close();
  });

  test('forge is visibly warmer for a consistent profile than a fresh one', async () => {
    // A fresh account (glow 0, everyone's actual first run) still needs to
    // read as "on" — the base state is a dumbbell silhouette plus a handful
    // of embers regardless of history — but a genuinely consistent profile
    // must be brighter still, or the glow isn't doing anything visible.
    const cold = await freshPage();
    await cold.page.goto(`${baseURL}?theme=forge`, { waitUntil: 'load' });
    await cold.page.waitForSelector('#start-session');
    await cold.page.waitForTimeout(400);
    const coldGlow = (await cold.page.evaluate(() => window.__backdrop.getDiagnostics().activity)).glow;
    const coldBright = await backdropMaxBrightness(cold.page);
    await cold.context.close();

    const hot = await freshPage();
    await seedSessions(hot.page, consistentDays(Array.from({ length: 14 }, (_, i) => i)));
    await hot.page.goto(`${baseURL}?theme=forge`, { waitUntil: 'load' });
    await hot.page.waitForSelector('#start-session');
    await hot.page.waitForTimeout(400);
    const hotGlow = (await hot.page.evaluate(() => window.__backdrop.getDiagnostics().activity)).glow;
    const hotBright = await backdropMaxBrightness(hot.page);
    await hot.context.close();

    assert.equal(coldGlow, 0, 'sanity check: the cold profile really is at zero consistency');
    assert.ok(hotGlow > 0.9, 'sanity check: the seeded profile really is at high consistency');
    assert.ok(coldBright > 20, `even at glow 0 the base state (dumbbell + embers) must not be literally invisible, got ${coldBright}`);
    assert.ok(hotBright > coldBright + 20, `the hot profile (${hotBright}) should read visibly brighter than the cold one (${coldBright})`);
  });

  test('terminal streams read brighter for a consistent profile than a fresh one', async () => {
    // Terminal wasn't originally consistency-responsive at all — added after
    // real usage asked for the reward to show up here too (see DECISIONS.md).
    // Speed and brightness both move with glow; brightness is what's cheap to
    // assert against a static screenshot, so that's the check here.
    const cold = await freshPage();
    await cold.page.goto(`${baseURL}?theme=terminal`, { waitUntil: 'load' });
    await cold.page.waitForSelector('#start-session');
    await cold.page.waitForTimeout(400);
    const coldGlow = (await cold.page.evaluate(() => window.__backdrop.getDiagnostics().activity)).glow;
    const coldBright = await backdropMaxBrightness(cold.page);
    await cold.context.close();

    const hot = await freshPage();
    await seedSessions(hot.page, consistentDays(Array.from({ length: 14 }, (_, i) => i)));
    await hot.page.goto(`${baseURL}?theme=terminal`, { waitUntil: 'load' });
    await hot.page.waitForSelector('#start-session');
    await hot.page.waitForTimeout(400);
    const hotGlow = (await hot.page.evaluate(() => window.__backdrop.getDiagnostics().activity)).glow;
    const hotBright = await backdropMaxBrightness(hot.page);
    await hot.context.close();

    assert.equal(coldGlow, 0, 'sanity check: the cold profile really is at zero consistency');
    assert.ok(hotGlow > 0.9, 'sanity check: the seeded profile really is at high consistency');
    assert.ok(coldBright > 40, `even at glow 0 the streams must not be literally invisible, got ${coldBright}`);
    assert.ok(hotBright > coldBright + 30, `the hot profile (${hotBright}) should read visibly brighter than the cold one (${coldBright})`);
  });

  test('fractal lightning respects the flicker-hazard floor and gets more frequent as consistency rises', async () => {
    const SAMPLE_MS = 16_000;
    const MIN_INTERVAL_S = 3.5;   // must match LIGHTNING.minIntervalS in js/backdrop.js

    async function sampleFlashes(page) {
      const before = await page.evaluate(() => window.__backdrop.getDiagnostics().boltFlashes);
      await page.waitForTimeout(SAMPLE_MS);
      const after = await page.evaluate(() => window.__backdrop.getDiagnostics().boltFlashes);
      return after - before;
    }

    const cold = await freshPage();
    await cold.page.goto(`${baseURL}?theme=fractal`, { waitUntil: 'load' });
    await cold.page.waitForSelector('#start-session');
    const coldFlashes = await sampleFlashes(cold.page);
    await cold.context.close();

    const hot = await freshPage();
    await seedSessions(hot.page, consistentDays(Array.from({ length: 14 }, (_, i) => i)));
    await hot.page.goto(`${baseURL}?theme=fractal`, { waitUntil: 'load' });
    await hot.page.waitForSelector('#start-session');
    const hotFlashes = await sampleFlashes(hot.page);
    await hot.context.close();

    // The cap is structural (Math.max against the floor in the scheduler), so
    // this is really a sanity check that the observed cadence agrees with it:
    // even in the busiest sample, the average gap can't be under the floor.
    const impliedMinGap = SAMPLE_MS / 1000 / Math.max(1, hotFlashes);
    assert.ok(impliedMinGap >= MIN_INTERVAL_S - 0.25, `flashes fired faster than the flicker-hazard floor: ${hotFlashes} in ${SAMPLE_MS / 1000}s`);
    assert.ok(hotFlashes >= coldFlashes, `a consistent profile (${hotFlashes} flashes) should flash at least as often as a quiet one (${coldFlashes})`);
  });

  test('the theme layer never scolds or counts the days missed', async () => {
    const { context, page } = await freshPage();
    const days = [];
    for (let i = 40; i <= 160; i += 2) days.push(isoDaysAgo(i));
    await seedSessions(page, days);
    await page.goto(`${baseURL}?theme=forge`, { waitUntil: 'load' });

    const banned = /missed|streak broken|you haven'?t|days since|lapse|slacking|failed|shame|get back on track|don'?t give up/i;
    for (const tab of ['today', 'diary', 'progress', 'exercises', 'settings']) {
      await page.click(`#tab-${tab}`);
      await page.waitForTimeout(150);
      const text = await page.textContent('body');
      assert.doesNotMatch(text, banned, `${tab} contains language that quantifies or judges a gap`);
    }

    // The frosted cells carry no announcement either — they are decoration.
    await page.click('#tab-diary');
    await page.waitForSelector('.cal-grid');
    const labels = await page.$$eval('.cal-day.is-frosted', (cells) => cells.map((c) => c.getAttribute('aria-label') || ''));
    for (const label of labels) assert.doesNotMatch(label, /frost|cold|missed|inactive/i);

    await context.close();
  });

  test('axe-core finds no violations in any of the glass skins', async () => {
    const { context, page } = await freshPage();
    for (const theme of GLASS_SKINS) {
      await page.goto(`${baseURL}?theme=${theme}`, { waitUntil: 'load' });
      await page.waitForSelector('#start-session');
      await page.addScriptTag({ content: AXE_SOURCE });
      const violations = await page.evaluate(async () => {
        const result = await window.axe.run(document, { resultTypes: ['violations'] });
        return result.violations
          .filter((v) => ['moderate', 'serious', 'critical'].includes(v.impact))
          .map((v) => `${v.id} (${v.impact})`);
      });
      assert.deepEqual(violations, [], `${theme} has accessibility violations`);
    }
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
