# Claude Code — Follow-up Prompt: Three Animated Frosted-Glass Skins

Add three further theme options alongside the existing **Light** and **High-Contrast Neon**. All three share a frosted-glass (backdrop-blur) panel treatment over an animated background layer. Same rules as the existing themes: built from the semantic CSS custom property set, selectable in Settings, persisted, applied without reload.

---

## Shared constraints (apply to all three — non-negotiable)

- **Performance budget:** background animation must stay under ~5% CPU on a mid-range Android device and must not meaningfully affect battery during a session. Prefer CSS animations and lightweight canvas over per-frame JS work. Cap at 30fps — these are ambient, not games.
- **Auto-pause:** animation pauses when the tab/app is backgrounded (`visibilitychange`), and pauses during active voice recognition (animation work must never compete with speech processing or interrupt audio).
- **`prefers-reduced-motion`:** must render a **static** version of each background — not a slowed one. This is a genuine accessibility need, not a preference toggle.
- **Contrast floor holds:** all text over frosted glass must still meet **≥ 4.5:1**. Backdrop-blur plus a sufficiently opaque scrim — verify with the existing automated contrast check, on the *animated* background at its lightest and darkest states, not just a static frame.
- **No flashing or strobing.** Sparks and glows must be smooth and slow. Nothing that could read as a flicker hazard.
- Each theme needs a manual "reduce background effects" toggle in Settings for anyone who wants the skin but not the motion.

---

## Skin 1 — "Terminal" (frosted glass over looping digital activity)

- Background: subtle looping digital/data motion behind the glass — drifting code-like glyphs, scrolling data streams, or a soft grid pulse. Kept low-contrast and slow so it reads as texture, not content.
- Palette: cool, dark, muted. The glass panels are the focus; the background is atmosphere.
- Implementation: CSS-animated layers or a lightweight canvas loop. No video files (footprint).

## Skin 2 — "Fractal" (frosted glass over morphing fractal, brightness tied to activity)

- Background: a slowly morphing fractal/organic pattern.
- **Activity-responsive brightness:** overall background lightness scales with recent training consistency — darker when activity is low, progressively lighter as consistency builds. Use the same consistency metric defined for Skin 3 below so the two behave coherently.
- Keep the morph slow (a full cycle over tens of seconds, not seconds) — this is ambient.
- Implementation: CSS gradients/filters or a cheap canvas shader-style effect. Avoid a real WebGL shader unless it comes in under the performance budget and degrades gracefully.

## Skin 3 — "Forge" (frosted glass over an oversized dumbbell, heat responds to consistency)

The flagship. Frosted glass panels over a large, faint background dumbbell, with orange/red/yellow sparks — the visual metaphor being a body being reforged.

### Base state
- Oversized dumbbell silhouette, low-opacity, behind the glass.
- Faint warm sparks drifting around panel edges.

### Consistency-responsive behaviour (the easter egg)
Define a single **consistency score** (documented in `CLAUDE.md`) derived from recent training frequency over a rolling window — e.g. sessions in the last 14 days relative to the user's own established baseline, not a fixed target. Drive the visuals from it:

- **Rising consistency:** dumbbell glows hotter (deeper orange → yellow-white at sustained high consistency); edge sparks grow more frequent and brighter.
- **Falling off:** glow cools gradually back toward the base state. This should be **gentle and slow** — a single missed day should be barely perceptible, not a visible punishment.
- **Extended inactivity:** a light frost effect may appear on calendar days that follow a period of activity.

### Frost rules — implement these carefully

1. **New users never see frost.** Frost only becomes possible after the user has established a genuine activity history (require at least ~3–4 weeks of logged use *and* a prior run of consistent sessions). Someone starting out, or returning after a long absence, sees only the warm states.
2. **Frost has a cap.** It reaches a mild, frosted-edge visual state and **stops there** — it must never deepen indefinitely into something that feels like accumulating failure. Cosmetic hint, not a scoreboard of shame.
3. **Rest/recovery pause:** add a Settings toggle — "Pause activity effects" — that freezes the visual state (no cooling, no frost) without erasing history, for illness, injury, holidays, or deliberate deload. Make it easy to find and reversible. This mirrors the Phase 3 holiday-pause principle already in the roadmap.
4. **Frost applies to calendar day cells only** — never to the logging UI, never to progress charts. Someone opening the app to log their comeback session must not be met with a frozen interface.
5. **Tone check on all copy:** no text anywhere that scolds, guilt-trips, or quantifies the lapse ("you've missed 9 days"). The visual is ambient feedback; it says nothing.

> Design principle to hold to throughout: this effect should make consistency feel *rewarding*, never make a gap feel *punishing*. If a visual state would make someone feel worse about opening the app after a hard month, soften it. The whole point is that they open it.

---

## Acceptance additions

- [ ] All three skins selectable in Settings, persist across sessions, apply without reload.
- [ ] All three pass Lighthouse a11y ≥ 90 and 4.5:1 contrast at both extremes of their animation range.
- [ ] `prefers-reduced-motion` renders a static background for each — verified, not assumed.
- [ ] Animation auto-pauses when backgrounded and during voice recognition.
- [ ] Measured CPU cost of each skin recorded in `ACCEPTANCE.md`; any skin exceeding the budget is simplified, not shipped as-is.
- [ ] Forge consistency score documented in `CLAUDE.md`; glow scales with it.
- [ ] Frost gated behind established history — verified with a simulated new-user profile (must show no frost) and a simulated lapsed-veteran profile (may show capped frost).
- [ ] Frost caps at its mild state and does not deepen further with longer gaps.
- [ ] "Pause activity effects" toggle present, prominent, and freezes cooling/frost without data loss.
- [ ] No scolding or lapse-quantifying copy anywhere in the theme layer.
- [ ] Footprint still < 50 MB with all skins included (no video assets, no heavy libraries).
