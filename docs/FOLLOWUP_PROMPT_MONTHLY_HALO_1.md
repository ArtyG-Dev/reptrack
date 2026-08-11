# Claude Code — Follow-up Prompt: Monthly-Progress Halo (Kemet) & White-Hot Bars (Forge)

Adds a second, independent progression effect to Kemet and Forge, layered on top of the existing `streakLevel` (rolling-window) system already driving the pyramid tiers and barbell brightness/clarity. Do not replace or conflate the two metrics — they coexist.

---

## 0. Define `monthPercent` (new metric)

`monthPercent` = (distinct training days so far this calendar month) ÷ (calendar days elapsed so far this month, i.e. today's date-of-month number).

**Use elapsed days, not total days in the month.** If it were measured against the full month, someone training every single day for the first week could only ever reach ~23% (7/30) regardless of consistency — the effect would stay dark through no fault of theirs until well past mid-month. Measuring against days elapsed means a perfect run always reads 100%, on any day of the month. This is the correct read of "25%/50%/90-100% of a month" for a motivating effect — implement it this way, not the naive full-month-denominator version.

- Recalculates daily.
- At the month boundary, resets for the new month. Make the reset a gentle fade rather than an abrupt cut — the halo/bar-glow shouldn't visibly slam off at midnight on the 1st. Fade out over the first day or two of the new month as `monthPercent` naturally starts low, rather than snapping instantly.
- Document the formula in `CLAUDE.md` alongside the existing `streakLevel` formula, and clearly note these are two separate, independently-tracked metrics.
- Same "Pause activity effects" toggle applies — pausing freezes `monthPercent` progression too, not just `streakLevel`.

---

## 1. Kemet — golden halo effect

Layered above the existing pyramid (which continues to show its 10 tiers per `streakLevel`, unchanged).

- **`monthPercent` ≥ 25%:** a faint glowing halo appears above/around the pyramid apex, gently dropping small golden spark particles.
- **`monthPercent` ≥ 50%:** halo brightens; add crawling lightning within/around the halo itself (distinct from the existing pyramid-surface lightning tied to `streakLevel` — this is a second, halo-specific lightning layer).
- **`monthPercent` 90–100%:** halo at its brightest; sparks spill outward beyond the halo's edge; visible lightning **strikes between the halo and the pyramid** — a connecting arc, not just ambient crawl.
- Interpolate smoothly between thresholds rather than snapping — a jump from 24% to 25% shouldn't be a hard cut from nothing to visible.
- Same flicker-hazard cap as all prior lightning effects: capped flash frequency/duration even at maximum intensity, no rapid strobing.

## 2. Forge — white-hot bars

Layered above the existing barbell (which continues to respond to `streakLevel` for its base brightness/clarity, unchanged).

- **`monthPercent` ≥ 25%:** the barbell's bars (the rod/sleeves, not just the plates) gently glow.
- **`monthPercent` ≥ 50%:** glow intensifies, moving toward a warmer/hotter colour.
- **`monthPercent` 90–100%:** bars glow white-hot — shift the glow colour through the natural heat progression (dull red → orange → yellow → white) rather than jumping straight to white at 90%, so the climb feels earned.
- Interpolate smoothly across the range, same reasoning as Kemet.
- Continue to layer with the existing ember/flame effects already specified — this is additive, not a replacement for those.

---

## Constraints (unchanged, restated because these are substantive new visual layers)

- Contrast ≥ 4.5:1 for all text, checked at `monthPercent` = 0% and 100% combined with `streakLevel` at its own min and max — these two metrics can now be independently high or low, so test the actual combinations (e.g. low streak + high month-percent), not just the two extremes in isolation.
- `prefers-reduced-motion`: static fallback must reflect the correct halo/glow *level* for both metrics — no crawl, no spark drop, no strike animation, but the right amount of glow/halo should still show statically.
- Auto-pause when backgrounded and during voice recognition.
- No flashing or strobing at any combination of levels.
- CPU budget holds — two independent animated layers per skin is more to render than before; re-measure and simplify if over budget.

## Acceptance additions

- [ ] `monthPercent` implemented against **elapsed days**, not total month days; formula documented in `CLAUDE.md` as distinct from `streakLevel`.
- [ ] Verified: training every day for the first 7 days of a month shows `monthPercent` at or near 100%, not ~23%.
- [ ] Month-boundary transition fades rather than snaps.
- [ ] Kemet halo present and correctly staged at 25/50/90–100% thresholds with smooth interpolation between them; halo-lightning distinct from pyramid-surface lightning.
- [ ] Halo-to-pyramid lightning strike visible only in the 90–100% band.
- [ ] Forge bar glow present and correctly staged at the same thresholds, with a believable dull-red→white heat-colour progression rather than a jump to white.
- [ ] Contrast checked across independent combinations of `streakLevel` and `monthPercent`, not just each metric's own extremes.
- [ ] Reduced-motion fallback reflects correct static glow/halo level for both metrics.
- [ ] CPU cost re-measured with both animated layers running simultaneously; simplified if over budget.
- [ ] "Pause activity effects" toggle freezes both `streakLevel` and `monthPercent`.
