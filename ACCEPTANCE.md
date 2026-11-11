# ACCEPTANCE.md

Every acceptance criterion, how it is verified, and the measured result.
Regenerate the measured block with `npm run acceptance`.

<!-- measured:start -->

_Measured 2026-11-11 — regenerate with `npm run acceptance`._

| Measurement | Value | Result |
|---|---|---|
| Automated tests | 351 passed, 1 failed | ❌ |
| Lighthouse — PWA | 100 | ✅ |
| Lighthouse — Accessibility (Light) | 100 | ✅ |
| Lighthouse — Accessibility (Neon) | 100 | ✅ |
| Lighthouse — Accessibility (Terminal) | 100 | ✅ |
| Lighthouse — Accessibility (Fractal) | 100 | ✅ |
| Lighthouse — Accessibility (Forge) | 100 | ✅ |
| Lighthouse — Accessibility (Kemet) | 100 | ✅ |
| Lighthouse — Performance | 81 | ✅ |
| Lighthouse — Best practices | 100 | ✅ |
| Lighthouse — SEO | 92 | ✅ |
| Skin CPU — Terminal (webgl2; see note below) | app JS +0.9% vs Light · main thread 68.5% incl. waiting on SwiftShader · GPU proc 231.8% (CPU-emulated) · 30 fps · 2D fallback 2.4% | ✅ |
| Skin CPU — Fractal (webgl2; see note below) | app JS +0.8% vs Light · main thread 70.9% incl. waiting on SwiftShader · GPU proc 248.8% (CPU-emulated) · 29.9 fps · 2D fallback 2.8% | ✅ |
| Skin CPU — Forge (webgl2; see note below) | app JS +0.9% vs Light · main thread 61.6% incl. waiting on SwiftShader · GPU proc 207.6% (CPU-emulated) · 30 fps · 2D fallback 2.9% | ✅ |
| Skin CPU — Kemet (webgl2; see note below) | app JS +0.9% vs Light · main thread 58.4% incl. waiting on SwiftShader · GPU proc 196.6% (CPU-emulated) · 30 fps · 2D fallback 3.5% | ✅ |
| App shell size | 0.418 MB | ✅ |
| A year of data (156 sessions, 3120 sets, 52 runs) | 3.336 MB stored | ✅ |
| Total installed footprint | 3.753 MB of a 50 MB budget | ✅ |

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
| 5 | No audio is ever written to storage | Two halves. Static: `pwa-static.test.js` bans `MediaRecorder`, `getUserMedia`, `AudioContext`, `createMediaStream` and asserts `continuous = false` / `interimResults = false`. Runtime: `browser.test.js` → "a full voice log writes zero audio bytes to any app-controlled storage" sweeps every IndexedDB database, Cache Storage entry, `localStorage` and `sessionStorage` after a real voice log — see #77 for scope and limits | ✅ |
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
| 30 | All three skins selectable in Settings, persist across sessions, apply without reload | `browser.test.js` → "every theme is selectable, applies without reload, and persists" selects each in turn, asserts `data-theme` changes with no navigation, then reloads and asserts the stored choice survives | ✅ |
| 31 | All three pass Lighthouse a11y ≥ 90 **and** 4.5:1 contrast at both extremes of their animation range | `contrast.test.js` — per skin, composites the glass scrim (`--glass`/`--glass-2` at `--glass-alpha`) over **both** `--backdrop-base` and `--backdrop-ink` and checks 12 text pairs against each; a companion test asserts every `--backdrop-*` token's luminance sits inside that range, which is what makes the two endpoints bracket every frame the canvas can draw. `npm run lighthouse` loops every theme and gates each on a11y ≥ 90; `browser.test.js` → "axe-core finds no violations in any of the glass skins" | ✅ see measured block (one a11y row per theme) |
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

## Added after the Kemet skin / prominent streak graphics update

Per `docs/FOLLOWUP_PROMPT_KEMET.md`.

