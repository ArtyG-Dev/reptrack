# DECISIONS.md

Choices made without asking, and why. Anything here is cheap to reverse — say the word.

---

### 1. It lives on the `Reptracker` branch of `ArtyG-Dev/GridAIcon`, not its own repo

The build prompt asked for a new repo `artyg-dev/reptrack`. This session's GitHub App
credential cannot create repositories — `POST /user/repos` returns
`403 Resource not accessible by integration` — and `gh` is not available here. You then
created the **`Reptracker` branch** on `ArtyG-Dev/GridAIcon`, so the whole project lives in
`reptrack/` on that branch.

It is self-contained: its own `package.json`, tests, tooling and docs. Moving it to a real
repo later is `git subtree split` or a plain copy — nothing here depends on GridAIcon.

### 2. It is not nested under an "RTG proposal tree"

The prompt said to locate an `RTG*` / `rtg*proposal*` folder on local disk and nest the
project inside it. This session runs in a fresh container holding only the GridAIcon
clone; no such tree exists here. `reptrack/` sits at the repository root instead.

### 3. Runs, `lastModified`, `visibility` and `store.js` are in Phase 1

`PHASE_ROADMAP.md` puts all four in Phase 1 and says explicitly that retrofitting them
later means a data migration. They cost little now, so they are built now:

- **Runs/cardio** — distance, unit, duration; pace is derived, never stored.
- **`lastModified`** — stamped by `db.js` on every record write.
- **`visibility`** — `'private'` on every record; nothing reads it yet.
- **`store.js`** — the single storage seam. A test fails the build if any feature module
  imports `db.js` directly.

Nutrition stays unbuilt: it is the Phase 2 slot, and a test asserts the store does not exist.

### 4. Weekly summary: one tap, share-first, download as fallback

`shareOrDownloadText()` tries Web Share with a real `.txt` file (which Android Chrome
supports) and falls back to a download everywhere else — one tap either way, no
intermediate preview screen. The summary week is the one currently shown in the Diary, so
you can send last week's just as easily as this week's.

### 5. Monday-first weeks

Both the calendar and the weekly summary treat Monday as the first day. Sunday belongs to
the week just gone.

### 6. `dateISO` is denormalised onto each set

A set stores its session's date. Without it, drawing one exercise's history means reading
every session to join. It is written once at log time and never edited independently.

### 7. Epley for estimated 1RM

`weight × (1 + reps/30)`, with a single rep returning the weight itself. It is the common
choice, close enough in the 1–10 rep range that matters, and simple enough to explain.
Everything is normalised to kg internally so a mixed kg/lb history still compares.

### 8. Progression nudge: same top set twice, then suggest

Suggests the next loadable jump (1.25 kg / 5 lb) only after the same top set appears in two
or more sessions. Quiet by design — one line, no notification, no target-setting.

### 9. Voice numbers: "four" after a unit means "for"

`"sixty kilos four ten"` is a common mis-transcription of `"sixty kilos for ten"`. The
parser repairs that one specific shape (unit word, then "four", then another number).
Ambiguities it does *not* guess at fail loudly with a reason rather than logging something
wrong.

### 10. Unknown exercises fail rather than guess

If the spoken name doesn't clear the fuzzy-match threshold, the app says which lift it
nearly matched and stops. Silently logging to the wrong exercise corrupts a progression
chart, and that is worse than a re-tap.

### 11. Bodyweight exercises read a lone number as reps

`"pull ups 12"` is 12 reps, not 12 kg. Marked per-exercise with `isBodyweight`, editable in
the Exercises tab.

### 12. Icons are generated, not drawn

`scripts/gen-icons.mjs` writes the PNGs directly with `zlib` and a hand-rolled PNG chunk
writer — no image library, no binary blobs of unknown provenance, and `npm run icons`
regenerates them at any size.

### 13. Dev dependencies exist, runtime dependencies do not

`fake-indexeddb`, `playwright`, `lighthouse`, `chrome-launcher` and `axe-core` are test
tooling and are `devDependencies`. The shipped app has zero dependencies and no build step;
a test fails if a runtime dependency or a `build` script ever appears.

### 14. Footprint uses a ×3 overhead factor

IndexedDB stores structured clones with per-record and index overhead. Chrome's LevelDB
backing usually lands within ~2× the serialised size for records this small; the report
uses ×3 so the number quoted is a ceiling, not an optimistic estimate.

### 15. Lighthouse is pinned to 11.x

Lighthouse 12 removed the PWA category, and the acceptance criterion is "Lighthouse PWA
≥ 90". Pinning to `^11.7.1` keeps that score measurable.

### 16. Deployment is prepared but not performed

`DEPLOYMENT.md` and `deploy/github-pages.yml` are ready to go, but GitHub Pages on a free
plan requires a **public** repository, and `ArtyG-Dev/GridAIcon` is private. Per your
instruction I have stopped short of publishing anything and asked first.

