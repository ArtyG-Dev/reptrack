# CLAUDE.md — RepTrack

Architecture, data model and extension points. Read this before changing anything.

---

## What this is

A voice-first, offline gym and running tracker. Single-page vanilla JS, PWA-installable,
IndexedDB on-device, no account, no network at runtime, no framework, **no build step**.

The current build is **Phase 1** of `PHASE_ROADMAP.md`: single-user tracking, gym + runs,
progression, weekly summary. Phases 2–4 (nutrition, multi-user, auth/social) are not built
— but the seams they need exist already, and are called out below.

## Hard constraints — do not break these

1. **No build step, no framework, no runtime dependency.** Everything under `js/` is an ES
   module the browser loads directly. `package.json` dependencies are test tooling only,
   and `tests/pwa-static.test.js` fails the build if a runtime dependency appears.
2. **No network at runtime.** Nothing in `index.html`, `css/` or `js/` may reference a
   remote origin. Enforced by test.
3. **Audio is never captured.** No `MediaRecorder`, `getUserMedia` or `AudioContext`.
   Recognition is one-shot (`continuous = false`) on an explicit tap. Enforced by test —
   statically *and* at runtime; see "What 'no audio is stored' actually means" below.
4. **No browser dialogs.** `alert`/`confirm`/`prompt` are banned; use the sheets in
   `js/ui.js`. Enforced by test.
5. **Nothing commits without confirmation.** Voice and manual entry both go through the
   edit sheet in `views/today.js`.
6. **All storage goes through `js/store.js`.** Nothing but `store.js` may import `db.js`.
   Enforced by test.
7. **No more than 3 flashes in any 1-second window (WCAG 2.3.1).** Every lightning effect,
   in either renderer, requests its flash through the one limiter in `js/theme-engine.js`.
   Enforced by test, in node and in real Chromium, for every theme at maximum intensity.

---

## Module map

```
index.html              shell: app bar, five view sections, tab bar, two <dialog> sheets
manifest.webmanifest    PWA manifest
sw.js                   service worker — precache the shell, cache-first, offline navigations
css/styles.css          one stylesheet; semantic custom properties, nine palettes

js/
  app.js                boot, tab router (hash + ARIA tablist), SW registration, theme
  store.js              THE STORAGE SEAM — every feature module reads/writes through this
  db.js                 IndexedDB primitives: schema, transactions, CRUD, export/import
  state.js              in-memory app state + actions; the only place views mutate data
  parser.js             natural language → structured sets, reps-mode AND hold-mode (pure)
  voice.js              one-shot SpeechRecognition wrapper (transcript only)
  progression.js        1RM/hold-duration scoring, PR detection, progression nudge (pure)
  summary.js            weekly plain-text summary, reps- and hold-mode rows (pure)
  consistency.js        consistency score, streak level, month percent, frost (pure)
  backdrop.js           the animated-skin loop: 30fps cap (60 full screen), auto-pause, static
                        mode, eased values; picks WebGL2 or the 2D fallback renderers in here
  backdrop-gl.js        the seven WebGL2 scenes + the luminance-bounding pass
  gl.js                 hand-rolled WebGL2 core: programs, buffers, targets, matrices, lines
  theme-engine.js       intensity driver, flash limiter, lightning scheduling, rotation cap (pure)
  graphic-view.js       the full-screen graphic view (View button on Today)
  reminders.js          when to show the backup reminder (pure)
  skin-data.js          what Monolith / Constellation / Orrery draw: faces, stars, lines, planets (pure)
  bodymap.js            the body-map SVG: pure geometry for three figures × front/back, and its renderer
  muscles.js            heat levels, recovery guard, suggestion order, definition; weekly working sets per muscle, a muscle's 12-week series, backfill guess (pure)
  plans.js              plan checklist progress, prefill, plan-from-session, update-to-what-I-did (pure)
  wake.js               the session screen wake lock
  chart.js              hand-rolled SVG line chart; computeChart() is pure geometry
  ui.js                 element builder, toasts, <dialog> sheets, disclosure, share/download
  exercises-seed.js     starter exercise dictionary + CATEGORIES suggestion list
  views/
    today.js            session lifecycle, mic, mode-aware confirm sheet, runs, rest timer
    diary.js            year/month/week/day calendar + weekly summary button
    progress.js         per-exercise charts (mode-aware), personal bests, nudge
    exercises.js        exercise dictionary CRUD, grouped into collapsible categories
    settings.js         preferences incl. theme, export/import, wipe, storage estimate
    muscle-sheet.js     a muscle's (or region's) exercise suggestions, "Log this", "Add an exercise for …"

scripts/                serve, icons, footprint, Lighthouse (all themes), skin CPU, acceptance loop
tests/                  node:test — unit, IndexedDB (fake-indexeddb) and Playwright browser
```

**Dependency direction:** `views/* → state.js → store.js → db.js`. Pure helpers
(`parser`, `progression`, `summary`, `chart`, `consistency`, `theme-engine`) depend on
nothing but each other. `backdrop.js` (with `backdrop-gl.js → gl.js` beneath it) is a leaf:
`app.js`, `views/settings.js` and `graphic-view.js` push into it, and it reads nothing back
out of the app — every colour it draws comes from CSS custom properties.

---

## Data model (IndexedDB `reptrack`, version 3)

```
Exercise  { id, name, aliases[], muscleGroup, primaryMuscles[], secondaryMuscles[], category, mode,
            isCustom, isBodyweight, restSec }
Session   { id, dateISO, startTs, endTs, durationSec, notes, lastModified, visibility,
            sessionType, className, instructor, location, attendance, planId, planMarks }
SetEntry  { id, sessionId, exerciseId, dateISO, order, weight, unit, reps, rpe,
            holdSeconds, side, isPR, isWarmup, lastModified, visibility }
Run       { id, dateISO, distance, distanceUnit, durationSec, notes, lastModified, visibility }
Plan      { id, name, order, items: [{ exerciseId, targetSets, targetReps, targetWeight, unit,
            targetHoldSec, note }], lastModified, visibility }
Settings  { key, value }   // includes theme, panelState and the skin controls (see below)
```

