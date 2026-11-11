# Claude Code — Follow-up Prompt: Session Plans, Set Editing, Muscle Map + Monolith, Constellation, Orrery

Five stages, built in order. Each stage ships on its own. **Work in a check → change → check → repair loop the whole way through** (the "Working method" section below). Read `CLAUDE.md` and the latest entries in `DECISIONS.md` before you write any code. Every hard constraint in `CLAUDE.md` still applies: no build step, no runtime dependency, no network, no audio capture, no browser dialogs, nothing saved without confirmation, all storage goes through `store.js`, and at most 3 flashes per second.

Don't change the consistency formulas (`glow`, `streakLevel`, `monthPercent`, frost), the intensity driver, or the four existing skins, except where a stage below says so.

---

## Working method: check for breaks, repair as you go

### Before you start (Stage 0)
1. `npm ci`, then `npm test`, then `npm run acceptance`. Write down the baseline: number of tests passed, Lighthouse scores, the CPU figure for each skin, and the footprint.
2. If anything is already failing, **fix that first, in its own commit** with a message starting `Repair:`, before any feature work. Record what it was and why in `DECISIONS.md`.

### After every change
- Run `npm test` after each meaningful edit, not just at the end of a stage.
- Run the full `npm run acceptance` at the end of each stage.
- When something breaks:
  1. **Find the cause and fix the code.** Never fix a failure by deleting, skipping or loosening a test.
  2. **Never weaken the tests that guard the hard constraints:**
     - `pwa-static.test.js`
     - the zero-audio-bytes test in `browser.test.js`
     - `contrast.test.js`
     - the flash-limiter tests
     - the storage-seam test
  3. If a test fails only because it hard-codes something this prompt deliberately changes (for example, the number of themes), update the test to match the new spec. Say so in the commit message.
  4. If the same failure survives **3 genuine attempts**, stop work on that item:
     - Revert to the last green commit for it.
     - Write a `BLOCKED:` entry in `DECISIONS.md` covering what failed, what you tried, and your best guess at the cause.
     - Move on to the next item that doesn't depend on it.
  5. Repairs get their own commits (`Repair: …`), separate from feature commits.
- **Never push while anything is failing.**

### Regression sweep at the end of every stage
These existing behaviours must still work. Each one is covered by an automated test or a scripted browser check. Where one is missing, add it.
- Voice and typed logging, including:
  - "same as last time"
  - "add another set"
  - multiple sets in one phrase
- Hold-mode logging, including "each side"
- Every set going through the confirm sheet before it's saved
- Runs: logging and deleting
- Diary at year, month, week and day level, plus the weekly summary
- PR flags and the progression nudge
- Export, then import (both Replace and Merge). **Also import a backup made by the current live build (schema 1)** and confirm it arrives complete.
- Every theme (all nine after Stage 5) loads with:
  - normal settings
  - `prefers-reduced-motion`
  - "Reduce background effects"
- Pause activity effects freezes every metric and changes no training data
- Frost behaviour and the 21-cell cap
- The service worker: offline reload works, and **every new file is in `PRECACHE`**. A missing entry is the most likely silent break.

---

## Stage 1: quick wins

### 1a. Edit a logged set, plus quick adjust buttons
- Tapping a logged set on Today reopens the existing edit sheet with that set's values filled in. Saving calls `state.updateSetEntry()`, which exists but nothing uses yet. Deleting stays where it is.
- Editing a set must recalculate PR flags for that exercise, because an edit can create or remove a PR. Add a test for both directions.
- In the edit sheet, add buttons next to the fields:
  - **reps:** −1 / +1
  - **weight:** − / + by the user's progression step (`progressionStepKg` / `progressionStepLb`)
  - **holds:** −5 s / +5 s

  Use real `<button>`s that are 44 px or larger, with proper `aria-label`s.
- Voice: add the intent "make that N" (and "change that to N"). It edits the reps of the **most recently logged set**, and goes through the confirm sheet like everything else. Add parser tests first.

