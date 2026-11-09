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

---

## Widening the reward range (direct request, not a follow-up doc)

Asked directly — "I'm not seeing much if any of the fractal patterns... only a few faint
sparks [on Forge]... increase the incidence of effects from the first use onwards and then
reward a consistent streak with greater visual embellishment... having the speed and
brightness [of Terminal] increase with an improved streak would be good."

### 48. Terminal is now consistency-responsive — a deliberate departure from the original brief

The original skins brief only asked Fractal and Forge to respond to training consistency;
Terminal was meant to be flat ambient texture. Real usage showed that reads as "the app
doesn't react to anything I do" for the one skin where it's most visible day-to-day (Terminal
has no separate "hot" state to notice — it either changes or it doesn't). This is a direct,
explicit ask from actual use, not an inference, so `drawTerminal()` now scales three things
with `activity.glow`: fall speed (×1 to ×1.85), overall brightness (×0.85 to ×1.5), and the
odds any given stream draws in the brightest colour token rather than a dimmer one.

That last point is the "colour variance" ask. Colour variety comes from literally drawing a
different token per stream (`--backdrop-stream`, the new `--backdrop-stream-2`, or
`--backdrop-ink`), chosen by a value seeded once per stream and never mixed — see decision
50 for why mixing was avoided. Only the *odds* of landing in the brightest bucket shift with
glow, so the palette itself never leaves the three literal tokens.

### 49. Floors raised across all three skins, not just the ceilings

"We don't want the user to feel punished or discouraged from the outset" was explicit and
came first in the request, before "reward a consistent streak" — so every change here raises
the zero-consistency floor at least as much as it raises the high-consistency ceiling:

- **Forge**: `EMBER_MIN_ACTIVE` 5→9, ember alpha floor 0.16→0.24 (ceiling 0.30→0.48 on top of
  that), glow gradient floor 0.16→0.22 (ceiling 0.42→0.53), `FLAME_START_HEAT` 0.35→0.22 so a
  flame lick starts appearing sooner rather than staying invisible through most of the range.
  A fourth flame lick joins only past `flameT > 0.6` — sustained streaks get something a
  shorter one doesn't, which is the "greater embellishment" half of the ask.
- **Fractal**: brightness floor (`lift`) 0.35→0.55 (ceiling 0.90→1.00), alpha multiplier
  0.62→0.78, and a new `grow` factor (0.85→1.15) makes blooms visibly larger, not just
  brighter, at high consistency — a second reward dimension on top of colour. Backing store
  resolution raised again, 0.18→0.24 (CSS blur correspondingly 11px→8px), because at the
  smaller size even the raised floor read as a formless wash rather than a bloom shape.
  Lightning's `maxIntervalS` (how rare a flash is at zero consistency) dropped 12s→9s — still
  rare, not absent, at rest; `minIntervalS` (the flicker-hazard floor) is untouched at 3.5s.
- **Terminal**: base stream speed range 6-20→9-25 px/s (a flat "slightly faster" bump the ask
  named directly), independent of the new glow multiplier on top.

Measured brightness deltas (headless Chromium, cold = no history vs. hot = 14 consecutive
days on an established baseline, `getImageData` sampling): Terminal max brightness 105→191,
Fractal average 81→141, Forge average 27→74. All three are now clearly perceptible in a
before/after comparison, and none is dark-to-the-point-of-invisible at zero consistency
(`tests/browser.test.js` asserts a floor on the cold reading for Forge and Terminal, matching
the "not punishing" half of the request as a real assertion, not just a design note).

### 50. Colour variety without blending: token selection, not token mixing

Terminal's colour variance is implemented by literally drawing one of three unblended tokens
per stream (`--backdrop-stream`, `--backdrop-stream-2`, `--backdrop-ink`), never a `mix()` of
them. This was a deliberate choice over the more obvious "blend toward a brighter hue as glow
rises": `mix()`'s existing comment already flagged that a linear RGB blend's luminance isn't
guaranteed to sit between its two endpoints' for two arbitrary colours (proven with a
concrete counter-example — a red/green blend can land darker than either). Drawing a literal
token sidesteps the question: whatever `contrast.test.js` already proves about a token
individually is automatically true of every pixel Terminal ever draws, no new reasoning
required. `--backdrop-stream-2` (`#1c5248`, a teal accent) was chosen and its luminance
checked against the existing generic "every backdrop token sits inside the range" test before
being added — no special-casing needed, that test already covers any new `--backdrop-*` name.

### 51. Forge's `mix()` usage got the test it was only ever informally justified by

While re-checking whether the widened Forge ranges were still safe, I re-examined the
existing claim (mix()'s own comment, written in an earlier session) that its two endpoint
colours were "directionally darker-or-lighter... in all three channels" — checked that
claim numerically and it's false (iron→ember's blue channel moves the *opposite* direction
from its red and green channels). The luminance still happens to stay in range across the
whole heat/flame parameter space, because the weighted luminance formula is dominated by the
green channel, which *is* monotonic for this particular colour family — but that's a fact
about these four specific colours, not a property of "directionally ordered channels" in
general, and the old comment overstated the guarantee. Fixed the comment to say what's
actually true, and added `tests/contrast.test.js` → "forge's mixed colours never escape the
backdrop range", which reimplements the exact `hot`/`ironShape`/`edge`/`flameColor` formulas
from `backdrop.js` and sweeps heat and flameT from 0 to 1 in 0.02 steps, asserting every
resulting luminance stays inside `[base, ink]`. This is the one runtime colour computation in
the entire backdrop system that isn't covered by "the canvas only ever paints a declared
token" — it needed its own proof, and now has one.

---

## Exercise dictionary backfill (direct request, diagnosing a support question)

Asked directly: "Under exercise types I'm only seeing 22 under strength as a default — where
are the other ones such as yoga, pilates, cardio and calisthenics?"

### 52. The 22 were the original Phase 1 seed list, not a bug in the current one