Indexes: `sessions.by_date`, `sets.by_session`, `sets.by_exercise`, `runs.by_date`,
`exercises.by_name`.

Details that look redundant and are not:

- **Muscles.** `MUSCLES` in `exercises-seed.js` is the 18-muscle taxonomy (chest,
  front/side/rear delts, biceps, triceps, forearms, abs, obliques, lats, upper/lower back,
  glutes, quads, hamstrings, calves, adductors, hip flexors). Each exercise lists
  `primaryMuscles[]` and `secondaryMuscles[]` from it, never one muscle in both; the old
  single `muscleGroup` stays, for the backfill and the Exercises list line. A working set
  counts **1 per primary, 0.5 per secondary** (`js/muscles.js`); warm-ups count nothing.
  No DB version bump: the fields are additive. **`settings.muscleBackfillDone`** gates a
  once-per-install pass in `state.init()` that gives every exercise with no muscles the
  starter mapping of the same name, else a primaries-only guess from `muscleGroup`
  (`MUSCLE_GROUP_MUSCLES`), never overwriting a non-empty list. After that pass, only
  records whose fields are *absent* (old-shaped exercises arriving from an import, in either
  mode) are filled, so an empty list chosen in the editor stays empty.
- **The body map** (Progress → "This week's muscles"). One `<path>` per muscle per view,
  each muscle a `role="button"` on exactly one view (`VIEW_OF` in `bodymap.js`). Fill is
  this week's weighted sets through `heatLevel()` (`HEAT_THRESHOLDS` — the one place the
  0 / <4 / 4–<10 / ≥10 cut-offs live) into `--heat-0…--heat-3`, declared in every theme
  block and checked by `contrast.test.js`. Outline weight and inner lines show
  `definitionLevel()` (0–5, lifetime weighted sets + 5 per PR on exercises where the muscle
  is primary): it only depends on work ever done, so a lapse can't lower it. **It never
  shows leanness, body fat or size, and no copy talks about size.** The figure's outline
  glow is `glow × (1 − 0.35 × frostHint)`, as the Forge. **`settings.bodyFigure`**
  (`'neutral' | 'male' | 'female'`, default `neutral`) picks the proportions. A tap opens
  `views/muscle-sheet.js`: the user's exercises for it, primary first, then fewest working
  sets this week, then least recently trained. `RECOVERY_SETS` (6 weighted sets "in the last
  48 h" — today and yesterday, since sets carry dates, not times) shows a note and blocks
  nothing.
- **`settings.constellationPeakLevel`** (default `0`) — the highest streak level the
  Constellation's lines have reached. Lines are drawn for the peak's window and dimmed to
  a trace outside the current level's, so a drop never deletes one. Written by `app.js`
  through `rememberSetting()` (no re-render).
- **Plans** (version 3, backup `SCHEMA_VERSION` 2). A plan is a named, ordered list of
  exercises with targets; a hold-mode item uses `targetHoldSec` and leaves reps/weight
  `null`, a reps item the reverse. `Session.planId` (nullable) records which plan a session
  was started from; `Session.planMarks` (`{ [itemIndex]: 'done' | 'open' | 'skipped' }`) is
  the user's own tick/untick/skip for that session, which beats the counted sets. All the
  deciding — what's ticked, what's Extra, what a plan built from a session looks like —
  is in `js/plans.js` (`planProgress()`), covered by `tests/plans.test.js`; warm-ups never
  count toward an item. A schema-1 backup (no `plans` array) still imports, as empty plans.
  Deleting a plan leaves sessions that used it untouched; their checklist simply stops
  showing.

- **`dateISO` on a set** is denormalised from its session so per-exercise history reads
  without joining every session. Keep it in sync when a session's date changes.
- **`lastModified`** is stamped on every record write by `db.js`. It is the change clock a
  future sync needs.
- **`visibility`** defaults to `'private'` and nothing reads it yet. It exists so Phase 3
  sharing is a feature flag, not a data migration.
- **`Exercise.category`** (`strength | cardio | calisthenics | yoga | pilates | ...`) is
  freeform — `CATEGORIES` in `exercises-seed.js` is a suggestion list for the Exercises
  editor's `<datalist>`, not an enum. Anything typed there works; grouping code in
  `today.js`/`exercises.js` just groups by whatever string is present.
- **`Exercise.mode`** is `'reps'` (weight/reps/sets — strength, cardio, calisthenics) or
  `'hold'` (a timed duration — yoga poses, pilates holds, a timed calisthenics hold like a
  plank). It decides which grammar `parser.js` uses and which fields `today.js`'s confirm
  sheet shows; nothing else branches on it directly.
- **`SetEntry.holdSeconds`/`.side`** are additive and only ever set together, only for a
  `hold`-mode exercise. A reps-mode set leaves both `null` — check `holdSeconds != null`
  (never `mode`) to tell which kind of set you're holding, since a set object doesn't carry
  its exercise's mode itself. `progression.recordScore()` is the one place that branch
  lives; everything downstream (PRs, "best set", the chart series) uses its output and
  doesn't need to know the difference.
- **`Session.sessionType`** (`gym | run | class | pt`, default `gym`) and **`className`,
  `instructor`, `location`, `attendance`** (`attended | missed | cancelled`, default `null`)
  are reserved for the class/PT build specified in `docs/PHASE_ROADMAP.md`. **Nothing reads
  them yet.** Version 2 exists only to stamp `gym` on sessions written before the field; runs
  are their own store, so they are untouched. `db.withSessionDefaults()` is also applied on
  import, so an older backup arrives complete. `SCHEMA_VERSION` (the backup format) stayed 1.
- **`settings.forgePlatesSeenLevel`** (default `null`) — the streak level whose Forge
  plates last settled on screen. A higher level next time Forge opens slides the new plates
  on once; a lower one just shows the right plates. Written by `state.rememberSetting()`,
  which does not notify subscribers, because nothing displays it.
- **`settings.fractalColour`** (default `{ hue: 0, warmth: 0 }`) and
  **`settings.fractalHintSeen`** (default `false`) — the Fractal colours chosen by dragging in
  its full-screen view (`TINT` / `tintDrag()` in `theme-engine.js`; hue in radians, wraps;
  warmth −1…1, clamped), saved when the view closes and applied by `app.js` on every state
  change except while the view is open. Reset in Settings and in the view itself.
- **`SetEntry.isWarmup`** (default `false`) — a warm-up set is logged and shown (badged), but
  counts toward nothing: `progression.workingSets()` drops it before PRs, top sets, series,
  volume and the nudge, and `recordScore()` scores it 0. Muscle totals must use
  `workingSets()` too. Said aloud as "warm-up …"; ticked in the set sheet.
- **A session's date** can be earlier than today ("Log an earlier session", or "Change date"
  on an open one). `state.setSessionDate()` moves its sets' `dateISO` with it and recomputes
  PRs for every exercise in it, since order in time is what makes a PR.
