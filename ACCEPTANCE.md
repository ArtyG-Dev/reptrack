# ACCEPTANCE.md

Every acceptance criterion, how it is verified, and the measured result.
Regenerate the measured block with `npm run acceptance`.

<!-- measured:start -->

_Measured 2026-08-10 — regenerate with `npm run acceptance`._

| Measurement | Value | Result |
|---|---|---|
| Automated tests | 182 passed, 0 failed | ✅ |
| Lighthouse — PWA | 100 | ✅ |
| Lighthouse — Accessibility (Light) | 100 | ✅ |
| Lighthouse — Accessibility (Neon) | 100 | ✅ |
| Lighthouse — Accessibility (Terminal) | 100 | ✅ |
| Lighthouse — Accessibility (Fractal) | 100 | ✅ |
| Lighthouse — Accessibility (Forge) | 100 | ✅ |
| Lighthouse — Performance | 94 | ✅ |
| Lighthouse — Best practices | 100 | ✅ |
| Lighthouse — SEO | 92 | ✅ |
| Skin CPU — Terminal (main thread, over baseline) | 2% total, +2% vs Light · 21.8 fps | ✅ |
| Skin CPU — Fractal (main thread, over baseline) | 1.9% total, +1.9% vs Light · 22.2 fps | ✅ |
| Skin CPU — Forge (main thread, over baseline) | 2.6% total, +2.6% vs Light · 22.2 fps | ✅ |
| App shell size | 0.209 MB | ✅ |
| A year of data (156 sessions, 3120 sets, 52 runs) | 3.124 MB stored | ✅ |
| Total installed footprint | 3.333 MB of a 50 MB budget | ✅ |

<!-- measured:end -->

