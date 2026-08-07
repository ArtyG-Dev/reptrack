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
  parser.js             natural language → structured sets (pure)
  voice.js              one-shot SpeechRecognition wrapper (transcript only)
  progression.js        1RM, PR detection, progression nudge, unit conversion (pure)
  summary.js            weekly plain-text summary (pure)
  chart.js              hand-rolled SVG line chart; computeChart() is pure geometry
  ui.js                 element builder, toasts, <dialog> sheets, share/download, dates
  exercises-seed.js     starter exercise dictionary with voice aliases
  views/
    today.js            session lifecycle, mic, confirm sheet, runs, rest timer
    diary.js            year/month/week/day calendar + weekly summary button
    progress.js         per-exercise charts, personal bests, nudge
    exercises.js        exercise dictionary CRUD
    settings.js         preferences, export/import, wipe, storage estimate

scripts/                serve, icon generation, footprint, Lighthouse, acceptance loop
tests/                  node:test — unit, IndexedDB (fake-indexeddb) and Playwright browser
```

**Dependency direction:** `views/* → state.js → store.js → db.js`. Pure helpers
(`parser`, `progression`, `summary`, `chart`) depend on nothing but each other.

---

## Data model (IndexedDB `reptrack`, version 1)

```
Exercise  { id, name, aliases[], muscleGroup, isCustom, isBodyweight }
Session   { id, dateISO, startTs, endTs, durationSec, notes, lastModified, visibility }
SetEntry  { id, sessionId, exerciseId, dateISO, order, weight, unit, reps, rpe, isPR,
            lastModified, visibility }
Run       { id, dateISO, distance, distanceUnit, durationSec, notes, lastModified, visibility }
Settings  { key, value }
```

Indexes: `sessions.by_date`, `sets.by_session`, `sets.by_exercise`, `runs.by_date`,
`exercises.by_name`.

Three details that look redundant and are not:

- **`dateISO` on a set** is denormalised from its session so per-exercise history reads
  without joining every session. Keep it in sync when a session's date changes.
- **`lastModified`** is stamped on every record write by `db.js`. It is the change clock a
  future sync needs.
- **`visibility`** defaults to `'private'` and nothing reads it yet. It exists so Phase 3
  sharing is a feature flag, not a data migration.

---

## Extending it

### Adding a voice phrase
`js/parser.js`. `parseSegment` tags numbers by their neighbouring words; `parseTranscript`
handles intents. Add a case to `tests/parser.test.js` first — the grammar is fully covered
there and that is the cheapest place to see what you broke.

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

---

## Testing

```bash
npm test           # everything
npm run acceptance # tests + footprint + Lighthouse, rewrites ACCEPTANCE.md
```

- `parser`, `progression`, `summary`, `chart` — pure logic, fast.
- `db` — real IndexedDB semantics via `fake-indexeddb`.
- `contrast` — parses `css/styles.css` and checks every text pair ≥ 4.5:1 in both themes.
- `pwa-static` — manifest, icon dimensions, service-worker precache completeness, and the
  architectural rules listed under "Hard constraints".
- `browser` — real Chromium via Playwright: offline reload, voice (stubbed recogniser),
  the tap-to-text fallback, runs, weekly summary download *and* Web Share, JSON export,
  and an axe-core scan of every tab. Skips cleanly if no Chromium is present.

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