- **Persistent storage:** `store.requestPersistence()` asks the browser not to clear the data
  under storage pressure, on boot once there are sessions and after finishing one; Settings
  shows whether it was granted, with a button to ask again.
- **`Exercise.restSec`** (null = use `settings.defaultRestSec`) — that exercise's own rest
  time, set in the Exercises editor; the timer started after a commit uses it.
- **`settings.vibrateOnRest`**, **`settings.keepScreenOn`** (both default `true`) — the rest
  buzz and the session wake lock (`js/wake.js`). **`settings.lastExportAt`** /
  **`settings.backupNudgeShownAt`** (default `null`) — the backup reminder's clock
  (`js/reminders.js`: after finishing a session only, 30+ days or never-with-5-sessions,
  at most weekly).
- **`settings.panelState`** — `{ [scope]: { [category]: boolean } }`, `scope` is
  `'exercises'` or `'session'`. Read/write only through `state.isPanelExpanded()` /
  `state.setPanelExpanded()`, which also supply the "most recently used category starts
  expanded" default when no explicit choice is stored yet.
- **`settings.theme`** — `'light' | 'neon' | 'terminal' | 'fractal' | 'forge' | 'kemet' |
  'monolith' | 'constellation' | 'orrery'`. All but the first two are the animated
  frosted-glass skins. `normaliseTheme()` in `views/settings.js`
  maps anything unrecognised (including a `'dark'`/`'auto'` value saved by a much older
  build) back to `'light'`, so no stored value can leave someone on a broken theme.
- **`settings.reduceBackgroundEffects`** (default `false`) — the manual counterpart to
  `prefers-reduced-motion`. Either one renders the backdrop as a single static frame.
  It is a motion control only: it never changes the palette, so it cannot move a contrast
  ratio.
- **`settings.pauseActivityEffects`** / **`settings.activityPausedAt`** (default `false` /
  `null`) — "Pause activity effects". Switching it on stamps today's date into
  `activityPausedAt`; every consistency calculation is then evaluated *as of* that date
  instead of today. **This writes one settings key and mutates no training data at all** —
  un-pausing just resumes from the real clock, and nothing was lost in between.
- **`settings.seedBackfillDone`** (default `false`) — see "Adding a starter exercise" below.
  Flips to `true` the first time `state.init()` has reconciled this install's dictionary
  against `exercises-seed.js`, whether that meant a full seed (brand-new install) or a
  by-name backfill (an existing one). Never re-checked after that.

---

## What "no audio is stored" actually means

Worth stating precisely, because the honest claim is narrower than the slogan and the
difference matters if anyone ever asks.

**The app never receives audio in the first place.** `js/voice.js` wraps the Web Speech API,
which is a *live recognition stream*, not a recorder: the browser listens, and what it hands
back through `onresult` is a `SpeechRecognitionResult` — a string plus a confidence number.
There is no audio object in that API surface for the app to hold, write, or forget to delete.
This is a stronger position than "we delete the recording afterwards", because there is no
recording to delete. RepTrack also never opens the other doors to raw audio: no
`MediaRecorder`, no `getUserMedia`, no `AudioContext`, no `createMediaStreamSource`.

**Two tests hold that in place, and they check different things:**

- `pwa-static.test.js` is the static half: it fails the build if any of those APIs appears in
  the source, and asserts `continuous = false` / `interimResults = false`.