**Update:** resolved — `artyg-dev/reptrack` now exists as its own public repo, created via
`git subtree split` from the `Reptracker` branch, with `.github/workflows/pages.yml`
publishing to `https://artyg-dev.github.io/reptrack/`. That repo is canonical going
forward; the `Reptracker` branch on `ArtyG-Dev/GridAIcon` is kept in sync as a courtesy
snapshot but `artyg-dev/reptrack` is where development happens.

---

## Exercise categories, collapsible panels, colour schemes (follow-up)

### 17. `category` and `mode` are separate axes, not one enum

A calisthenics plank is still a timed hold; a pilates roll-up is still counted reps. So
`Exercise.category` (what kind of training) and `Exercise.mode` (`reps` or `hold` — how
it's logged) vary independently. The seed data reflects that: Plank is
`calisthenics`+`hold`, Roll Up is `pilates`+`reps`.

### 18. `category` is freeform, not a fixed enum — but the picker is a real `<select>`, not a `<datalist>`

The follow-up said "extensible list, not hardcoded to five forever." `CATEGORIES` in
`exercises-seed.js` is five values used to seed data and order the picker, but nothing
enforces them — a sixth is just a typed string away. No schema change needed to add one.

The first version of this used a text `<input list="...">` with a `<datalist>` of
suggestions. A user reported "not seeing the display choices" — `<datalist>` suggestion UI
is genuinely unreliable across browsers, especially on mobile, where it can show no arrow
and no visible options at all. Replaced with a real `<select>` listing every known category
plus an explicit "Other (type your own)…" option that reveals a text field — every choice
is now always visible, and freeform categories still work exactly as before.

### 19. A round becomes a separate SetEntry, same as a rep-mode "set"

"Plank 30 seconds 3 rounds" logs three separate 30-second hold entries, exactly the way
"squat 100 kilos 5 reps 3 sets" already logged three separate rep-mode entries. One
mechanism, reused, rather than a parallel "rounds" field to maintain.

### 20. "Each side" produces two entries with a `side` field, not one entry doubled

`SetEntry.side` (`'left' | 'right' | null`) is a small additive field beyond what the spec's
data-model bullet asked for (which named only `holdSeconds`), needed to make "downward dog
30 seconds each side" mean what it says — two holds, not one logged twice as long. It
defaults to `null` and reps-mode sets never set it.

### 21. A set's mode is read from `holdSeconds != null`, not a stored `mode` field on the set

`SetEntry` doesn't duplicate its exercise's `mode` — the presence of `holdSeconds` already
says which kind of set this is, and `progression.recordScore()` is the one place that
branch lives. Storing `mode` redundantly on every set would just be another place the two
copies could drift apart.

### 22. Disclosure state lives in `settings.panelState`, not a new store

`{ exercises: { strength: true, ... }, session: { yoga: true, ... } }` — two scopes,
persisted through the existing settings mechanism. No new IndexedDB store, no new export
concern (it's already carried in every settings-inclusive backup).

### 23. "Most recently used category starts expanded" is computed, not stored per-category

`state.mostRecentCategory()` looks at whichever set has the highest `lastModified` right
now — reusing the sync-readiness stamp from decision #3 for an unrelated, purely local
purpose. Once a user explicitly toggles a section, that stored choice overrides the
computed default for that category from then on.

### 24. Neon replaces the old Light/Dark/Match-system toggle, not a fourth option

The follow-up asked for exactly two schemes: "Light (default) and High-Contrast Neon."
Rather than ship three-plus options (auto/light/dark/neon) I collapsed Settings → Theme to
the two the spec describes. `DEFAULT_SETTINGS.theme` changed from `'auto'` to `'light'` to
match "Light (default)" literally; `applyTheme()` maps anything that isn't `'neon'`
(including an old saved `'auto'`/`'dark'` from before this change) to `'light'`, so nobody
is left with a broken theme after this update.

### 25. Neon's palette was verified programmatically before it went in the stylesheet

All 17 contrast pairs were computed with the exact luminance/contrast formulas
`contrast.test.js` uses (not eyeballed) before being written into CSS — every pair clears
4.5:1 with real margin (the tightest is danger-on-surface-2 at 5.83:1). The one pre-existing
animation (`.mic-btn.is-listening`'s recording pulse) is untouched and unrelated to the
theme; no glow/pulse/flash was added for neon, and a test enforces that no new
`@keyframes` appears anywhere in the stylesheet.

### 26. Lighthouse now runs twice, gated on `?theme=` query override

`app.js` reads an optional `?theme=light|neon` URL param at boot to preview a scheme
without touching the saved setting — built for `scripts/run-lighthouse.mjs` to score both,
but harmless (and mildly useful) as a general preview hook.
