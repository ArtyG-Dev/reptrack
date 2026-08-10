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

---

## Search indexing (follow-up)

### 27. `robots.txt` disallows everything; the noindex meta tag is the belt to that braces

Exactly the two mechanisms the follow-up asked for, no more: `Disallow: /` for every user
agent, and `<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">` in
`index.html`'s `<head>`, checked programmatically against every `.html` file in the repo
(currently just the one) so a future page can't ship without it.

I did **not** add an `X-Robots-Tag` HTTP header — GitHub Pages doesn't let you set custom
response headers on static content, so there's nowhere to put it. `DEPLOYMENT.md` states
this explicitly (the follow-up's exact wording) rather than silently omitting it, so the
gap is documented, not hidden.

### 28. `robots.txt` gets a real `text/plain` content-type from the dev server

`scripts/serve.mjs` had no `.txt` entry in its content-type map, so `robots.txt` would have
served as `application/octet-stream` locally (GitHub Pages serves it correctly on its own).
Added `.txt → text/plain; charset=utf-8` so the local server — used for the Lighthouse run
and the browser tests — matches real-world behaviour, and so a test can actually assert the
content-type is right rather than working around a local-only quirk.

### 29. This does not make the app private, and the docs say so plainly

robots.txt and a noindex meta tag are requests compliant crawlers honour — they are not
access control. The URL still works for anyone who has it; the repo being public (required
for free Pages) means the source and the exact URL are discoverable by anyone browsing
GitHub regardless of indexing rules; and non-compliant bots/scrapers ignore both mechanisms
entirely. `DEPLOYMENT.md`'s new section says this in the same terms the follow-up used,
rather than letting "we blocked search engines" read as "we made it private" by omission.
If you want the app unreachable by an unauthenticated visitor, that's authentication — a
different feature, not something this update attempts.

### 30. Lighthouse SEO dropping from 100 to 92 is the correct outcome, not a regression to fix

Lighthouse's `is-crawlable` audit scores 0 for any page carrying a noindex meta tag —
"blocked from indexing" is a failure by SEO's definition, and a success by this update's.
`scripts/run-lighthouse.mjs`/`run-acceptance.mjs` only gate `accessibility` and `pwa`, never
`seo`, so this doesn't fail the build; `ACCEPTANCE.md` explains it next to the measured
numbers rather than leaving a 92 unexplained.

---

## Animated frosted-glass skins (follow-up)

### 31. The motion is a canvas, not CSS — because it has to be able to stop

The brief says "prefer CSS animations and lightweight canvas", and CSS would have been the
cheaper-looking choice. I went with canvas anyway, for one reason that outranks cost: the
animation must pause *during voice recognition*, and CSS animation has no reliable stop.
`animation-play-state: paused` still keeps the compositor holding animated layers, and
anything driven by `@keyframes` cannot be single-stepped to render one static frame for
`prefers-reduced-motion` — you can only slow it, which is exactly what the brief rules out.

A rAF loop gated on one `shouldRun()` predicate gives all four behaviours for free: the
30fps cap, `visibilitychange`, the voice pause, and reduced-motion-as-a-still-frame. It also
gives the frame counter that makes every one of those testable — "did it stop" is an
assertion about a number, not a guess about a compositor. Measured cost is 2.4–3.2% of one
core, comfortably inside the budget, so the cheaper option would have bought nothing.

The stylesheet still contains exactly one `@keyframes` (the pre-existing mic pulse) and a
test enforces that, unchanged from before.

### 32. Contrast over a moving background is made provable, not asserted

"4.5:1 on the animated background at its lightest and darkest states" is easy to claim and
hard to verify — you cannot check every frame. So the architecture makes the claim
structural instead:

1. Each skin declares `--backdrop-base` (darkest) and `--backdrop-ink` (lightest).
2. `backdrop.js` may only paint colours read from `--backdrop-*` custom properties. It
   contains no colour literals at all.
3. A test asserts every `--backdrop-*` token's luminance falls inside `[base, ink]`.
4. Contrast is then checked with the glass scrim alpha-composited over *those two
   endpoints* — which, given (2) and (3), brackets every frame the canvas can produce.

The load-bearing rule is (2). Hardcode one colour in the draw function and the proof
silently stops holding while every test still passes, which is why it's called out in
`CLAUDE.md` as well as in the file.

### 33. Frost is an edge treatment, and that is a contrast decision as much as a tonal one

`.cal-day.is-frosted` sets `border-color` and two inset `box-shadow`s. It changes no
background and no text colour. That means it cannot move any contrast ratio, so frosted
calendar cells need no separate contrast verification — there's a test asserting the rule
holds. It also happens to be the gentlest version of the effect visually, which is the
point.

### 34. Frost is binary and extent-capped, so "never deepens" is structural

The brief says frost must reach a mild state and stop, never accumulating into a scoreboard
of shame. Rather than tuning an opacity ramp to plateau, frost is simply on or off, and
`frostedDates()` returns at most 21 cells drawn only from the *current* gap. A 200-day
absence renders identically to a 21-day one — there is a test asserting exactly that set
equality — and one comeback session clears every frosted cell at once, because a closed gap
is never frosted retroactively.

This also means there is no state to get wrong: no accumulating counter, nothing that could
drift, nothing that survives a comeback.

### 35. The consistency baseline is the user's own rate, capped at ~3×/week

`baselineTarget()` measures training days per fortnight over everything *before* the recent
window, and compares recent activity to that. Two guards on it:

- **Floor of 2, ceiling of 6.** Without the ceiling, a very consistent period would ratchet
  the bar upward until the glow could only ever fall — success would make the effect
  punishing, which inverts the whole design principle.
- **Fewer than 14 days of prior history → a fixed target of 3.** A new user has no baseline
  to be measured against, and borrowing someone else's would be meaningless. They get a
  modest target and, therefore, visible early progress.

The 28-day window blended in at 40% is what makes a single dropped session move the glow by
under 0.15 — the constraint the brief states most explicitly. It has a test named after it,
because it is precisely the sort of thing a later "simplify this formula" pass would remove
without noticing.

### 36. "Pause activity effects" freezes the clock, it does not edit the data

Pausing stamps `activityPausedAt` and every consistency calculation is then evaluated as of
that date rather than today. One settings key; zero writes to sessions, sets or runs. This
was the only implementation I'd trust against the brief's "without erasing history" — an
approach that inserted placeholder days, or excluded a range from the window, would be
mutating training data to serve a cosmetic effect, and would be visible in an export.

Un-pausing needs no repair step: it just resumes from the real clock.

### 37. The activity visuals produce no copy at all

The brief asks for no text that scolds or quantifies a lapse. The strongest form of that is
not careful wording — it is having nothing to word. Nothing reads `consistency.js` except
the canvas draw functions and one CSS class on a calendar cell. There is no streak count, no
"days since", no `aria-live` announcement of frost, and no nudge derived from consistency
anywhere.

A browser test walks the full rendered text of every tab plus every `aria-label`, `title`
and live region under a lapsed-veteran profile and fails on scold-shaped phrasing. It should
never be able to fire; it exists so that a future feature can't quietly reintroduce the
thing the brief ruled out.

Deliberately *not* announced to screen readers, despite frost being a visual-only signal:
announcing it would be the exact "you have missed N days" message the brief forbids, just
delivered to the people least able to ignore it. It carries no information the calendar
doesn't already show.

### 38. The skin CPU number is reported as an increment, and called a proxy

`scripts/measure-skins.mjs` samples CDP `TaskDuration` in headless Chromium — a desktop CPU,
main thread only, blind to GPU compositing of the blur. It is not a mid-range Android and I
have not pretended otherwise: it reports each skin's cost *over a no-canvas baseline*, which
is the part that transfers between machines, and `ACCEPTANCE.md` states the limits next to
the number rather than in a footnote. The device check is in `MANUAL_TEST.md`, which now has
two checks rather than one.

The static-mode run is the useful companion measurement: it records 0 frames drawn while
sampling, which is direct evidence that reduced-effects mode costs nothing at all rather
than merely costing less.

### 39. Glass is gated behind `@supports`, with an opaque fallback

A translucent panel over moving content, in a browser with no `backdrop-filter`, is exactly
the contrast failure the whole scheme is built to avoid. So `--surface` is opaque by
default in the three skins and only becomes translucent inside an
`@supports (backdrop-filter: blur(1px))` block. A test asserts the fallback exists. Nobody
gets an unreadable panel because their browser is old.

---

## Skin fixes: visibility, lightning, embers and flame (follow-up)

### 40. The root cause was visibility, not wiring — and the diagnosis is worth stating precisely

Live testing on the deployed site reported Terminal as barely visible and Fractal/Forge as
not animating at all. Before touching any drawing code, I checked whether the loop was
actually running: `window.__backdrop.getDiagnostics()` showed `running: true` and a rising
`frames` counter for all three skins, with zero console errors, and reading the raw canvas
pixels back out (`getImageData`) showed non-flat content in every case. **The render loop,
the theme wiring, the pause/resume logic and the palette lookup were all working exactly as
built.** There was no dead code path, no swallowed exception, no CSS selector mismatch.

The actual defects were about amplitude and legibility, and they compounded:

1. **Terminal's raw alpha values were too low.** Grid pulse at 0.05-0.08 and stream alpha at
   0.18-0.40, composited under the frosted glass panels' fixed 88% opacity (itself required
   by the 4.5:1 contrast proof — see decision 32 — so it wasn't a lever available to pull),
   rendered as functionally black. Confirmed by rendering the canvas alone: average pixel
   brightness was 4-11 out of 255.
2. **Fractal's backing store was too small and too blurred to read as a shape.** 0.12× the
   viewport (down to 49×108px on a phone-sized viewport) blurred by 18px CSS blur turns five
   radial gradients into a flat, textureless wash — there is no bloom left to see, whatever
   the alpha. This alone would read as "not running" to anyone looking for a fractal pattern.
3. **Forge tied its entire visual to `activity.glow`, including the dumbbell silhouette
   itself.** The common case for anyone opening the app for the first time — the exact
   moment someone is most likely to be testing it — is zero training history, hence
   `glow = 0`. At `glow = 0` the old code drew a 55%-alpha iron-coloured bar on a near-black
   background with no separate contour, which is close enough to imperceptible that "no sign
   of a flame" was a completely accurate description of what was on screen, even though the
   flame was never meant to appear until heat rose — the *base state* (dumbbell + a few
   embers) was supposed to be visible regardless, and it wasn't.

None of this shows up as an error, a failed assertion, or a stopped loop — it only shows up
as "doesn't look like anything's happening", which is exactly what was reported. The fix is
therefore a set of amplitude/resolution/base-state changes, not a rewiring, and the two are
easy to conflate — worth writing down so a future regression report gets diagnosed the same
way (check the diagnostics and the raw pixels *before* assuming the loop is broken).

### 41. Fixes stayed inside the existing contrast proof, by construction

The contrast guarantee (decision 32) holds because `backdrop.js` may only paint colours
declared as `--backdrop-*` tokens, and every such token's luminance is tested to fall inside
`[--backdrop-base, --backdrop-ink]`. Raising the *alpha* at which a token is drawn — which is
all the Terminal and base-state fixes below do — changes nothing about the token's own hex
value, so it cannot move the luminance-range test. Lightning and the flame lick reuse
existing tokens (`--backdrop-ink` for bolts, a mix of `--backdrop-ember`/`--backdrop-ink` for
flame) rather than introducing new ones, so no new CSS was needed to keep the invariant
intact. `tests/contrast.test.js` passed unmodified.

### 42. A bounded-region gradient fill, added as a side effect of the fractal fix, paid for the rest

Canvas fill cost is proportional to the pixel count of the rect actually drawn, not the
gradient's radius — the original code filled the *entire* canvas for every radial gradient
(five blooms, one forge glow), even though nothing past the outer colour stop is anything
but transparent. `fillRadialBounded()` clips each fill to its own bounding box. Applying it
everywhere a radial gradient is drawn meant Forge's new embers and flame lick, and Fractal's
larger backing store (0.12× → 0.18×) and lightning, landed at **lower** measured CPU than
before (terminal 2.4%→2.2%, fractal 2.3%→2.1%, forge 3.5%→2.8% over baseline) rather than
higher. This wasn't the goal going in; it fell out of fixing fractal's resolution and turned
out to be exactly the kind of headroom the added visuals needed.

### 43. Forge's base state is now decoupled from heat; only the "hot" elements are gated

Per the original brief's "base state" section (a dumbbell silhouette and faint sparks,
present regardless of consistency) — which the first implementation didn't actually honour,
tying opacity for *everything* including the silhouette to `heat`. Now: the dumbbell fill
gets a fixed contour stroke (readable at any heat) and a minimum of `EMBER_MIN_ACTIVE` (5)
embers drift regardless of consistency. Heat still governs the glow's brightness, how many
additional embers join, how bright they burn, and — new — a flame lick above the bar that
stays completely off below `FLAME_START_HEAT` (0.35) and ramps in gradually above it, so "no
visible flame at low consistency, brighter sustained flame at high consistency" from the
brief is a real gate in the code, not just a description.