- `browser.test.js` → "a full voice log writes zero audio bytes to any app-controlled
  storage" is the runtime half: it drives a real voice log end to end, then sweeps every
  storage backend this origin can write — every IndexedDB database (not just RepTrack's),
  every Cache Storage entry, `localStorage` and `sessionStorage` — looking for `Blob`s,
  `ArrayBuffer`s, typed arrays, `data:audio/…` URIs, audio MIME types and long opaque base64
  runs. It also asserts the stored set carries no field outside the documented schema, so a
  stray binary payload can't ride along on a legitimate record.

**What neither test can tell you.** They cover storage *this origin controls*. They say
nothing about what Chrome, Android, or a platform speech service does inside its own process:
some implementations send audio to a server for recognition, and may buffer or log it there.
That is outside the app's visibility and outside its ability to clear — RepTrack cannot see
it, cannot assert on it, and this document should not imply otherwise. What can be said
truthfully is: *nothing audio-shaped is ever written to storage RepTrack owns, and the app
never holds raw audio at any point.* If someone needs a guarantee that covers the platform
layer too, that is a question about the browser and OS, not about this codebase — and the
answer is to not use speech recognition at all, which the tap-to-text fallback already
supports as a complete alternative path.

---

## Theme engine — one intensity, one flash gate

`js/theme-engine.js` — pure, clock-free, covered by `tests/theme-engine.test.js`. Every
animated skin reads its shared effects from one number:

```
intensity = clamp(0.6 × streakLevel / 10  +  0.4 × monthPercent, 0, 1)
```

The streak is weighted more because it is the steadier signal (28-day damped, a rest day
never resets it), while `monthPercent` is jumpy early in a month by construction. Either
metric alone moves the scene (max 0.6 / 0.4), and both maxed reach 1. `backdrop.js` eases
the shown values toward the live ones (`approach()`, τ ≈ 1.2 s), so nothing snaps.
Static mode and the first values after a skin loads are snapped instead.

**What reads `intensity`:** rotation speed, glow and bloom, particle density and travel,
lightning frequency and branching, Fractal zoom/iterations/saturation, Terminal stream
speed/density and packet bursts. **What reads its own metric directly**, because displaying
that metric is its job: the ten Kemet tiers (`streakLevel`), the halo stages and the Forge
heat colour (`monthPercent`, existing 25/50/90% and 15–30% thresholds), Forge iron clarity
(`streakFraction`), the Forge glow (`glow`, damped by frost). Neither metric's formula
changed in this pass.

**Flash safety.** `createFlashLimiter()` is a sliding window: at most 3 grants in any
(t − 1000 ms, t]. One limiter per page, shared by every bolt track in both renderers.
`updateBoltTrack()` schedules strikes by intensity (8 s mean gap at 0, 1.2 s at 1) and asks
the limiter. A refused strike stays due and is retried next frame. Intensity buys branching
and frequency, never a rate past the cap.

**Rotation** is capped at one revolution per 8 s (`ROTATION.maxRadPerS`), whatever the
intensity. Drag in the full-screen view is the user's hand and is not capped.

**Drag-to-rotate is one shared orbit** (`createOrbit`/`orbitDrag`/`orbitRelease`/
`orbitSettle`): a world-space yaw (horizontal drag) and pitch (vertical drag) offset applied
*on top of* the scene's own auto-rotation, easing back on release. A scene must apply it as
`rotationX(f.orbit.pitch) · rotationY(f.orbit.yaw)` before its own model rotation. Never
feed the drag into the scene's auto-rotation angle: Forge spins about the bar's long axis,
and a drag applied there is invisible (DECISIONS #82).

**Per-scene orbit rules** live in `ORBIT_STYLE`: Kemet and Forge are unclamped and stay put
on release under reduced motion; Terminal is a look-around *inside* the field, clamped to
±40° yaw / ±25° pitch, easing home over ~1 s and snapping home under reduced motion. Fractal
is not in it: dragging there recolours (below), it never moves the view.

**Fractal recolouring** is not an orbit: `backdrop.tintBy(dxFrac, dyFrac)` turns the hue
(a full screen width = one turn) and sets warmth (up warms), applied by `tinted()` in the
Fractal shaders as a transform on the existing palette. Never let it touch zoom, iterations
or the lightning colour.

**Auto-rotation axes** are constants in `theme-engine.js`. Kemet spins `+1` about the
vertical axis; `FORGE_AUTO_ROTATION = { axis: 'vertical', direction: -1 }` turns the bar
level on a turntable, the opposite way. Switching Forge to an end-over-end tumble (about the
horizontal axis across the bar) is a one-line change there: `axis: 'tumble'`. Both use the
same intensity-scaled speed and the one-turn-per-8-s cap. Don't go back to `'roll'`: a round
bar rolling on its own length barely looks like it's moving (DECISIONS #82, #84).

**Forge plates.** `PLATE_TABLE` maps `streakLevel` to the plates per side, `plateLayout()`
places them on the sleeve (`SLEEVE` is sized so level 10 just fills it), and a plate rack
(`createPlateRack`/`stepRack`/`rackPlates`) moves one plate at a time: outer plates off
before inner ones change, new ones on inner-first. `backdrop.js` owns the rack.
`settings.forgePlatesSeenLevel` lets a level gained between visits be shown going on once.

## The Stage 5 skins — Monolith, Constellation, Orrery

All three read their own data from `js/skin-data.js` (pure, `tests/skin-data.test.js`),
built in `state.skinData()` as of the same effective date as every other activity visual
(so "Pause activity effects" freezes them) and pushed by `app.js` through
`backdrop.setSkinData()`. Each starts from a base state that needs no data at all, since a
fresh install has none. None of them has lightning (`LIGHTNING_TRACKS` lists them empty).

- **Monolith.** A cube: four side faces are the last four weeks (this week on the front at
  heading 0), seven bars each Monday → Sunday, lit on a training day, with a bright cap on a
  PR day; a frosted day's bar is cooled (`--backdrop-frost`), never removed. The top face
  carries five rings lit by `monthPercent` (its carry included). Turntable auto-rotation;
  drag turns freely and tilts at most ±30° (`ORBIT_STYLE.monolith`). On release the drag is
  folded into the heading and the cube turns to the nearest face over 0.4 s
  (`createSnap`/`stepSnap`), then auto-rotation resumes; under reduced motion the snap is
  instant.
- **Constellation.** One star per training day of the last 365 (≤ `MAX_STARS` 400, one
  point draw), longitude = day of year, latitude = a stable hash of the date, PR days
  larger and brighter. Lines join stars in date order inside a window that grows with the
  streak level (all of the last 28 days at level 10). The window is the *peak* level's
  (`settings.constellationPeakLevel`); lines outside the current level's window ease down
  to a trace, never away. Twinkle is brightness only, a ≤15% swing at ≤1 Hz
  (`TWINKLE`); `visuals.test.js` measures it from real pixels at maximum intensity.
  Frost cools the sky, never a star. Drag like Kemet.
- **Orrery.** Eight planets, one per region (`REGIONS` covers all 18 muscles once), round a
  sun. Size = this week's weighted sets, with a floor (`PLANET.minSize`); rings = lifetime
  PRs on exercises whose primary muscles touch the region, up to 3, so they are permanent.
  Sun brightness = `monthPercent`; frost cools only the sun. Planet speed is `spin` scaled
  by ≤ 1 (`planetAngle()`), so the shared rotation cap holds. In the full-screen view a tap
  on a planet (`backdrop.planetAt()`, ≥ 22 px hit radius) or Tab + Enter on its button
  (`#graphic-planet-N`, which also rings it in the scene) opens the Stage 4 suggestion sheet
  for the region.

## Consistency score

`js/consistency.js` — pure, clock-free (the caller passes `todayISO`), fully covered by
`tests/consistency.test.js`. It is the model behind every activity-responsive visual: the
Forge glow, the Fractal brightness and lightning, the Terminal stream speed/brightness/
colour, the Kemet pyramid tiers and halo, and calendar frost. Nothing else in the app reads
it; no feature behaviour depends on it.

**There are three independent signals in here**, and they are deliberately not one number:
`glow` (continuous, baseline-relative), `streakLevel` (0–10, rolling window, absolute), and
`monthPercent` (0–1, calendar month to date). Each section below covers one.

Terminal was not originally consistency-responsive — the brief only asked for it on Fractal
and Forge — but real usage after shipping showed a flat ambient texture reads as "nothing
changed" exactly when someone's looking for the reward, so it now scales too (see
`drawTerminal()` in `js/backdrop.js` and decision 48 in `DECISIONS.md`). If you add another
skin, default to wiring it up the same way rather than treating "ambient and static" as the
safe default; a skin that never moves in response to anything a user does is the thing this
whole feature exists to avoid.

**`glow` and `streakLevel` are not interchangeable.** `glow` (below) is continuous and
measured against the user's *own* baseline. `streakLevel` (further down) is a 0–10 integer
measured against an *absolute* target. Continuous-and-relative is right for warmth;
discrete-and-absolute is right for progression, because a beginner needs countable progress
and a baseline-relative score would put them at maximum on their second session.

**A "training day"** is any date with a session or a run on it — distinct dates, so two
sessions in one day count once. Doing something is what matters, not doing a lot.

**The score** compares a recent rate to the user's *own* prior rate:

```
recent   = training days in the last 14 days
long     = training days in the last 28 days
blended  = 0.6 × recent  +  0.4 × (long / 2)      // long/2 puts it on a 14-day footing
score    = clamp(blended / target, 0, 1)
glow     = score ** 0.7
```

`target` is `baselineTarget()`: the user's training days per 14, measured over everything
*before* the recent window, clamped to 2–6. Below 14 days of prior history there is no
personal baseline yet, so it falls back to 3 (~1.5×/week) — a new user is measured against
a modest fixed target, never against a stranger.

Three deliberate softenings, all of them load-bearing rather than incidental:

- **Blending the 28-day window in** is what makes a single dropped session barely visible.
  At a 3-day target, going 3→2 sessions in the recent window moves `glow` by well under
  0.15. There's a test named for exactly that, because it is the constraint most easily
  lost to a "simplification".
- **`glow = score ** 0.7`** compresses the top of the range, so falling off from a hot
  state cools slowly at first rather than dropping off a cliff.
- **The target is capped at 6.** However consistent someone has been, the bar it holds them
  to stops at ~3×/week. Consistency can't ratchet itself into something unreachable.

### Streak level — the 0–10 progression metric

`streakState()` in `js/consistency.js`. This is what the skins' *signature graphics* read:
the ten Kemet pyramid tiers, the Forge barbell's brightness and edge definition, the Fractal
Mandelbrot's resolution.

**It is deliberately not a consecutive-day streak**, and that was a considered override of
how the feature was originally described. A strict streak resets to zero on one rest day,
which means it only ever climbs if you train *every* day — a mechanic that quietly rewards
overtraining, when adaptation happens during recovery, and which collides head-on with the
over-activity guardrail already planned for Phase 4. So it's a rolling-window count: nothing
ever "breaks", and the level only eases down if activity genuinely thins out.

```
recent   = training days in the last 14 days
long     = training days in the last 28 days
blended  = 0.6 × recent  +  0.4 × (long / 2)      // same damping as `glow`
raw      = clamp(blended / 7, 0, 1)               // 7 training days per 14 = 3.5×/week
fraction = raw ** 0.7                             // continuous, drives brightness/clarity
level    = round(fraction × 10)                   // integer, drives the pyramid tiers
```

Why `targetDays: 7` when the brief asks 4–5 sessions/week to be *capable* of maxing it out:
the headroom is the mechanism, not sloppiness. At 4×/week the blend sits above the target, so
the clamp absorbs a dropped session entirely and the level does not move. Measured:

| Pattern | Level | After one extra rest day |
|---|---|---|
| 7×/week | 10 | 10 (no change) |
| 5×/week | 10 | 10 (no change) |
| 4×/week | 10 | 10 (no change) |
| 3×/week | 9 | 8 |
| 2×/week | 7 | 6 |

Be precise about the guarantee when you touch this: **a rest day never resets the level**, at
any frequency, and at 4–5×/week it doesn't move it at all. Below the target rate it eases
down by one tier of ten — which is the metric honestly reflecting a genuinely lower rate, not
a punishment, and is the behaviour `tests/consistency.test.js` pins in both directions.

The curve makes early progress fast on purpose: one session is already level 1–2, six
sessions is level 8. A beginner should see the pyramid filling, not a flat floor.

`streakLevel` respects "Pause activity effects" through the same `effectiveToday()` path as
everything else — pausing freezes the level where it stood, and mutates no training data.

### Month percent — the 0–1 month-to-date metric

`monthProgress()` in `js/consistency.js`. **A second, entirely separate metric
from `streakLevel`.** They coexist, are tracked independently, and the skins *layer* them
rather than combining them:

| | `streakLevel` | `monthPercent` |
|---|---|---|
| Window | rolling 14/28 days | the current calendar month |
| Scale | 0–10 integer | 0–1 continuous |
| Kemet | the ten pyramid tiers | the golden halo above the apex |
| Forge | barbell brightness/clarity | the bars running white-hot |

You can be high on one and low on the other, and that is a normal state — a strong rolling
streak that crosses into a new month starts that month at zero, and a perfect first three
days of a month sits well below a full rolling window. Don't "simplify" them into one number.

```
elapsed  = day-of-month           // 7th → 7. Days ELAPSED, not days in the month.
trained  = distinct training days in this calendar month
raw      = clamp(trained / elapsed, 0, 1)
percent  = raw, except during the first `carryDays` (2) of a month, where the
           previous month's final figure is blended out linearly
```

**Elapsed days, not total days in the month**, and this is the whole design of it. Measured
against the full month, someone training every day of the first week could only reach
7/31 ≈ 23% however perfectly they trained — the effect would stay dark until mid-month
through no fault of theirs. Against elapsed days a perfect run reads 100% on any date, which
is what makes it worth looking at. A test asserts exactly this case.

**The carry** exists because the raw ratio resets hard at midnight on the 1st: a month
finishing at 100% becomes 0/1 the next morning, and the halo would slam off. For the first
two days the previous month's final figure fades out instead — 100% → 67% → 33% → 0%.

Being straight about a property of the elapsed-days denominator: early in a month it is
*jumpy* by construction. On the 3rd, one missed day is 67%. That is inherent to the
definition the metric is supposed to have, not a bug to damp — and the carry already covers
the one place it would have been jarring. If it ever needs softening beyond that, do it
knowingly rather than by quietly widening the window.

`monthPercent` respects "Pause activity effects" through the same `effectiveToday()` path as
everything else, so pausing freezes *both* metrics.

### Frost

Frost is a cool edge treatment on **calendar day cells only** — never the logging UI, never
a chart, never anything on the way to recording a comeback session. It is binary (present
or absent, no depth ramp) and extent-capped. `frostState()` gates it in this order, and
each gate is a kindness rather than an optimisation:

| Gate | Meaning |
|---|---|
| `paused` | "Pause activity effects" is on. Never any frost, full stop. |
| `no-history` | Nothing logged yet. |
| `new-user` | Less than 21 days between the first logged day and today. |
| `no-established-run` | No 14-day window has ever held 3+ training days. |
| `recent-activity` | Eligible, but the current gap is under 10 days. |
| `lapsed` | Frost shows. |

`frostedDates()` returns at most **21 cells**, always within the *current* gap only. A
200-day absence therefore looks exactly like a 21-day one — the "does not deepen
indefinitely" rule is structural, not a tuning value — and a single comeback session clears
every frosted cell at once, because old gaps are never re-litigated on the calendar.

`activityVisualState()` bundles it up for the skins and adds `frostHint` (0..1, capped),
which cools the Forge glow slightly during a lapse. `backdrop.js` applies it as
`heat = glow × (1 − 0.35 × frostHint)`, so the forge retains at least 65% of its warmth at
maximum frost: it cools, it never goes out.

**Nothing in this system produces copy.** No count of missed days, no streak number, no
message. It is ambient and it says nothing — see `DECISIONS.md` for why.

---

## Extending it

### Adding a voice phrase
`js/parser.js`. Reps-mode phrases: `parseSegment` tags numbers by their neighbouring words.
Hold-mode phrases (used when the matched exercise's `mode === 'hold'`): `parseHoldSegment`,
same idea but for seconds/minutes/rounds/"each side". `parseTranscript` picks the branch
and handles intents. Add a case to `tests/parser.test.js` first — the grammar is fully
covered there and that is the cheapest place to see what you broke.

### Adding a starter exercise
Add it to `SEED_EXERCISES` in `js/exercises-seed.js`. That alone is enough for a brand-new
install — `state.init()` seeds the whole list when the dictionary is empty — but **it is not
enough for anyone already using the app**: the seed loop only ever runs on a genuinely empty
store, so an existing install's dictionary is frozen at whatever `SEED_EXERCISES` looked like
the day it was first created. `state.init()` also runs a one-time-per-install backfill (gated
on `settings.seedBackfillDone`) that adds anything in the current `SEED_EXERCISES` not already
present *by name* — this is what got yoga/pilates/calisthenics starters to installs whose
dictionary predated them. It only ever adds, never touches an existing record, and it only
ever runs once, so a starter a user deliberately deleted doesn't come back. Add a case to
`tests/state.test.js`, not `tests/db.test.js` — this is `state.js`'s seeding/backfill logic,
not a `db.js` primitive, even though both run against `fake-indexeddb`.

Matching by name (case-insensitive) is a known, accepted limitation: if a user renamed a
starter exercise, the backfill can't tell that apart from "never had it" and will add the
original name back as a second entry. There's no seed-id on exercise records to do better
with, and adding one is a bigger change than this warranted — see `DECISIONS.md`.

### Adding a collapsible section
Use `disclosure()` from `js/ui.js` — pass `id`, `summary`, `expanded`, `onToggle`, `content`.
It's a real `<button>` (so Enter/Space work with no extra code) toggling the panel's
`hidden` attribute, with `aria-expanded`/`aria-controls` kept in sync — that combination is
what makes it a real disclosure widget, not just a CSS-hidden div. Persist the open/closed
choice through `state.isPanelExpanded(scope, category)` / `setPanelExpanded(...)`, not a
new mechanism.

### Adding a screen
Add a `<section class="view" id="view-x" role="tabpanel">` to `index.html`, a matching
tab button, an entry in `VIEWS` in `app.js`, and a module exporting `render(container)`.
Views are re-rendered wholesale on every state change — keep them cheap and stateless.

### Adding a store (e.g. nutrition — the Phase 2 slot)
1. `db.js`: add to `STORES`, create the object store in the upgrade block, bump
   `DB_VERSION` and add an `if (event.oldVersion < 2)` branch. Add CRUD + include it in
   `exportAll`/`importAll`.
2. `store.js`: re-export the new functions. **Do not** let feature code import `db.js`.
3. `state.js`: hold it in state, add actions, emit.
4. Bump `SCHEMA_VERSION` if the backup shape changes, and keep `validateBackup` tolerant
   of older exports (missing arrays are treated as empty).

### Adding sync (Phase 3)
`store.js` is the seam. Every record already has a UUID, a `lastModified` stamp and a
`visibility` flag. A sync adapter wraps the exported functions there — no view, and no
feature module, needs to change.

### Adding a colour scheme
Nine exist: Light (`:root`, default), High-Contrast Neon, and the seven animated skins
(Terminal, Fractal, Forge, Kemet, Monolith, Constellation, Orrery). Add another the same way — a new `[data-theme="..."]` block in
`css/styles.css` overriding only the colour custom properties (including `--heat-0…3`) (never introduce a hardcoded
colour in component CSS), an entry in `THEMES` in `views/settings.js`, and it flows through
`applyTheme()`, `run-lighthouse.mjs` and `run-acceptance.mjs` automatically. Then run
`tests/contrast.test.js` (which checks every pair in every `[data-theme]` block it finds)
and `npm run lighthouse` before committing.

**No scheme may introduce an `animation`/`@keyframes`.** `contrast.test.js` asserts the
whole stylesheet still contains exactly one — the pre-existing mic-recording pulse. Skin
motion goes on the canvas instead, and the reason is not stylistic: CSS animation cannot be
reliably *stopped*, and skin motion must stop dead during voice recognition.

### Adding an animated skin
Seven exist. An eighth needs, in this order:

1. A `[data-theme="..."]` block declaring the normal semantic tokens **plus** the backdrop
   contract: `--backdrop-base` (the darkest colour the canvas will ever paint),
   `--backdrop-ink` (the lightest), and any skin-specific `--backdrop-*` colours in
   between. Set `--glass`/`--glass-2`/`--glass-alpha` for the frosted panels. Use
   `node scripts/check-skin-palettes.mjs` to tune the palette *before* it reaches the
   stylesheet — it runs the same arithmetic the test does.
2. A draw function in `js/backdrop.js` that reads **only** `--backdrop-*` properties via
   `getComputedStyle`. Never hardcode a colour there — the stylesheet is the single source
   of truth, and that is the entire mechanism by which contrast stays provable.
3. Entries in `SCALE` (backing-store resolution), `SKIN_TOKENS` (which tokens the renderer
   reads) and `GLASS_SKINS` in `backdrop.js`, plus `THEMES` in `views/settings.js`. The
   scripts (`run-lighthouse`, `measure-skins`, `run-acceptance`) each carry their own theme
   list too — grep for an existing skin's name to find them all.

The contrast guarantee works like this: because the canvas can only paint colours declared
as `--backdrop-*` tokens, and `contrast.test.js` proves every such token's luminance sits
inside `[--backdrop-base, --backdrop-ink]`, checking text contrast against the glass scrim
composited over just those two endpoints brackets *every frame the animation can produce*.
Paint a colour that isn't a token and that proof silently stops being true.

**Two rules keep that bracket valid, and both are enforced by test:**

- `SKIN_TOKENS` must list every token the renderer reads. `readPalette()` has a hardcoded
  fallback for each one, so a skin that forgets to *declare* a token still renders happily —
  in a colour no contrast test has ever seen. The test cross-checks the two.
- **In the 2D renderer, never use an additive composite op** (`globalCompositeOperation =
  'lighter'`, `screen`, …). Normal source-over alpha is a convex combination, so stacked
  draws land *between* the colours involved and can't exceed `--backdrop-ink` however many
  layers pile up. Additive blending breaks exactly that, and would break it silently. **The
  WebGL2 scenes may blend additively**, because they hold the bracket differently: every
  scene renders offscreen and `POST_FS` in `backdrop-gl.js` clamps each pixel's luminance
  into `[base, ink]` before it reaches the screen (DECISIONS #74). Never draw a WebGL scene
  straight to the default framebuffer, because that skips the clamp.

**The feature band.** Each skin draws its signature graphic (pyramid, barbell, Mandelbrot)
into `featureBand()` — the bottom third of the viewport, *less* the tab bar's height. The
inset is not cosmetic: without it the bottom two pyramid tiers sit behind the tab bar, which
makes "all ten tiers light up" false in the only way that matters, since you can't count what
you can't see. `browser.test.js` asserts the band clears the tab bar for every skin.

Prefer drawing a literal, unblended token over `mix()`-ing two of them, even for variety —
Terminal gets its colour variance by picking outright between `--backdrop-stream`,
`--backdrop-stream-2` and `--backdrop-ink` per particle, never blending them. `mix()`'s own
comment explains why: a linear RGB blend's luminance is not guaranteed to land between its
two endpoints' (two saturated, differently-hued colours can blend to something darker or
lighter than either). Forge is the one skin that does blend (`ember`/`iron`/`ink`), and it
has its own dedicated test — `contrast.test.js` → "forge's mixed colours never escape the
backdrop range" — that runs the *actual* blend formulas across their full parameter space
rather than reasoning about the source colours. If a new skin needs to blend, it needs a
test in that shape, not an assumption that it's probably fine.

Everything else is already handled centrally and needs no per-skin work: the 30fps cap,
`visibilitychange`, the voice-recognition pause, `prefers-reduced-motion`, and the manual
reduce-effects toggle all live in `backdrop.js`'s `shouldRun()`.

**The WebGL2 scene.** Each skin also has a scene function in `js/backdrop-gl.js`, which is
what normally runs. The 2D draw function is the fallback for no WebGL2, a failed build or a
lost context, so a new skin needs both. A scene:

- reads colours only from `f.palette` (the same `--backdrop-*` tokens) and draws into the
  bound target. `render()` then runs the bounding pass, so never bind the default
  framebuffer yourself;
- takes shared effects from `f.k` (intensity) and its displayed metric from `f.level` /
  `f.month` / `f.tierGlow`, and rotates by `f.spin` (integrated and capped in `backdrop.js`;
  drag writes the same value);
- frames its graphic with `camera(f, { targetY, needH, needW, tilt })`, which fits it into
  `f.band` (the Today feature band, or the full viewport when `f.full`);
- requests lightning only through `strike(f, trackName, level, make)`, and lists its track
  names in `LIGHTNING_TRACKS` in `theme-engine.js` so the 10-second cap test drives them;
- registers its programs and meshes in `SOURCES` / `MAKERS`, which compile lazily on first
  use, so no skin pays for another's shaders.

Then add it to `SKINS` in `tests/visuals.test.js` and `scripts/capture-visuals.mjs`, run
`npm run visuals`, and look at the screenshots.

**Two things a first pass at a skin will get wrong** (see `DECISIONS.md` #40 — a real
regression, diagnosed the hard way):

- **The glass panel's opacity (now 92%) eats most of a raw canvas alpha.** It's there for
  the 4.5:1 contrast proof, so it isn't a lever you can pull — draw amplitudes have to be
  tuned *knowing* under a tenth of what the canvas paints ever reaches a card. What looks
  fine in a standalone canvas test can read as "not running" once composited. Check the
  rendered page, not just the canvas: `page.screenshot()` and look at it, because
  `getImageData` on the canvas alone cannot tell you what the glass did to it.
- **If any visual element scales to zero at `glow = 0`, that element is invisible on first
  load — which is the most common state anyone will ever see it in**, since a fresh install
  has no training history. Anything meant to always be present (a silhouette, a few ambient
  particles) has to be drawn with an amplitude that doesn't depend on the consistency score;
  only the "hot" elements on top of that base state should be gated.

Before assuming a skin's loop is broken, check `window.__backdrop.getDiagnostics()`
(`renderer`, `running`, `frames` advancing) and read the pixels back with
`window.__backdrop.readPixels()`, which serves whichever renderer is live. Don't use
`getImageData` on `#backdrop`, because under WebGL2 that canvas is never drawn and reads as
blank. "Looks like nothing is happening" and "the loop stopped" are different bugs with
different fixes, and the diagnostics distinguish them in seconds.

---

## Testing

```bash
npm test           # everything
npm run skins      # CPU cost of each skin vs a no-canvas baseline
npm run palettes   # design aid: contrast of a candidate skin palette, before writing CSS
npm run visuals    # screenshots of every skin at intensity 0 / 0.5 / 1 → docs/screenshots/
npm run acceptance # tests + footprint + Lighthouse + skin cost, rewrites ACCEPTANCE.md
```

- `parser`, `progression`, `summary`, `chart` — pure logic, fast. Covers both reps-mode and
  hold-mode paths.
- `consistency` — the score, the glow curve and every frost gate, including the ones that
  are about tone rather than correctness: a dropped session is barely perceptible, a new
  user is never frosted, frost caps, a comeback clears it, pause freezes without erasing.
- `db` — real IndexedDB semantics via `fake-indexeddb`, including category/mode/holdSeconds.
- `state` — also against `fake-indexeddb`, but for `state.js`'s own logic: seeding a fresh
  dictionary, backfilling a starter exercise into an existing one by name without touching
  what's already there, running that backfill exactly once, and not duplicating a starter
  that already exists under a different case.
- `contrast` — parses `css/styles.css` and checks every text pair ≥ 4.5:1 in all five
  themes; for the glass skins it composites the panel scrim over both extremes of the
  backdrop range and checks the result, asserts every `--backdrop-*` token sits inside that
  range, checks the opaque `@supports` fallback, and asserts frost is edge-only (it may not
  touch a background or text colour, so it cannot move any ratio).
- `pwa-static` — manifest, icon dimensions, service-worker precache completeness, and the
  architectural rules listed under "Hard constraints".
- `theme-engine` — the intensity formula, easing, the rotation cap, the sliding-window flash
  limiter, and 10 simulated seconds at maximum intensity for every theme at 30 and 60 fps.
- `visuals` — real Chromium against the WebGL2 scenes: DPR cap, frames differ 500 ms apart,
  reduced motion is pixel-identical with Kemet's seams countable, text ≥ 4.5:1 against real
  pixels at intensity 0 and 1, 10 s at max never exceeds 3 flashes/s, rotation cap, 2D
  fallback with WebGL2 unavailable, context loss and restore, and the full-screen view's
  focus, exits and drag. Headless Chromium has no GPU, so this runs on SwiftShader and needs
  `--enable-unsafe-swiftshader` (set in `tests/helpers/browser.mjs`).
- `browser` — real Chromium via Playwright: offline reload, voice (stubbed recogniser),
  the tap-to-text fallback, hold-mode logging, collapsible-panel keyboard operation and
  persistence, the theme toggle, runs, weekly summary download *and* Web Share, JSON
  export, the skins (pause on background/voice/static, seeded new-user and lapsed-veteran
  profiles for frost), and an axe-core scan of every tab. Skips cleanly if no Chromium.

`npm run skins` is honest about being a proxy: it samples main-thread `TaskDuration` in
headless Chromium on a desktop CPU, which is not a mid-range Android, and it cannot see GPU
compositing of the `backdrop-filter` blur. It gates the *increment over a no-canvas
baseline*, which is the number that answers "what did the skin cost". The real-device check
stays in `MANUAL_TEST.md`.

**When you add a shipped file, add it to `PRECACHE` in `sw.js`** — the static test fails
otherwise, because a missed entry means a blank screen when offline.

---

## Conventions

- British English in user-facing copy.
- No magic numbers in view code; timing and palette live in `css/styles.css` custom
  properties and named constants.
- `el()` from `ui.js` sets text with `textContent` — never build DOM from string
  concatenation of user data.
- Every interactive control needs a label or `aria-label`; the browser test enforces it.
- Respect `prefers-reduced-motion`; it is already handled globally in the stylesheet, and
  `backdrop.js` honours it by holding a single static frame rather than slowing down.
- **The activity visuals never speak.** No streak counts, no missed-day totals, no nudges
  derived from consistency, no `aria-live` announcement of frost. If you find yourself
  writing copy that quantifies a gap, the answer is not to word it more kindly.
