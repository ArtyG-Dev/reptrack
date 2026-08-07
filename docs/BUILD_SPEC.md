# RepTrack — Build Specification

A voice-first, offline gym tracker. Vanilla HTML/CSS/JS single-page app, PWA-installable on Android, sub-50 MB footprint.

---

## 1. Competitive analysis (what to steal, what to skip)

| App | Strength worth copying | Weakness to avoid |
|-----|------------------------|-------------------|
| **Hevy** | Fast set-by-set logging (reps/weight/RPE), reusable routine templates, rest timer, plate calculator, clean free Android app | Cloud-account required; social feed is bloat for a personal tracker |
| **Strong** | Fastest, cleanest logging UI; great "repeat last workout" flow | Paywalled progress charts; iOS-first |
| **Jefit** | Progressive-overload logic that tells you *when* to add weight/reps | Cluttered UI, ad-heavy, huge exercise DB you don't need |
| **GhostFit / W8Log / SLAB** | Natural-language voice logging — "bench press 60 kilos for ten" parses instantly | Subscription-gated; sends audio to a server (privacy + data cost) |
| **FitNotes** | Tiny footprint, fully offline, no account | Dated UI, no voice, no charts |

**Synthesis — RepTrack's edge:** Hevy's logging speed + natural-language voice input (transcribed *on-device*, audio discarded) + a proper calendar diary + progression charts, all **fully offline** with **no account**.

---

## 2. Core requirements (from Ron)

1. **Diary** keyed to day/week/month/year — calendar view, tap a date to see or add a session.
2. **Session lifecycle** — a "Start Session" button begins a timed session; "End Session" closes it. Duration tracked automatically.
3. **Voice logging** — dictate sets naturally; parsed to structured data. **Must not interrupt music playback.**
4. **Progression tracking** — per-exercise charts of weight and reps over time; auto-flag PRs and suggest when to increase load.
5. **Storage discipline** — hard target **< 50 MB**. Transcribe voice → text, **discard audio immediately**. No raw media stored, ever.
6. **Nutrition** — *out of scope for v1*, but data model must leave room for it (see §6).
7. **Accessible, graphically pleasing, robust.**

---

## 3. The music-safe voice constraint (this is the tricky bit)

The standard Web Speech API (`SpeechRecognition`) **grabs the audio focus** and will duck or pause music on most Android setups. To log without interrupting playback:

- Use `SpeechRecognition` with `continuous = false` and fire it only for short bursts on an explicit tap of a **mic button** (not always-listening).
- Set the audio session to not request exclusive focus where the browser allows it; on Android/Chrome, short one-shot recognitions generally coexist with background media far better than continuous listening.
- **Fallback path is mandatory:** if recognition is unavailable or the parse fails, the same mic button opens a quick-entry text field. Voice is an accelerator, never the only way in.
- **Never store the audio.** Take the transcript string, parse it, throw the audio away. This is what keeps the footprint tiny *and* sidesteps the privacy problem the subscription apps have.

> Build note for Claude Code: test the music-coexistence behaviour explicitly on a real Android device in the acceptance loop. If continuous listening ducks audio, fall back to one-shot-on-tap.

---

## 4. Voice grammar (natural-language → structured set)

Parse spoken phrases into `{ exercise, weight, unit, reps, sets }`. Support these patterns at minimum:

- "bench press 60 kilos for 10" → 1 set, 60 kg × 10
- "squat 100 kilos 5 reps 3 sets" → 3 sets, 100 kg × 5
- "deadlift 140 for 5" → unit defaults to user's preferred (kg)
- "add another set" → repeats last logged set
- "same as last time" → pulls the last session's entry for that exercise
- "60 kilos 10, 65 for 8, 70 for 6" → three sets, ascending

Rules: fuzzy-match exercise names against a local dictionary (handle "bench"/"bench press", "OHP"/"overhead press"). Default unit to user setting. Always show the parsed result for a one-tap confirm/edit before committing — never log silently.

---

## 5. Screens

1. **Today / Active Session** — big Start button; once started, a running timer, the current exercise list, a mic button, and a manual "+ Add set" button. End Session commits everything.
2. **Diary (Calendar)** — month grid, dots on days with sessions; tap a day → session detail. Swipe or buttons for month/year navigation.
3. **Progress** — pick an exercise → line chart of estimated 1RM / top-set weight over time, plus a reps-at-weight view. PR badges. A gentle "you've hit 3×5 at 100 kg twice — try 102.5 kg" nudge (Jefit-style, but quiet).
4. **Exercises** — manage the local exercise dictionary; add custom lifts.
5. **Settings** — units (kg/lb), default rest timer, data export/import (JSON), wipe data.

---

## 6. Data model (IndexedDB)

Use **IndexedDB** (not localStorage — it's the right tool for structured, growing data and keeps everything on-device).

```
Exercise   { id, name, aliases[], muscleGroup, isCustom }
Session    { id, dateISO, startTs, endTs, durationSec, notes }
SetEntry   { id, sessionId, exerciseId, order, weight, unit, reps, rpe?, isPR }
Settings   { unit, defaultRestSec, ... }
// Reserved for v2, do not build yet:
// NutritionEntry { id, dateISO, kcal, protein, carbs, fat, note }
```

Keep it normalised. Estimated storage for 3 sessions/week for a year: well under 5 MB. The 50 MB cap is enormous headroom.

---

## 7. Non-negotiables / acceptance criteria

- [ ] Installs as a PWA on Android (manifest + service worker, offline-capable).
- [ ] Works with **zero network** after first load. No account, no login.
- [ ] Voice logging does **not** pause or duck background music on a real Android device (or degrades gracefully to tap-to-text).
- [ ] Every voice log shows a confirm/edit step before committing.
- [ ] No audio is ever written to storage.
- [ ] Calendar diary navigable by day/week/month/year.
- [ ] Progress charts render per-exercise weight & rep history with PR flags.
- [ ] Total installed footprint (app + a year of realistic data) stays well under 50 MB; verify and report the measured number.
- [ ] Data export/import as JSON works (backup path, since there's no cloud).
- [ ] Accessible: keyboard-navigable, ARIA labels on controls, ≥ 4.5:1 contrast, respects reduced-motion.
- [ ] Lighthouse PWA + Accessibility both ≥ 90.

---

## 8. Tech constraints

- **Vanilla HTML/CSS/JS.** No framework, no build step — keeps the footprint and complexity down and matches the existing workflow.
- Charts: hand-rolled SVG or a single tiny lib (≤ ~30 KB, e.g. uPlot) — no heavyweight chart bundles.
- One `index.html`, modular JS files, one stylesheet with semantic CSS custom properties for theming.
- Service worker caches the shell for offline use.
