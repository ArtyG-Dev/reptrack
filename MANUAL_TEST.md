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

## Check 2: the 3D skins and the full-screen view on a real phone (one pass, ~5 minutes)

Since the WebGL2 pass the skins draw on the phone's GPU. Nothing headless can measure that:
`npm run skins` runs on a machine with **no GPU**, where WebGL2 is emulated on the CPU, so it
can only prove the app's own JavaScript is cheap (under 1% of a core) — not that the GPU work
is. The budget in the brief (~5% CPU on a mid-range Android, the phone not heating up) is only
answerable here. See `VISUALS.md` for what each skin should look like at each level.

1. On the phone, **Settings → Theme → Kemet**. Then **Forge**, **Fractal**, **Terminal**.
2. For each: leave it on the Today tab for ~30 seconds and just watch. It should move
   smoothly — the pyramid and barbell turning, the fractal breathing, the glyphs falling.
3. Tap **View** (bottom right of the Today cards). The graphic fills the screen with the
   level shown at the bottom. On Kemet and Forge, drag sideways to turn it; let go and it
   carries on by itself. Tap the scene once — the level label hides; tap again to bring it
   back.
4. Press the **Android back button (or back gesture)**. You should be back on Today, still
   in RepTrack — not dropped out of the app. Open **View** again and leave via **✕** too.
5. Then do one real thing — start a session and log a set by voice.

Do the whole pass on one charge and keep a hand on the back of the phone: **after five
minutes across the four skins it should not feel warmer than it does browsing the web.**
Fractal and Kemet do the most per-pixel work, so watch those hardest. If the phone has no
WebGL2 (rare on anything from the last six years), the skins quietly fall back to the
previous flat 2D versions — that is the designed behaviour, not a fault.

**Forge, specifically (about a minute):** open Forge, tap **View**, and drag the barbell
around both ways. Drag sideways to swing it end-on so you look straight down the bar, and up
or down to flip it over. Let go: it should drift smoothly back and carry on turning by
itself, not snap. Then check the plates against your level. Show the level label at the
bottom (tap the scene, or **Show level**), and the plates on each side should match this
table, identical on both sides:

| Level | Per side, inner → outer |
|---|---|
| 0 | bare bar |
| 1 / 2 / 3 | one green / one blue / one red |
| 4 / 5 | red + green / red + blue |
| 6 / 7 | 2 red / 2 red + blue |
| 8 / 9 | 3 red / 3 red + blue |
| 10 | 4 red, filling the sleeve up to the end collar |

If you levelled up since you last had Forge open, the new plates should slide on once as
the Today screen appears.

**Three more quick looks (about a minute):**

- **Kemet base:** open Kemet, tap **View**, and drag *upwards* until you are looking at the
  bottom of the pyramid. It should be solid dark stone with `RepTrack © ArtyG-Dev` engraved
  in gold, readable, not back to front.
- **Forge turntable:** open Forge and watch it next to Kemet. The barbell stays level and
  turns like it's on a turntable, the *opposite* way to the pyramid.
- **Terminal katakana:** open Terminal. The falling characters should be Japanese katakana
  mixed with digits, some of them mirrored, and **never empty boxes (□)**. If your phone
  shows Latin letters A–F instead, it couldn't draw katakana and fell back on purpose. Tell
  me, because that would be unusual on Android.

**Two more:**

- **Terminal:** open it full screen and drag around. It's like turning your head inside the
  stream, and it stops before you see past its edges. Let go: it glides back to straight-on.
  The characters stay upright and readable the whole time.
- **Fractal:** open it full screen. The first time, a hint explains the gesture. Drag
  sideways (the colours cycle round) and up/down (warmer or cooler). Close it and reopen:
  the colours are kept. Back on Today, the background uses them too. **Settings → Reset
  Fractal colours** puts them back.

### What to watch for

| Observation | Meaning |
|---|---|
| Scrolling and tapping stay as smooth as they are on Light | ✅ Pass |
| The background is a slow drift/glow — no flicker, no strobe, nothing sharp | ✅ Pass — it should be barely noticeable |
| The background visibly freezes the instant the mic starts listening, and resumes after | ✅ Pass — this is the auto-pause working |
| The phone feels warm, or the battery drops noticeably faster than usual during a session | ❌ Over budget — tell me which skin and I'll simplify it (render the Today view below 2× pixels, cap Fractal's iterations lower, fewer particles, or drop the blur to a plain scrim on small screens) |
| **View** fills the screen, drag turns Kemet/Forge, and **back** returns to Today inside the app | ✅ Pass |
| Forge turns end-on and flips under your finger, and its plates match the table for your level | ✅ Pass |
| The barbell barely moves when dragged, or the plate count is wrong | ❌ Tell me your level and what you see |
| Back leaves the app, or the view gets stuck open | ❌ Tell me the phone and Chrome version |
| Lightning ever looks like a strobe — rapid flashing rather than separate strikes | ❌ Stop and tell me. It is capped in code at 3 flashes per second, so this would be a bug |
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

## Check 3: the session conveniences (about 3 minutes)

- **Edit a set:** log a set, tap it in the list, change the reps with the − / + buttons, Save.
  The set updates in place, and a PR badge appears or disappears if the change makes or
  breaks a record. Say "make that 8": the editor opens with 8 filled in, waiting for Save.
- **Rest buzz:** set a short rest (Settings → Rest timer, e.g. 15), log a set, and wait. The
  phone should buzz twice when rest ends. **Some Android browsers ignore vibration while the
  screen is off**, so check with the screen on first. Switch "Vibrate when rest ends" off and
  it should stay silent.
- **Screen on:** start a session and leave the phone untouched past its usual screen-off
  time. With "Keep screen on during a session" on (the default), it should stay lit. End
  the session and it should time out as usual again.

## Check 4: data safety and the past (about 2 minutes)

- **Settings → Storage** should say "Protected" once you have logged a session (installed
  apps are normally granted). If it says "Not yet protected", tap "Ask the browser to keep
  my data", and export a backup either way.
- **Log an earlier session:** on Today, "Log an earlier session", pick yesterday, log a set,
  end it. The Diary should show it on yesterday, not today.
- **Fix a past set:** Diary → Day → tap a set, change it, Save.
- **Warm-ups:** say "warm up bench press 40 for 10". The set is badged Warm-up and never
  becomes a PR, however heavy.

## Check 5: a plan session (about 3 minutes)

- **Exercises → Plans → + New plan:** two exercises, e.g. Bench Press 2 × 8 @ 60 and
  Overhead Press 2 × 6 @ 40. Save.
- **Today → Start from plan:** tap Bench Press in the checklist. The sheet opens with two
  rows of 60 × 8; save them. The item ticks and reads "2 / 2".
- **Say a planned set** ("overhead press 40 for 6") — it counts, "1 / 2". **Say an
  unplanned one** ("deadlift 100 for 5") — it appears under Extra.
- **Edit a set** in the list (tap it), change the reps, Save — the count still follows.
- **End session:** "Update plan to what I did?" appears with No highlighted. Either answer
  is fine; No must leave the plan as it was.

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

- **Pass** → the device half of criterion #34 and of the 3D-visuals CPU line is recorded
  against the headless numbers.
- **Warm or stuttering** → I simplify the offending skin rather than shipping it as-is,
  which is what the brief asks for. In order of what I'd try: render the Today view (where
  92% glass covers most of it) at 1× instead of 2× device pixels, lower Fractal's iteration
  cap, halve the particle counts, then replace `backdrop-filter` with an opaque scrim below a
  screen-width threshold. The skin stays; the cost comes down.
