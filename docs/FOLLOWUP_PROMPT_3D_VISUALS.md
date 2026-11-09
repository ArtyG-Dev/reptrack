# Claude Code — Follow-up Prompt: 3D Theme Visuals, Full-Screen Graphic View, Visual Verification

RepTrack is live at `https://artyg-dev.github.io/reptrack/` (repo `artyg-dev/reptrack`). This pass upgrades the animated themes to sharper, GPU-rendered 3D visuals and adds a full-screen view of each theme's graphic. Work through the steps in order, commit at each green milestone, and push to `origin main` as soon as the acceptance checks pass. Redeploy and re-verify the live site.

Earlier passes reported animations that were in the code but did not visibly run on the device. This pass must **prove** the visuals render, with screenshots, rather than assume they do (see §5).

---

## 0. Before you start

1. `git pull`, then run the existing acceptance suite and record the baseline in `ACCEPTANCE.md`. Don't start new work on top of failing tests; fix regressions first.
2. Read `CLAUDE.md` for the existing `streakLevel` (rolling-window training days) and `monthPercent` (training days ÷ days elapsed this month) formulas. **Both metrics stay as they are.** This pass changes how they look, not how they're calculated.
3. Define one shared driver for every theme's graphic in a new `theme-engine.js` module: `intensity = f(streakLevel, monthPercent)` normalised to 0–1. Document the formula in `CLAUDE.md`. Every effect below reads from it, so all the themes respond the same way.

---

## 1. Rendering approach (applies to all themes)

- **Use hand-rolled WebGL2, not a 3D library.** A pyramid, a barbell and a fullscreen shader quad are simple enough geometry that a small custom renderer (target ≤ 20 KB for the engine) does the job. Three.js and similar libraries add hundreds of KB to an app whose spec says no heavy libraries. If you can't make hand-rolled WebGL work for one effect, write down why in `DECISIONS.md` before you add any dependency.
- **Fallback:** if WebGL2 is unavailable or context creation fails, fall back to the existing 2D canvas/CSS version of that theme. Never fall back to a blank background.
- **Context loss:** handle `webglcontextlost`/`webglcontextrestored` so the scene recovers instead of freezing.
- **Device pixel ratio:** render at `min(devicePixelRatio, 2)` for sharpness, capped so high-DPI phones don't render 4× the pixels.
- **Frame budget:** 30 fps cap in normal view, 60 fps allowed only in full-screen view (§3). Target under ~5% CPU on a mid-range Android phone in normal view. Measure it and record it.
- **Pause rules stay the same:** pause when backgrounded, pause during voice recognition, show a static frame under `prefers-reduced-motion`, and respect the "reduce background effects" and "Pause activity effects" toggles.

### Flash-safety rule (applies to every lightning effect)

Brighter, faster lightning is the point of this pass, and it's also where a real hazard sits. Enforce the WCAG 2.3.1 limit in code, not just in the design: **no more than 3 flashes in any 1-second window**, at any intensity. Large full-brightness flashes covering a big part of the screen also count. Put a central `flashLimiter` in `theme-engine.js` that every lightning effect must request a flash through. Turning up intensity increases branching, bolt count spread over time and glow, **never** the flash rate past the cap. Add an automated test that runs maximum intensity for 10 s and asserts the cap is never exceeded.

---

## 2. Theme upgrades

### Kemet (flagship): 3D rotating pyramid with halo lightning

- **3D pyramid:** a properly lit, rotating pyramid with a square base, slow Y-axis rotation and a slight downward camera tilt so the apex and two faces are visible. Positioned in the bottom third of the Today view as before.
- **The 10 power tiers stay.** They render as horizontal bands on the 3D faces and light cumulatively per `streakLevel`. They must still be easy to count, including on the static reduced-motion frame.
- **Progress drives all of the following** (all smoothly interpolated, no snapping):
  - **Rotation speed:** slow at low intensity, faster at high intensity. Cap the maximum at roughly one revolution per 8 s so it never spins fast enough to be disorienting.
  - **Glow:** emissive tier glow and an apex bloom that strengthen with intensity.
  - **Particles:** golden spark particles from the halo, more of them and travelling further as intensity rises (keep the existing 25/50/90–100% `monthPercent` staging).
  - **Lightning:** branching bolts from the glowing halo down to the pyramid apex/faces. More branching and more frequent strikes with progress, always within the flash limiter.
- **Halo:** a glowing ring above the apex, rendered as an additive-blended torus or billboard ring, brightening per `monthPercent`.
- **Palette:** cyberpunk Egypt, with gold, cyan and violet emissives on a deep night background, and neon hieroglyph detailing on the faces as a subtle texture.

### Forge: 3D rotating barbell, heat shader

- Swap the flat silhouette for a 3D barbell (cylinders for bar and sleeves, discs for plates) rotating slowly on its long axis.
- **Heat:** a shader-based heat glow on the bar running dull red → orange → yellow → white-hot, driven by `monthPercent` (existing thresholds kept). Add heat-haze distortion above the bar at high intensity.
- **Embers:** GPU particles rising from the bar. Density, brightness and rise speed scale with intensity.
- **Rotation speed** scales with intensity, using the same cap as Kemet.
- Frost rules unchanged: calendar cells only, capped, gated behind established history.

### Fractal: GPU Mandelbrot shader with progress-driven zoom

