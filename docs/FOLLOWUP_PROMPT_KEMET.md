# Claude Code — Follow-up Prompt: "Kemet" Theme + Prominent Streak-Responsive Graphics

Two things here: a new skin, and a change to how Fractal and Forge display their signature graphic. Both depend on the progression metric defined below — read that section first, it applies to all three skins.

---

## 0. The progression metric (read first — this changes an earlier decision)

The brief for these effects was described as a **consecutive-day training streak**. Implement it instead as a **rolling-window training-day count**, for a specific reason:

- A strict consecutive-day streak resets to zero on a single rest day, and implicitly rewards training **every** day. Rest days are physiologically necessary — muscle adapts during recovery, not during the session. A visual mechanic that only climbs when you train daily quietly pushes users toward overtraining, which directly conflicts with the over-activity guardrail already specified for Phase 4.
- **Implement:** `streakLevel` = training days within a rolling window (e.g. days trained in the last 14), mapped onto the visual scale. Sustained 4–5 sessions/week should be capable of reaching maximum level — daily training must not be required to max it out.
- A missed day causes **no reset** — the level eases down gradually only if activity genuinely drops off over the window.
- Document the exact formula in `CLAUDE.md`.
- Keep all existing protections: the "Pause activity effects" toggle freezes the level (illness, injury, holiday, deload); no scolding or lapse-quantifying copy anywhere; frost rules unchanged.

> If a strict consecutive-day count is ever specifically requested later, gate it behind an explicit opt-in setting rather than making it the default — and never let it be the only way to progress the visual.

---

## 1. New skin — "Kemet" (futuristic cyberpunk Egypt)

- **Aesthetic:** cyberpunk Egypt. Deep night-sky background, neon-hieroglyph accent detailing, gold/cyan/violet palette over the shared frosted-glass panel treatment.
- **Pyramid of Power:** a large pyramid, **fully visible in the bottom third of the Today view** (not a faint background wash — it's a focal element, with the glass panels sitting above/around it).
- **Ten discrete levels:** the pyramid is divided into 10 horizontal tiers that light up cumulatively as `streakLevel` rises. This is the skin's core mechanic — discrete, countable levels give a beginner unmistakable visible progress in a way a continuous glow doesn't.
  - Level transitions should be a satisfying but brief illumination — a smooth light-up, no strobe, no long fanfare animation.
  - Lit tiers stay lit while the level holds; if the level eases down, tiers dim gradually rather than snapping off.
- **Lightning crawl:** electrical arcs crawling across the pyramid surface, **intensity scaling with `streakLevel`** — sparse faint crawl at low levels, dense bright arcing at high levels.
  - Same flicker-hazard cap as the Fractal skin's lightning: brief flashes, hard frequency ceiling even at maximum intensity, no rapid strobing.

## 2. Forge — make the barbell prominent and streak-responsive

- The background barbell/dumbbell graphic moves from faint-background to **fully visible in the bottom third of the Today view**, same treatment as the pyramid.
- **Brightness and clarity scale with `streakLevel`:** dim and softly defined at low levels → bright, sharp, and clearly rendered at high levels.
- Existing ember/flame behaviour continues to scale alongside it (embers and flame intensity as previously specified).

## 3. Fractal — make the Mandelbrot prominent and streak-responsive

- The Mandelbrot set renders **fully visible in the bottom third of the Today view**.
- **Intensity, clarity, and visibility scale with `streakLevel`** — faint and low-detail at low levels → vivid, sharply resolved, more visible at high levels.
- Existing lightning behaviour continues to scale alongside it.

---

## Constraints that still apply to all of the above

- Contrast floor of **≥ 4.5:1** for all text, verified against these now-more-prominent graphics at *both* extremes of the level range. A brighter, sharper graphic in the bottom third makes this harder — if text sits over that region, strengthen the scrim rather than dropping contrast.
- `prefers-reduced-motion` renders a **static** version (pyramid still shows correct lit levels; no crawl, no flicker, no morph).
- Auto-pause when backgrounded and during voice recognition.
- CPU budget unchanged — a Mandelbrot render and a particle/arc system are both capable of blowing it. Pre-render or cache where possible; do not compute a full Mandelbrot per frame.
- No flashing or strobing anywhere, at any level.
- Footprint still < 50 MB — no video assets, no heavy libraries.

## Acceptance additions

- [ ] `streakLevel` implemented as a rolling-window training-day count (not consecutive-day reset), formula documented in `CLAUDE.md`; verified that 4–5 sessions/week can reach maximum level.
- [ ] Verified a single rest day does **not** reset or visibly drop the level.
- [ ] Kemet skin selectable, persists, applies without reload.
- [ ] Pyramid fully visible in bottom third of Today view; all 10 tiers light cumulatively and correctly across simulated levels 0–10.
- [ ] Lightning crawl scales with level; flash frequency cap recorded.
- [ ] Forge barbell and Fractal Mandelbrot both fully visible in bottom third and scale in brightness/clarity across simulated levels.
- [ ] Contrast ≥ 4.5:1 verified at minimum and maximum level for all three skins.
- [ ] Reduced-motion static fallback correct for all three (pyramid tiers still readable).
- [ ] CPU cost re-measured for all three post-change; any skin over budget is simplified.
- [ ] "Pause activity effects" toggle still freezes level progression correctly.
