# MANUAL_TEST.md — the one device check

Everything else is verified automatically. This one cannot be: no headless browser can
tell you whether Android's audio focus ducked your music.

**Time needed: about two minutes.**

---

## The check: voice logging must not interrupt music

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

## While you are there (optional, 30 seconds each)

- **Offline:** turn on flight mode, force-close the app, reopen it from the home screen.
  It should launch normally and your session should still be there.
- **Weekly summary:** Diary → **Share or save this week (.txt)**. The Android share sheet
  should open with a `.txt` file attached. Send it to yourself and check it reads sensibly.
- **Fallback path:** if voice ever mishears, tap *Type it instead* on the sheet that
  appears and type the same phrase — it parses identically.

---

## What I do with the result

- **Pass** → criterion #3 in `ACCEPTANCE.md` flips from ⚠️ to ✅. Nothing to change.
- **Ducks** → acceptable per the spec (“degrades gracefully”), recorded as such.
- **Pauses** → I change the mic button's default to tap-to-text and keep voice behind an
  opt-in in Settings. Roughly a ten-minute change; the fallback path is already built and
  tested.
