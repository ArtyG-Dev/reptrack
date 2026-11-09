# Claude Code — Follow-up Prompt: Terminal Clamped Orbit + Fractal Drag-to-Recolour

Two full-screen interaction changes. Touch only what's needed. Don't change the metrics, the intensity driver, Kemet or Forge. Commit after each change, push to `origin main`, bump the service worker cache version, and re-verify the live site at `https://artyg-dev.github.io/reptrack/`.

---

## 1. Terminal: clamped orbit in full-screen view

The data field already has real depth. Dragging should move the **viewpoint around the field**, like looking around inside it. It doesn't spin the field as an object.

- **Use the shared rotation handler** in `theme-engine.js` that Kemet and Forge already use. Don't write a separate one.
- **Clamp the angles:** yaw (left/right) ±40°, pitch (up/down) ±25°. The user must never be able to swing the view off into empty space.
- **Billboard the glyphs:** each katakana glyph turns to face the camera, so it stays readable and never turns into a thin sliver at an angle. Keep using the cached glyph atlas, including the mirrored glyphs, with no per-frame text drawing.
- **On release:** ease smoothly back to the default straight-on view over about 1 s. Terminal has no auto-orbit, so this is a return to centre, not a resumed spin.
- **Reduced motion:** manual drag still works, since the user is choosing the motion, but there's no easing animation. The view snaps back to centre on release.
- Everything else is unchanged: data velocity tied to intensity, the katakana mix, the Latin fallback and the flash limiter.

**Check:**
- A scripted drag changes the frame, and dragging past the clamp stops at ±40° / ±25°.
- After release, the view returns to the default frame.
- Glyphs stay legible at maximum yaw and pitch (screenshot).

---

## 2. Fractal: drag to change hue and warmth, remembered

In full-screen view, dragging **changes the fractal's colours**. It doesn't rotate, pan or zoom the fractal. There is no zoom gesture.

### Mapping

- **Horizontal drag → hue.** Rotate the whole palette around the colour wheel. Dragging one full screen width = one full 360° turn, and it wraps around.
- **Vertical drag → warmth.** Dragging up warms the palette (towards reds, oranges, yellows) and dragging down cools it (towards blues, cyans, violets). Clamp it to a range of −1 (coolest) to +1 (warmest). It doesn't wrap.
- **Use relative drag (movement), not absolute position,** so tapping or starting a new drag never makes the colours jump.
- Apply both as a transform on the existing palette in the shader (a hue rotation plus a warm/cool tint), not as a new palette. It's a few lines of shader code.
- **Unchanged:**
  - The inside of the set stays black.
  - Progress still controls vividness, clarity and the progress-driven zoom/detail. The drag only changes which colours are used.
  - Lightning keeps its own colour and the flash limiter. Changing colour is not a flash.

### Memory

- Save the chosen `{ hue, warmth }` to Settings (IndexedDB) when the user leaves full-screen view.
- Use the saved colours **everywhere the Fractal theme appears**: the next time full-screen opens, and in the normal Today view.
- Add a **"Reset colours"** button in full-screen view and in Settings, which restores the theme default (`hue: 0, warmth: 0`).
- Include the saved colours in the existing JSON export/import.

### Usability and accessibility

- First time only, show a short dismissible hint in full-screen view, e.g. "Drag sideways to change colour, up and down for warmth". Store that it has been seen.
- Keyboard support: left/right arrows adjust hue, up/down arrows adjust warmth.
- Give the level overlay text in full-screen view a small dark backing so it's readable at any colour.
- **Contrast in normal Today view:** the user can now set any colour combination, so check that text over the fractal stays ≥ 4.5:1 across the range. Sample at least hue 0°, 90°, 180° and 270°, each at warmth −1, 0 and +1, at intensity 0 and 1. If any combination fails, strengthen the frosted-glass scrim. Don't limit the user's colour range.

**Check:**
- A scripted horizontal drag changes hue and a vertical drag changes warmth (frame colours differ as expected).
- Warmth stops at its limits and hue wraps.
- Exiting and re-entering full-screen keeps the colours. Reloading the app keeps them. The normal Today view shows them too.
- "Reset colours" restores the defaults.
- The contrast sweep passes.

---

## Acceptance additions

- [ ] Terminal: orbit uses the shared handler, is clamped at ±40° yaw / ±25° pitch, glyphs are billboarded and legible at the extremes, and the view eases back to centre (snaps back under reduced motion).
- [ ] Fractal: horizontal drag changes hue (wraps) and vertical drag changes warmth (clamped −1 to +1). No rotate, pan or zoom gesture.
- [ ] Fractal colours persist across full-screen exits and app reloads, apply in the normal Today view, are included in JSON export/import, and "Reset colours" works in both places.
- [ ] First-use hint shows once. Arrow keys work. The overlay text backing is present.
- [ ] Contrast sweep (4 hues × 3 warmths × 2 intensities) passes in normal Today view.
- [ ] Screenshots of the Terminal orbit at the extremes and the Fractal at several hue/warmth settings added to `docs/screenshots/` and `VISUALS.md`.
- [ ] CPU cost re-measured for both themes and still within budget.
- [ ] Full existing acceptance suite still green.
- [ ] Pushed, cache version bumped, live site re-verified.
- [ ] `MANUAL_TEST.md` updated with the on-phone checks:
  - Drag around the Terminal field and let go.
  - Recolour the Fractal, close full-screen and reopen to confirm the colours were kept.
