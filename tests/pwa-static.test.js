/* Static PWA and offline-integrity checks: manifest shape, icon files, service
 * worker precache completeness, and the absence of any external reference.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const manifest = JSON.parse(read('manifest.webmanifest'));
const swSource = read('sw.js');
const indexHtml = read('index.html');

/** width/height straight out of a PNG's IHDR chunk. */
function pngSize(path) {
  const buf = readFileSync(path);
  assert.equal(buf.subarray(1, 4).toString('ascii'), 'PNG', `${path} is not a PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'tests', 'scripts', '.reports'].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test('manifest has everything an installable Android PWA needs', () => {
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.length > 0);
  assert.ok(manifest.short_name.length > 0 && manifest.short_name.length <= 12);
  assert.ok(['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display));
  assert.ok(manifest.start_url);
  assert.ok(/^#[0-9a-f]{6}$/i.test(manifest.background_color));
  assert.ok(/^#[0-9a-f]{6}$/i.test(manifest.theme_color));
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
});

test('every manifest icon exists at the size it claims', () => {
  for (const icon of manifest.icons) {
    const path = join(ROOT, icon.src);
    assert.ok(existsSync(path), `${icon.src} is missing`);
    const [w, h] = icon.sizes.split('x').map(Number);
    const actual = pngSize(path);
    assert.equal(actual.width, w, `${icon.src} width`);
    assert.equal(actual.height, h, `${icon.src} height`);
  }
});

test('a 192px and a 512px icon are present, plus a maskable one', () => {
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192'));
  assert.ok(sizes.includes('512x512'));
  assert.ok(manifest.icons.some((i) => String(i.purpose).includes('maskable')));
});

test('robots.txt exists at the site root and disallows everything', () => {
  const path = join(ROOT, 'robots.txt');
  assert.ok(existsSync(path), 'robots.txt is missing from the repo root');
  const body = readFileSync(path, 'utf8').trim();
  assert.equal(body, 'User-agent: *\nDisallow: /');
});

test('every HTML page carries the noindex meta tag, not just index.html', () => {
  const htmlFiles = walk(ROOT).filter((f) => f.endsWith('.html'));
  assert.ok(htmlFiles.length > 0, 'expected at least one HTML page to check');
  for (const file of htmlFiles) {
    const source = readFileSync(file, 'utf8');
    assert.match(
      source,
      /<meta name="robots" content="noindex, ?nofollow, ?noarchive, ?nosnippet">/,
      `${relative(ROOT, file)} is missing the noindex robots meta tag`
    );
  }
});

/** The app is meant to be direct-access only: robots.txt and the noindex meta
 *  tag ask compliant crawlers not to index it, but neither stops GitHub's own
 *  markdown renderer from turning a stray mention of the live host into a
 *  clickable (and therefore discoverable/crawlable-by-other-means) link in
 *  this repo's own docs. This caught a real regression: two ACCEPTANCE.md
 *  rows had the URL as bare text, which GFM auto-links, even though a later
 *  row in the same file claimed — by then incorrectly — that no such link
 *  existed. See DECISIONS.md. */
test('the live URL is never a crawlable hyperlink in the repo\'s own docs', () => {
  const HOST = 'artyg-dev.github.io';
  const mdFiles = walk(ROOT).filter((f) => f.endsWith('.md'));
  assert.ok(mdFiles.length > 0, 'expected at least one markdown doc to check');

  for (const file of mdFiles) {
    const source = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);

    // A markdown link whose target is the live host is a hyperlink no matter
    // how its label is formatted — e.g. [`text`](https://artyg-dev.github.io/x).
    for (const link of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      assert.ok(!link[1].includes(HOST), `${rel} links directly to the live host: ${link[1]}`);
    }

    // Outside of link targets, the host may only appear inside a backtick
    // code span or fenced block — bare text auto-links under GFM.
    const withoutLinks = source.replace(/\[[^\]]*\]\([^)]+\)/g, '');
    const withoutCode = withoutLinks.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
    assert.ok(!withoutCode.includes(HOST), `${rel} mentions the live host outside a code span — GitHub will auto-link it`);
  }
});

test('index.html links the manifest, sets viewport and theme colour', () => {
  assert.match(indexHtml, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(indexHtml, /name="viewport"/);
  assert.doesNotMatch(indexHtml, /user-scalable=no|maximum-scale=1/, 'pinch-zoom must not be disabled');
  assert.match(indexHtml, /name="theme-color"/);
  assert.match(indexHtml, /<html lang="en">/);
});

test('the service worker precaches every shipped shell file', () => {
  const listed = [...swSource.matchAll(/'(\.\/[^']*)'/g)].map((m) => m[1]).filter((p) => p !== './');
  for (const entry of listed) {
    assert.ok(existsSync(join(ROOT, entry)), `precached ${entry} does not exist`);
  }

  const shipped = walk(ROOT)
    .map((f) => `./${relative(ROOT, f).split('\\').join('/')}`)
    .filter((f) => /\.(js|css|png)$/.test(f) && !f.startsWith('./sw.js'));

  for (const file of shipped) {
    assert.ok(listed.includes(file), `${file} is shipped but not in the service worker PRECACHE list`);
  }
});

test('the service worker survives a cold offline start', () => {
  assert.match(swSource, /addEventListener\('install'/);
  assert.match(swSource, /addEventListener\('activate'/);
  assert.match(swSource, /addEventListener\('fetch'/);
  assert.match(swSource, /req\.mode === 'navigate'/, 'navigations must fall back to the cached shell');
  assert.match(swSource, /caches\.delete/, 'old caches must be cleaned up on activate');
});

test('nothing in the app references a remote origin', () => {
  const offenders = [];
  for (const file of walk(ROOT)) {
    if (!/\.(html|css|js|webmanifest)$/.test(file)) continue;
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/https?:\/\/[^\s'")]+/g)) {
      const url = match[0];
      if (url.startsWith('http://www.w3.org/')) continue;         // SVG namespace, never fetched
      if (url.startsWith('http://localhost')) continue;
      offenders.push(`${relative(ROOT, file)} → ${url}`);
    }
  }
  assert.deepEqual(offenders, [], 'the app must not reference anything off-device');
});

test('no CDN scripts, no framework, no build step', () => {
  assert.doesNotMatch(indexHtml, /<script[^>]+src="http/);
  assert.ok(!existsSync(join(ROOT, 'node_modules', 'react')), 'no framework runtime');
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies, undefined, 'the app must ship with zero runtime dependencies');
  assert.equal(pkg.scripts.build, undefined, 'there must be no build step');
});

/** Source with comments removed — these checks are about code, not prose. */
function codeOnly(dir) {
  return walk(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('no audio is ever captured or written to storage', () => {
  const sources = codeOnly(join(ROOT, 'js'));
  for (const banned of ['MediaRecorder', 'getUserMedia', 'AudioContext', 'audio/webm', 'createMediaStream']) {
    assert.ok(!sources.includes(banned), `${banned} must not appear anywhere — audio is never captured`);
  }
  assert.match(sources, /continuous = false/, 'recognition must be one-shot, not continuous');
  assert.match(sources, /interimResults = false/);
});

test('all storage access goes through the store.js seam', () => {
  // PHASE_ROADMAP Phase 3 plugs a sync adapter into store.js. Feature code that
  // reaches past it into db.js would have to be rewritten at that point.
  const offenders = walk(join(ROOT, 'js'))
    .filter((f) => !f.endsWith('/db.js') && !f.endsWith('/store.js'))
    .filter((f) => /from '[^']*db\.js'/.test(readFileSync(f, 'utf8')))
    .map((f) => relative(ROOT, f));
  assert.deepEqual(offenders, [], 'these modules import db.js directly instead of store.js');
});

test('no browser dialogs — every prompt is an in-app sheet', () => {
  const sources = codeOnly(join(ROOT, 'js'));
  for (const banned of [/\balert\(/, /\bwindow\.confirm\(/, /\bwindow\.prompt\(/, /(?<![.\w])confirm\(/, /(?<![.\w])prompt\(/]) {
    assert.ok(!banned.test(sources), `${banned} must not be used — use ui.js sheets`);
  }
});
