/* The self-test loop in one command: runs the test suite, measures the
 * footprint, runs Lighthouse, and writes the measured values back into
 * ACCEPTANCE.md between the `measured` markers.
 *
 * Run: npm run acceptance
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const START = '<!-- measured:start -->';
const END = '<!-- measured:end -->';

function run(label, args) {
  process.stdout.write(`\n▶ ${label}\n`);
  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  return { code: result.status, output };
}

/* 1. Test suite */
const tests = run('Test suite', ['--test', 'tests/browser.test.js', 'tests/chart.test.js', 'tests/consistency.test.js',
  'tests/contrast.test.js', 'tests/db.test.js', 'tests/parser.test.js', 'tests/progression.test.js',
  'tests/pwa-static.test.js', 'tests/state.test.js', 'tests/summary.test.js', 'tests/theme-engine.test.js',
  'tests/visuals.test.js', 'tests/sweep.test.js', 'tests/features.test.js', 'tests/reminders.test.js', 'tests/plans.test.js', 'tests/muscles.test.js', 'tests/skin-data.test.js']);
const pass = Number(tests.output.match(/^# pass (\d+)$/m)?.[1] ?? 0);
const fail = Number(tests.output.match(/^# fail (\d+)$/m)?.[1] ?? 0);
const skipped = Number(tests.output.match(/^# skipped (\d+)$/m)?.[1] ?? 0);
console.log(`  ${pass} passed, ${fail} failed, ${skipped} skipped`);
if (fail) {
  // The failing tests' names, then each one's error and stack, so an
  // intermittent failure can be diagnosed from this log instead of guessed at.
  const lines = tests.output.split('\n');
  console.log(lines.filter((l) => l.trim().startsWith('not ok')).join('\n'));
  lines.forEach((l, i) => {
    if (/^\s+not ok/.test(l) && !/subtests? failed/.test(lines.slice(i, i + 12).join(' '))) console.log(lines.slice(i, i + 30).join('\n'));
  });
}

/* 2. Footprint */
const footprintRun = run('Footprint', ['scripts/measure-footprint.mjs']);
console.log(footprintRun.output.trim());

/* 3. Lighthouse (every theme) */
const lighthouseRun = run('Lighthouse', ['scripts/run-lighthouse.mjs']);
console.log(lighthouseRun.output.trim());

/* 4. Skin CPU cost */
const skinsRun = run('Skin cost', ['scripts/measure-skins.mjs']);
console.log(skinsRun.output.trim());

const read = (file) => (existsSync(join(ROOT, file)) ? JSON.parse(readFileSync(join(ROOT, file), 'utf8')) : null);
const footprint = read('.reports/footprint.json');
const lighthouse = read('.reports/lighthouse.json');
const skins = read('.reports/skins.json');

/* 5. Write the measured block into ACCEPTANCE.md */
const scores = lighthouse?.scores ?? {};                                    // default (light) run
const themeScores = lighthouse?.themes ?? {};
const THEME_LABELS = { light: 'Light', neon: 'Neon', terminal: 'Terminal', fractal: 'Fractal', forge: 'Forge', kemet: 'Kemet', monolith: 'Monolith', constellation: 'Constellation', orrery: 'Orrery' };
const a11yOf = (theme) => themeScores?.[theme]?.scores?.accessibility;
const everyThemeAccessible = Object.keys(THEME_LABELS).every((t) => (a11yOf(t) ?? scores.accessibility ?? 0) >= 90);

const rows = [
  ['Automated tests', `${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}`, fail === 0],
  ['Lighthouse — PWA', scores.pwa ?? 'n/a', (scores.pwa ?? 0) >= 90],
  ...Object.entries(THEME_LABELS).map(([id, label]) => [
    `Lighthouse — Accessibility (${label})`,
    a11yOf(id) ?? 'n/a',
    (a11yOf(id) ?? 0) >= 90
  ]),
  ['Lighthouse — Performance', scores.performance ?? 'n/a', true],
  ['Lighthouse — Best practices', scores['best-practices'] ?? 'n/a', true],
  ['Lighthouse — SEO', scores.seo ?? 'n/a', true],
  ...(skins ? ['terminal', 'fractal', 'forge', 'kemet', 'monolith', 'constellation', 'orrery'].map((skin) => [
    `Skin CPU — ${THEME_LABELS[skin]} (${skins.runs[skin].animated.renderer}; see note below)`,
    `app JS +${skins.runs[skin].overBaselinePercent}% vs Light · main thread ${skins.runs[skin].animated.cpuPercent}% incl. waiting on SwiftShader · GPU proc ${skins.runs[skin].animated.gpuProcessPercent ?? 'n/a'}% (CPU-emulated) · ${skins.runs[skin].animated.fps} fps · 2D fallback ${skins.runs[skin].fallback2d.cpuPercent}%`,
    skins.runs[skin].withinBudget
  ]) : []),
  ['App shell size', `${footprint?.shell.mb ?? '?'} MB`, true],
  ['A year of data (156 sessions, 3120 sets, 52 runs)', `${footprint?.yearOfData.estimatedStoredMB ?? '?'} MB stored`, true],
  ['Total installed footprint', `${footprint?.totalMB ?? '?'} MB of a 50 MB budget`, Boolean(footprint?.withinBudget)]
];

const block = [
  START,
  '',
  `_Measured ${new Date().toISOString().slice(0, 10)} — regenerate with \`npm run acceptance\`._`,
  '',
  '| Measurement | Value | Result |',
  '|---|---|---|',
  ...rows.map(([label, value, ok]) => `| ${label} | ${value} | ${ok ? '✅' : '❌'} |`),
  '',
  END
].join('\n');

const acceptancePath = join(ROOT, 'ACCEPTANCE.md');
if (existsSync(acceptancePath)) {
  const current = readFileSync(acceptancePath, 'utf8');
  const startIdx = current.indexOf(START);
  const endIdx = current.indexOf(END);
  if (startIdx !== -1 && endIdx !== -1) {
    writeFileSync(acceptancePath, current.slice(0, startIdx) + block + current.slice(endIdx + END.length));
    console.log('\n✔ ACCEPTANCE.md measured block updated.');
  } else {
    console.log('\n! ACCEPTANCE.md has no measured markers — left untouched.');
  }
}

mkdirSync(join(ROOT, '.reports'), { recursive: true });
writeFileSync(join(ROOT, '.reports/acceptance.json'), `${JSON.stringify({
  measuredAt: new Date().toISOString(),
  tests: { pass, fail, skipped },
  footprint,
  lighthouse: { scores, themes: lighthouse?.themes, version: lighthouse?.lighthouseVersion },
  skins
}, null, 2)}\n`);

const skinsWithinBudget = !skins || ['terminal', 'fractal', 'forge', 'kemet', 'monolith', 'constellation', 'orrery'].every((s) => skins.runs[s].withinBudget);
const green = fail === 0 && footprint?.withinBudget && (scores.pwa ?? 0) >= 90
  && everyThemeAccessible && skinsWithinBudget;
console.log(`\n${green ? '✅ All headless acceptance criteria pass.' : '❌ Acceptance criteria not met.'}`);
process.exit(green ? 0 : 1);
