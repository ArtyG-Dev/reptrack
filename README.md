# RepTrack

A voice-first, offline gym tracker. Start a session, say *“bench press 60 kilos for 10”*,
confirm what it heard, and get on with your set. Everything lives on your phone — no
account, no cloud, no audio recorded, nothing uploaded.

Vanilla HTML/CSS/JS. No framework, no build step, no runtime dependencies.

---

## What it does

- **Today** — start/end a timed session, log sets by voice or by tap, log runs, rest timer.
  A mixed session (strength + a yoga hold, say) groups into collapsible sections by category.
- **Diary** — a calendar you can navigate by year, month, week or day; tap a day to see it.
- **Progress** — per-exercise charts. Weight/rep exercises chart estimated 1RM, top-set
  weight and reps; yoga/pilates/timed-hold exercises chart hold duration instead. PR flags
  either way, and a quiet “you've hit this twice, try a bit more” nudge for weighted lifts.
- **Exercises** — your own dictionary, grouped into collapsible categories (Strength,
  Calisthenics, Yoga, Pilates, or anything you type — it's not a fixed list). Add lifts,
  poses or holds and the aliases you actually say out loud.
- **Settings** — units, rest timer, **six themes** (two flat, four animated), background
  effect controls, JSON export/import, wipe.
- **Weekly summary** — one tap turns the week into a plain-text file (sessions, lifts, PRs,
  volume, runs) that you can share or save. Generated on-device, works offline.

---

## Running it

It is a static site. Any static server will do:

```bash
npm run serve          # http://127.0.0.1:4173
```

Or open `index.html` through any web server. (`file://` works for the UI but the service
worker — and therefore offline mode — needs `http://` or `https://`.)

There is nothing to build. The `npm` dependencies are test tooling only; the app itself
ships zero.

## Installing as a PWA on Android

1. Serve the folder over HTTPS (or `http://localhost` while developing).
2. Open it in Chrome on the phone.
3. Menu → **Add to Home screen** / **Install app**.
4. Launch it from the home screen. It runs full-screen and works with the network off.

Once installed, the entire app shell is cached. Flight mode changes nothing.

---

## Voice logging

Tap the mic, say one phrase, confirm. Phrases it understands:

| You say | It logs |
|---|---|
| “bench press 60 kilos for 10” | 1 set — 60 kg × 10 |
| “squat 100 kilos 5 reps 3 sets” | 3 sets — 100 kg × 5 |
| “deadlift 140 for 5” | 1 set at your default unit |
| “60 kilos 10, 65 for 8, 70 for 6” | three ascending sets of the current lift |
| “add another set” | repeats the last set |
| “bench press same as last time” | pulls last session's sets for that lift |
| “pull ups 12” | 12 bodyweight reps |
| “deadlift 140 for 5 rpe 8” | records the RPE too |
| “plank for 60 seconds” | 1 hold — 60s |
| “downward dog 30 seconds each side” | 2 holds, 30s each, one per side |
| “child's pose for a minute” | 1 hold — 60s |
| “plank 30 seconds 3 rounds” | 3 holds, 30s each |

Which grammar applies is decided by the exercise, not the phrase — anything logged as
`hold` mode (yoga poses, pilates holds, a timed calisthenics hold like a plank) parses
duration instead of weight/reps. Set an exercise's mode in **Exercises → Edit**.

Spoken numbers work (“sixty two point five kilos”), as do pounds, and near-misses in
transcription are fuzzy-matched against your exercise dictionary. **Every voice log shows
you the parsed result to confirm or edit before anything is saved.**

If the browser has no speech recognition, or it fails, or it mishears — the same mic
button opens a text box that accepts exactly the same phrases. Voice is an accelerator,
never the only way in.

**About your audio:** RepTrack never captures it. There is no `MediaRecorder`, no
`getUserMedia`, no `AudioContext` anywhere in the source — the browser's own recogniser
hands back a string and that string is all the app ever sees. Recognition is one-shot on
an explicit tap so background music keeps playing (see `MANUAL_TEST.md`).

---

## Backups (export / import)

There is no cloud, so an export is your backup.

- **Settings → Export backup (JSON)** downloads `reptrack-backup-YYYY-MM-DD.json`
  containing every exercise, session, set, run and setting.
- **Settings → Import a backup** takes that file and asks whether to **Replace**
  (wipe first, then restore) or **Merge** (keep what's here, overwrite matching ids).
- A backup from a newer schema is refused rather than half-imported.

Keep a copy somewhere off the phone. Clearing the browser's site data deletes everything.

---

## Weekly summary

**Diary → Share or save this week (.txt)** — one tap. On Android it opens the share
sheet with a real `.txt` file attached; everywhere else it downloads. Contains sessions
and training time, sets and volume, a per-lift breakdown, personal records with dates,
runs with pace, and a day-by-day line. Plain text, no network, no formatting to fight.

---

## Themes

**Settings → Theme.** Six of them. The choice applies instantly and is remembered.

| | |
|---|---|
| **Light** | The default — clean, minimal, soft neutrals. |
| **High-Contrast Neon** | Dark and saturated, electric cyan/green/pink. Bold in colour, not in motion. |
| **Terminal** | Frosted glass over drifting data streams. Cool and dark; streams fall a little faster and a little brighter, and more of them shift into the brightest colour, the more consistently you've been training. |
| **Fractal** | A Mandelbrot set across the lower screen, under slowly morphing colour and the odd flicker of lightning. It resolves as your level climbs — soft and low-detail at first, sharply defined at the top. |
| **Forge** | A big barbell across the lower screen with drifting embers and a warm forge glow. It sharpens and brightens as your level climbs, with a flame lick above the bar once you're well into a run. |
| **Kemet** | Cyberpunk Egypt — night sky, gold and neon cyan, and a **Pyramid of Power** in ten tiers that light up one by one as you train. Electrical arcs crawl across it, more of them the higher you get. |

All six meet the same accessibility bar: every colour pair clears 4.5:1 contrast — for the
animated ones, checked against the background at both its lightest and its darkest, so it
holds for every frame. Nothing flashes or strobes.

### The animated ones

They are drawn on a small canvas, capped at 30 fps, and measured: each costs about
2–3% of one CPU core on a desktop, and stops entirely when it isn't earning it. It pauses
when you switch apps, and it pauses while the mic is listening — speech recognition never
competes with a background effect.

**Settings → Background effects** has two switches:

- **Reduce background effects** — keep the theme, drop the motion. The background renders as
  a single still frame. If your device is set to reduce motion system-wide, this happens
  automatically, and it's still a still frame rather than a slow one.
- **Pause activity effects** — freezes the level and the glow where they are. For illness,
  injury, a holiday, or a deliberate deload. Nothing is erased; turn it off and it picks up
  from the real date again.

### Your level (and why it isn't a daily streak)

All four animated themes respond to how consistently you've been training. There are two
things moving: a **level from 0 to 10** that drives the big graphic — the pyramid's lit
tiers, the barbell's sharpness, the Mandelbrot's detail — and a softer glow that drives
brightness and warmth.

**The level counts training days in a rolling two-week window, not consecutive days.** That
distinction is deliberate and it matters:

- **A rest day never resets anything.** There is no streak to break. Train four or five
  times a week and a rest day doesn't move the level at all — the maths has headroom built
  in precisely so it doesn't.
- **You don't have to train daily to max it out.** Four sessions a week gets you to level 10.
  Seven gets you to level 10 as well — training every day earns nothing extra, because rest
  is when you actually adapt, and a mechanic that only rewards daily training is a mechanic
  that pushes you toward overtraining.
- **It eases, it doesn't snap.** If you genuinely train less over a couple of weeks the level
  drifts down a tier at a time, and lit tiers dim gradually rather than switching off.

It climbs fast early on purpose: your first session is already worth a tier or two, and six
sessions puts you most of the way up. There's no floor of "nothing happens until you've
proven yourself" — the pyramid is fully drawn from day one, with all ten empty tiers visible,
so you can see what you're filling in.

After a long gap, and only if you'd built a real habit first, calendar days can pick up a
faint frosted edge. It's capped — a very long gap looks the same as a moderate one — it's
only ever on the calendar, never on anything you use to log a session, and one session
clears all of it. There is no counter, no streak, and no message anywhere: nothing in the
app tells you how long you were away. It's meant to make showing up feel good, not to make
coming back feel bad.

## Development

```bash
npm test               # unit, integration and browser tests
npm run footprint      # app shell + a simulated year of data, in MB
npm run lighthouse     # PWA + accessibility scores, for all six themes
npm run skins          # CPU cost of each animated skin
npm run acceptance     # all of the above, and rewrites ACCEPTANCE.md
npm run icons          # regenerate the PWA icons
```

`CLAUDE.md` has the architecture and module map. `ACCEPTANCE.md` has the measured
numbers. `MANUAL_TEST.md` has the one check that needs a real phone.