### 44. Lightning's flicker-hazard cap is a hard floor, checked in code and in a test

Per the brief: "no more than one bolt-flash per few seconds even at max intensity". This is
`LIGHTNING.minIntervalS = 3.5` in `js/backdrop.js`, enforced via `Math.max(minIntervalS, …)`
in the scheduler — so it holds structurally at glow = 1, not just as an average across a
sample. Flash duration is `LIGHTNING.durationS = 0.15` (about 4-5 frames at the 30fps cap),
fading linearly rather than cutting off, and peak brightness itself scales with consistency
(0.20 alpha at glow 0, up to 0.60 at glow 1) so even a flash at maximum intensity is a
moody flicker in the theme's own ink colour, not a flash to white. `branchCount` scales 0→2
with glow, so a quiet profile only ever sees a single unbranched line ("single-branch
flickers" from the brief), and a consistent one sees more frequent, more branching strikes.

`tests/browser.test.js` → "fractal lightning respects the flicker-hazard floor and gets more
frequent as consistency rises" seeds a cold and a hot profile, samples `boltFlashes` (a new
diagnostics counter) over a 16s window for each, and asserts both that the hot profile
flashes at least as often as the cold one and that the implied average gap in the busiest
sample never drops meaningfully below the 3.5s floor.

### 45. The consistency-scaling claim in ACCEPTANCE.md #35 was corrected, not just re-verified

