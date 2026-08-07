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
   Recognition is one-shot (`continuous = false`) on an explicit tap. Enforced by test.
4. **No browser dialogs.** `alert`/`confirm`/`prompt` are banned; use the sheets in
   `js/ui.js`. Enforced by test.
5. **Nothing commits without confirmation.** Voice and manual entry both go through the
   edit sheet in `views/today.js`.
6. **All storage goes through `js/store.js`.** Nothing but `store.js` may import `db.js`.
   Enforced by test.

---

## Module map

```
index.html              shell: app bar, five view sections, tab bar, two <dialog> sheets
manifest.webmanifest    PWA manifest
sw.js                   service worker — precache the shell, cache-first, offline navigations
css/styles.css          one stylesheet; semantic custom properties, light + dark palettes

js/
  app.js                boot, tab router (hash + ARIA tablist), SW registration, theme
  store.js              THE STORAGE SEAM — every feature module reads/writes through this
  db.js                 IndexedDB primitives: schema, transactions, CRUD, export/import
  state.js              in-memory app state + actions; the only place views mutate data
  parser.js             natural language → structured sets, reps-mode AND hold-mode (pure)
  voice.js              one-shot SpeechRecognition wrapper (transcript only)
  progression.js        1RM/hold-duration scoring, PR detection, progression nudge (pure)
  summary.js            weekly plain-text summary, reps- and hold-mode rows (pure)
  chart.js              hand-rolled SVG line chart; computeChart() is pure geometry
  ui.js                 element builder, toasts, <dialog> sheets, disclosure, share/download
  exercises-seed.js     starter exercise dictionary + CATEGORIES suggestion list
  views/
    today.js            session lifecycle, mic, mode-aware confirm sheet, runs, rest timer
    diary.js            year/month/week/day calendar + weekly summary button
    progress.js         per-exercise charts (mode-aware), personal bests, nudge
    exercises.js        exercise dictionary CRUD, grouped into collapsible categories
    settings.js         preferences incl. theme, export/import, wipe, storage estimate

scripts/                serve, icon generation, footprint, Lighthouse (both themes), acceptance loop
tests/                  node:test — unit, IndexedDB (fake-indexeddb) and Playwright browser
```

**Dependency direction:** `views/* → state.js → store.js → db.js`. Pure helpers
(`parser`, `progression`, `summary`, `chart`) depend on nothing but each other.

---

## Data model (IndexedDB `reptrack`, version 1)

```
Exercise  { id, name, aliases[], muscleGroup, category, mode, isCustom, isBodyweight }
Session   { id, dateISO, startTs, endTs, durationSec, notes, lastModified, visibility }
SetEntry  { id, sessionId, exerciseId, dateISO, order, weight, unit, reps, rpe,
            holdSeconds, side, isPR, lastModified, visibility }
Run       { id, dateISO, distance, distanceUnit, durationSec, notes, lastModified, visibility }
Settings  { key, value }   // includes theme ('light'|'neon') and panelState (see below)
```

Indexes: `sessions.by_date`, `sets.by_session`, `sets.by_exercise`, `runs.by_date`,
`exercises.by_name`.

Details that look redundant and are not:

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
- **`settings.panelState`** — `{ [scope]: { [category]: boolean } }`, `scope` is
  `'exercises'` or `'session'`. Read/write only through `state.isPanelExpanded()` /
  `state.setPanelExpanded()`, which also supply the "most recently used category starts
  expanded" default when no explicit choice is stored yet.

---

## Extending it

### Adding a voice phrase
`js/parser.js`. Reps-mode phrases: `parseSegment` tags numbers by their neighbouring words.
Hold-mode phrases (used when the matched exercise's `mode === 'hold'`): `parseHoldSegment`,
same idea but for seconds/minutes/rounds/"each side". `parseTranscript` picks the branch
and handles intents. Add a case to `tests/parser.test.js` first — the grammar is fully
covered there and that is the cheapest place to see what you broke.

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
Two schemes exist: Light (`:root`, default) and High-Contrast Neon (`[data-theme="neon"]`).
Add a third the same way — a new `[data-theme="..."]` block in `css/styles.css` overriding
only the colour custom properties (never introduce a hardcoded colour in component CSS),
an option in `views/settings.js`'s theme `<select>`, and a case in `applyTheme()`. Whatever
you add: run `tests/contrast.test.js` (which checks every pair in every `[data-theme]`
block it finds — extend `PAIRS`/the theme list there) and `npm run lighthouse` (loops
`THEMES` in `scripts/run-lighthouse.mjs`) before committing. No scheme may introduce an
`animation`/`@keyframes` — `contrast.test.js` enforces that too.

---

## Testing

```bash
npm test           # everything
npm run acceptance # tests + footprint + Lighthouse, rewrites ACCEPTANCE.md
```

- `parser`, `progression`, `summary`, `chart` — pure logic, fast. Covers both reps-mode and
  hold-mode paths.
- `db` — real IndexedDB semantics via `fake-indexeddb`, including category/mode/holdSeconds.
- `contrast` — parses `css/styles.css` and checks every text pair ≥ 4.5:1 in both themes,
  plus that the neon theme introduces no animation.
- `pwa-static` — manifest, icon dimensions, service-worker precache completeness, and the
  architectural rules listed under "Hard constraints".
- `browser` — real Chromium via Playwright: offline reload, voice (stubbed recogniser),
  the tap-to-text fallback, hold-mode logging, collapsible-panel keyboard operation and
  persistence, the theme toggle, runs, weekly summary download *and* Web Share, JSON
  export, and an axe-core scan of every tab. Skips cleanly if no Chromium is present.

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
- Respect `prefers-reduced-motion`; it is already handled globally in the stylesheet.
