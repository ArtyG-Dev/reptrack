/* Screenshots for VISUALS.md: the 3D mannequin at four angles, the muscle map
 * in both counting modes, the Unassigned row, and the legacy copy's banner.
 *
 *   node scripts/capture-musclemap.mjs     → docs/screenshots/musclemap-*.jpg
 *
 * Data is logged through the real UI (typed phrases through the confirm
 * sheet), so every number on screen is one the app computed itself.
 */

import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { listen } from './serve.mjs';
import { findChromium, launch } from '../tests/helpers/browser.mjs';
import { THREE_QUARTER_YAW } from '../js/mannequin.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/screenshots');
mkdirSync(OUT, { recursive: true });
if (!findChromium()) { console.error('No Chromium available.'); process.exit(1); }

const { server, port } = await listen(0);
const origin = `http://127.0.0.1:${port}`;
const browser = await launch(chromium);
const shot = async (handle, name) => { await handle.screenshot({ path: join(OUT, `musclemap-${name}.jpg`), type: 'jpeg', quality: 85 }); console.log(`  musclemap-${name}`); };

async function logPhrase(page, phrase, { create = false } = {}) {
  await page.click('#mic-button');
  await page.fill('#prompt-input', phrase);
  await page.click('#prompt-sheet button[type="submit"]');
  if (create) await page.click('#create-assign-later');
  await page.click('#confirm-sheet button[type="submit"]');
  await page.waitForSelector('#confirm-sheet', { state: 'hidden' });
}

try {
  const context = await browser.newContext({ viewport: { width: 393, height: 900 }, deviceScaleFactor: 2 });
  await context.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
  const page = await context.newPage();
  await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
  await page.waitForSelector('#start-session');
  await page.click('#start-session');
  for (const p of [
    'squat 100 kilos 4 sets of 5', 'deadlift 140 kilos 3 sets of 3', 'bench press 60 kilos 3 sets of 8',
    'pull ups 3 sets of 8', 'overhead press 40 kilos 2 sets of 6', 'push ups 2 sets of 20', 'plank 60 seconds'
  ]) await logPhrase(page, p);
  await logPhrase(page, 'cable crossover 15 kilos 3 sets of 12', { create: true });   // left Unassigned

  await page.click('#tab-settings');
  await page.selectOption('#set-body-figure', 'male');
  await page.waitForFunction(() => !(document.getElementById('toast')?.textContent || '').trim() || getComputedStyle(document.getElementById('toast')).opacity === '0', null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(3200);                     // let the toast clear: it is not the subject
  await page.click('#tab-progress');
  await page.waitForSelector('#mm-stage canvas');
  await page.waitForFunction(() => window.__muscleMap.get().frames > 0);

  // Four angles: three-quarter front (the resting view), front, side, back.
  const stage = await page.$('#mm-stage');
  for (const [name, yaw] of [['3q', THREE_QUARTER_YAW], ['front', 0], ['side', Math.PI / 2], ['back', Math.PI]]) {
    await page.evaluate((y) => window.__muscleMap.setView(y, 0), yaw);
    await shot(stage, `angle-${name}`);
  }
  await page.evaluate((y) => window.__muscleMap.setView(y, 0), THREE_QUARTER_YAW);

  // Both counting modes, the whole card.
  const card = await page.$('#muscle-map');
  await shot(card, 'sets');
  await page.click('#muscle-map [aria-label="Count by"] button:has-text("Weight")');
  await page.waitForSelector('#mm-weight-note');
  await shot(await page.$('#muscle-map'), 'weight');
  await page.click('#muscle-map [aria-label="Count by"] button:has-text("Sets")');
  await page.waitForFunction(() => !document.getElementById('mm-weight-note'));

  // The Unassigned row, at the end of the ranked list.
  await page.locator('#mm-unassigned').scrollIntoViewIfNeeded();
  await shot(await page.$('#mm-rank'), 'unassigned');

  // A tapped muscle's panel, with its trend.
  await page.click('#mm-rank button[data-muscle="quads"]');
  await page.waitForSelector('#muscle-sheet #muscle-trend svg');
  await shot(await page.$('#confirm-sheet'), 'panel');
  await page.click('#muscle-sheet button:has-text("Close")');

  // Full screen.
  await page.click('#mm-open-full');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, 'musclemap-fullscreen.jpg'), type: 'jpeg', quality: 85 });
  console.log('  musclemap-fullscreen');
  await page.keyboard.press('Escape');

  // The legacy copy, first launch: the banner, with the history copied over.
  await page.goto(`${origin}/legacy/index.html`, { waitUntil: 'load' });
  await page.waitForSelector('#legacy-banner');
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'musclemap-legacy-banner.jpg'), type: 'jpeg', quality: 85 });
  console.log('  musclemap-legacy-banner');
  await context.close();
} finally {
  await browser.close();
  server.close();
}