The original skins update recorded criterion #35 ("glow scales with the consistency score")
as verified by a browser test asserting "the rendered glow differs between a seeded
consistent profile and a seeded silent one" — but no such test existed; only the frost tests
(which seed *old*, not recent, activity) were in the suite. The formula itself was correct
(unit-tested in `consistency.test.js` and confirmed by direct probing during this fix), but
the acceptance record overstated what the browser suite actually covered. Two real tests
now exist — "forge is visibly warmer for a consistent profile than a fresh one" (pixel
brightness, cold vs. hot) and the lightning-frequency test above — and `ACCEPTANCE.md` #35
now cites them by name instead of a description that didn't match any test in the file.

---

## Crawler exclusion re-verified and hardened

### 46. "Checked by hand" for #28 had already gone stale — two rows shipped with bare, auto-linkable URLs

Asked to re-confirm the app stays crawler-exclusion/direct-access-only, I re-read every doc
mention of `artyg-dev.github.io` rather than trusting the earlier "checked by hand" note.
Two rows already in `ACCEPTANCE.md` (added when the deployment was first re-verified,
predating the automated check) wrote the live URL as bare text — `live at
https://artyg-dev.github.io/reptrack/` — with no surrounding backticks. GitHub's markdown
renderer auto-links a bare URL like that under GFM, which is exactly the kind of crawlable
hyperlink `DEPLOYMENT.md` and criterion #28 both claim doesn't exist anywhere in the repo's
own docs. Fixed by wrapping both in backticks.

`robots.txt`, the noindex meta tag, and the underlying tests covering them
(`pwa-static.test.js`, `browser.test.js`) were all still intact and passing — the actual
opt-out mechanism was never broken, only the doc-hygiene guarantee around it.

### 47. "Checked by hand" is now a test, so it can't go stale silently again

A manual check that already missed one real regression isn't a check going forward. Added
`pwa-static.test.js` → "the live URL is never a crawlable hyperlink in the repo's own docs":
scans every `.md` file in the repo, fails on a markdown link (`[label](url)`) whose target
contains the live host regardless of how the label is formatted, and fails on any mention of
the host outside a backtick code span or fenced block — the exact GFM auto-link condition
that caused the regression. Verified the test actually catches the pre-fix text before
trusting it (ran the regex against the two offending rows directly), rather than assuming a
new assertion is correct because it happens to pass against already-fixed content.