| # | Criterion | How it is verified | Status |
|---|---|---|---|
| 63 | `streakLevel` is a rolling-window training-day count, not a consecutive-day reset; formula documented in `CLAUDE.md` | `streakState()` in `js/consistency.js`; `CLAUDE.md` → "Streak level" gives the formula, the reasoning for `targetDays: 7`, and a measured table of level-vs-pattern. Nothing anywhere resets on a missed day — there is no streak counter to reset | ✅ |
| 64 | Verified 4–5 sessions/week can reach maximum level, without daily training | `consistency.test.js` → "sustained 4-5 sessions a week reaches the top level — daily training is not required" asserts level 10 at both 4× and 5×/week, and that 7×/week is not *more* than maximum | ✅ |
| 65 | Verified a single rest day does not reset or visibly drop the level | `consistency.test.js` → "a single rest day never resets the level, and does not move it at all at 4-5x/week" (zero change at 4×, 5×, 7×). A companion test is explicit about the honest limit: below the target rate (2–3×/week) a rest day eases the level by **one tier of ten and never to zero** — a gradual ease, not a reset. See `DECISIONS.md` #54 | ✅ |
| 66 | Kemet skin selectable, persists, applies without reload | `browser.test.js` → "every theme is selectable, applies without reload, and persists" (now six; asserts the option list, that `data-theme`/`data-glass` change with no navigation, and that the choice survives a reload) | ✅ |
| 67 | Pyramid fully visible in the bottom third; all 10 tiers light cumulatively across levels 0–10 | `browser.test.js` → "the pyramid lights its ten tiers cumulatively across every level" drives levels 0→10 and asserts the lit count equals the level *and* that the lit tiers are always the bottom ones with no gaps. "…signature graphic inside the visible band, clear of the tab bar" asserts the band starts at the bottom third and ends above the tab bar — the first implementation hid two tiers behind it, see `DECISIONS.md` #57 | ✅ |
| 68 | Lightning crawl scales with level; flash frequency cap recorded | `LIGHTNING` in `js/backdrop.js`, shared by the Fractal bolts and the Kemet crawl so there is one cap, not two: `minIntervalS: 3.5` enforced structurally via `Math.max` so it holds at maximum intensity; `durationS: 0.15` (~4–5 frames at the 30fps cap, linear fade); peak alpha 0.22→0.67 and 0–2 branches, both scaling with level. `browser.test.js` → "fractal lightning respects the flicker-hazard floor…" samples the shared counter | ✅ |
| 69 | Forge barbell and Fractal Mandelbrot both fully visible in the bottom third, scaling in brightness/clarity | Same band test as #67 covers all three skins. `browser.test.js` → "the signature graphics get brighter and clearer as the streak level climbs" asserts, per skin, that level 0 still renders something visible **and** that 0 < 5 < 10 in measured pixel brightness | ✅ |
| 70 | The Mandelbrot is pre-rendered/cached, never computed per frame | `buildMandelbrot()` renders two offscreen buffers at seed/resize; the loop only `drawImage`s them. `browser.test.js` → "the fractal Mandelbrot is pre-rendered once, not computed per frame" asserts the frame rate holds (a per-frame escape-time pass could not sustain it) | ✅ |
| 71 | Contrast ≥ 4.5:1 verified at minimum and maximum level for all skins | Structural rather than per-level: the canvas may only paint declared `--backdrop-*` tokens, every token is tested to sit inside `[--backdrop-base, --backdrop-ink]`, and text contrast is checked with the scrim composited over **both** endpoints — which brackets every level, not just the two sampled. Two new guards close the ways that could stop being true: `contrast.test.js` → "every skin declares each --backdrop-* token its renderer actually reads" and "…never uses an additive composite operation". Scrim strengthened .88 → .92 per the brief; measured margin ≥ 7:1 everywhere | ✅ |
| 72 | Reduced-motion static fallback correct for all skins, pyramid tiers still readable | `snapTiers()` sets tiers to their exact target in static mode, so the count is correct without the ease. `browser.test.js` → "prefers-reduced-motion renders a static frame, not a slow one" (frame counter must not advance) and the tier test itself runs under `?static=1` | ✅ |
| 73 | CPU cost re-measured for every skin post-change | `npm run skins`: terminal 2.3%, fractal 3.1%, forge 2.7%, kemet 2.7% over baseline against a 5% budget — see measured block. Fractal is unchanged from before the Mandelbrot existed, because the per-pixel work happens once | ✅ see measured block |
| 74 | "Pause activity effects" still freezes level progression | `consistency.test.js` → "pausing activity effects freezes the level where it was" — two months of silence would otherwise empty the pyramid; paused, it holds at 10, via the same `effectiveToday()` path and with no data mutation | ✅ |
| 75 | Footprint still < 50 MB, no video assets or heavy libraries | `npm run footprint`. The update adds one CSS block and ~300 lines of JS; the Mandelbrot is computed, not shipped | ✅ see measured block |
| 76 | Pages deployment re-verified live after this merge | GitHub Actions run [`a7cb483`](https://github.com/ArtyG-Dev/reptrack/actions/runs/31475345106) completed with conclusion `success`. Same proxy limitation as above applies to fetching the live files back from here | ✅ |

## Added after the weight-display report and audio verification

Per `docs/FOLLOWUP_PROMPT_AUDIO_VERIFY_AND_WEIGHT_BUG.md`.

| # | Criterion | How it is verified | Status |
|---|---|---|---|
| 77 | Root cause of the "3kg → 300kg" report identified and documented as write-path vs display-path | **Neither — no weight was ever wrong.** Established empirically before changing anything: logged 3 / 3.5 / 30 / 300 kg through both entry paths and read raw `SetEntry.weight` out of IndexedDB (exact round-trip every time), with all three screens rendering the set correctly. The "300 kg" was the session *volume* line (3 kg × 10 reps × 10 sets = 300 kg), correct arithmetic rendered as a bare number one line above a list of `3 kg × 10` sets. Full diagnosis in `DECISIONS.md` #61 | ✅ |
| 78 | Fix applied; regression test covers voice and manual entry across multiple weights on every screen showing weight | Volume line now leads with its label — `10 sets · total volume 300 kg` — via one shared `formatVolumeLine()` in `progression.js` used by both Today and Diary. `browser.test.js` → "a logged weight is stored and displayed exactly, on every screen, via both entry paths" (4 weights × 2 paths × 3 screens, asserting stored value *and* rendered text, and explicitly that no `×100` weight appears) and "the session volume line names itself before its number…" (asserts the old `300 kg volume` phrasing cannot return) | ✅ |
| 79 | Corrupted data repaired where identifiable; ambiguous cases flagged rather than guess-corrected | **No repair pass written, because no data is corrupt** — the raw IndexedDB check above is the evidence. A migration written on the assumption of a write-path bug would have rewritten correct user data, which is worse than the reported symptom. One genuinely ambiguous display inconsistency (sets render in their logged unit, volume in the display-unit preference) is flagged in `DECISIONS.md` #62 with the reasoning for leaving it, rather than silently changed | ✅ |
| 80 | Automated test confirms zero audio bytes written to any app-controlled storage during voice logging | `browser.test.js` → "a full voice log writes zero audio bytes to any app-controlled storage": drives mic tap → transcript → confirm → commit, then recursively sweeps every IndexedDB database (not only RepTrack's), every Cache Storage entry and content-type, `localStorage` and `sessionStorage` for `Blob`s, `ArrayBuffer`s, typed arrays, `data:audio/…` URIs, audio MIME types and long opaque base64 runs; also asserts the committed set carries no field outside the documented schema. **Verified the test fails when it should** — planting four audio-shaped artefacts across two backends produced exactly four findings | ✅ |
| 81 | `CLAUDE.md` / `DEPLOYMENT.md` state honestly what is verified vs what is outside the app's visibility | `CLAUDE.md` → "What 'no audio is stored' actually means" and `DEPLOYMENT.md` → "Voice data on a deployed instance". Both make the stronger accurate claim (the Web Speech API is a live recognition stream, so the app never receives audio — there is nothing to delete) **and** state the limit plainly: the tests cover storage this origin controls, not what Chrome/Android/a platform speech service does in its own process, which the app can neither see nor clear | ✅ |
| 82 | The audio check is on the standing acceptance checklist, re-run on any change to the voice flow | It lives in `tests/browser.test.js`, which `npm test` and `npm run acceptance` both run every time — not a one-off manual check. Criterion #5 above now cites it alongside the static ban | ✅ |

## Added after the monthly-progress halo / white-hot bars update

Per `docs/FOLLOWUP_PROMPT_MONTHLY_HALO_1.md`.

| # | Criterion | How it is verified | Status |
|---|---|---|---|
| 83 | `monthPercent` implemented against **elapsed days**, formula documented in `CLAUDE.md` as distinct from `streakLevel` | `monthProgress()` in `js/consistency.js`; `CLAUDE.md` → "Month percent" gives the formula and a table contrasting all three metrics (`glow`, `streakLevel`, `monthPercent`) side by side, including which visual each drives | ✅ |
| 84 | Verified: training every day for the first 7 days of a month reads at or near 100%, not ~23% | `consistency.test.js` → "a perfect run reads 100% on any date — the denominator is days elapsed, not days in the month" asserts 100% *and* asserts that the naive full-month denominator would have read under 25%, so the test documents the trap it guards | ✅ |
| 85 | Month-boundary transition fades rather than snaps | `MONTH.carryDays: 2` blends the previous month's final figure out linearly. `consistency.test.js` → "the month boundary fades over a couple of days instead of snapping off" walks a perfect June across the 30th/1st/2nd/3rd and asserts a monotonic fade to zero rather than a cut | ✅ |
| 86 | Kemet halo staged at 25/50/90–100% with smooth interpolation; halo lightning distinct from pyramid-surface lightning | `drawHalo()` in `js/backdrop.js` — three `smoothstep` bands (presence ~25%, brighten ~50%, strike ~90%) so no threshold is a hard cut. The halo runs its own bolt track (`haloTrack`) separate from the pyramid's (`boltTrack`), with `getDiagnostics()` reporting each count separately | ✅ |
| 87 | Halo-to-pyramid lightning strike appears only in the 90–100% band | The connecting-arc geometry is chosen with probability `strike`, which is `smoothstep(0.82, 0.92, monthPercent)` — zero below the band, so no connecting arc can be generated there; below it the same track draws crawl around the ring instead | ✅ |
| 88 | Forge bar glow staged at the same thresholds with a believable dull-red → white progression, not a jump to white | `HEAT_STOPS` cross-fades four declared tokens (`heat-a` → `heat-b` → `heat-c` → `ink`) across the range. Verified by screenshot at 50% (orange) and 100% (white), not just by reading the ramp | ✅ |
| 89 | Contrast checked across **independent combinations** of the two metrics, not each in isolation | Structural: the canvas may only paint declared tokens, all tested inside `[base, ink]`, and text contrast is checked with the scrim over both endpoints — which brackets every combination. Empirical backup: `browser.test.js` → "no frame exceeds the declared backdrop ceiling, at any combination of the two metrics" samples real rendered pixels at (0,0), (0,100%), (10,0), (10,100%) and (5,50%) and asserts no pixel's luminance exceeds `--backdrop-ink`. That verifies the *code* honours the token contract, which reading the source no longer makes obvious now that two layers stack | ✅ |
| 90 | Reduced-motion fallback reflects the correct static level for both metrics | `browser.test.js` → "the reduced-motion frame still reflects both metrics, it just does not move" asserts the tier count is correct, that the halo level differs between month 0% and 100%, and that the frame counter does not advance | ✅ |
| 91 | CPU re-measured with both animated layers running; simplified if over budget | `npm run skins`: terminal 2.9%, fractal 3.9%, forge 3.4%, kemet 3.5% over baseline against a 5% budget — see measured block. Kemet now runs two independent bolt tracks plus the halo and still fits. The first halo implementation did **not**: it measured 10.8% and dropped Kemet to 16fps, and was rebuilt as a single gradient (see `DECISIONS.md` #72). That gate earning its keep is the reason it runs every acceptance pass | ✅ see measured block |
| 92 | "Pause activity effects" freezes both `streakLevel` and `monthPercent` | `consistency.test.js` → "pausing activity effects freezes month progress, not just the streak level" — two months on, live reads 0% while paused holds at 100%, through the same `effectiveToday()` path and with no data mutation | ✅ |
| 93 | The two metrics are demonstrably independent, not conflated | `consistency.test.js` → "month progress and streak level are genuinely independent" (a perfect 3-day month with an unfilled rolling window, and a streak carrying into an empty new month); `browser.test.js` → "the month-to-date layer responds independently of the streak level" sweeps each with the other pinned and asserts both respond | ✅ |
| 94 | Live-review tuning applied: flattened torus halo, stronger glow on the vertical bars | Halo is now an ellipse (~1:0.32) drawn as a single radial gradient with the ring band shaped into its colour stops, sized to sit between the card panel and the pyramid apex without shortening the pyramid; the vertical bars take the heat ramp at 1.35× the rod's intensity. Both verified by screenshot — see `DECISIONS.md` #72 | ✅ |
| 95 | Pages deployment re-verified live after this merge | GitHub Actions run [`837fdca`](https://github.com/ArtyG-Dev/reptrack/actions/runs/31499198946) completed with conclusion `success`. Same proxy limitation as above applies to fetching the live files back from here | ✅ |

## Added after the 3D theme visuals / full-screen view update

Per `docs/FOLLOWUP_PROMPT_3D_VISUALS.md`. Screenshots and the full
evidence table are in `VISUALS.md`.

**Superseded on the WebGL2 path, still true of the 2D fallback:** #46/#68 (the 3.5 s
lightning floor is now the WCAG 3-per-second sliding window, DECISIONS #75), #70 (the
Mandelbrot is a GPU shader; the 2D fallback still pre-renders, and its test now runs with
`?renderer=2d`) and #87 (halo-to-pyramid bolts now run whenever the halo is present,
growing more frequent and branched with intensity, as this brief asks).

| # | Criterion | How it is verified | Status |
|---|---|---|---|
| 96 | `theme-engine.js` with documented `intensity` formula; all themes read from it | `intensity = clamp(0.6 × streakLevel/10 + 0.4 × monthPercent)`, documented in `CLAUDE.md` → "Theme engine", including which effects read it and which display their own metric. `theme-engine.test.js` pins the formula and that each metric moves it alone | ✅ |
| 97 | Hand-rolled WebGL2 engine ≤ ~20 KB, or deviation justified; 2D fallback works with WebGL disabled | No library. `gl.js` 6.1 KB; with the four scenes, 16 KB gzipped (46 KB raw, mostly GLSL source text). Deviation recorded in `DECISIONS.md` #73. `visuals.test.js` → "with WebGL2 unavailable the existing 2D skins run instead" | ✅ gzipped / ⚠️ raw, see #73 |
| 98 | Kemet: 3D pyramid rotates, 10 tiers countable, rotation/glow/particles/halo lightning scale with intensity; rotation capped | Screenshots at 0/0.5/1. `visuals.test.js` counts the tier seams from pixels in the reduced-motion frame, and asserts rotation speeds up and stays ≤ 2π/8 rad/s; `browser.test.js` tier and brightness tests | ✅ |
| 99 | Forge: 3D barbell, heat shader red→white per `monthPercent`, embers scale with intensity | Screenshots at 0/0.5/1; `browser.test.js` → streak and month layers each brighten the frame independently | ✅ |
| 100 | Fractal: GPU shader, zoom/detail rise with intensity, no precision artefacts at max zoom | `browser.test.js` → "the fractal zooms deeper, iterates more and resolves more detail" (zoom, iterations, saturation and pixel edge energy). Max zoom keeps ~20 float32 steps per pixel; checked by eye in `docs/screenshots/fractal-1-full.jpg` | ✅ |
| 101 | Terminal clearly visible at default settings (by screenshot) | `docs/screenshots/terminal-0-today.jpg`; `browser.test.js` asserts the cold frame is not dark and the hot one carries more light | ✅ |
| 102 | Flash limiter: 10 s max intensity, ≤ 3 flashes in any 1 s window, every theme | `theme-engine.test.js` (all four themes, 30 and 60 fps, simulated) and `visuals.test.js` (all four, 10 s, real Chromium) | ✅ |
| 103 | Full-screen view: Fullscreen API + fallback; close, Esc and Android back exit; focus handled; drag-to-rotate on Kemet and Forge | `visuals.test.js` → full-screen focus/exits test (Esc, ✕, `goBack()` stays in the app), overlay without the Fullscreen API, drag holds and resumes auto-rotation. The physical back gesture is in `MANUAL_TEST.md` Check 2 | ✅ |
| 104 | Screenshots at 0 / 0.5 / 1.0 for every animated theme; animation-running and reduced-motion assertions pass | 24 shots in `docs/screenshots/`, embedded in `VISUALS.md`; `visuals.test.js` frame-difference and pixel-identical reduced-motion tests | ✅ |
| 105 | CPU measured and recorded per theme; anything over budget simplified | Measured block above: app JS +0.7–0.8%. The no-GPU environment's blocked main-thread and SwiftShader figures are recorded beside it, and DECISIONS #78 explains why they are not phone numbers. MSAA dropped at ≥ 2× DPR to cut fill on high-DPI phones | ✅ headless / ⚠️ needs device — `MANUAL_TEST.md` Check 2 |
| 106 | `sessionType` + reserved attendance fields with migration; nothing user-facing; roadmap spec | DB v2; `db.test.js` builds a genuine v1 database and migrates it, plus import of an older backup. Spec in `docs/PHASE_ROADMAP.md` → "Later build — class & PT attendance" | ✅ |
| 107 | Existing suite still green: weight-display regression, no-audio-persistence, weekly summary, noindex | 244 passing; all named tests included. There is no passcode gate in this codebase to keep green (DECISIONS #80) | ✅ |
| 108 | Footprint < 50 MB; Playwright dev-only and not deployed | Measured block above. `pwa-static.test.js` fails the build on any runtime dependency; nothing under `js/` imports Playwright | ✅ |
| 109 | Pushed, Pages re-verified live, service worker cache bumped | Actions run #23 `success`. Live site `200`; manifest and service worker load from `/reptrack/` (SW scope `/reptrack/`, single cache `reptrack-shell-v3`); deployed files are byte-identical to the commit; WebGL2 running with no console errors; 24 live screenshots in `docs/screenshots/live/`. Details in `DEPLOYMENT.md` → "Live verification" | ✅ |

## Added after the Forge rotation + progressive plates update

Per `docs/FOLLOWUP_PROMPT_FORGE_ROTATE_PLATES.md`.

| # | Criterion | How it is verified | Status |
|---|---|---|---|
| 110 | Root cause of the missing Forge drag-to-rotate documented | `DECISIONS.md` #82: the drag reached Forge, but was applied about the bar's own long axis, so a 69° turn changed 0.11% of the pixels (Kemet 6.5%). Measured on the live build before fixing | ✅ |
| 111 | Scripted drag rotates the barbell in the expected direction; auto-rotation resumes after release | `visuals.test.js` → "drag visibly turns both Kemet and Forge…" (pixels and on-screen bar ends) and "auto-rotation holds while dragging, eases back after release, and resumes" | ✅ |
| 112 | Kemet drag still works; both use one shared handler | Both themes run through the same assertions. `orbit*` in `theme-engine.js` is the only rotation handler, and `graphic-view.js` has one pointer path | ✅ |
| 113 | Forge at `streakLevel` 0, 3, 6, 10 in `docs/screenshots/` and `VISUALS.md`, symmetrical and matching the table | `forge-plates-L*-cool/hot.jpg`. `visuals.test.js` asserts the seated and drawn plates equal the table at each level; both sides draw the same list, mirrored | ✅ |
| 114 | Level 10 fits the sleeve with a visible collar, no clipping | `theme-engine.test.js` → "every level fits the sleeve, and level 10 just fills it" (0.003 units spare); `visuals.test.js` asserts the bar ends stay inside the viewport at every level, Today and full screen | ✅ |
| 115 | Plate colours distinguishable at heat 0 and 1.0 | `visuals.test.js` samples rendered plate rims: red/green and red/blue more than 60 RGB apart at both heats. Screenshots L4/L5/L9-hot | ✅ |
| 116 | Reduced-motion screenshot shows the correct plates, no animation | All `forge-plates-L*` shots are held reduced-motion frames; `theme-engine.test.js` → `snapRack`; `visuals.test.js` reduced-motion drag test | ✅ |
| 117 | Simulated level-up slides a plate on; level drop slides one off gently | `visuals.test.js` → "a level-up slides a plate on; a level easing down slides one off gently" (seen mid-move; alpha fades gradually); unit tests pin order and timing; `forge-plates-sliding-on.jpg` | ✅ |
| 118 | Forge CPU re-measured, within budget | `npm run skins`: app JS +0.9% (was +0.7%), 30 fps; 2D fallback 2.9% | ✅ headless / ⚠️ device — `MANUAL_TEST.md` Check 2 |
| 119 | Existing acceptance suite green | 258 passing, two consecutive full runs | ✅ |
| 120 | Pushed, cache bumped, live re-verified | Live files byte-identical to `9f37261`; SW `/reptrack/` with `reptrack-shell-v5`; on the live site a Forge drag changes 4.85% of the frame (0.11% before the fix); plates correct; no console errors. `DEPLOYMENT.md` → "Live verification" | ✅ |
| 121 | `MANUAL_TEST.md` on-phone check for Forge drag and plate count | Check 2 → "Forge, specifically", with the plate table to compare against | ✅ |

## Added after the Kemet base / Forge turntable / Terminal katakana update

Per `docs/FOLLOWUP_PROMPT_KEMET_BASE_FORGE_SPIN_TERMINAL_KATAKANA.md`. Each change committed separately.

| # | Criterion | How it is verified | Status |
|---|---|---|---|
| 122 | Kemet: cause documented; base solid and lit; inscription legible, not mirrored, from below; no edge gaps | `DECISIONS.md` #83 (base never in the mesh; culling never enabled). `visuals.test.js` → "Kemet has a solid base…" (faces camera from below, left→right, upright, centred, solid; hidden by default). The base shares the side faces' corner vertices. `kemet-base-before.jpg` / `kemet-base-underside.jpg` | ✅ |
| 123 | Forge: default spin about the vertical axis, opposite to Kemet, intensity-scaled and capped; axis and direction in one constant, documented | `FORGE_AUTO_ROTATION = { axis: 'vertical', direction: -1 }` in `theme-engine.js`; `CLAUDE.md` → "Auto-rotation axes" ('tumble' is the one-line switch). `visuals.test.js` → "Forge spins level on a turntable, the opposite way to Kemet" and "reduced motion: Forge does not auto-rotate" | ✅ |
| 124 | Terminal: katakana replace the letters, ~even mix of mirrored glyphs fixed per glyph, no tofu, Latin fallback works, cached atlas | Half-width katakana (`DECISIONS.md` #85). Two-row atlas drawn once. Every glyph is checked against the tofu box before use. `visuals.test.js` (katakana where drawable, forced fallback → Latin), `theme-engine.test.js` (mirror split ~50%) | ✅ |
| 125 | Screenshots for all three in `docs/screenshots/` and `VISUALS.md` | `VISUALS.md` → "Kemet base, Forge turntable, Terminal katakana" | ✅ |
| 126 | CPU re-measured for Kemet, Forge, Terminal | `npm run skins`: app JS +0.9% each, 30 fps, all PASS | ✅ headless / ⚠️ device |
| 127 | Full acceptance suite green | 262 passing | ✅ |
| 128 | Footprint < 50 MB, no font files | 3.499 MB total; system font stacks only. Noto CJK was installed as an OS package on the test machine for screenshots, not in the repo | ✅ |
| 129 | Pushed, cache bumped, live re-verified | Live files byte-identical to `f6f81a5`, SW `/reptrack/` with `reptrack-shell-v6`; on the live site the Kemet base reads correctly from below, Kemet +0.734 / Forge −0.734 rad/s, Terminal on katakana, no console errors. `DEPLOYMENT.md` → "Live verification" | ✅ |
| 130 | `MANUAL_TEST.md` on-phone checks for all three | Check 2 → "Three more quick looks" | ✅ |

## Added after the Terminal look-around / Fractal recolour update

Per `docs/FOLLOWUP_PROMPT_TERMINAL_ORBIT_FRACTAL_COLOUR.md`. Each change committed separately.

| # | Criterion | How it is verified | Status |
|---|---|---|---|
| 131 | Terminal: shared handler, clamped ±40° / ±25°, billboarded and legible at the extremes, eases back (snaps under reduced motion) | `ORBIT_STYLE.terminal` in `theme-engine.js`; `theme-engine.test.js` clamp test; `visuals.test.js` → clamp stops, ease home, reduced-motion snap to a pixel-identical frame; screenshots at every clamp. Point-sprite glyphs are screen-aligned by construction (`DECISIONS.md` #86) | ✅ |
| 132 | Fractal: horizontal → hue (wraps), vertical → warmth (−1…+1); no rotate/pan/zoom | `tintDrag()` unit test; `visuals.test.js` → hue/warmth/clamp/wrap, orbit and zoom unchanged | ✅ |
| 133 | Colours persist across exits and reloads, apply in Today, travel in JSON export/import, reset in both places | `visuals.test.js` → "Fractal colours are remembered…"; `db.test.js` export/import round-trip | ✅ |
| 134 | Hint once, arrow keys, overlay backing | `visuals.test.js` → "the hint shows once, the arrow keys recolour, and the overlay text has a dark backing" | ✅ |
| 135 | Contrast sweep (4 hues × 3 warmths × 2 intensities) in Today | `visuals.test.js` → all 24 combinations ≥ 4.5:1 against real pixels; no scrim change needed | ✅ |
| 136 | Screenshots in `docs/screenshots/` and `VISUALS.md` | "Terminal look-around and Fractal recolouring" | ✅ |
| 137 | CPU re-measured | Terminal app JS +0.9%, Fractal +0.8%, both PASS | ✅ headless / ⚠️ device |
| 138 | Existing suite green | 272 passing, two consecutive full runs | ✅ |
| 139 | Pushed, cache bumped, live re-verified | Live files byte-identical to `ea1100f`, SW `/reptrack/` with `reptrack-shell-v7`; on the live site the Terminal clamp, snap home, Fractal hint, hue/warmth and persistence across a reload all verified, no console errors. `DEPLOYMENT.md` → "Live verification" | ✅ |
| 140 | `MANUAL_TEST.md` on-phone checks | Check 2 → "Two more" | ✅ |

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

Lighthouse runs against all six themes (`?theme=light|neon|terminal|fractal|forge|kemet` — a
preview-only URL override `app.js` reads at boot, see `js/app.js` `wireTheme()`) and gates
every one of them at ≥ 90 for accessibility. The measured block above reports the default
(light) run's other categories; each theme's accessibility score has its own row.
`?static=1` alongside it forces the reduced-effects path, which is how the static render is
exercised without faking a media query.
