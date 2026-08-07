# ACCEPTANCE.md

Every acceptance criterion, how it is verified, and the measured result.
Regenerate the measured block with `npm run acceptance`.

<!-- measured:start -->

_Measured 2026-08-07 — regenerate with `npm run acceptance`._

| Measurement | Value | Result |
|---|---|---|
| Automated tests | 127 passed, 0 failed | ✅ |
| Lighthouse — PWA | 100 | ✅ |
| Lighthouse — Accessibility (Light theme) | 100 | ✅ |
| Lighthouse — Accessibility (Neon theme) | 100 | ✅ |
| Lighthouse — Performance | 96 | ✅ |
| Lighthouse — Best practices | 100 | ✅ |
| Lighthouse — SEO | 100 | ✅ |
| App shell size | 0.166 MB | ✅ |
| A year of data (156 sessions, 3120 sets, 52 runs) | 3.124 MB stored | ✅ |
| Total installed footprint | 3.29 MB of a 50 MB budget | ✅ |

<!-- measured:end -->

---

## From BUILD_SPEC §7

| # | Criterion | How it is verified | Status |
|---|---|---|---|
| 1 | Installs as a PWA on Android (manifest + service worker, offline-capable) | `pwa-static.test.js` validates the manifest, icon dimensions and precache list; Lighthouse PWA category (installability audits all pass) | ✅ automated — the install itself is unverified until you run `MANUAL_TEST.md` step 1 |
| 2 | Works with **zero network** after first load. No account, no login | `browser.test.js` → "registers a service worker and survives a fully offline reload" cuts the network at the browser context and reloads; `pwa-static.test.js` fails on any remote reference in the source | ✅ |
| 3 | Voice logging does not pause or duck background music (or degrades gracefully to tap-to-text) | Implemented as one-shot-on-tap with no `getUserMedia`/`AudioContext`; the fallback is covered by `browser.test.js` → "voice falls back to tap-to-text". **The music behaviour itself needs a real Android device** | ⚠️ needs device verification — `MANUAL_TEST.md` |
| 4 | Every voice log shows a confirm/edit step before committing | `browser.test.js` → "voice logs a set end to end, showing the parse before it commits" and "…nothing commits without confirmation" (cancel leaves the `sets` store empty) | ✅ |
| 5 | No audio is ever written to storage | `pwa-static.test.js` bans `MediaRecorder`, `getUserMedia`, `AudioContext`, `createMediaStream` and asserts `continuous = false` / `interimResults = false` | ✅ |
| 6 | Calendar diary navigable by day / week / month / year | All four scopes implemented in `views/diary.js`; `browser.test.js` navigates the month grid to a day view | ✅ |
| 7 | Progress charts render per-exercise weight & rep history with PR flags | `chart.test.js` covers the geometry; `progression.test.js` covers PR detection; `browser.test.js` asserts a labelled `svg.chart` renders | ✅ |
| 8 | Total installed footprint stays well under 50 MB; report the measured number | `npm run footprint` — app shell on disk plus a simulated year (3 sessions/week, 20 sets each, 1 run/week) written to IndexedDB, with a pessimistic ×3 store-overhead factor | ✅ see measured block |
| 9 | Data export/import as JSON works | `db.test.js` round-trips export → wipe → import including a JSON serialise cycle, covers merge mode and rejects malformed backups; `browser.test.js` downloads the real file from the UI | ✅ |
| 10 | Accessible: keyboard-navigable, ARIA labels, ≥ 4.5:1 contrast, respects reduced-motion | `contrast.test.js` checks 17 colour pairs per theme against the real stylesheet; `browser.test.js` runs axe-core on all five tabs and asserts every visible control is labelled and the tablist supports arrow keys; reduced-motion handled globally in `css/styles.css` | ✅ |
| 11 | Lighthouse PWA + Accessibility both ≥ 90 | `npm run lighthouse` (gates the run; exits non-zero below 90) | ✅ see measured block |

## Added after the roadmap update