Diagnosed before writing anything: `js/exercises-seed.js` today has 18 strength + 5
calisthenics + 3 yoga + 3 pilates = 29 starters, not 22 under strength. But `git show` on the
Phase 1 commit showed the *original* seed list had exactly 22 exercises, none with a
`category` field at all (categories didn't exist yet). `views/exercises.js` groups by
`ex.category || 'strength'` — so every exercise from before that field existed silently
lands in the Strength bucket. That's what the user was looking at: their own dictionary,
frozen at Phase 1, not a rendering bug.

The reason it never updated: `state.init()`'s seed loop is `if (!exercises.length)` — it only
ever writes `SEED_EXERCISES` into a genuinely empty store. An install that already had 22
exercises from Phase 1 skipped seeding entirely when categories, and later yoga/pilates, were
added — there was never a path that reconciled an existing dictionary against a growing seed
list. (There's also no "cardio" category in the exercise dictionary at all, by design — see
decision 3: runs/cardio are logged through the separate Runs feature, not the exercise list.)

### 53. Backfill by name, once, additive-only — the same shape as every other migration here

`state.init()` now does, when the dictionary is non-empty and `settings.seedBackfillDone` is
still false: build a set of existing exercise names (trimmed, lower-cased), find every
`SEED_EXERCISES` entry not in that set, add just those, then set the flag. A fresh install
still takes the original all-empty branch and sets the same flag immediately, so it's never
re-scanned on its next boot either.

Three deliberate constraints, in order of how much they cost to get wrong:

- **Never touches an existing record.** Only additions. A user's own edits, renames, and
  custom exercises are never read, let alone written.
- **Runs exactly once per install.** Gated on a settings key (`seedBackfillDone`, additive —
  see decision on `category`/`mode`/`holdSeconds` in `db.js`'s header comment for the
  pattern), not re-checked on every boot. This means a starter a user deliberately deletes
  stays deleted — the alternative (re-scan every boot) would silently resurrect it the next
  time the app opens, which is a worse bug than the one being fixed.
- **Matches by name, not by identity.** Exercise records carry no seed-id, so "is this starter
  already here" can only mean "does a record with this name already exist" (case-insensitive).
  The known cost: a user who renamed a starter (e.g. "Bench Press" → "Bench") will see the
  original name added back as a second entry on their first post-update boot. Adding a
  proper seed-id to every exercise record would close this gap but is a bigger schema change
  than a one-time dictionary top-up warrants; documented here and in `CLAUDE.md` rather than
  solved, so a future maintainer doesn't have to rediscover it.

`tests/state.test.js` (new) covers all three constraints directly: a fresh install gets every
starter across every category; an existing dictionary gets exactly the missing starters and
nothing already present is altered; a second boot after the flag is set does not resurrect a
deliberately deleted starter; and a starter already present under different casing is not
duplicated.

---

## Kemet skin + prominent streak-responsive graphics

Per `docs/FOLLOWUP_PROMPT_KEMET.md`.

### 54. The progression metric is a rolling window, not a consecutive-day streak — as the brief itself directed

The brief opens by overriding its own earlier framing: the effects had been described as a
consecutive-day streak, and it asks for a rolling-window training-day count instead, because
a strict streak resets on one rest day and therefore only climbs if you train daily. That
rewards overtraining, when adaptation happens during recovery, and collides with the
over-activity guardrail already planned for Phase 4.

Implemented as `streakState()` in `js/consistency.js`, reusing the same 14/28-day blend the
existing `glow` uses, then a compressive curve, then a clamp, then rounding to 0–10.

**`targetDays: 7` (3.5×/week) is the load-bearing choice.** The brief asks that 4–5×/week be
*capable* of reaching maximum, and separately that a single rest day not visibly drop the
level. Those two requirements are in tension on a 10-point scale: if the target is exactly
what 4×/week produces, you sit on the boundary and one dropped session costs a tier. Setting
the target *below* the sustained rate gives the clamp headroom to absorb a missed session
entirely. Measured: at 4×, 5× and 7×/week a rest day moves the level by exactly zero.

Being precise about the guarantee, because "does not visibly drop" is easy to overclaim: at
2–3×/week — below the target rate — a rest day does cost one tier of ten. That is the metric
honestly reflecting a genuinely lower training rate, and it is a *gradual ease*, never the
reset a consecutive-day streak would inflict. `tests/consistency.test.js` pins both halves:
zero movement at 4–5×/week, and "at most one tier, never to zero" below it.

### 55. `streakLevel` is absolute where `glow` is relative, and that asymmetry is the point

`glow` measures the user against their *own* prior baseline — right for warmth, because a
2×/week trainer holding their own pattern deserves to read as consistent. `streakLevel`
measures against a fixed 3.5×/week target instead.

Making it baseline-relative would have been the "consistent" choice and would have been
wrong: a beginner's baseline is near zero, so their second session would light all ten tiers
and the mechanic would have nowhere left to go. The brief's stated purpose for discrete tiers
is "a beginner unmistakable visible progress" — which requires an absolute scale with room
above them. Both numbers are exposed from `activityVisualState()`; `CLAUDE.md` states the
distinction so a future change doesn't quietly collapse them into one.

### 56. The Mandelbrot is rendered twice at seed time and never computed in the frame loop

The brief flags it explicitly: "do not compute a full Mandelbrot per frame". `buildMandelbrot()`
renders two offscreen buffers when the skin mounts or resizes — one at 14 iterations (coarse,
soft) and one at 96 (filaments resolved) — and the loop only ever `drawImage`s them.

Cross-fading *between the two buffers* is what makes "faint and low-detail → vivid and sharply
resolved" a real change in resolved structure rather than the same picture at two opacities.
It costs one extra `drawImage` per frame, which is nothing, and the per-pixel work happens
once. This is the only per-pixel code in `backdrop.js`, and the file header now says so
rather than continuing to claim there is none.

Measured after the change: fractal 2.9% of one core over baseline, unchanged from before the
Mandelbrot existed, against a 5% budget.

### 57. The feature band stops above the tab bar — found by screenshotting, not by testing the canvas

First implementation put all three signature graphics in the literal bottom third of the
viewport. The canvas diagnostics were perfect: ten tiers lit, correct geometry, no errors.
The screenshot showed the bottom two pyramid tiers sitting behind the fixed tab bar.

"All ten tiers light up cumulatively" is false in the only way that matters if two of them
are behind opaque chrome — you cannot count what you cannot see. `featureBand()` now insets
the band by the tab bar's height, and `browser.test.js` asserts the band's bottom clears the
tab bar's top for every skin.

The general lesson, now in `CLAUDE.md`: `getImageData` on the backdrop canvas cannot tell you
what the page looks like. It sees neither the glass scrim nor the chrome drawn over it. A
graphic that is "prominent" on the canvas and invisible on the page passes every canvas-based
assertion. Screenshot the page.

### 58. Two new structural guards on the contrast proof, both prompted by this change

The proof rests on "the canvas only ever paints declared `--backdrop-*` tokens, all of which
are tested to lie inside `[base, ink]`". Adding a fourth skin with eight tokens surfaced two
ways that can quietly stop being true:

- **A renderer can read a token its theme never declares.** `readPalette()` supplies a
  hardcoded fallback for every token, so the skin renders fine — in a colour no contrast test
  has ever seen. `SKIN_TOKENS` in `backdrop.js` now declares which tokens each renderer
  reads, and a test cross-checks it against the stylesheet.
- **An additive composite op would break the bound.** Source-over alpha is a convex
  combination, so stacked draws land between the colours involved; `'lighter'` or `'screen'`
  would let two mid-tone layers sum past `--backdrop-ink`. Nothing used one, but nothing
  stopped it either. A test now asserts `globalCompositeOperation` never appears in
  `backdrop.js`.

Both are cheap, and both close a gap where the code would keep passing while the *proof*
silently stopped holding — the same failure mode as decision 32's "paint a colour that isn't
a token".

### 59. The glass scrim went from .88 to .92, and the opaque fallbacks were recomputed to match

The brief anticipates this: "A brighter, sharper graphic in the bottom third makes this
harder — if text sits over that region, strengthen the scrim rather than dropping contrast."

Worth being precise about what changed and why, because the numbers alone don't justify it:
contrast passed at .88, and still passes at .92 with 7:1+ margins everywhere. The reason to
strengthen it anyway is that a computed ratio is measured against a *flat* backdrop colour,
and the bottom third is no longer flat — it's a Mandelbrot's filaments, or ten tier seams, or
plate edges. Text over high-frequency detail reads as harder work than the same ratio over a
smooth gradient, and WCAG's arithmetic doesn't model that. The tab bar sits directly over the
band, so it was the concrete case.

`--surface`/`--surface-2` are documented as "the scrim over `--backdrop-base`", used as the
opaque fallback where `backdrop-filter` is unsupported. They were computed at .88, so they
were recomputed at .92 — otherwise the documented invariant would have quietly become false
and the no-blur fallback would no longer match the blurred rendering.

### 60. Kemet's `--backdrop-ink` is a bright cyan, chosen against the scrim rather than by eye

`--backdrop-ink` is the luminance *ceiling* — the lightest colour the canvas may paint — and
neon detailing needs headroom that a dark ceiling doesn't give. Rather than picking a colour
and hoping, I swept candidate ceilings against the composited scrim first: at .92 alpha the
worst text pair stays above 7:1 even with an ink luminance of 0.31. `#5f8f96` (0.243) leaves
room for the cyan hieroglyphs (0.174) and violet arcs (0.158) while keeping every text pair
at 7.45:1 or better — comfortably clear of the 4.5 floor at the *lightest* extreme the
animation can reach.

`scripts/check-skin-palettes.mjs` was the tool for this, which is what it exists for: tune
the palette before it reaches the stylesheet, using the same arithmetic the test enforces.

---

## The "3kg shows as 300kg" report, and the audio-persistence verification

Per `docs/FOLLOWUP_PROMPT_AUDIO_VERIFY_AND_WEIGHT_BUG.md`.

### 61. The weight was never wrong — the volume line was being misread, and that is still a real defect

The brief asked, correctly, to establish whether this was a storage bug or a display bug
before touching anything, because a storage bug would mean existing data is corrupt. I
checked that first, empirically rather than by reading code:

- **Storage is correct.** Logged 3, 3.5, 30 and 300 kg through *both* entry paths (voice with
  a stubbed recogniser, and the tap-to-text/manual path), then read the raw `SetEntry.weight`
  straight out of IndexedDB. Every value round-tripped exactly: `3` stored as `3`.
- **Every weight renders correctly, on every screen.** Today, Diary and Progress all showed
  `3 kg × 10`. `describeSet()`, `formatNumber()` and `formatWeight()` are all correct, and
  there is no stray `× 100` anywhere in the source (checked directly — every `* 100` in the
  codebase is a two-decimal rounding idiom with its matching `/ 100`).

So there is **no data corruption and no repair migration to write.** Saying so plainly is
the point of this entry: a migration written on the assumption of a write-path bug would
have rewritten correct user data, which is far worse than the reported symptom.

What the user actually saw is real, though. Reproduced exactly by logging a realistic light
session — 3 kg × 10 reps × 10 sets — which rendered:

```
10 sets · 300 kg volume
Bench Press
  1  3 kg × 10
  2  3 kg × 10
  …
```

`300 kg` is arithmetically right (3 × 10 × 10 = 300 kg of total volume) but it is a bare
number in a weight unit, sitting one line above a list of `3 kg` sets, with a single
trailing word carrying the entire burden of distinguishing the two. Reading that as "it
thinks my 3 kg is 300 kg" is not a misunderstanding — it is the display inviting the wrong
parse.

**Fix:** the label now leads. `10 sets · total volume 300 kg`. Both Today and Diary route
through one shared `formatVolumeLine()` in `progression.js` so they cannot drift apart
again. Notably the plain-text weekly summary already did this (`VOLUME     300 kg`) — the UI
was the odd one out, and the fix brings it into line with a convention the codebase had
already settled on elsewhere.

**Regression cover** (`browser.test.js`): one test logs 3, 3.5, 30 and 300 kg via both entry
paths and asserts, for each, that IndexedDB holds the exact value and that all three screens
render `N kg × 10` and never `N×100 kg × …`. A second test asserts the volume line reads
`total volume 300 kg` and specifically *not* `300 kg volume`, so the old phrasing cannot
come back.

### 62. One related inconsistency found and deliberately left alone

Sets render in the unit they were logged in (`describeSet` uses `entry.unit`), while the
volume line converts to the user's display-unit preference. A set logged in kg by someone
whose display unit is lb therefore shows `3 kg × 10` above `total volume 66 lb`. Both
numbers are correct and each is right in its own terms, but they are in different units on
adjacent lines.

Not changed, because both candidate fixes are worse than the situation: converting the set
display would show someone a weight they never entered and cannot match to the plates they
loaded, and pinning volume to the set's unit breaks down the moment a session mixes units.
Flagged here rather than silently accepted, per the brief's instruction about ambiguous
cases — it is a judgement call, and it is the user's to overturn.

### 63. The audio guarantee is now enforced at runtime, and the claim narrowed to what is actually provable

"No audio is ever stored" was previously enforced only statically — `pwa-static.test.js`
bans `MediaRecorder`/`getUserMedia`/`AudioContext` in the source. That proves the app cannot
*capture* audio, which is the strongest part of the argument, but it never demonstrated the
storage side.

`browser.test.js` → "a full voice log writes zero audio bytes to any app-controlled storage"
closes it: it drives a complete voice log (mic tap → stubbed recogniser → transcript →
confirm → commit) and then sweeps every storage backend the origin can write — *every*
IndexedDB database rather than just RepTrack's, every Cache Storage entry and its
content-type, `localStorage` and `sessionStorage` — recursively inspecting values for
`Blob`s, `ArrayBuffer`s, typed arrays, `data:audio/…` URIs, audio MIME types and long opaque
base64 runs. It additionally asserts the committed set carries no field outside the
documented schema, so a binary payload can't ride along on a legitimate record.

**I verified the test fails when it should**, rather than trusting a green pass on a check
that might assert nothing: planting an `audio/webm` Blob, a `data:audio/…` string, a raw
`ArrayBuffer` and a 2000-character base64 run across IndexedDB and `localStorage` produced
exactly four findings.

**The claim in the docs was narrowed to match what is provable.** `CLAUDE.md` and
`DEPLOYMENT.md` now say: the Web Speech API is a live recognition stream, not a recorder, so
the app never receives audio to begin with — a stronger position than "we delete it" — and
the tests cover storage *this origin controls*. They explicitly do **not** cover what Chrome,
Android or a platform speech service does inside its own process; some implementations
recognise server-side and may buffer audio there. That is invisible to the app and
unclearable by it, and claiming otherwise would be overreach. Anyone needing a guarantee
that spans the platform should use the tap-to-text fallback, which reaches every voice
feature without a microphone.

---

## Monthly-progress halo (Kemet) and white-hot bars (Forge)

Per `docs/FOLLOWUP_PROMPT_MONTHLY_HALO_1.md`.

### 64. `monthPercent` is a third metric, kept deliberately separate from the other two

There are now three independent signals feeding the skins, and the brief is explicit that
the new one must not be conflated with `streakLevel`:

| | `glow` | `streakLevel` | `monthPercent` |
|---|---|---|---|
| Window | rolling 14/28 days | rolling 14/28 days | this calendar month |
| Scale | 0–1 continuous | 0–10 integer | 0–1 continuous |
| Measured against | the user's own baseline | an absolute target | days elapsed this month |

They are layered, never combined: Kemet shows tiers *and* a halo, Forge shows barbell clarity
*and* white-hot bars. A strong rolling streak crossing into a new month legitimately shows a
full pyramid with the halo just starting — that is the honest picture of two different
things, and collapsing them into one number would lose it.

### 65. Elapsed days as the denominator, exactly as the brief instructed, and it matters more than it looks

`monthPercent = training days this month / day-of-month`. The brief pre-empted the naive
implementation and it was right to: against the full month, training every single day of the
first week caps at 7/31 ≈ 23%, so a perfect run would leave the halo dark until mid-month.
Against elapsed days a perfect run reads 100% on any date. There is a test named for exactly
that case, asserting both the 100% and that the naive denominator would have read under 25%.

The honest cost, stated in `CLAUDE.md` rather than damped away: early in a month the metric
is *jumpy* by construction — on the 3rd, one missed day is 67%. That is inherent to the
definition being asked for, not a defect, and widening the window to smooth it would quietly
turn it back into the rolling metric we already have.

### 66. The month boundary carries the previous month out over two days

The raw ratio resets hard at midnight on the 1st: a month finishing at 100% becomes 0/1 the
next morning and the halo would slam off. `MONTH.carryDays: 2` blends the previous month's
final figure out linearly, so a perfect June reads 100% → 67% → 33% → 0% across the 30th,
1st, 2nd and 3rd. Chosen over damping the ratio itself because it touches only the boundary,
leaving the metric's definition intact everywhere else.

### 67. Two new backdrop tokens per skin, and the luminance ceiling had to rise for both

`--backdrop-ink` is the ceiling — the lightest colour the canvas may paint — and both new
effects reach past the old one: Forge's bars go white-hot, Kemet's halo goes bright gold.

Raising ink alone would have silently changed the *existing* streak visuals, because both
renderers used `ink` as the warm/bright endpoint of their `mix()` calls. So the old value
got its own name in each skin — `--backdrop-glow` (Forge) and `--backdrop-star` (Kemet), both
unchanged in value — and `ink` became purely the ceiling. Existing appearance is byte-for-byte
identical; only the headroom moved.

Verified before writing any CSS that the brighter ceilings still clear the contrast floor at
the *lightest* extreme: worst text pair is 6.35:1 (Forge) and 6.78:1 (Kemet) against a 4.5
requirement. The .92 scrim does the work — a near-white backdrop still only lifts the panel
to `#251d18`.

### 68. Heat and halo colours are token cross-fades, not blends

Both new layers could have interpolated toward a computed colour. Neither does. Forge's
dull-red → orange → yellow → white ramp picks the two adjacent stops from four declared
tokens and draws each at a weight; Kemet's halo layers `--backdrop-halo` and
`--backdrop-halo-hot` at separate alphas. Every pixel is therefore a literal declared token
at some alpha — a convex combination, provably inside `[base, ink]` — and neither needs the
bespoke luminance proof that Forge's one remaining `mix()` still requires.

### 69. The flicker cap became skin-wide, because two layers can now flash independently

Kemet runs two bolt tracks: the streak-driven pyramid crawl and the month-driven halo
lightning. Each obeying `minIntervalS` separately is *not* the same guarantee as before —
two tracks could put flashes 0.1s apart on screen while both satisfied their own floor.

Added `lastFlashAt`, a module-level gate every track must clear before firing. The cap is now
a statement about what the eye actually sees rather than about any one layer. This is a case
where honouring the brief's constraint ("same flicker-hazard cap as all prior lightning
effects") required *changing* the mechanism, not just reusing it.

### 70. Two visual corrections found by testing and by looking, not by reading the code

- **The halo plateaued at 58%.** `brighten` was a smoothstep saturating at 0.58, so the top
  forty points of the range added sparks and arcs but no actual light — while the brief calls
  for "halo at its brightest" in the 90–100% band. Caught by the browser test that sweeps
  month-percent expecting a monotonic rise. `strike` now feeds ring brightness too.
- **The Forge bloom washed out the plates.** The first bloom radius was proportional to
  segment *width*, which on the full-length rod threw a halo wide enough to obscure the
  plates — and the plates are what carry the streak signal. Two layers that are meant to be
  independently readable had become one. Replaced with an inflated-outline glow that follows
  whatever shape it is given, so the rod and the vertical bars each glow along their length.

### 71. A test that measures the wrong thing is a broken test, even when it fails "correctly"

"Both metrics high must exceed either alone" initially failed on Kemet — and the code was
right. Peak pixel brightness cannot rise when the halo is by construction the brightest
element on screen; lighting the pyramid tiers beneath it adds a great deal of light without
touching the maximum. Switched that assertion to *average* brightness (total light), which is
the measure that actually matches the claim, and kept max brightness for the "is the peak
brighter" assertions where it is the right instrument. Both helpers now sit side by side with
a comment explaining when each applies.

### 72. Follow-up tuning from live review: the halo is a flattened torus, and the vertical bars glow

Two adjustments after seeing it running:

- The halo was a perfect circle, which read as a drawn ring with a hole punched in the middle
  rather than a glow — and a circle wide enough to look deliberate is also tall enough to
  reach the card panel above it, which would have forced either overlapping the UI or
  shortening the pyramid. It is now an ellipse at roughly 1:0.32. Flattening buys the width
  without the height: it sits in the gap and the pyramid keeps all ten tiers.

  **The first version of that torus cost 10.8% of a core — double the budget — and dropped
  Kemet to 16fps.** It was built from four concentric strokes of the ring band, which looked
  right and was quietly ruinous: stroking an ellipse with a ~32px line width is a large
  antialiased fill, four times a frame. Rebuilt as a *single* radial gradient with the band
  shaped into its colour stops, drawn through a y-scale to make it elliptical — same picture,
  3.5%. `npm run skins` caught it on the acceptance pass, which is the entire argument for
  that gate running every time rather than once per feature. Worth noting the run that caught
  it also threw a 9.4% outlier on Fractal, which two clean re-runs did not reproduce — a
  measurement on a loaded machine, not a regression. Re-run before acting on a number.
- The white-hot layer glowed the rod but left the vertical bars looking cold beside it. They
  now take the same heat ramp at 1.35× intensity — they are the tallest, most readable pieces
  of the barbell, and the effect is called "white-hot bars".

### 73. The 3D skins are hand-rolled WebGL2, and "≤ 20 KB" is met gzipped, not raw

The brief asked for no 3D library, with the engine at ≤ ~20 KB. The renderer core
(`js/gl.js`: compile, buffers, the multisample target, six matrix functions, screen-space
thick lines) is **6.1 KB raw**. The four scenes (`js/backdrop-gl.js`) are 39.6 KB raw, and
most of that is GLSL source held as strings. Shader text does not minify the way JS does
without a build step, and this project has no build step. Shipped size is **16 KB gzipped**
for the core plus scenes, 19 KB with `theme-engine.js` included. So the target is met as
transferred and missed as raw bytes on disk. For scale, Three.js is ~600 KB raw. No
dependency was added, so no exception needed recording.

### 74. The contrast proof moved from "by construction" to "by a bounding pass"

The 2D renderer keeps every frame inside `[--backdrop-base, --backdrop-ink]` because it
only paints token colours with source-over blending (#40, #68). Lit 3D shading, specular,
bloom and additive glow cannot promise that. So the WebGL2 renderer draws each scene into
an offscreen target, and one final pass clamps every pixel's relative luminance into that
range. It scales down above the ceiling and adds equal grey below the floor. Both are exact
in linear RGB, because luminance is linear there. Consequences:

- **Additive blending is allowed in WebGL scenes only.** The halo, sparks, embers and
  bolts all use it, as the brief asks for the halo. The old rule still binds the 2D
  renderer, where nothing clamps afterwards, and `contrast.test.js` still enforces it
  there. CLAUDE.md now scopes the rule accordingly.
- **The guarantee is checked on pixels, not argued.** `browser.test.js` reads every pixel
  of all four skins back at five metric combinations and asserts none exceeds the ink
  ceiling. Before this pass that test read the 2D canvas directly, which under WebGL is
  never drawn, so it would have passed vacuously. All pixel reads now go through
  `__backdrop.readPixels()`, which serves whichever renderer is live.
- **In the full-screen view the ceiling is lifted to white.** No text sits over the graphic
  there except the level pill and two buttons, which carry their own 92% glass scrim, and
  `visuals.test.js` checks them at 4.5:1 against the real pixels.

### 75. Flash safety is now WCAG 2.3.1's number, enforced by one limiter

Previously the rule was a stricter floor, invented for this app: no flash closer than 3.5 s
to the last (#69). This brief explicitly wants faster, more frequent lightning that is
capped at **3 flashes in any 1 s window**, in code. So `theme-engine.js` has one
`createFlashLimiter()`. It is a sliding window, not a per-second bucket, which would allow
six flashes across a second boundary. Every bolt in both renderers requests it, so the cap
covers what the eye sees, not any one layer. The scheduling rate is set well below the cap:
at maximum intensity each track averages one strike per ~1.2 s. Intensity buys branching
and frequency up to that rate, never past the cap. The cap is tested for every theme in
node (10 simulated seconds at 30 and 60 fps) and in real Chromium (10 s at maximum).

This is a relaxation of the old floor, made deliberately because the brief asked for it.
If strikes ever feel like a strobe on a device, raising `LIGHTNING.fastDelayS` is a
one-number change and stays inside the WCAG cap either way.

Found on the way: a strike booked while intensity was low (up to ~10 s away) was not
pulled in when intensity jumped, so lightning lagged real progress. `updateBoltTrack` now
caps a pending wait at the current level's longest gap.

### 76. Terminal and Fractal ink were raised, because their ceilings made them invisible

Terminal's `--backdrop-ink` was `#2f5567`, luminance 0.08. That was the cause of the earlier
"barely visible" bug, and a 3D field bounded by it could not be bright either. Fractal's
`#4a3a7a` (0.06) capped the zoomed filaments at a murk. At 92% glass both had a lot of
headroom: the new inks (`#7fd8ec`, `#cdbdf8`) still leave the worst text pair at 6.7:1 and
6.5:1. `contrast.test.js` re-proves every pair against the new range. The 2D fallback gets
brighter too, which is intended.

### 77. The full-screen level label, and "the activity visuals never speak"

CLAUDE.md says no streak counts and no copy derived from consistency. The brief explicitly
asks for "Tier 6 of 10 · 58% this month" in the full-screen view, so it is there, kept
inside the spirit of the rule. It states only what has been earned and never a gap, a
count of missed days or a nudge. It appears only in a view the user chose to open, hides
with one tap, and is not `aria-live`, so it is never announced unprompted. It reads the
values the scene is actually drawing, so label and picture cannot disagree. The
`theme layer never scolds` test still passes over every tab.

### 78. CPU is measured, but on a machine with no GPU, and the numbers say so

`npm run skins` now reports per renderer. With WebGL2, app JavaScript costs **+0.7–0.9% of
a core**, the same as the 2D skins. Total main-thread time reads 56–82%, which looks
alarming, so it was investigated before being explained. A WebGL2 canvas that only clears
costs 14% of the main thread here versus 3% for 2D: with no GPU, Chromium composites in
software and reads every WebGL frame back synchronously. The rest is the main thread blocked
on SwiftShader, which runs the GPU work on 2–3 CPU cores. A phone does that on its GPU,
asynchronously. So the gate is the app's own JavaScript for WebGL2 and total CPU for the 2D
fallback, and the blocked time and the GPU-process figure are recorded beside it, not
hidden. The real ~5%-on-a-phone answer needs the phone (`MANUAL_TEST.md` Check 2).

Real GPU load still matters on a phone, so two choices bear on it:

- **4× MSAA only below 2× device pixels.** At DPR 2 the pixels are small enough that
  multisampling would roughly quadruple fill bandwidth for edges nobody can see.
- **`min(devicePixelRatio, 2)` is honoured on the Today view too**, as the brief says, even
  though 92% glass covers most of that frame. Rendering Today at 1× would cut its GPU work
  roughly fourfold. It is the first thing to try if the phone check runs warm, and is not
  done pre-emptively because the brief asked for sharpness.

GL context creation and shader compilation are lazy: nothing happens until a glass skin is
chosen, and each skin compiles only its own programs. A test caught the alternative. Eager
creation slowed boot enough that the Light theme was applied late after a reload.

### 79. Class/PT attendance: schema only, a real migration, no SCHEMA_VERSION bump

`Session` gains `sessionType` (`gym | run | class | pt`) plus null `className`,
`instructor`, `location` and `attendance`. The brief says existing sessions migrate "to gym
or run". Runs live in their own store and are not Sessions, so every existing Session is a
gym session. `'run'` is reserved for a future where a run is logged as a Session. The
database goes to version 2 solely to stamp that field on old records. Older backups are
filled on import. `SCHEMA_VERSION` (the backup format) is **not** bumped: the top-level
shape did not change, and bumping it would make older app versions refuse newer backups
they can read perfectly well.

The later-build spec is in `docs/PHASE_ROADMAP.md`, not a new `ROADMAP.md`, so there is one
roadmap rather than two that drift apart.

### 80. Two things the brief referred to that did not exist

- **A "passcode gate"** is listed among existing tests to keep green. There is no passcode
  gate anywhere in the code or tests. Nothing was built for it, because inventing an auth
  feature inside a visuals pass would be the wrong place to do it.
- **The browser tests had been silently skipping** in any environment where Playwright
  ships `chrome-linux64/` rather than `chrome-linux/`. The helper now finds both. Chromium
  also needs `--enable-unsafe-swiftshader` to keep software WebGL. Without it, a future
  Chromium would quietly drop the tests to the 2D fallback and they would test the wrong
  renderer.

### 81. Terminal's progression is now visible in a still frame, not just in motion

On review, Terminal at 0 and 0.5 looked almost identical in screenshots. Most of what scaled
was speed and flicker rate, which a still cannot show. Its brightest glyphs also already hit
the ink ceiling at 0, so "brighter" had nowhere to go. Four changes make the reward something
you can see at a glance. Density now rises from 35% of columns (was 65%). A glowing
`--backdrop-ink` head is earned: 12% of columns at 0, rising to all of them. Trails lengthen
from 6 to 14 glyphs. Packet bursts start at 0.3 instead of 0.45. The stream colours' base
gain went up (1.1 → 1.5) so the sparser 0 state stays readable. Measured over 12 frames,
bright-glyph coverage goes 0.24% → 0.99% → 4.77% across 0 / 0.5 / 1. The bounding pass still
clamps every pixel and the scene has no lightning, so neither the contrast proof nor the
flash cap is touched.

### 82. Why Forge drag-to-rotate "did nothing", and the plates that now load with the level

**Root cause, measured before fixing.** None of the three suspects in the brief. The drag
handler was not keyed to Kemet: the same 100px drag moved both scenes' rotation angle by
the same 1.20 rad. Forge simply applied that angle about the **barbell's own long axis**
(`rotationX(f.spin)`), the axis it auto-rotates around. A barbell is almost perfectly
symmetric about that axis, so a 69° turn changed **0.11%** of the screen (the plate spokes
and grip knurl), against **6.5%** for the same drag on Kemet. The handler also only read
horizontal movement, so turning it end-on or flipping it was impossible. The previous
test checked the rotation *number*, which did change, rather than the picture, so it passed.

**Fix: one shared orbit in `theme-engine.js`.** Drag is now a world-space yaw (horizontal)
and pitch (vertical) offset applied *on top of* each scene's own auto-rotation, so any
scene turns the way the finger moves, whatever axis it spins on. While held, auto-rotation
stops. On release the offset eases back along the shortest path (τ 0.45 s) while
auto-rotation resumes. Under reduced motion a drag still turns the held frame, because the
user chose that motion, but nothing eases or auto-rotates afterwards. `graphic-view.js` has
one pointer path for both themes, and arrow keys (now including Up/Down) go through the
same three calls. Kemet behaves slightly differently from before: a horizontal drag used to
be folded permanently into its spin, and now eases back too, to match Forge. No pinch-zoom:
Kemet never had it.

The tests now assert pixels and on-screen positions. A drag must change >2% of the frame,
dragging right must move the near side right, and dragging up must tilt the near end up
and the far end down.

**Plates (`streakLevel` → per-side plates, per the brief's table).** The level 1–3 swaps
(small → medium → large) were kept. In screenshots they read naturally as "heavier", so the
fallback to one-pair-per-level was not needed. Further choices:

- **Colours:** large red, medium blue, small green. The competition convention runs red /
  blue / yellow / green / white by weight, and with three sizes I skipped yellow, which
  reads poorly next to a yellow-hot bar. They are `--backdrop-plate-*` tokens, so the
  contrast tests cover them, and the bounding pass still clamps every pixel. Plates take
  only a 10% wash of the heat glow (steel takes 100%), which is what keeps them
  distinguishable when the bar is white-hot. `visuals.test.js` samples their rendered rims
  at heat 0 and 1.
- **Countable stacks:** identical plates side by side merged into one block, so each plate
  has a dark seam at its faces.
- **Fit:** the sleeve is sized from the table. Level 10 (four large) ends 0.003 units short
  of the end collar.
- **Motion:** one plate moves at a time, as on a real bar. An outer plate comes off before an
  inner one changes, and new plates go on inner-first. On: 0.6 s slide from past the sleeve
  end, easing into its seat. Off: 0.9 s, fading as it slides out, with no frame-to-frame
  jump. Voice recognition and a hidden page pause it (the loop stops); reduced motion snaps
  to the right plates.
- **Between visits:** `settings.forgePlatesSeenLevel` remembers the level whose plates last
  settled on screen. If the level is higher next time Forge opens, the new plates go on in
  front of the user once. If it is *lower*, the bar just shows the right plates: replaying a
  lapse as plates coming off would be exactly the punishment the theme exists to avoid. An
  install that predates the setting (`null`) starts in place. The save goes through a new
  `state.rememberSetting()`, which does not notify subscribers. A test caught
  `updateSettings()` here: it re-rendered every view and re-pushed the activity values in
  the middle of an animation.
- **Heat and plates are independent layers.** A fully loaded cool bar and a lightly loaded
  white-hot one are both shown in `VISUALS.md`. Pause activity effects freezes the level,
  and therefore the plates.
- **The 2D fallback is unchanged** (fixed plates, no orbit). It only runs without WebGL2 or
  during a lost context. Extending it is straightforward if wanted, but it was left out to
  keep the change to what was asked.

Forge's "brighter as the level climbs" assertion now uses total light instead of the peak.
Plates cover part of the brightest steel, so the peak can dip slightly (539 → 530) while
total light nearly triples (26 → 42 → 71).

### 83. Kemet's hollow underside: the base face was never in the mesh

**Cause, checked before fixing:** not culling. Face culling is never enabled anywhere in the
renderer (no `CULL_FACE`/`cullFace` in the code), and winding therefore never hid anything.
`pyramidMesh()` simply looped over the **four side faces only**. A pyramid seen from the
default camera never needed a base, so it was never built. Once drag-to-rotate could flip
the pyramid, looking up from below showed the inside of the four faces
(`docs/screenshots/kemet-base-before.jpg`).

**Fix:** a square base (face 4) built from exactly the same four corner vertices as the
sides, so there is no gap at the edges, with an outward normal straight down. It is lit by
the same light as the faces, and the light from above leaves it as dark stone under the
ambient term, as an underside should be. The inscription `RepTrack © ArtyG-Dev` is drawn
once with a system font stack (no font file) into a cached canvas texture: sharp lettering
in one channel, a blurred copy in another for the glow. It renders in `--backdrop-gold-hot`
with a `--backdrop-glyph` (cyan) halo, so it reads as engraved rather than a label.

**Not mirrored, by construction:** the base's u runs along +x and the text's "up" along +z.
Seen from below (looking up +y), right × up = +x × +z = −y, which points back at the
viewer, so it is a proper rotation of the page, never a reflection. `visuals.test.js`
checks it on screen: from below, the base faces the camera, the text's start is left of its
end, its top is above its centre, and it is centred. The default camera looks down on the
pyramid, so the base never faces it in normal Today view (also asserted), and nothing
changes under reduced motion.

### 84. Forge spins level on a turntable, opposite to Kemet

The old auto-rotation was a slow roll about the bar's own long axis, which a round bar
barely shows (the same symmetry behind #82). Forge now turns about the vertical axis with
the bar level, showing front, end-on and back, in the opposite direction to Kemet. Both use
the shared intensity-scaled speed and the one-turn-per-8-s cap. The axis and direction are
one constant, `FORGE_AUTO_ROTATION = { axis: 'vertical', direction: -1 }`, beside
`KEMET_AUTO_ROTATION`; `'tumble'` (end over end) is the documented one-line alternative.
The forge glow, embers and heat haze are now positioned from the turning bar, so they swing
round with it rather than staying put while it turns. Drag works as before through the
shared orbit and eases back into this spin; reduced motion has no auto-rotation (tested).
`visuals.test.js` compares the two themes over ~1 s: Kemet's heading rises, Forge's falls,
and the bar's end stays at exactly world height 0 while it swings round.

### 85. Terminal streams half-width katakana, half of them mirrored, with a Latin fallback

**Character set: half-width katakana** (U+FF66–U+FF9D), chosen over full-width. They are
the narrow forms, so a column reads as a dense vertical stream at the rendered sizes, where
full-width glyphs crowd the cell. 22 of them replace the Latin letters A–F; the ten digits
stay. **About half the glyphs are mirrored**, picked by a hash of (column, slot, glyph
lifetime). The same lifetime key that picks the character picks the mirroring, so a glyph
keeps its orientation until its character changes and never flips frame to frame. The atlas
holds a normal row and a mirrored row, drawn once (`scale(-1, 1)`) and only sampled by the
shader, with no per-frame `fillText`. `theme-engine.test.js` checks the formula's split
(about 50%) through a JS twin, `mirrorFlag()`.

**No font file.** The atlas uses the system stack `"Noto Sans CJK JP", "Noto Sans JP",
"Hiragino Sans", "Yu Gothic", sans-serif`; Android ships Noto Sans CJK. **No tofu, ever:**
before building the atlas, every katakana in the set is drawn and compared with a character
no font has (U+FFFF, which every browser draws as the same box) and with blank. Every glyph
must differ from both and from each other. Otherwise the old `0–9 A–F` Latin set is used,
unmirrored, exactly as before. `visuals.test.js` forces that path by making the canvas draw
katakana as U+FFFF, and asserts the Latin set.

The headless machine here had no CJK font, so the `fonts-noto-cjk` OS package (the same
Noto Sans CJK family Android ships) was installed to render the screenshots. That is a
property of this test box, not the app: nothing was added to the repo or the footprint, and
on a box without it the test expects, and gets, the Latin fallback.

### 86. Terminal: a clamped look-around, through the one shared orbit

Terminal is a place, not an object, so dragging moves the **viewpoint** around inside the
field: the look direction turns and the field follows the finger, as in a panorama. It goes
through the same `orbit*` handler as Kemet and Forge. `ORBIT_STYLE` in `theme-engine.js`
gives each scene its rules:

- **Terminal:** clamped to ±40° yaw and ±25° pitch, easing home over about a second
  (τ 0.3 s), and snapping home on release under reduced motion.
- **Kemet and Forge:** unchanged. Unclamped, τ 0.45 s, and they stay put under reduced motion.

The clamp limits the accumulated angle, not the finger's travel, so a drag past the stop
responds the instant it reverses. The floor-grid shader turns its rays by the same yaw, so
the grid, packet bursts and glyphs stay locked together.

Two things the clamp needed that it didn't obviously need:

- **The field had to be widened.** Columns were placed in the straight-on frustum only
  (±0.55 × depth), so turning 40° would have shown empty space. They now span ±1.3 × depth,
  enough for the full yaw plus the half field of view, and there are 170 of them instead of
  72 to keep the visible density the same.
- **The near field was empty.** Looking down showed only the floor, so the nearest columns
  now start at 1.2 units instead of 3.

**Billboarding is by construction.** The glyphs are GL point sprites, which are always
screen-aligned, so a katakana never turns edge-on whatever the view. They still sample the
same cached atlas, mirrored row included. Data velocity, the katakana mix, the Latin
fallback and the flash limiter are untouched.

### 87. Fractal: drag recolours (hue and warmth), remembered everywhere

In the Fractal's full-screen view a drag changes **which colours** are used and never moves
the view (no rotate, pan or zoom). Horizontal movement turns the hue: one screen width is a
full turn, and it wraps. Vertical movement sets warmth from −1 to +1: up warms, it's
clamped, and it doesn't wrap. It is driven by *movement*, so a tap or the start of a new
drag can never jump the colours, and a press only starts recolouring once it travels past
the tap slop. The arrow keys do the same in steps of 15° of hue and 0.1 of warmth.

**A transform, not a new palette.** `tinted()` in the bloom and Mandelbrot shaders rotates
the existing colours about the grey axis and leans them warm or cool. Progress still drives
saturation, iterations, zoom and detail exactly as before. The inside of the set is untouched,
and so is the lightning colour, which is drawn separately. A colour change never goes near
the flash limiter. The luminance-bounding pass still clamps every pixel.

**Memory.** `settings.fractalColour` (`{ hue, warmth }`, default `{ 0, 0 }`) is saved when the
full-screen view closes, and only if it changed. `app.js` applies the saved value on boot and
after every state change, which is how **Reset Fractal colours** in Settings and a JSON
**import** take effect with no extra wiring. It skips this while the full-screen view is open,
where the user's live drag is the truth. The export already carries every settings row, so
the colours travel in backups with no format change (`db.test.js` round-trips them).

**The first-use hint** ("Drag sideways to change colour, up and down for warmth") shows the
first time the Fractal opens full screen, and `settings.fractalHintSeen` is set when it
shows. It is dismissed with *Got it*, or by simply starting to recolour.

**Contrast:** the sweep the brief asked for (hues 0/90/180/270° × warmth −1/0/+1 × intensity 0
and 1, measured against real pixels behind every text element on Today) passes all 24
combinations at ≥ 4.5:1. The bounding pass already caps luminance whatever the hue, so the
glass scrim did not need strengthening, and the user's colour range is not limited.

**A bug found on the way:** Esc (and the arrow keys) only worked while focus was inside the
dialog. Pressing on the scene moves focus to the page body, so after any drag, Esc did
nothing. Keys are now handled at document level while the view is open. This affected Kemet
and Forge too, and has its own test.

The 2D fallback renderer is not tinted. It only runs without WebGL2.
