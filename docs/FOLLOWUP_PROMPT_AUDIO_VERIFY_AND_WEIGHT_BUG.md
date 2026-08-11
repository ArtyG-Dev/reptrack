# Claude Code — Follow-up Prompt: Verify No Audio Persistence + Fix Diary Weight Display Bug

Two separate issues — a verification gap and a real data bug. Treat the weight bug as higher priority; it affects data accuracy, which is the core purpose of the app.

---

## 1. Bug: Diary shows "300kg" instead of "3kg"

A logged weight of 3kg is displaying as 300kg on the Diary screen. Investigate properly — don't just patch the display, find the root cause, since if this is a **storage**-level bug (wrong value written to IndexedDB) rather than a **display**-level bug (correct value, wrong rendering), existing logged data may already be corrupted and need a repair pass.

Things to check, in order:

1. **Is the stored value itself wrong, or just the rendering?** Inspect the raw `SetEntry.weight` value in IndexedDB for an affected entry. If it's stored as `300` when `3` was intended, this is a write-path bug (voice parsing or manual-entry parsing). If it's correctly stored as `3` but displays as `300`, this is a Diary-screen rendering bug.
2. **If it's a write-path bug**, check both entry paths:
   - **Voice parsing:** does the natural-language parser mishandle a spoken "3 kilos" — e.g. multiplying by 100, or a decimal/unit-conversion step firing incorrectly (a stray kg↔lb conversion, or a percentage-style parse treating "3" as "3.00" then mishandling the decimal)?
   - **Manual entry:** does the quick-entry form or its confirm/edit step apply any transformation that could introduce a ×100 error?
3. **If it's a display-only bug**, check the Diary screen's formatting logic specifically — Diary is one of several places weight is shown (Active Session, Progress charts, Diary), so check whether the bug is Diary-specific or shared. A Diary-only bug suggests it has its own formatting path with a bug not present elsewhere (e.g. an accidental unit-conversion or multiplier applied only there).
4. **Check for a pattern**, not just this one case: test logging several different weights (e.g. 3kg, 30kg, 3.5kg, 300kg intentionally) through both voice and manual entry, and check how each renders in every screen that shows weight. Report which combinations are affected — this tells us whether it's a decimal-place bug (3 → 300 suggests a ×100, which smells like a kg/g unit confusion somewhere, or a percentage/decimal mis-parse).

### Fix and repair

- Fix the root cause.
- If any already-stored data was corrupted by this bug, write a one-time repair/migration that corrects affected entries (only if you can identify them with confidence — don't guess-correct ambiguous values, flag those in `DECISIONS.md` instead for the user to review manually).
- Add a regression test: log 3kg via both voice and manual entry, assert it displays as "3kg" (not "300kg") on every screen that shows weight.

---

## 2. Verify: confirm no audio is ever persisted

The design intent has always been that voice logging never writes raw audio to storage — only the transcript. This has never been explicitly tested as a standalone check, only assumed as a design constraint. Close that gap:

1. Write an automated (or clearly documented manual) test that:
   - Triggers a voice log entry (mic tap → speech → transcript → confirm).
   - Immediately after, inspects **all** app-writable storage — IndexedDB, Cache Storage, any other storage API in use — for any binary/audio data (e.g. Blob, ArrayBuffer, base64-encoded audio) written during that interaction.
   - Asserts zero audio bytes are present anywhere in app-controlled storage.
2. Note explicitly in `DEPLOY.md` or `CLAUDE.md`: the Web Speech API used here is a live recognition stream, not a recorded file, so RepTrack's own code never receives raw audio to begin with — there is nothing for the app to delete because nothing is captured. Confirm whether the specific browser/OS combination in use performs any of its **own** audio caching outside the app's control (this would be Chrome/OS-level, not something RepTrack can see or clear, but worth being honest about in the documentation rather than claiming total certainty over behaviour outside the app's storage).
3. Add this test to the standing acceptance checklist so it's re-verified on any future change to the voice logging flow, not just checked once.

## Acceptance additions

- [ ] Root cause of the 3kg→300kg bug identified and documented (write-path vs display-path).
- [ ] Fix applied; regression test added covering voice and manual entry across multiple weight values, checked on every screen that displays weight.
- [ ] Any corrupted existing data repaired where confidently identifiable; ambiguous cases flagged in `DECISIONS.md` rather than silently guess-corrected.
- [ ] Automated test confirms zero audio bytes written to any app-controlled storage during voice logging.
- [ ] `CLAUDE.md`/`DEPLOY.md` updated with a clear, honest statement of what's verified (app-controlled storage) versus what's outside the app's visibility (OS/browser-level caching, if any).