### 1b. Rest timer that actually tells you
- When rest reaches zero, call `navigator.vibrate([200, 100, 200])` if the browser supports it. Add a setting, "Vibrate when rest ends", on by default.
- Optional rest time per exercise: add an `Exercise.restSec` field (null means use the default). Set it in the Exercises editor. The timer started after a commit uses the exercise's rest time if set, otherwise the default.
- While a session is active, keep the screen awake with the Screen Wake Lock API, behind the setting "Keep screen on during a session", on by default. Release it when the session ends or is discarded, and take it again when the page becomes visible. Handle a refused request silently: no error, no toast.
- `MANUAL_TEST.md`: add a note that some Android browsers ignore vibration while the screen is off.

### 1c. Backup reminder
- Save `settings.lastExportAt` on every successful export.
- In Settings, show "Last backup: <date>" or "Never backed up".
- After **finishing** a session (never during one, never on the logging screen), if the last export was 30 or more days ago, or never and there are at least 5 sessions, show one quiet toast with an "Export now" action. At most once every 7 days (`settings.backupNudgeShownAt`). No dialog and no count of days.

**Stage 1 done when:**
- Sets can be edited and PRs recalculate.
- The quick buttons work.
- "make that N" works.
- Vibration and wake lock work and can be switched off.
- Per-exercise rest works.
- The backup reminder follows its rules.
- The regression sweep passes.

---

## Stage 2: session plans with a tick-off checklist

### Data
- A new `plans` store. **Bump `DB_VERSION` to 3** with an `oldVersion < 3` branch.

  `Plan { id, name, items: [{ exerciseId, targetSets, targetReps, targetWeight, unit, targetHoldSec, note }], lastModified, visibility }`.
- Add the store to `exportAll`/`importAll` and re-export its functions through `store.js`.
- Bump the backup `SCHEMA_VERSION` to 2. `validateBackup` must still accept schema 1, treating a missing `plans` as empty. Test both versions.
- `Session.planId` (nullable) records which plan a session was started from. It's additive and needs no migration.

### UI
- **Creating a plan:** a "Plans" section in the Exercises tab (a collapsible built with `disclosure()`) with create, edit, rename, delete and reorder. Also "Save as plan" on a finished session, which builds a plan from that session's exercises and top sets.
- **Starting from a plan:** when idle, the Today screen shows a "Start from plan" option next to "Start session".
- **The checklist:** the active session shows the plan as a checklist. Each item shows its target and how many of its target sets are done (e.g. "2 / 3").
  - Tapping an item opens the normal confirm sheet, filled with the target. The user adjusts anything, including extra reps or sets, then confirms. **Nothing saves without that confirmation.**
  - An item is ticked when its logged sets reach the target. It can also be ticked or unticked by hand (e.g. "done, but differently").
  - "Skip" marks an item skipped for this session only.
  - Exercises outside the plan can still be added. They appear under "Extra".
  - Voice logging still works during a plan session and counts toward the matching item.
- **Finishing a plan session:** show "Update plan to what I did?", which updates the targets to the logged top sets. Use a sheet, not a dialog, and default to No.

**Stage 2 done when:**
- Plans can be created, edited and deleted, including via "Save as plan".
- A plan session ticks items off correctly and allows extra work.
- Export and import include plans, and old backups still import.
- The regression sweep passes.

---

## Stage 3: finer muscle data, plus volume and muscle-group graphs

### Muscle taxonomy
- Add `Exercise.primaryMuscles[]` and `Exercise.secondaryMuscles[]`, drawn from this fixed list, exported from `exercises-seed.js` as `MUSCLES`:

  `chest, front-delts, side-delts, rear-delts, biceps, triceps, forearms, abs, obliques, lats, upper-back, lower-back, glutes, quads, hamstrings, calves, adductors, hip-flexors`
