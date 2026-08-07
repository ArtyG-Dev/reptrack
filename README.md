# RepTrack

A voice-first, offline gym tracker. Start a session, say *“bench press 60 kilos for 10”*,
confirm what it heard, and get on with your set. Everything lives on your phone — no
account, no cloud, no audio recorded, nothing uploaded.

Vanilla HTML/CSS/JS. No framework, no build step, no runtime dependencies.

---

## What it does

- **Today** — start/end a timed session, log sets by voice or by tap, log runs, rest timer.
- **Diary** — a calendar you can navigate by year, month, week or day; tap a day to see it.
- **Progress** — per-exercise charts of estimated 1RM, top-set weight and reps, with PR
  flags and a quiet “you've hit this twice, try a bit more” nudge.
- **Exercises** — your own dictionary; add lifts and the aliases you actually say out loud.
- **Settings** — units, rest timer, theme, JSON export/import, wipe.
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

## Development

```bash
npm test               # 100+ unit, integration and browser tests
npm run footprint      # app shell + a simulated year of data, in MB
npm run lighthouse     # PWA + accessibility scores
npm run acceptance     # all of the above, and rewrites ACCEPTANCE.md
npm run icons          # regenerate the PWA icons
```

`CLAUDE.md` has the architecture and module map. `ACCEPTANCE.md` has the measured
numbers. `MANUAL_TEST.md` has the one check that needs a real phone.