**Lighthouse SEO dropped from 100 to 92 in this measurement, and that's correct, not a
regression:** Lighthouse's `is-crawlable` audit ("Page is blocked from indexing") scores 0
against a page with a noindex meta tag — which is exactly the intent of the search-indexing
update below. SEO isn't a gated score (`scripts/run-lighthouse.mjs` only gates
`accessibility` and `pwa`), so this doesn't fail the build; it's the expected cost of
telling search engines not to index the app.

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
| 10 | Accessible: keyboard-navigable, ARIA labels, ≥ 4.5:1 contrast, respects reduced-motion | `contrast.test.js` checks 17 colour pairs against the real stylesheet for each flat theme, and 12 pairs against both extremes of the backdrop range for each glass skin (see #31); `browser.test.js` runs axe-core on all five tabs in every theme and asserts every visible control is labelled and the tablist supports arrow keys; reduced-motion handled globally in `css/styles.css` and by `backdrop.js` holding a still frame | ✅ |
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
| 24 | Pages deployment re-verified live after merge | GitHub Actions run [`c4f0f1a`](https://github.com/ArtyG-Dev/reptrack/actions/runs/31201628051) completed with conclusion `success` — live at `https://artyg-dev.github.io/reptrack/` | ✅ |

## Added after the search-indexing update

Per `docs/FOLLOWUP_PROMPT_BLOCK_INDEXING.md`.

| # | Criterion | How it is verified | Status |
|---|---|---|---|
| 25 | `robots.txt` returns 200 with the disallow-all rule when fetched directly | `pwa-static.test.js` → "robots.txt exists at the site root and disallows everything" checks the file content; `browser.test.js` → "robots.txt serves a plain-text disallow-all…" fetches it over real HTTP from the local server and checks status 200, `text/plain` content-type, and body | ✅ |
| 26 | Every HTML page's rendered `<head>` contains the noindex meta tag — checked programmatically, not just on `index.html` | `pwa-static.test.js` → "every HTML page carries the noindex meta tag…" globs every `.html` file in the repo (currently one, `index.html`, but the check scales to more); `browser.test.js` reads the tag back out of the live rendered DOM, not just the source | ✅ |
| 27 | `DEPLOY.md` states the X-Robots-Tag limitation | `DEPLOYMENT.md` → "Search indexing" section states GitHub Pages does not support custom response headers, so `X-Robots-Tag` is not applied at this host, and names it as the thing to add if the site ever moves to a host that does | ✅ |
| 28 | The live URL is not a crawlable hyperlink anywhere in the repo's own docs | `pwa-static.test.js` → "the live URL is never a crawlable hyperlink in the repo's own docs" scans every `.md` file, fails on a markdown link targeting the host and on any mention outside a backtick code span (GFM auto-links bare URLs). Originally "checked by hand" — that check missed two bare-URL rows added in a later update, so it's now automated. See `DECISIONS.md` | ✅ |
| 29 | Pages deployment re-verified live after this merge | GitHub Actions run [`46eeb8d`](https://github.com/ArtyG-Dev/reptrack/actions/runs/31287089210) completed with conclusion `success` — robots.txt and the noindex meta tag are live at `https://artyg-dev.github.io/reptrack/` | ✅ |

## Added after the animated skins update

Per `docs/FOLLOWUP_PROMPT_SKINS.md`.

| # | Criterion | How it is verified | Status |
|---|---|---|---|
| 30 | All three skins selectable in Settings, persist across sessions, apply without reload | `browser.test.js` → "all five themes are selectable, apply without reload, and persist" selects each in turn, asserts `data-theme` changes with no navigation, then reloads and asserts the stored choice survives | ✅ |
| 31 | All three pass Lighthouse a11y ≥ 90 **and** 4.5:1 contrast at both extremes of their animation range | `contrast.test.js` — per skin, composites the glass scrim (`--glass`/`--glass-2` at `--glass-alpha`) over **both** `--backdrop-base` and `--backdrop-ink` and checks 12 text pairs against each; a companion test asserts every `--backdrop-*` token's luminance sits inside that range, which is what makes the two endpoints bracket every frame the canvas can draw. `npm run lighthouse` now loops all five themes and gates each on a11y ≥ 90; `browser.test.js` → "axe-core finds no violations in any of the glass skins" | ✅ see measured block (five a11y rows) |
| 32 | `prefers-reduced-motion` renders a **static** background for each — verified, not assumed | `browser.test.js` → "prefers-reduced-motion renders a static frame, not a slow one" loads each skin with `colorScheme`/`reducedMotion: 'reduce'`, samples the backdrop's frame counter twice and asserts it does not advance — a slowed animation would still advance it, so the test distinguishes static from slow rather than assuming | ✅ |
| 33 | Animation auto-pauses when backgrounded and during voice recognition | `browser.test.js` → "the backdrop stops while the tab is hidden" (real `visibilitychange` via CDP) and "the backdrop stops while speech recognition is listening" (drives the actual mic button with a stubbed recogniser and asserts the frame counter is frozen for the duration, then resumes) | ✅ |
| 34 | Measured CPU cost of each skin recorded in `ACCEPTANCE.md`; any skin over budget is simplified, not shipped | `npm run skins` (`scripts/measure-skins.mjs`) samples CDP `Performance.getMetrics` `TaskDuration` over a 6s window per skin against a no-canvas Light baseline; `run-acceptance.mjs` writes the rows into the measured block and fails the run if any skin exceeds baseline + 5% | ✅ see measured block — **and read the caveat below** |
| 35 | Forge consistency score documented in `CLAUDE.md`; glow scales with it | `CLAUDE.md` → "Consistency score" gives the formula, the baseline rule, the three softenings and every frost gate. `consistency.test.js` (21 cases) covers the maths; `browser.test.js` → "forge is visibly warmer for a consistent profile than a fresh one" seeds a cold and a hot profile and asserts the rendered pixel brightness rises with glow, not just the underlying number | ✅ |
| 36 | Frost gated behind established history — verified with a simulated new-user profile (no frost) and a simulated lapsed-veteran profile (capped frost) | `browser.test.js` → "a brand-new profile sees no frost, whatever the gap" seeds a fortnight-old first session and a long gap, and asserts zero frosted cells; "a lapsed veteran may show frost — on calendar cells only, and capped" seeds months of history plus a lapse and asserts frosted cells appear. `consistency.test.js` covers each gate separately (`new-user`, `no-established-run`, `recent-activity`, `paused`) | ✅ |
| 37 | Frost caps at its mild state and does not deepen further with longer gaps | Structural, not tuned: frost is binary (an edge treatment, no depth ramp) and `frostedDates()` returns at most 21 cells of the *current* gap only. `consistency.test.js` → "frost caps: a 21-day gap and a 200-day gap look identical" asserts set equality between the two, and "an old gap in the middle of history is never re-litigated" / "logging one comeback session clears every frosted cell" cover the extent rule | ✅ |
| 38 | "Pause activity effects" toggle present, prominent, and freezes cooling/frost without data loss | `views/settings.js` — its own "Background effects" card, not buried in a list. `consistency.test.js` → "pausing freezes the glow at the moment it was switched on, without touching history" (evaluation shifts to `activityPausedAt`; the session arrays are untouched); `browser.test.js` → "'pause activity effects' clears frost and freezes the glow, keeping the history" toggles it in the real UI and asserts the sessions are all still in IndexedDB afterwards | ✅ |
| 39 | No scolding or lapse-quantifying copy anywhere in the theme layer | `browser.test.js` → "the theme layer never scolds or counts the days missed" loads the lapsed-veteran profile in Forge, walks the full rendered text of every tab plus every `aria-label`/`title`/`aria-live` region, and fails on any match for streak/missed/days-since/"you haven't"-style phrasing. The system produces no copy at all by construction — nothing reads `consistency.js` except the canvas and a CSS class | ✅ |
| 40 | Footprint still < 50 MB with all skins included (no video assets, no heavy libraries) | `npm run footprint` — unchanged methodology. The skins add two JS modules and a CSS block; there is no image, video or library. `pwa-static.test.js` still fails on any runtime dependency | ✅ see measured block |
| 41 | Pages deployment re-verified live after this merge | GitHub Actions run [`cd3aab8`](https://github.com/ArtyG-Dev/reptrack/actions/runs/31412350856) completed with conclusion `success` (build **and** deploy jobs). Note: the build container's outbound proxy blocks `artyg-dev.github.io`, so the live files could not be fetched back from here — the run conclusion is the verification, as it was for #24 and #29 | ✅ |

**On the CPU numbers (#34) — what they are and are not:** the brief's budget is ~5% on a
mid-range Android. `scripts/measure-skins.mjs` runs headless Chromium on a desktop-class
CPU, so it is a *proxy* for that budget, not a measurement of it. It also counts main-thread
work only — GPU compositing of the `backdrop-filter` blur does not appear in `TaskDuration`,
and on a phone that blur is plausibly the larger of the two costs. That is why the reported
figure is the *increment over a no-canvas baseline* rather than an absolute, and why a real
device check was added to `MANUAL_TEST.md` rather than treating the headless number as
sufficient. The static-mode row of `.reports/skins.json` records 0 frames drawn while
sampling, which is the direct evidence that reduced-effects mode costs nothing rather than
merely less.

## Added after the skin visibility/lightning/embers fix

Per `docs/FOLLOWUP_PROMPT_SKINS_FIX.md`. This was a real defect, diagnosed against evidence
(the backdrop diagnostics counter and raw canvas pixels), not a re-skin — see `DECISIONS.md`
#40 for what was actually wrong versus what merely looked wrong.

| # | Criterion | How it is verified | Status |
|---|---|---|---|
| 42 | Terminal animation confirmed visible (not just present in code) at default opacity | Verified by reading the canvas pixels back with `getImageData` before and after the fix (average brightness ~4-11/255 before, raised alphas after) and by eye against a live build; grid pulse and stream alpha both raised, nothing about what's drawn changed | ✅ |
| 43 | Fractal animation confirmed actually running post-fix, with lightning scaling visibly across at least three consistency levels | `browser.test.js` → "fractal lightning respects the flicker-hazard floor and gets more frequent as consistency rises" (cold vs. hot, via the `boltFlashes` diagnostics counter); backing store raised from 0.12× to 0.18× and blur from 18px to 11px so blooms read as shapes rather than a wash | ✅ |
| 44 | Forge animation confirmed actually running post-fix, with ember/flame intensity scaling visibly across the same levels | `browser.test.js` → "forge is visibly warmer for a consistent profile than a fresh one" (pixel-brightness delta, cold vs. hot); the base state (dumbbell contour + `EMBER_MIN_ACTIVE` embers) is now decoupled from heat so a fresh profile is visibly "on", while ember density/brightness and the flame lick above the bar still scale with it | ✅ |
| 45 | Root cause of the Fractal/Forge non-render bug documented in `DECISIONS.md` | `DECISIONS.md` #40 — diagnosed with `getDiagnostics()` (loop running, frames advancing, no console errors) and raw pixel sampling before writing any fix; the defect was amplitude/resolution/base-state, not wiring | ✅ |
| 46 | Lightning flash frequency/duration checked against the flicker-hazard rule; cap values recorded | `LIGHTNING` in `js/backdrop.js`: `minIntervalS: 3.5` (hard floor, enforced structurally via `Math.max`, holds even at glow 1), `durationS: 0.15` (~4-5 frames, linear fade), peak alpha 0.20-0.60 scaling with glow, 0-2 branches scaling with glow. `DECISIONS.md` #44 records the reasoning; the browser test above asserts the observed cadence never implies a gap under the floor | ✅ |
| 47 | Full existing skins acceptance checklist re-run since these are substantive changes | `npm run acceptance`: 175/175 tests, all five themes still score 100 for Lighthouse accessibility, `contrast.test.js` passed unmodified (see `DECISIONS.md` #41 for why the fixes couldn't break it), CPU cost measured **lower** than before the fix (terminal 2.4%→2.2%, fractal 2.3%→2.1%, forge 3.5%→2.8%, all vs. baseline) — see `DECISIONS.md` #42 | ✅ see measured block |
| 48 | Pages deployment re-verified live after this merge | GitHub Actions run [`222e466`](https://github.com/ArtyG-Dev/reptrack/actions/runs/31418080653) completed with conclusion `success`. As with the previous two updates, this container's outbound proxy blocks `artyg-dev.github.io`, so the live files could not be fetched back from here — the run conclusion is the verification | ✅ |
| 49 | Pages deployment re-verified live after the crawler-exclusion audit | GitHub Actions run [`67c9d37`](https://github.com/ArtyG-Dev/reptrack/actions/runs/31424377589) completed with conclusion `success`. Same proxy limitation as above applies to fetching the live files back from here | ✅ |

## Added after widening the reward range

Direct request, not a written follow-up doc: "not seeing much if any of the fractal
patterns... only a few faint sparks [on Forge]... increase the incidence of effects from the
first use onwards and then reward a consistent streak with greater visual embellishment...
[Terminal] speed and brightness increase with an improved streak."

| # | Criterion | How it is verified | Status |
|---|---|---|---|
| 50 | Every skin is visibly "on" from the first session, before any consistency has accrued | `browser.test.js` → "forge is visibly warmer for a consistent profile than a fresh one" and "terminal streams read brighter for a consistent profile than a fresh one" both assert a floor on the cold (glow 0) pixel-brightness reading, not just a delta — a base state that happened to round to zero would pass a delta-only check | ✅ |
| 51 | A consistent streak produces a clearly greater effect than the base state, on all three skins | Same two tests plus "fractal lightning respects the flicker-hazard floor and gets more frequent as consistency rises" assert hot > cold by a wide, named margin. Measured headless (`getImageData`, cold = no history vs. hot = 14 consecutive days): Terminal max brightness 105→191, Fractal average 81→141, Forge average 27→74 | ✅ |
| 52 | Terminal now scales with training consistency (a deliberate departure from the original brief, which only asked this of Fractal/Forge) | `js/backdrop.js` → `drawTerminal()` scales fall speed, overall brightness and the odds of drawing in the brightest colour token, all off `activity.glow`; documented as an intentional scope change in `CLAUDE.md` and `DECISIONS.md` #48 | ✅ |
| 53 | Terminal gets colour variance without ever mixing two backdrop tokens together (which isn't provably safe — see #54) | Each stream draws one of three *literal* tokens (`--backdrop-stream`, the new `--backdrop-stream-2`, `--backdrop-ink`) chosen at seed time; only the odds of landing in the brightest bucket move with glow, never the palette itself. Covered by the existing generic "every backdrop token sits inside the range" test — no special-casing needed for a new token | ✅ |
| 54 | Forge's one runtime colour blend (`mix()`) is proven safe across its full parameter space, not just asserted | `contrast.test.js` → "forge's mixed colours never escape the backdrop range" reimplements the exact `hot`/`ironShape`/`edge`/`flameColor` formulas from `backdrop.js` and sweeps heat/flameT 0→1 in 0.02 steps, asserting every resulting luminance stays inside `[--backdrop-base, --backdrop-ink]`. This replaces an informal comment that turned out to overstate its own guarantee — see `DECISIONS.md` #51 | ✅ |
| 55 | Re-measured CPU cost stays within budget after widening every range | `npm run skins`: terminal 2.8%, fractal 2.8%, forge 3.4% over baseline (budget +5%) — see measured block | ✅ see measured block |
| 56 | Pages deployment re-verified live after this merge | GitHub Actions run [`c09f914`](https://github.com/ArtyG-Dev/reptrack/actions/runs/31435715650) completed with conclusion `success`. Same proxy limitation as above applies to fetching the live files back from here | ✅ |

## Added after the exercise dictionary backfill

Direct request diagnosing a support question: "I'm only seeing 22 under strength... where
are yoga, pilates, cardio and calisthenics?" — see `DECISIONS.md` for the root cause (the 22
were the Phase 1 seed list, frozen because seeding only ever writes to an empty dictionary).

| # | Criterion | How it is verified | Status |
|---|---|---|---|
| 57 | An existing dictionary is backfilled with any starter exercise it's missing, exactly once, on the first boot after the update | `tests/state.test.js` → "a dictionary from before the newer starter categories existed gets backfilled once…" seeds an 18-exercise strength-only dictionary, calls `state.init()`, and asserts every category (including yoga/pilates) is now present and every pre-existing exercise is untouched | ✅ |
| 58 | The backfill never re-adds a starter a user has deliberately deleted | `tests/state.test.js` → "the backfill never runs twice…" runs `state.init()` once (backfill fires), deletes a backfilled exercise, runs `state.init()` again, and asserts it does not reappear — gated on the new `settings.seedBackfillDone` flag, never re-checked once true | ✅ |
| 59 | The backfill never duplicates a starter already present under different casing | `tests/state.test.js` → "…matches by name case-insensitively…" pre-seeds a lower-case `"bench press"` and asserts the starter list's `"Bench Press"` isn't added alongside it | ✅ |
| 60 | A brand-new install still gets every starter across every category in one pass | `tests/state.test.js` → "a fresh install seeds every starter exercise…" | ✅ |
| 61 | The known limitation (name-matching can't tell a rename from an absence) is documented, not silently accepted | `CLAUDE.md` → "Adding a starter exercise" and `DECISIONS.md` #53 both state it plainly, including why a seed-id wasn't added to close the gap | ✅ |
| 62 | Pages deployment re-verified live after this merge | GitHub Actions run [`1b8a8c0`](https://github.com/ArtyG-Dev/reptrack/actions/runs/31441309041) completed with conclusion `success`. Same proxy limitation as above applies to fetching the live files back from here | ✅ |

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

Two things cannot be settled headlessly, and both live in `MANUAL_TEST.md`: criterion #3,
the music behaviour, and the real-device half of criterion #34, the skin CPU/battery cost.

Lighthouse runs against all five themes (`?theme=light|neon|terminal|fractal|forge` — a
preview-only URL override `app.js` reads at boot, see `js/app.js` `wireTheme()`) and gates
every one of them at ≥ 90 for accessibility. The measured block above reports the default
(light) run's other categories; each theme's accessibility score has its own row.
`?static=1` alongside it forces the reduced-effects path, which is how the static render is
exercised without faking a media query.
