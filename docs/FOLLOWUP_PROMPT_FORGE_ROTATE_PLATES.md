# Claude Code — Follow-up Prompt: Forge Full-Screen Rotation + Progressive Plate Loading

Two changes to the **Forge** theme only. Don't change other themes, the `streakLevel`/`monthPercent` formulas, or the shared `theme-engine.js` intensity driver, except where noted below. Commit, push to `origin main`, bump the service worker cache version, and re-verify the live site at `https://artyg-dev.github.io/reptrack/`.

---

## 1. Drag-to-rotate the barbell in full-screen view

The previous prompt (`FOLLOWUP_PROMPT_3D_VISUALS.md`, §3) already specified drag-to-rotate for both Kemet and Forge in full-screen view. On the live build it works for the Kemet pyramid but not the Forge barbell. **Diagnose why before you fix it**, and record the cause in `DECISIONS.md`. Likely causes to check:
- The pointer/drag handler is bound only to the Kemet scene, or is keyed on the theme name.
- The Forge scene has no camera/orbit state exposed to the shared input handler.
- The barbell's fixed auto-rotation on its long axis overwrites the user's input every frame.

**Behaviour to match Kemet:**
- Drag (touch or mouse) rotates the barbell freely around both the vertical and horizontal axes, so the user can turn it end-on, look along the bar, or flip it.
- On release, ease back into the theme's auto-rotation instead of snapping back.
- Pinch-to-zoom is optional. Add it only if Kemet already has it, so the two themes behave the same.
- Use one shared rotation handler in `theme-engine.js` for both 3D themes, not a second copy for Forge.
- Keep the existing exits (close button, Esc, Android back), focus handling, flash limiter, and reduced-motion behaviour. Under `prefers-reduced-motion`, manual drag still works (the user is choosing the motion), but there's no auto-rotation and no easing animation.

---

## 2. Load plates onto the bar as the level rises

At present the barbell carries a fixed set of plates. Change it so the bar **starts empty and gains plates as `streakLevel` rises**, giving Forge the same countable, step-by-step progress as Kemet's 10 pyramid tiers.

### Plate mapping

- `streakLevel` 0 → bare bar.
- `streakLevel` 10 → fully loaded bar.
- Plates are always added **in matching pairs, one on each side**, so the bar is never visually lopsided.
- Suggested progression (heaviest plate goes on first, nearest the collar, as on a real bar):

| Level | Plates per side (inner → outer) |
|---|---|
| 0 | none |
| 1 | 1 small |
| 2 | 1 medium |
| 3 | 1 large |
| 4 | 1 large + 1 small |
| 5 | 1 large + 1 medium |
| 6 | 2 large |
| 7 | 2 large + 1 medium |
| 8 | 3 large |
| 9 | 3 large + 1 medium |
| 10 | 4 large (full sleeve) |

  At levels 1–3 a single plate is swapped for a larger one rather than a second plate being added. That's deliberate: early progress reads as "heavier", and later progress as "more". If the swaps look odd in testing, switch to a simple one-pair-per-level progression and note it in `DECISIONS.md`.

- **Colour:** use the standard competition plate colour convention (red, blue, yellow, green, white by size), shaded to fit the Forge palette. The colours must still read clearly under the heat glow. Check this at intensity 1.0, where the bar is white-hot.
- **Fit:** every configuration must fit within the rendered sleeve length, with a collar at the end. Size the sleeve so level 10 just fills it.

### Animation

- **Adding a plate:** it slides onto the sleeve from the end and seats against the previous plate, taking about 0.6 s. Play this when the level rises while the app is open, and also once when the user next opens the Today view after levelling up between visits, so they see the plate go on.
- **Removing a plate** (level eases down): it fades and slides off gently. Never make it look like a dramatic loss. This keeps the existing "gaps cool things down, never punish" principle.
- No plate animation runs during voice recognition (the existing pause rule).
- **Reduced motion:** show the correct plates in place, with no sliding.

### Keep everything else as it is

- The heat-glow progression on the bar (red → white-hot) still follows `monthPercent`, and embers still follow intensity. Plates are an extra layer, so a user can have a fully loaded but cool bar, or a lightly loaded but white-hot one. Both have to look coherent.
- The frost rules, "Pause activity effects" toggle and contrast floor are unchanged. Pausing freezes the plate count too.

---

## 3. Verification

Use the same Playwright screenshot process as before:

- [ ] Root cause of missing Forge drag-to-rotate documented in `DECISIONS.md`.
- [ ] Scripted drag in full-screen view rotates the barbell: frames before and after the drag differ in the expected direction, and auto-rotation resumes after release.
- [ ] Kemet drag-to-rotate still works. Both themes use the one shared handler.
- [ ] Screenshots of the Forge barbell at `streakLevel` 0, 3, 6 and 10 saved to `docs/screenshots/` and embedded in `VISUALS.md`. Plates are symmetrical and match the table at each level.
- [ ] Level 10 configuration fits the sleeve, with a visible collar and no clipping.
- [ ] Plate colours are distinguishable at heat intensity 0 and 1.0.
- [ ] Reduced-motion screenshot shows the correct plates with no animation.
- [ ] Simulated level-up triggers the plate slide-on, and a simulated level drop triggers the gentle slide-off.
- [ ] CPU cost for Forge re-measured and still within budget.
- [ ] Full existing acceptance suite still green.
- [ ] Pushed, cache version bumped, live site re-verified.
- [ ] `MANUAL_TEST.md` updated with the on-phone check: open Forge in full-screen, drag the barbell around both axes, and confirm the plate count matches your current level.
