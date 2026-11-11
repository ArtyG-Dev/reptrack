/* Re-verifies the deployed site after a push, the same way each time:
 *   1. the service worker serves the expected cache version;
 *   2. after one visit, the app reloads with the network cut off;
 *   3. a backup made by the build before this work (schema 1) imports complete;
 *   4. the features of each stage shipped so far work on the live build.
 *
 *   node scripts/verify-live.mjs <expected cache name> [--url <site>]
 */

import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { launch } from '../tests/helpers/browser.mjs';

const expectCache = process.argv[2];
const urlArg = process.argv.indexOf('--url');
const SITE = (urlArg > -1 ? process.argv[urlArg + 1] : 'https://artyg-dev.github.io/reptrack/').replace(/\/?$/, '/');
const BACKUP = JSON.parse(readFileSync(new URL('../tests/fixtures/backup-live-schema1.json', import.meta.url), 'utf8'));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); };

const browser = await launch(chromium);
try {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 393, height: 852 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });

  // 1. Cache version.
  await page.goto(`${SITE}index.html`, { waitUntil: 'load' });
  await page.waitForSelector('#start-session');
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, keys: await caches.keys() }; });
  check('service worker scope', sw.scope === SITE, sw.scope);
  check(`cache is ${expectCache}`, sw.keys.length === 1 && sw.keys[0] === expectCache, sw.keys.join(', '));

  // 2. Offline reload.
  await page.reload({ waitUntil: 'load' });                  // let the worker take control
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  check('offline reload', await page.waitForSelector('#start-session', { timeout: 10000 }).then(() => true, () => false));
  await context.setOffline(false);

  // 3. Import the pre-work backup (Replace).
  await page.click('#tab-settings');
  await page.setInputFiles('#import-file', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(BACKUP)) });
  await page.click('#confirm-sheet button:has-text("Replace")');
  await page.waitForFunction(() => /Imported/.test(document.getElementById('toast')?.textContent || ''), null, { timeout: 10000 });
  const counts = await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('reptrack');
    req.onsuccess = () => {
      const out = {};
      const names = ['sessions', 'sets', 'runs', 'exercises'];
      const tx = req.result.transaction(names);
      names.forEach((n) => { const g = tx.objectStore(n).count(); g.onsuccess = () => { out[n] = g.result; }; });
      tx.oncomplete = () => resolve(out);
    };
  }));
  for (const n of ['sessions', 'sets', 'runs', 'exercises']) check(`old backup: ${n}`, counts[n] === BACKUP[n].length, `${counts[n]} of ${BACKUP[n].length}`);

  // 4. Stage features.
  await page.click('#tab-today');
  // Stage 1: edit a logged set with a quick-adjust button.
  const active = await page.$('#start-session');
  if (active) await page.click('#start-session');
  await page.click('#mic-button');
  await page.fill('#prompt-input', 'bench press 60 kilos for 10');
  await page.click('#prompt-sheet button[type="submit"]');
  await page.click('#confirm-sheet button[type="submit"]');
  await page.waitForSelector('#confirm-sheet', { state: 'hidden' });
  const edit = page.locator('button[aria-label^="Edit set"][aria-label*="Bench Press"]').last();
  check('stage 1: a logged set is tappable to edit', await edit.count() > 0);
  await edit.click();
  await page.click('#confirm-sheet button[aria-label="Set 1 reps up"]');
  check('stage 1: quick adjust nudges reps', await page.inputValue('#row-reps-0') === '11');
  await page.click('#confirm-sheet button[type="submit"]');
  await page.waitForSelector('#confirm-sheet', { state: 'hidden' });
  await page.click('#tab-settings');
  check('stage 1: settings show the new controls', await page.$('#set-vibrate-rest') && await page.$('#set-keep-screen-on') && /back(ed )?up/i.test(await page.textContent('#last-backup')));

  // Stage 1b: earlier sessions, RPE + warm-up fields, the storage line.
  await page.click('#tab-today');
  const endBtn = page.locator('#view-today button:has-text("End session")');
  if (await endBtn.count()) { await endBtn.click(); await page.click('#confirm-sheet button:has-text("End session")'); }
  check('stage 1b: "Log an earlier session" is offered', await page.waitForSelector('#start-earlier-session', { timeout: 8000 }).then(() => true, () => false));
  await page.click('#start-session');
  await page.click('#mic-button');
  await page.fill('#prompt-input', 'warm up bench press 40 kilos for 10');
  await page.click('#prompt-sheet button[type="submit"]');
  await page.waitForSelector('#row-rpe-0');
  check('stage 1b: spoken warm-up pre-ticks the box, RPE field present', await page.isChecked('#row-warmup-0'));
  await page.click('#confirm-sheet button:has-text("Cancel")');
  check('stage 1b: an open session can change date', await page.$('#change-session-date'));
  await page.click('#tab-settings');
  check('stage 1b: Settings states the storage protection', await page.waitForFunction(() => /protected|does not say/i.test(document.getElementById('persist-line')?.textContent || ''), null, { timeout: 8000 }).then(() => true, () => false));

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
} finally {
  await browser.close();
}

for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
