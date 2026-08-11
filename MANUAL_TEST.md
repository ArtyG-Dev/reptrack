# MANUAL_TEST.md — the device checks

Everything else is verified automatically. These two cannot be: no headless browser can
tell you whether Android's audio focus ducked your music, and no desktop CPU can tell you
what a background animation costs a mid-range phone.

**Time needed: about two minutes for the first, five for the second.**

---

## Check 1: voice logging must not interrupt music

1. Serve RepTrack over HTTPS (or `http://localhost` via USB port-forwarding) and open it
   in **Chrome on your Android phone**. Install it: menu → *Add to Home screen*. Launch it
   from the home screen icon, not the browser tab.
2. Start music playing in another app — Spotify, YouTube Music, whatever you train to.
   Let it play out loud or through headphones; volume up enough to notice a dip.
3. In RepTrack, tap **Start session**.
4. Tap **🎤 Log by voice** and say: *“bench press 60 kilos for 10”*.
5. Grant the microphone permission if asked, then repeat step 4.

### What to watch for

| Observation | Meaning |
|---|---|
| Music keeps playing at the same volume through the whole recognition | ✅ Pass — this is the intended behaviour |
| Music dips in volume briefly, then returns | ⚠️ Partial — Android ducked for the mic. Note it and tell me |
| Music **pauses or stops** | ❌ Fail — tell me and I will switch the mic button to open the text entry directly |

Then confirm the parsed set appears (60 kg × 10) and tap **Save**.

---

## Check 2: the animated skins on a real phone

`npm run skins` measures each skin at 2–3% of one core — but that is headless Chromium on a
desktop CPU, and it only counts main-thread work. It cannot see the GPU cost of the frosted
glass blur, which on a phone is plausibly the bigger half. So the budget in the brief
(~5% CPU on a mid-range Android, no meaningful battery hit over a session) is only really
answerable here.

1. On the phone, **Settings → Theme → Kemet**. Then **Forge**, **Fractal**, **Terminal**.
2. For each: leave it on the Today tab for ~30 seconds and just watch.
3. Then do one real thing — start a session and log a set by voice.

Kemet is the one to watch hardest: the pyramid, its ten tiers and the arcs crawling over it
are the most drawing any skin does. Fractal's Mandelbrot is computed once when the theme
loads, so a brief hitch *on switching to it* is expected and fine; a sustained one is not.

### What to watch for

| Observation | Meaning |
|---|---|
| Scrolling and tapping stay as smooth as they are on Light | ✅ Pass |
| The background is a slow drift/glow — no flicker, no strobe, nothing sharp | ✅ Pass — it should be barely noticeable |
| The background visibly freezes the instant the mic starts listening, and resumes after | ✅ Pass — this is the auto-pause working |
| The phone feels warm, or the battery drops noticeably faster than usual during a session | ❌ Over budget — tell me which skin and I'll simplify it (fewer particles, lower backing-store resolution, or drop the blur to a plain scrim on small screens) |
| Any stutter while scrolling, or the keyboard/mic feeling laggy | ❌ Same — tell me which skin |

Also worth a quick look while you're in there:

- **Settings → Background effects → Reduce background effects.** The background should go
  completely still — a frozen frame, not a slow one — and stay a still frame after a reload.
- **Text stays easy to read** over the moving background on all four, in daylight and in a
  dark room. The contrast is verified mathematically at both extremes of the animation, but
  a phone screen at low brightness in the sun is the real test. Pay particular attention to
  the **tab bar**, which now sits directly over each skin's focal graphic — that's the one
  spot where busy detail meets small text.
- **The whole graphic is visible**, not cut off behind the tab bar: you should be able to
  count all ten pyramid tiers, and see the full barbell including both outer plates.

---

## While you are there (optional, 30 seconds each)

- **Offline:** turn on flight mode, force-close the app, reopen it from the home screen.
  It should launch normally and your session should still be there.
- **Weekly summary:** Diary → **Share or save this week (.txt)**. The Android share sheet
  should open with a `.txt` file attached. Send it to yourself and check it reads sensibly.
- **Fallback path:** if voice ever mishears, tap *Type it instead* on the sheet that
  appears and type the same phrase — it parses identically.

---

## What I do with the result

**Check 1 — music:**

- **Pass** → criterion #3 in `ACCEPTANCE.md` flips from ⚠️ to ✅. Nothing to change.
- **Ducks** → acceptable per the spec (“degrades gracefully”), recorded as such.
- **Pauses** → I change the mic button's default to tap-to-text and keep voice behind an
  opt-in in Settings. Roughly a ten-minute change; the fallback path is already built and
  tested.

**Check 2 — skins:**

- **Pass** → the device half of criterion #34 is recorded against the headless numbers.
- **Warm or stuttering** → I simplify the offending skin rather than shipping it as-is,
  which is what the brief asks for. In order of what I'd try: halve the particle count,
  drop the canvas backing store another step, then replace `backdrop-filter` with an opaque
  scrim below a screen-width threshold. The skin stays; the cost comes down.