| # | Criterion | How it is verified | Status |
|---|---|---|---|
| 12 | **Weekly plain-text summary** — one tap, covering sessions / lifts / PRs / volume / runs, as a `.txt` download **and** via Web Share, working offline | `summary.test.js` (14 cases: week boundaries, headline numbers, per-lift breakdown, PRs, day-by-day, unit conversion, mixed run units, empty week); `browser.test.js` covers the one-tap download, the Web Share path with a stubbed `navigator.share`, and generating it with the network cut off | ✅ |
| 13 | Runs/cardio: distance, duration, pace, kept to a few fields | `browser.test.js` → "a run is a few fields and shows its pace"; `db.test.js` covers run CRUD and backup inclusion | ✅ |
| 14 | Every record has a stable UUID and a `lastModified` stamp (the future sync hook) | `db.test.js` → "every record carries a UUID, a lastModified stamp and private visibility" and "lastModified moves forward on every write" | ✅ |
| 15 | `visibility` field present and `private` by default, though nothing reads it yet | Same tests as #14, plus the browser test asserting stored sets are `private` | ✅ |
| 16 | All storage access behind a single `store.js` seam | `pwa-static.test.js` → "all storage access goes through the store.js seam" fails if any module imports `db.js` directly | ✅ |
| 17 | Nutrition is *not* built yet (Phase 2 slot stays reserved) | `db.test.js` asserts no `nutrition` object store exists | ✅ |

## Added after the exercise categories / collapsible panels / colour schemes update

Per `docs/FOLLOWUP_PROMPT_EXERCISES_THEMES.md`.

| # | Criterion | How it is verified | Status |
|---|---|---|---|
| 18 | Calisthenics/yoga/pilates loggable in both `reps` and `hold` mode; existing strength/cardio logging unaffected | `parser.test.js` (hold-mode block: `plank for 60 seconds`, sides, rounds, indefinite-article durations) and `progression.test.js` (`recordScore`/`buildSeries`/PRs on holds); every pre-existing reps-mode test still passes unmodified — additive fields (`holdSeconds`, `side`) never appear on a reps-mode set | ✅ |
| 19 | Voice logging handles at least one hold-mode phrase correctly | `browser.test.js` → "a hold-mode exercise logs a duration, not weight/reps, and shows it as a hold" drives the real UI end to end with `plank for 60 seconds`, plus 7 parser unit tests covering `each side`, `a minute`, and a rounds count | ✅ |
| 20 | Exercise list and active-session view group into collapsible, keyboard-accessible, `aria-expanded`-correct panels | `js/ui.js` `disclosure()` — a real `<button>` (Enter/Space work natively), `hidden` attribute (not CSS) toggled in sync with `aria-expanded`/`aria-controls`; `contrast.test.js` checks the `hidden`-attribute rule; `browser.test.js` → "a mixed strength + yoga session groups…" and "…keyboard-operable and remember their state" drive it with a real Space keypress | ✅ |
| 21 | Collapsed/expanded state persists | Stored in `settings.panelState` (via `store.js`, not a parallel mechanism); `browser.test.js` reloads the page and confirms the same section is still expanded | ✅ |
| 22 | Light and High-Contrast Neon themes both selectable, both persist, both pass Lighthouse a11y ≥ 90 and 4.5:1 contrast checks, no flashing/strobing | `contrast.test.js` checks all 17 pairs for **both** `:root` and `[data-theme="neon"]`, plus asserts no `@keyframes`/`animation` in the neon block; `npm run lighthouse` now runs twice (`?theme=light`, `?theme=neon`) and gates on both; `browser.test.js` → "the theme toggle applies immediately and survives a reload" | ✅ see measured block (both themes) |
| 23 | Footprint still reported < 50 MB after these additions | `npm run footprint` — unchanged methodology, now seeding exercises that include `category`/`mode` | ✅ see measured block |
| 24 | Pages deployment re-verified live after merge | See `DEPLOYMENT.md` — re-run after this push | ⏳ verify after push, see below |

## Build constraints

| Constraint | Verification | Status |
|---|---|---|
| Vanilla HTML/CSS/JS, no framework, no build step | `pwa-static.test.js` asserts no `dependencies` and no `build` script | ✅ |
| Charts hand-rolled or ≤ ~30 KB | `js/chart.js` is ~4 KB of hand-rolled SVG; zero chart dependencies | ✅ |
| IndexedDB, not localStorage | `js/db.js`; `db.test.js` exercises the real API surface | ✅ |
| Clean load, no console errors | `browser.test.js` → "loads clean with no console errors on any tab" | ✅ |

---

## Running the checks

```bash
npm test               # the whole suite
npm run footprint      # MB report, exits non-zero over budget
npm run lighthouse     # scores, exits non-zero below the gates
npm run acceptance     # all three + rewrites the measured block above
```

The only criterion that cannot be verified headlessly is #3, the music behaviour.
`MANUAL_TEST.md` is the one thing to check on a real phone.

Lighthouse now runs against both colour schemes (`?theme=light`, `?theme=neon` — a
preview-only URL override `app.js` reads at boot, read `js/app.js` `wireTheme()`) and gates
on both scoring ≥ 90 for accessibility. The measured block above reports the default
(light) run; the neon run's accessibility score has its own row.