- Keep `muscleGroup` as it is for compatibility. Nothing that reads it now should break.
- Give every seed exercise accurate primary and secondary muscles. For example:
  - Deadlift: primary glutes, hamstrings, lower-back; secondary upper-back, lats, forearms, quads
  - Bench: primary chest; secondary front-delts, triceps
  - Pull Up: primary lats; secondary biceps, upper-back, rear-delts

  Yoga and pilates holds get sensible mappings or empty lists.
- **Existing installs:** a one-time backfill in `state.init()`, gated by `settings.muscleBackfillDone`, using the same pattern as `seedBackfillDone`.
  - It fills in muscles only for exercises whose lists are empty: matching seed names first, then mapping from the old `muscleGroup` (e.g. `legs` → `quads, hamstrings, glutes`).
  - It never overwrites an exercise that already has muscles, and runs only once.
  - No DB version bump: the fields are additive.
- The Exercises editor gets multi-select chip lists for primary and secondary muscles. These are buttons with `aria-pressed`.
- Add the muscle lists to export/import (already covered because they're on the exercise record). Test that a schema-1 backup without them imports, and that the backfill then fills them in.

### Graphs
Put the shared calculations in `progression.js` (or a new pure module) as pure functions with unit tests.

- **Per exercise:** add these metrics to `METRICS_REPS`:
  - **Total reps** per session (all sets, not just the top set)
  - **Volume** per session (Σ weight × reps, shown in the display unit). For bodyweight exercises, volume = total reps, labelled as such.
- **Muscle groups:** a new card in Progress, "Weekly sets by muscle", as bars for the current week with the previous week shown faintly behind.
  - A set counts as 1 for each primary muscle and 0.5 for each secondary.
  - Pick any muscle to see a line chart of its weekly sets over the last 12 weeks.
- Use the existing `chart.js`. If it needs bar support, add it as a pure geometry function with tests. **No chart library.**

**Stage 3 done when:**
- Every seed exercise has a muscle mapping.
- The backfill is idempotent and tested.
- The new metrics and the muscle chart render correctly.
- The regression sweep passes.

---

## Stage 4: body heat-map with tap-for-suggestions

### The figure
- A **hand-built inline SVG** body, front and back side by side (or a flip button on narrow screens), with one `<path>` per muscle in `MUSCLES`. Ship it as an ES module that builds the SVG. No external asset files and no network.
- Body type setting: `settings.bodyFigure` = `'male' | 'female' | 'neutral'`, default `neutral`. All three use the same muscle ids and the same data. Only the outlines differ.
- Put the figure in a new card on Progress, "This week's muscles". Colours come only from CSS custom properties: add a `--heat-0…--heat-3` scale to every theme block. Each muscle's level comes from this week's weighted sets (Stage 3 maths):

  | Weighted sets this week | Level |
  |---|---|
  | 0 | 0 (none) |
  | under 4 | 1 (light) |
  | 4 to under 10 | 2 (good) |
  | 10 or more | 3 (high) |

  Put the thresholds in one constant.
- `contrast.test.js` must cover the new tokens. A legend must explain the shades, and the meaning must not depend on colour alone: the legend and tooltips give the set count.

### Tap a muscle
- Every muscle path is keyboard-focusable and has a label (e.g. `role="button"` with `aria-label`, "Hamstrings: 3 sets this week").
- Tapping opens a sheet listing the user's own exercises that hit that muscle, primary matches first. Within each group, order by:
  1. fewest weighted sets on that muscle this week
  2. then trained least recently
- **Recovery guard:** if the muscle had 6 or more weighted sets within the last 48 hours, show a gentle line at the top ("Trained recently — rest may serve it better") and still list the exercises. Never block anything.
- If no exercises match, offer "Add an exercise for <muscle>", which opens the Exercises editor with that muscle pre-selected.
- Each suggestion has "Log this", which goes through the normal confirm sheet (or adds it to an active plan session as an Extra).

### Earned definition (permanent, never shrinks)
- Each muscle also gets a **definition level** from 0 to 5, from lifetime data only: lifetime weighted sets on that muscle plus PRs on exercises where it's a primary muscle. Make it a pure function with tests. **It can only go up.**
- Show it as outline weight and inner detail lines on that muscle. A brand-new user shows level 0 everywhere, and a fresh PR raises it.
- The whole figure gets a soft glow that follows the existing `glow`, damped by frost exactly as Forge is: it cools during a lapse and never goes out. **The figure itself never shrinks, thins or loses definition.** Add a test that a 60-day lapse leaves every definition level unchanged.
- **No leanness or body-fat changes.** Nothing here may suggest body composition: no weight-loss visuals and no copy about size. Record this in `DECISIONS.md` (training logs can't measure leanness, and the app never punishes a lapse). Leave a note that a future bodyweight log (Phase 2) could drive an *opt-in* change.

**Stage 4 done when:**
- The heat-map is right for a seeded test week.
- Every muscle can be tapped and focused with the keyboard.
- Suggestions are ordered correctly and the recovery guard appears.
- The figure switch works.
- Definition never decreases (tested).
- Contrast passes in all six existing themes.
- The regression sweep passes.

---

## Stage 5: three new animated skins

Follow **"Adding an animated skin"** in `CLAUDE.md` to the letter for each skin, and **commit each skin separately**:
- a `[data-theme]` block with the `--backdrop-*` contract, tuned with `npm run palettes` first
- a WebGL2 scene in `backdrop-gl.js` **and** a 2D-canvas fallback in `backdrop.js`
- entries in `SCALE`, `SKIN_TOKENS`, `GLASS_SKINS` and `THEMES`
- an `ORBIT_STYLE` entry

**The hard-coded skin lists in these scripts must all gain the new ids,** or the new skins will silently go unmeasured:
- `scripts/run-acceptance.mjs`: two places
- `scripts/measure-skins.mjs`
- `scripts/run-lighthouse.mjs`
- `scripts/capture-visuals.mjs`

Grep for `'kemet'` across `scripts/`, `js/` and `tests/` to find every other list.

**Rules for all three skins:**
- Colours come only from CSS variables.
- No CSS `@keyframes`.
- Motion stops dead during voice recognition.
- `reduceBackgroundEffects` and reduced motion give one static frame.
- Every flash goes through the one limiter.
- Rotation is capped at one turn per 8 s; dragging is not capped.
- Earned elements are never removed during a lapse. Frost only cools the scene.
- Each skin stays within the 5% CPU budget in `npm run skins`, at 30 fps, or 60 in full screen.

### Monolith (`monolith`): your last four weeks as a cube
- **The cube:**
  - Its four side faces are the last four weeks, most recent at the front. This is the 28-day window the streak level uses.
  - Each face is split into 7 vertical bars, Monday to Sunday. A training day's bar is lit, and a bar for a day with a PR gets a bright cap.
  - Overall emissive strength follows `intensity`.
- **The top face** fills with concentric rings up to `monthPercent`. This is the month-progress equivalent of the Kemet halo, and it follows the same carry-over in the first two days of a month.
- **Motion:** a slow turntable auto-rotation (vertical axis), scaled by intensity and within the rotation cap.
- **Drag:** horizontal drag turns the cube freely. Vertical drag tilts it, clamped to ±30°. On release, yaw **snaps to the nearest face** (90° steps) over about 400 ms, then auto-rotation resumes. Under reduced motion it snaps instantly.
- **Lapse:** bars for frosted dates cool in tone but stay visible.

### Constellation (`constellation`): every session is a star
- **The stars:**
  - One star per training day over the last 365 days, placed on a celestial sphere by date: longitude from day of year, latitude from a stable hash of the date so the layout never reshuffles.
  - Days with a PR are larger, brighter stars.
  - Cap the scene at 400 stars and use a single point draw.
- **Constellation lines:** as the streak level goes up, more lines join recent stars in date order. At level 10 the last 28 days form one connected figure.
  - Lines appear gradually as the level rises and are never deleted by a later drop. A lower level fades older lines to a faint trace instead.
  - Store the highest level reached in `settings.constellationPeakLevel`, the same pattern as `forgePlatesSeenLevel`.
- **Twinkle** speed follows intensity. **Twinkle is not a flash:** keep its brightness swing at 15% or less and its rate at 1 Hz or less per star. Add a test, run in Chromium at maximum intensity, that measures frame-to-frame luminance change and confirms the scene stays well below the WCAG flash threshold. Lightning, if you add any, goes through the limiter.
- **Motion:** slow auto-rotation of the sphere, and drag is unclamped, with the same ease-back on release as Kemet.
- **Lapse:** stars never disappear. Frost cools the sky's tint.

### Orrery (`orrery`): a planet for each muscle group
- **The planets:**
  - Eight planets, one per muscle region: chest, back (lats + upper-back + lower-back), shoulders (three delts), arms (biceps + triceps + forearms), core (abs + obliques + hip-flexors), quads, posterior (glutes + hamstrings + adductors), calves.
  - Planet size follows that region's weighted sets this week (Stage 3 maths), with a **minimum size so no planet ever vanishes**. Under-trained regions just look small and dim.
  - Rings show lifetime PR count on that region's primary exercises, up to 3 rings. Rings are permanent.
- **The sun's** brightness follows `monthPercent`. Planet orbit speed follows `intensity`, within the rotation cap.
- **Drag:** unclamped orbit of the whole system, easing back on release.
- **Tap a planet** in full-screen view: open the Stage 4 suggestion sheet for that region (list exercises for every muscle in the region). Use the existing full-screen view's hit testing, and give it a keyboard equivalent: Tab cycles through planets, Enter opens.
- **Lapse:** planets keep their rings, and frost cools the sun.
- Stage 5 Orrery depends on Stage 3. If Stage 3 is blocked, build Monolith and Constellation and write a `BLOCKED:` entry for Orrery.

**Stage 5 done when:**
- All three skins render in WebGL2 and the 2D fallback.
- Lighthouse Accessibility is 100 for each.
- The contrast and flash tests pass in node and Chromium at maximum intensity.
- Each skin is within the CPU budget.
- Static mode gives a single frame.
- Drag behaviour matches the spec (scripted drag tests, as for Terminal and Fractal).
- Screenshots are in `docs/screenshots/` and `VISUALS.md`.

---

## Docs, release and final check
- `CLAUDE.md`:
  - update the module map and the data model (`plans`, the new fields and settings)
  - change "Six exist" to nine
  - add the new pure modules and the muscle taxonomy
- `DECISIONS.md`: number new entries from **#88** onward. One entry per real decision, plus every `Repair:` and `BLOCKED:`.
- `ACCEPTANCE.md`: regenerate with `npm run acceptance`, and add rows for the new criteria.
- `MANUAL_TEST.md`, on-phone checks:
  - run a plan session and tick it off, with an extra set
  - edit a set
  - feel the rest vibration
  - keep the screen awake
  - tap muscles on the body map
  - swipe the Monolith to snap between faces
  - spin the Constellation
  - tap an Orrery planet
- Bump the service-worker `CACHE` from `reptrack-shell-v7` to `v8` (once per push that changes shell files) and add every new file to `PRECACHE`.
- After each stage is green: commit, push to `origin main`, wait for Pages, then **re-verify the live site at `https://artyg-dev.github.io/reptrack/`**:
  - Load it offline after the first visit.
  - Import a backup made before this work.
  - Check the new features on the live build.
  - Record the result in `DECISIONS.md`, as previous passes did.

## Final report
End with a short summary:
- what shipped, stage by stage
- every `Repair:` you made, with its cause
- anything `BLOCKED:`
- before/after figures for test count, Lighthouse, skin CPU and footprint
- anything that needs checking by hand on a real phone
