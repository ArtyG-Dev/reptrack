# Claude Code — Follow-up Prompt: Exercise Categories, Collapsible Panels, Colour Schemes

RepTrack is built and deployed at `https://artyg-dev.github.io/reptrack/`. Add the following as an incremental update — commit and push through the same repo, same self-test discipline as before (update `ACCEPTANCE.md`, re-verify Pages deployment after changes, don't regress existing tests).

---

## 1. Calisthenics, yoga, and pilates support

Extend the exercise/logging model rather than replacing it:

- Add a `category` field to `Exercise`: `strength | cardio | calisthenics | yoga | pilates` (extensible list, not hardcoded to five forever).
- Add a `mode` field to `Exercise`: `reps` (existing weight/reps/sets logging — covers strength *and* calisthenics, since calisthenics is just bodyweight reps/sets with optional added weight) or `hold` (duration-based — covers yoga poses and pilates holds: pose name, hold duration, optional side left/right, optional rounds).
- `SetEntry` gains an optional `holdSeconds` field alongside the existing weight/reps, used only when `mode = hold`. Don't touch or rename existing fields — this is additive, existing strength/cardio data must keep working unchanged.
- Seed the local exercise dictionary with a reasonable starter set per new category (e.g. calisthenics: push-up, pull-up, dip, pistol squat, plank; yoga: downward dog, warrior II, child's pose; pilates: hundred, roll-up, plank series) — keep it small, users can add their own.
- Voice grammar: extend parsing for hold-mode phrases — "plank for 60 seconds", "downward dog 30 seconds each side" — alongside the existing rep-mode grammar. Same confirm-before-commit rule applies.
- Progress charts: for `hold` mode, chart hold duration over time instead of weight.

## 2. Collapsible sub-panels

- On the **Exercises** screen, group exercises by `category` into collapsible sections (tap header to expand/collapse), collapsed by default except the category most recently used.
- On the **Active Session** screen, group logged exercises by category the same way once more than one category appears in a session, so a mixed strength+yoga session doesn't just become a long flat list.
- Persist collapsed/expanded state per section in `Settings` (or localStorage-equivalent in IndexedDB) so it doesn't reset every visit.
- Accessibility: panels must be keyboard-operable (Enter/Space to toggle) and use `aria-expanded` correctly — don't just hide content with CSS, use proper disclosure semantics.

## 3. Two colour schemes

Add a **Settings** toggle: **Light** (default) and **High-Contrast Neon**.

- Build both as sets of the existing semantic CSS custom properties (per the original spec's theming approach) — no component should hardcode colours outside the variable set, so the toggle is a single swap at the root.
- **Light:** clean, minimal, soft neutrals — matches the calm, simple-graphics brief from Phase 1.
- **High-Contrast Neon:** dark background, saturated neon accent colours (e.g. electric green/cyan/magenta) for key actions and data (PRs, active timers, chart lines) — bold and energetic, but:
  - Every text/background pairing must still meet **≥ 4.5:1 contrast** (WCAG AA) — verify with the same automated contrast check used in the original acceptance tests. "Neon" must not mean "fails accessibility."
  - No flashing, strobing, or animated glow effects — static styling only, since motion/flicker can be a genuine accessibility and safety issue, not just a taste question.
  - Respect `prefers-reduced-motion` as already required in the base spec.
- Store the chosen theme in Settings so it persists across sessions; apply it immediately without reload.
- Add both themes to the Lighthouse accessibility check already in the acceptance loop — both must score ≥ 90, not just the default.

## Acceptance additions

- [ ] Calisthenics/yoga/pilates exercises loggable in both `reps` and `hold` modes; existing strength/cardio logging unaffected.
- [ ] Voice logging handles at least one hold-mode phrase correctly.
- [ ] Exercise list and active-session view group into collapsible, keyboard-accessible, `aria-expanded`-correct panels.
- [ ] Collapsed/expanded state persists.
- [ ] Light and High-Contrast Neon themes both selectable, both persist, both pass Lighthouse a11y ≥ 90 and 4.5:1 contrast checks, no flashing/strobing.
- [ ] Footprint still reported < 50 MB after these additions.
- [ ] Pages deployment re-verified live at `https://artyg-dev.github.io/reptrack/` after merge.
