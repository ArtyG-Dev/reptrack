# Claude Code — Follow-up Prompt: Fix Skin Animations + Revise Fractal & Forge Effects

Live testing on the deployed site (`https://artyg-dev.github.io/reptrack/`) found real problems with the three new skins — this needs a proper diagnosis, not just a re-skin on top of broken plumbing.

## Bugs to fix first

- **Terminal:** animation is barely visible. Check actual rendered opacity/contrast of the background layer against the frosted-glass scrim — it may be getting nearly fully obscured by the blur/scrim, or the animation may be running at too low an amplitude to read. Verify by rendering the background layer alone (scrim off) to confirm the animation itself works, then reintroduce the glass and tune opacity until it's *subtly visible*, not invisible.
- **Fractal and Forge: animations do not appear to run at all.** Debug properly, don't just replace the effect and hope:
  - Confirm the animation code is actually wired into the theme-switch logic — check whether selecting these themes correctly mounts/starts the background layer (canvas or CSS animation) rather than only swapping colour variables.
  - Check the browser console for errors on theme switch (a broken canvas context, a CSS animation targeting a class that isn't applied, a JS error silently killing the render loop).
  - Confirm `prefers-reduced-motion` handling isn't accidentally forcing the *static* fallback for everyone — test with that OS setting off.
  - Confirm the auto-pause-when-backgrounded logic isn't misfiring and treating the page as backgrounded when it isn't (e.g. wrong `visibilitychange` condition), which would leave it permanently paused.
  - Once the root cause is found, note it briefly in `DECISIONS.md` so it doesn't regress again.

## Revised effect for Skin 2 — Fractal → lightning instead of sparks

Replace the described spark treatment with **lightning**:
- Thin, jagged, branching bolts flickering across or through the fractal background — irregular timing (not a smooth loop), which suits lightning's naturally erratic feel far better than a steady particle system.
- **Intensity scales with the consistency score** (same score already defined for Forge): low consistency → rare, faint, single-branch flickers; high consistency → more frequent bolts, brighter flashes, more branching.
- **Hard rule: no rapid strobing.** Real lightning is a flicker hazard risk if overdone — cap flash duration and frequency (e.g. no more than one bolt-flash per few seconds even at max intensity), keep individual flashes brief but not jarring, and this must be included in the flicker/strobe check already required for all skins. If in doubt, make it calmer, not flashier.
- Keep the fractal's existing brightness-scales-with-consistency behaviour underneath — lightning is additive, not a replacement for that.

## Revised effect for Skin 3 — Forge → flickering embers and glowing flame instead of sparks

Replace the drifting-spark treatment with **embers and flame**:
- Small ember particles that drift and flicker (gentle upward motion, fade out) around the panel edges and the dumbbell silhouette.
- A soft glowing flame/heat-shimmer effect on the dumbbell itself rather than just a colour-shift glow — subtle flame-lick shapes or a heat-haze distortion at the head of the dumbbell.
- **Intensity scales with the consistency score:** low consistency → a few faint embers, dim glow, no visible flame; high consistency → denser ember flicker, brighter sustained flame.
- Keep all previously-specified rules intact: gentle cooling on lapses, frost cap, frost gated behind established history, "Pause activity effects" toggle, calendar-cells-only frost, no scolding copy, no strobing.

## Acceptance additions

- [ ] Terminal animation confirmed visible (not just present in code) at default opacity — spot-check against the contrast/visibility bar, not just "renders."
- [ ] Fractal animation confirmed actually running post-fix, with lightning effect scaling visibly across at least three consistency levels (low/mid/high) in a manual or scripted test.
- [ ] Forge animation confirmed actually running post-fix, with ember/flame intensity scaling visibly across the same three levels.
- [ ] Root cause of the Fractal/Forge non-render bug documented in `DECISIONS.md`.
- [ ] Lightning flash frequency/duration checked against the flicker-hazard rule — record the cap values used.
- [ ] Re-run the full existing skins acceptance checklist (contrast at extremes, reduced-motion static fallback, auto-pause, CPU budget) since these are substantive changes, not cosmetic tweaks.
