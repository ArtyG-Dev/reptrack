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

  /** Logs one set through the confirm sheet, via either entry path, and returns
   *  what the raw IndexedDB record holds plus what each screen renders. */
  async function logAndInspect(weight, mode) {
    const phrase = `bench press ${weight} kilos for 10`;
    const { context, page } = mode === 'voice'
      ? await freshPage({ voice: 'working', init: new Function(`window.__transcript = ${JSON.stringify(phrase)};`) })
      : await freshPage({ voice: 'none' });

    await page.click('#start-session');
    if (mode === 'voice') {
      await page.click('#mic-button');
      await page.waitForSelector('#confirm-sheet button[type="submit"]', { state: 'visible' });
    } else {
      await typeSet(page, phrase);
    }
    await page.click('#confirm-sheet button[type="submit"]');
    await page.waitForTimeout(200);

    const stored = await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('reptrack');
      req.onsuccess = () => {
        const tx = req.result.transaction('sets', 'readonly');
        tx.objectStore('sets').getAll().onsuccess = (e) => resolve(e.target.result.map((s) => s.weight));
      };
    }));

    const today = await page.textContent('#view-today');
    await page.click('#tab-diary');
    await page.waitForSelector('.cal-day.has-session');
    await page.click('.cal-day.has-session');
    await page.waitForTimeout(200);
    const diary = await page.textContent('#view-diary');
    await page.click('#tab-progress');
    await page.waitForTimeout(300);
    const progress = await page.textContent('#view-progress');

    await context.close();
    return { stored, today, diary, progress };
  }

  test('a logged weight is stored and displayed exactly, on every screen, via both entry paths', async () => {
    // Regression for a report of "3kg displaying as 300kg" on the Diary. The
    // weight itself was never wrong — see the volume-line test below — but the
    // only way to know that is to check the stored value against every screen,
    // which is what this does. 3 and 3.5 are the small values that would expose
    // a ×100 or a decimal mis-parse; 300 guards the other direction.
    for (const weight of [3, 3.5, 30, 300]) {
      for (const mode of ['manual', 'voice']) {
        const { stored, today, diary, progress } = await logAndInspect(weight, mode);
        const where = `${weight}kg via ${mode}`;

        assert.deepEqual(stored, [weight], `${where}: IndexedDB must hold exactly what was logged`);
        for (const [screen, text] of [['today', today], ['diary', diary], ['progress', progress]]) {
          assert.ok(
            text.includes(`${weight} kg × 10`),
            `${where}: ${screen} should render "${weight} kg × 10", got: ${text.replace(/\s+/g, ' ').slice(0, 200)}`
          );
          assert.ok(
            !text.includes(`${weight * 100} kg × `),
            `${where}: ${screen} rendered a ×100 weight — the original bug report's symptom`
          );
        }
      }
    }
  });

  test('the session volume line names itself before its number, so it cannot read as a set weight', async () => {
    // The actual defect behind the "3kg shows as 300kg" report: 3 kg × 10 reps
    // × 10 sets is 300 kg of volume, which is correct — but it was rendered as
    // a bare "300 kg volume" directly above a list of "3 kg × 10" sets.
    const { context, page } = await freshPage({ voice: 'none' });
    await page.click('#start-session');
    await typeSet(page, 'bench press 3 kilos 10 reps 10 sets');
    await page.click('#confirm-sheet button[type="submit"]');
    await page.waitForTimeout(250);

    for (const [screen, tab] of [['today', null], ['diary', 'diary']]) {
      if (tab) {
        await page.click(`#tab-${tab}`);
        await page.waitForSelector('.cal-day.has-session');
        await page.click('.cal-day.has-session');
        await page.waitForTimeout(200);
      }
      const text = (await page.textContent(`#view-${screen}`)).replace(/\s+/g, ' ');
      assert.match(text, /total volume 300 kg/, `${screen}: volume must be labelled before its number`);
      assert.doesNotMatch(text, /300 kg volume/, `${screen}: the old number-first phrasing is what caused the misreading`);
      assert.match(text, /3 kg × 10/, `${screen}: the sets themselves still read as 3 kg`);
    }
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

  test('a full voice log writes zero audio bytes to any app-controlled storage', async () => {
    // The "no audio is ever stored" promise has always been enforced statically
    // (pwa-static.test.js bans MediaRecorder/getUserMedia/AudioContext). This is
    // the runtime half: drive a real voice log end to end, then sweep every
    // storage API the app can write to and assert nothing binary landed.
    //
    // What this can and cannot prove is stated in CLAUDE.md: it covers storage
    // this origin controls. It says nothing about Chrome's or Android's own
    // internals, which the app cannot see or clear.
    const { context, page } = await freshPage({
      voice: 'working',
      init: () => { window.__transcript = 'bench press 60 kilos for 10'; }
    });

    const before = await page.evaluate(async () => ({
      dbs: (await indexedDB.databases?.() ?? []).map((d) => d.name).sort(),
      caches: await caches.keys()
    }));

    await page.click('#start-session');
    await page.click('#mic-button');
    await page.waitForSelector('#confirm-sheet button[type="submit"]', { state: 'visible' });
    await page.click('#confirm-sheet button[type="submit"]');
    await page.waitForSelector('text=60 kg × 10');
    await page.waitForTimeout(300);

    const audit = await page.evaluate(async () => {
      const findings = [];

      /** Anything that could carry audio: a binary container, an audio data URI,
       *  or a long opaque base64 run. Deliberately over-broad — a false positive
       *  here is a conversation, a false negative is a broken promise. */
      const inspect = (value, path, seen = new Set()) => {
        if (value == null) return;
        if (typeof value === 'object') {
          if (seen.has(value)) return;
          seen.add(value);
        }
        if (typeof Blob !== 'undefined' && value instanceof Blob) {
          findings.push(`${path}: Blob type=${value.type || 'unknown'} size=${value.size}`);
          return;
        }
        if (value instanceof ArrayBuffer) { findings.push(`${path}: ArrayBuffer ${value.byteLength}B`); return; }
        if (ArrayBuffer.isView(value)) { findings.push(`${path}: ${value.constructor.name} ${value.byteLength}B`); return; }
        if (typeof value === 'string') {
          if (/^data:(audio|video)\//i.test(value)) findings.push(`${path}: ${value.slice(0, 40)}…`);
          else if (value.length > 1024 && /^[A-Za-z0-9+/\r\n]+={0,2}$/.test(value)) findings.push(`${path}: ${value.length}-char opaque base64 run`);
          return;
        }
        if (Array.isArray(value)) { value.forEach((v, i) => inspect(v, `${path}[${i}]`, seen)); return; }
        if (typeof value === 'object') for (const k of Object.keys(value)) inspect(value[k], `${path}.${k}`, seen);
      };

      // 1. IndexedDB — every database, every store, every record.
      const dbNames = (await indexedDB.databases?.() ?? []).map((d) => d.name).filter(Boolean);
      const stores = {};
      for (const name of dbNames) {
        const db = await new Promise((resolve, reject) => {
          const rq = indexedDB.open(name);
          rq.onsuccess = () => resolve(rq.result);
          rq.onerror = () => reject(rq.error);
        });
        for (const storeName of [...db.objectStoreNames]) {
          const rows = await new Promise((resolve) => {
            const tx = db.transaction(storeName, 'readonly');
            tx.objectStore(storeName).getAll().onsuccess = (e) => resolve(e.target.result);
          });
          stores[`${name}/${storeName}`] = rows.length;
          inspect(rows, `indexedDB.${name}.${storeName}`);
        }
        db.close();
      }

      // 2. Cache Storage — the service worker's precache and anything else.
      const cacheNames = await caches.keys();
      const cachedTypes = [];
      for (const cacheName of cacheNames) {
        const cache = await caches.open(cacheName);
        for (const request of await cache.keys()) {
          const response = await cache.match(request);
          const type = response?.headers.get('content-type') || '';
          cachedTypes.push(type);
          if (/^(audio|video)\//i.test(type)) findings.push(`cache ${cacheName}: ${request.url} is ${type}`);
          if (/\.(webm|wav|mp3|ogg|m4a|aac|opus|flac)(\?|$)/i.test(request.url)) findings.push(`cache ${cacheName}: ${request.url} looks like an audio file`);
        }
      }

      // 3. localStorage / sessionStorage.
      for (const [label, store] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]]) {
        for (let i = 0; i < store.length; i += 1) {
          const key = store.key(i);
          inspect(store.getItem(key), `${label}.${key}`);
        }
      }

      return {
        findings,
        dbs: dbNames.sort(),
        caches: cacheNames,
        stores,
        localStorageKeys: Object.keys(localStorage),
        sessionStorageKeys: Object.keys(sessionStorage),
        cachedTypes: [...new Set(cachedTypes)].sort()
      };
    });

    assert.deepEqual(audit.findings, [], 'a voice log wrote binary/audio-shaped data to app storage');

    // The transcript is text and it is the only thing the recogniser hands over —
    // assert the set really was written, so a silently-failed log can't pass this.
    const setRow = await page.evaluate(() => new Promise((resolve) => {
      const rq = indexedDB.open('reptrack');
      rq.onsuccess = () => {
        const tx = rq.result.transaction('sets', 'readonly');
        tx.objectStore('sets').getAll().onsuccess = (e) => resolve(e.target.result);
      };
    }));
    assert.equal(setRow.length, 1, 'the voice log must actually have committed a set');
    assert.equal(setRow[0].weight, 60);
    assert.deepEqual(
      Object.keys(setRow[0]).filter((k) => !['id', 'sessionId', 'exerciseId', 'dateISO', 'order', 'weight', 'unit', 'reps', 'rpe', 'holdSeconds', 'side', 'isPR', 'isWarmup', 'lastModified', 'visibility'].includes(k)),
      [],
      'the stored set carries no field beyond the documented schema'
    );

    // No audio MIME type anywhere in the cache, and no new storage backend
    // appeared as a side effect of talking to the app.
    assert.ok(!audit.cachedTypes.some((t) => /^(audio|video)\//i.test(t)), `cached content types: ${audit.cachedTypes.join(', ')}`);
    assert.deepEqual(audit.dbs, ['reptrack'], `only RepTrack's own database should exist, got ${audit.dbs.join(', ')}`);
    assert.deepEqual(audit.localStorageKeys, [], 'nothing should be written to localStorage at all');
    assert.deepEqual(audit.sessionStorageKeys, [], 'nothing should be written to sessionStorage at all');
    assert.deepEqual(before.dbs.length ? before.dbs : ['reptrack'], ['reptrack']);

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
    await page.waitForSelector('#set-theme');   // booted (it reloads onto Settings): the saved theme is applied then, not at 'load'
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

  const GLASS_SKINS = ['terminal', 'fractal', 'forge', 'kemet'];

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
      // readPixels() serves whichever renderer is live (WebGL2 or the 2D fallback).
      const { data } = window.__backdrop.readPixels();
      let max = 0;
      for (let i = 0; i < data.length; i += 4) max = Math.max(max, data[i] + data[i + 1] + data[i + 2]);
      return max;
    });
  }

  /** Total light on the backdrop — the right measure for "is more happening",
   *  where max brightness answers "is the peak brighter". They differ: on Kemet
   *  the halo is by construction the brightest thing on screen, so lighting the
   *  pyramid tiers underneath it adds a great deal of light without moving the
   *  peak at all. */
  async function backdropAverageBrightness(page) {
    return page.evaluate(() => {
      const { data } = window.__backdrop.readPixels();
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
      return sum / (data.length / 4);
    });
  }

  async function averagedBrightness(page, samples = 4) {
    let sum = 0;
    for (let i = 0; i < samples; i += 1) {
      sum += await backdropAverageBrightness(page);
      await page.waitForTimeout(150);
    }
    return sum / samples;
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

  test('every theme is selectable, applies without reload, and persists', async () => {
    const { context, page } = await freshPage();
    await page.click('#tab-settings');

    const options = await page.$$eval('#set-theme option', (opts) => opts.map((o) => o.value));
    assert.deepEqual(options, ['light', 'neon', 'terminal', 'fractal', 'forge', 'kemet']);

    for (const theme of GLASS_SKINS) {
      await page.selectOption('#set-theme', theme);
      await page.waitForFunction((t) => document.documentElement.getAttribute('data-theme') === t, theme, { timeout: 3000 });
      assert.equal(await page.getAttribute('html', 'data-glass'), '1', `${theme} should turn the glass treatment on`);
    }

    await page.reload({ waitUntil: 'load' });
    // Wait for boot to have applied a theme rather than racing it.
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') !== null, null, { timeout: 5000 });
    assert.equal(await page.getAttribute('html', 'data-theme'), 'kemet', 'the choice survives a reload');
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

  /** Drives the backdrop straight to a given streak level, bypassing the
   *  database. Seeding 0–10 real training histories per assertion would make
   *  these tests minutes long for no extra coverage — consistency.test.js
   *  already proves history maps to level correctly. */
  async function forceLevel(page, level, monthPercent = 0) {
    await page.evaluate(([lv, mp]) => {
      window.__backdrop.setActivity({ glow: lv / 10, frostHint: 0, streakLevel: lv, streakFraction: lv / 10, monthPercent: mp });
    }, [level, monthPercent]);
  }

  test('the pyramid lights its ten tiers cumulatively across every level', async () => {
    const { context, page } = await freshPage();
    await page.goto(`${baseURL}?theme=kemet&static=1`, { waitUntil: 'load' });
    await page.waitForSelector('#start-session');
    await page.waitForFunction(() => window.__backdrop?.getDiagnostics().skin === 'kemet', null, { timeout: 5000 });

    // Static mode snaps the tiers to their target, so each level can be read
    // immediately rather than waiting out the ease — and it doubles as the
    // reduced-motion check that the pyramid still shows the right count.
    for (let level = 0; level <= 10; level += 1) {
      await forceLevel(page, level);
      const tiers = await page.evaluate(() => window.__backdrop.getDiagnostics().tierGlow);
      const lit = tiers.filter((v) => v > 0.5).length;
      assert.equal(lit, level, `level ${level} should light exactly ${level} tiers, got ${lit}`);
      // Cumulative: the lit ones are always the bottom ones, never a gap.
      for (let i = 0; i < 10; i += 1) {
        assert.equal(tiers[i] > 0.5, i < level, `tier ${i} wrong at level ${level}`);
      }
    }
    await context.close();
  });

  test('each skin draws its signature graphic inside the visible band, clear of the tab bar', async () => {
    const { context, page } = await freshPage();
    for (const theme of ['kemet', 'forge', 'fractal']) {
      await page.goto(`${baseURL}?theme=${theme}`, { waitUntil: 'load' });
      await page.waitForSelector('#start-session');
      await page.waitForFunction((t) => window.__backdrop?.getDiagnostics().skin === t, theme, { timeout: 5000 });

      const { band, store, tabbarTop } = await page.evaluate(() => {
        const d = window.__backdrop.getDiagnostics();
        const bar = document.querySelector('.tabbar').getBoundingClientRect();
        return { band: d.featureBand, store: d.backingStore, tabbarTop: bar.top / window.innerHeight };
      });

      // The band is the bottom third…
      assert.ok(Math.abs(band.y / store.h - 2 / 3) < 0.02, `${theme}: band should start at the bottom third`);
      // …and must stop above the tab bar, or the graphic is drawn where nobody
      // can see it. This is what made the bottom pyramid tiers uncountable.
      const bandBottom = (band.y + band.h) / store.h;
      assert.ok(bandBottom <= tabbarTop + 0.01, `${theme}: band bottom ${bandBottom.toFixed(3)} runs under the tab bar at ${tabbarTop.toFixed(3)}`);
      assert.ok(band.h > 0, `${theme}: band must have height`);
    }
    await context.close();
  });

  test('the 2D fallback\'s Mandelbrot is pre-rendered once, not computed per frame', async () => {
    // The WebGL2 scene computes it per pixel on the GPU (cheap there); the 2D
    // fallback must still never do that on the CPU.
    const { context, page } = await freshPage();
    await page.goto(`${baseURL}?theme=fractal&renderer=2d`, { waitUntil: 'load' });
    await page.waitForSelector('#start-session');
    await page.waitForFunction(() => window.__backdrop?.getDiagnostics().hasMandelbrot === true, null, { timeout: 5000 });

    // If it were computed per frame, the frame budget would collapse: the cap
    // is 30fps and a full escape-time pass per frame cannot hold that.
    const before = await page.evaluate(() => window.__backdrop.getDiagnostics().frames);
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => window.__backdrop.getDiagnostics().frames);
    const drawn = after - before;
    assert.ok(drawn > 15, `fractal only drew ${drawn} frames in 1.5s — the Mandelbrot is likely being recomputed`);
    assert.ok(drawn <= 30 * 1.8, `fractal drew ${drawn} frames in ~1.5s — above the 30fps cap`);
    await context.close();
  });

  test('the signature graphics get brighter and clearer as the streak level climbs', async () => {
    const { context, page } = await freshPage();
    for (const theme of ['kemet', 'forge']) {
      await page.goto(`${baseURL}?theme=${theme}&static=1`, { waitUntil: 'load' });
      await page.waitForSelector('#start-session');
      await page.waitForFunction((t) => window.__backdrop?.getDiagnostics().skin === t, theme, { timeout: 5000 });

      // Forge now shows its level by loading plates, which cover part of the
      // brightest steel — so its peak can dip while far more is lit. Total
      // light is the measure that matches the claim there (see DECISIONS #82).
      const measure = theme === 'forge' ? backdropAverageBrightness : backdropMaxBrightness;
      const readings = [];
      for (const level of [0, 5, 10]) {
        await forceLevel(page, level);
        await page.waitForTimeout(120);
        readings.push(await measure(page));
      }
      const [low, mid, high] = readings;
      assert.ok(low > 15, `${theme}: level 0 must still render something visible, got ${low}`);
      assert.ok(mid > low, `${theme}: level 5 (${mid}) should read brighter than level 0 (${low})`);
      assert.ok(high > mid, `${theme}: level 10 (${high}) should read brighter than level 5 (${mid})`);
    }
    await context.close();
  });

  test('the fractal zooms deeper, iterates more and resolves more detail as the level climbs', async () => {
    // Brightness is the wrong measure here: the set's edge already reaches the
    // luminance ceiling at level 0. What the brief asks for is depth and
    // detail, so that is what this reads — the zoom and iteration count the
    // shader actually used, and edge energy in the rendered pixels.
    const { context, page } = await freshPage();
    await page.goto(`${baseURL}?theme=fractal&static=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__backdrop?.getDiagnostics().skin === 'fractal', null, { timeout: 5000 });
    const read = async (level) => {
      await forceLevel(page, level);
      return page.evaluate(() => {
        const { data, width, height } = window.__backdrop.readPixels();
        let edge = 0;
        const y0 = Math.floor(height * 0.67);
        for (let y = y0; y < height - 1; y += 1) {
          for (let x = 0; x < width - 1; x += 1) {
            const i = (y * width + x) * 4;
            const v = data[i] + data[i + 1] + data[i + 2];
            edge += Math.abs(v - (data[i + 4] + data[i + 5] + data[i + 6])) + Math.abs(v - (data[i + width * 4] + data[i + width * 4 + 1] + data[i + width * 4 + 2]));
          }
        }
        return { edge: edge / ((height - y0) * width), ...window.__backdrop.getDiagnostics().scene.fractal };
      });
    };
    const [low, mid, high] = [await read(0), await read(5), await read(10)];
    assert.ok(mid.half < low.half && high.half < mid.half, `zoom must deepen: ${low.half} → ${mid.half} → ${high.half}`);
    assert.ok(mid.iterations > low.iterations && high.iterations > mid.iterations, 'iterations must rise');
    assert.ok(high.saturation > low.saturation, 'colour saturation must rise');
    assert.ok(high.edge > low.edge * 1.5, `more resolved detail at level 10 (${high.edge.toFixed(1)}) than level 0 (${low.edge.toFixed(1)})`);
    await context.close();
  });

  test('the month-to-date layer responds independently of the streak level', async () => {
    // The two metrics are separate signals and the skins layer them. If they
    // had been conflated, holding the streak fixed and moving month-percent
    // would do nothing — which is exactly what this rules out.
    for (const theme of ['kemet', 'forge']) {
      const { context, page } = await freshPage();
      await page.goto(`${baseURL}?theme=${theme}&static=1`, { waitUntil: 'load' });
      await page.waitForSelector('#start-session');
      await page.waitForFunction((t) => window.__backdrop?.getDiagnostics().skin === t, theme, { timeout: 5000 });

      const read = async (level, month) => {
        await forceLevel(page, level, month);
        await page.waitForTimeout(120);
        return backdropMaxBrightness(page);
      };

      // Streak pinned low, month sweeping up.
      const lowStreak = [await read(0, 0), await read(0, 0.5), await read(0, 1)];
      assert.ok(lowStreak[1] > lowStreak[0], `${theme}: month 50% should read brighter than 0% at streak 0`);
      assert.ok(lowStreak[2] > lowStreak[1], `${theme}: month 100% should read brighter than 50% at streak 0`);

      // Month pinned at zero, streak sweeping up — still works, unchanged.
      const lowMonth = [await read(0, 0), await read(10, 0)];
      assert.ok(lowMonth[1] > lowMonth[0], `${theme}: the streak layer must still respond with month at 0`);

      // The two together must put more light on screen than either alone.
      // Measured as total light rather than peak: Kemet's halo is the brightest
      // element by design, so adding lit pyramid tiers beneath it cannot raise
      // the peak even though it plainly adds to the picture.
      const lit = async (level, month) => {
        await forceLevel(page, level, month);
        await page.waitForTimeout(120);
        return backdropAverageBrightness(page);
      };
      const monthOnly = await lit(0, 1);
      const streakOnly = await lit(10, 0);
      const both = await lit(10, 1);
      assert.ok(both > monthOnly, `${theme}: both metrics high (${both.toFixed(1)}) should exceed month alone (${monthOnly.toFixed(1)})`);
      assert.ok(both > streakOnly, `${theme}: both metrics high (${both.toFixed(1)}) should exceed streak alone (${streakOnly.toFixed(1)})`);
      await context.close();
    }
  });

  test('no frame exceeds the declared backdrop ceiling, at any combination of the two metrics', async () => {
    // The contrast proof rests on the canvas never painting brighter than
    // --backdrop-ink. contrast.test.js proves the *tokens* obey that; this
    // proves the *code* does, by sampling real rendered pixels across the
    // corners of the two-metric space. With two independent layers stacking,
    // that is no longer self-evident from reading the source.
    for (const theme of GLASS_SKINS) {
      const { context, page } = await freshPage();
      await page.goto(`${baseURL}?theme=${theme}&static=1`, { waitUntil: 'load' });
      await page.waitForSelector('#start-session');
      await page.waitForFunction((t) => window.__backdrop?.getDiagnostics().skin === t, theme, { timeout: 5000 });

      const ceiling = await page.evaluate(() => {
        const css = getComputedStyle(document.documentElement);
        const hex = css.getPropertyValue('--backdrop-ink').trim().replace('#', '');
        const ch = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
        const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
        return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
      });

      for (const [level, month] of [[0, 0], [0, 1], [10, 0], [10, 1], [5, 0.5]]) {
        await forceLevel(page, level, month);
        await page.waitForTimeout(140);
        const worst = await page.evaluate(() => {
          const d = window.__backdrop.readPixels().data;
          const ch = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
          let max = 0;
          for (let i = 0; i < d.length; i += 4) {
            const l = 0.2126 * ch(d[i]) + 0.7152 * ch(d[i + 1]) + 0.0722 * ch(d[i + 2]);
            if (l > max) max = l;
          }
          return max;
        });
        assert.ok(
          worst <= ceiling + 0.005,
          `${theme} at streak ${level} / month ${month}: a pixel reached luminance ${worst.toFixed(4)}, above the declared ceiling ${ceiling.toFixed(4)} — the contrast proof assumes this cannot happen`
        );
      }
      await context.close();
    }
  });

  test('the reduced-motion frame still reflects both metrics, it just does not move', async () => {
    const { context, page } = await freshPage();
    await page.goto(`${baseURL}?theme=kemet&static=1`, { waitUntil: 'load' });
    await page.waitForSelector('#start-session');
    await page.waitForFunction(() => window.__backdrop?.getDiagnostics().static === true, null, { timeout: 5000 });

    await forceLevel(page, 7, 1);
    await page.waitForTimeout(150);
    const hot = await backdropMaxBrightness(page);
    const tiers = await page.evaluate(() => window.__backdrop.getDiagnostics().tierGlow.filter((v) => v > 0.5).length);
    assert.equal(tiers, 7, 'the static frame shows the correct tier count');

    await forceLevel(page, 7, 0);
    await page.waitForTimeout(150);
    const cold = await backdropMaxBrightness(page);
    assert.ok(hot > cold, 'and the correct halo level for the month metric, held still');

    const settled = await settledFrameCount(page);
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => window.__backdrop.getDiagnostics().frames);
    assert.equal(after, settled, 'nothing animates in static mode');
    await context.close();
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
    const coldPeak = await backdropMaxBrightness(cold.page);
    const coldBright = await averagedBrightness(cold.page);
    await cold.context.close();

    const hot = await freshPage();
    await seedSessions(hot.page, consistentDays(Array.from({ length: 14 }, (_, i) => i)));
    await hot.page.goto(`${baseURL}?theme=terminal`, { waitUntil: 'load' });
    await hot.page.waitForSelector('#start-session');
    await hot.page.waitForTimeout(400);
    const hotGlow = (await hot.page.evaluate(() => window.__backdrop.getDiagnostics().activity)).glow;
    const hotBright = await averagedBrightness(hot.page);
    await hot.context.close();

    assert.equal(coldGlow, 0, 'sanity check: the cold profile really is at zero consistency');
    assert.ok(hotGlow > 0.9, 'sanity check: the seeded profile really is at high consistency');
    assert.ok(coldPeak > 40, `even at glow 0 the streams must not be literally invisible, got ${coldPeak}`);
    // Total light, averaged over a few frames: both profiles' brightest glyph
    // heads reach the same ceiling, so the peak cannot tell them apart — the
    // hot profile shows up as more, denser, brighter streams.
    assert.ok(hotBright > coldBright + 3, `the hot profile (${hotBright.toFixed(1)}) should carry visibly more light than the cold one (${coldBright.toFixed(1)})`);
  });

  test('fractal lightning stays under 3 flashes per second and gets more frequent as consistency rises', async () => {
    const SAMPLE_MS = 12_000;

    async function sampleFlashes(page) {
      await page.waitForTimeout(SAMPLE_MS);
      return page.evaluate(() => window.__backdrop.getDiagnostics().flashLog);
    }
    const worstSecond = (log) => {
      const t = [...log].sort((a, b) => a - b);
      let best = 0;
      for (let hi = 0, lo = 0; hi < t.length; hi += 1) { while (t[hi] - t[lo] >= 1000) lo += 1; best = Math.max(best, hi - lo + 1); }
      return best;
    };

    const cold = await freshPage();
    await cold.page.goto(`${baseURL}?theme=fractal`, { waitUntil: 'load' });
    await cold.page.waitForSelector('#start-session');
    const coldLog = await sampleFlashes(cold.page);
    await cold.context.close();

    const hot = await freshPage();
    await seedSessions(hot.page, consistentDays(Array.from({ length: 14 }, (_, i) => i)));
    await hot.page.goto(`${baseURL}?theme=fractal`, { waitUntil: 'load' });
    await hot.page.waitForSelector('#start-session');
    const hotLog = await sampleFlashes(hot.page);
    await hot.context.close();

    assert.ok(worstSecond(hotLog) <= 3, `WCAG 2.3.1: ${worstSecond(hotLog)} flashes inside one second`);
    assert.ok(hotLog.length > coldLog.length, `a consistent profile (${hotLog.length} flashes) should flash more often than a quiet one (${coldLog.length})`);
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