- Move the Mandelbrot to a **fragment shader**. That fixes the earlier CPU-cost concern, because the GPU computes it per pixel almost for free compared with CPU rendering.
- **Progress = depth:** as intensity rises, the view slowly zooms toward a fixed, visually rich coordinate (e.g. Seahorse Valley). Iteration count and colour saturation rise with it, so the set literally gets sharper and more detailed as the user progresses. Clamp the iteration count for mobile GPUs.
- Slow colour-cycle palette animation. Lightning bolts trace the set's boundary, more frequent with intensity, through the flash limiter.
- Use `highp` precision where available. Clamp zoom depth to whatever stays artefact-free on mobile `mediump`, and test on the device.

### Terminal: depth and data velocity

- Replace the barely visible flat glyph layer with a **3D perspective data field**: glyph columns or a receding grid drawn with real depth (near glyphs larger and brighter, far ones dim and blurred).
- **Data velocity** (stream speed and density) scales with intensity, and occasional "packet bursts" travel along the grid at high intensity.
- Tune it so it's clearly visible at default settings, which is the earlier bug. Check it in screenshots (§5), not by reading the code.

### Light and High-Contrast Neon

Leave them as they are. They're the calm, static choices, and that's a deliberate option to offer.

---

## 3. Full-screen graphic view (new)

- Add a **"View" button** (icon plus accessible label, e.g. "View Kemet graphic full screen") on the Today screen for any animated theme.
- Tapping it opens the theme's graphic **fully displayed**: no frosted panels, no nav, with the scene re-framed so the whole pyramid, barbell or fractal fills the viewport. Use the Fullscreen API where supported and a fixed full-viewport overlay where it isn't.
- Show a small, unobtrusive overlay with the current level (e.g. "Tier 6 of 10 · 58% this month"). The user can hide it with a tap.
- Exit options: a visible close button, Esc, and the Android back gesture/button (use the History API so back closes the view instead of leaving the app).
- In full-screen view, allow 60 fps and drag-to-rotate on the 3D scenes (Kemet and Forge). Releasing resumes auto-rotation.
- All the safety rules still apply: the flash limiter, reduced-motion static frame, and pausing when backgrounded.
- Accessibility: focus moves into the view when it opens and returns to the "View" button when it closes, and every control is keyboard-operable.

---

## 4. Reserved for a later build (do NOT build now): class and PT attendance

Add the data hook only, so the later feature doesn't need a migration:

- Add `sessionType` to `Session`: `gym | run | class | pt`, defaulting to the type implied by existing data. Existing sessions migrate to `gym` or `run`.
- Leave optional, unused fields on `Session`: `className`, `instructor`, `location`, `attendance` (`attended | missed | cancelled`).
- Write a short spec in `ROADMAP.md` for the later build covering: logging a class or PT session (name, instructor or trainer, location, duration, attended/missed/cancelled); classes and PT counting toward `streakLevel`/`monthPercent` when attended; a cancelled class never counting as a lapse; and attendance appearing in the weekly text summary.

Build nothing user-facing for this now. Only the schema fields and the migration.

---

## 5. Visual verification (mandatory, this is what was missing before)

1. Use a headless browser (Playwright with Chromium, installed as a dev tool only and not shipped to the site) against a local server **and** the live Pages URL.
2. For each animated theme, seed simulated data at intensity **0, 0.5 and 1.0**, then capture screenshots of the Today view and the full-screen view. Save them to `docs/screenshots/`. They're the evidence that each effect renders and scales.
3. Check two frames ~500 ms apart and assert the pixels differ, which proves the animation is actually running and not frozen.
4. Run with `prefers-reduced-motion: reduce` emulated and assert that the frames are identical and the tiers are still visible.
5. Contrast: assert ≥ 4.5:1 for text over the graphic at intensity 0 and 1.0.
6. Embed the screenshots in a new `VISUALS.md` so I can look at the results without running anything.
7. Add to `MANUAL_TEST.md` the single on-phone check: open each theme on the Android phone, confirm it animates smoothly and the phone doesn't heat up, and check the full-screen view and back-button exit.

---

## Acceptance additions

- [ ] `theme-engine.js` with documented `intensity` formula; all themes read from it.
- [ ] Hand-rolled WebGL2 engine ≤ ~20 KB, or the deviation is justified in `DECISIONS.md`. 2D fallback works with WebGL disabled.
- [ ] Kemet: 3D pyramid rotates, 10 tiers countable, and rotation, glow, particles and halo-to-pyramid lightning all scale with intensity. Rotation capped.
- [ ] Forge: 3D barbell, heat shader red→white per `monthPercent`, embers scale with intensity.
- [ ] Fractal: GPU shader, zoom/detail increase with intensity, no visible precision artefacts at max zoom.
- [ ] Terminal: clearly visible at default settings (confirmed by screenshot).
- [ ] Flash limiter enforced: automated 10 s max-intensity test shows ≤ 3 flashes in any 1 s window for every theme.
- [ ] Full-screen view works with Fullscreen API and fallback; close button, Esc and Android back all exit; focus handled; drag-to-rotate on Kemet and Forge.
- [ ] Screenshots at 0 / 0.5 / 1.0 for every animated theme in `docs/screenshots/` and `VISUALS.md`; animation-running and reduced-motion assertions pass.
- [ ] CPU measured and recorded per theme; anything over budget is simplified.
- [ ] `sessionType` plus reserved attendance fields added with migration; nothing user-facing built. `ROADMAP.md` spec written.
- [ ] Existing suite still green (weight-display regression, no-audio-persistence, weekly summary, passcode gate, noindex).
- [ ] Footprint still < 50 MB. Playwright is a dev dependency only and is not deployed.
- [ ] Committed, pushed to `origin main`, live Pages site re-verified (200, manifest + service worker load from `/reptrack/`), and a service worker cache version bump so installed PWAs pick up the update.
