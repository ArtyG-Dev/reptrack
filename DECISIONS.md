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
