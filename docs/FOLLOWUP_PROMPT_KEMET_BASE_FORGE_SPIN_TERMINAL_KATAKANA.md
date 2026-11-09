# Claude Code — Follow-up Prompt: Kemet Pyramid Base, Forge Default Rotation, Terminal Katakana

Three small, separate changes. Touch only what each one needs. Don't change the metrics, the intensity driver or any other theme. Commit after each change, push to `origin main`, bump the service worker cache version, and re-verify the live site at `https://artyg-dev.github.io/reptrack/`.

---

## 1. Kemet: give the pyramid a solid base with the maker's mark

**Problem:** the pyramid has no bottom face, so when it's manually rotated in full-screen view the underside looks hollow.

**Diagnose first** and record the cause in `DECISIONS.md`. Most likely the base face is missing from the mesh, or it exists but is culled because its winding order makes the normal point inward.

**Fix:**
- Add a flat square base face that closes the pyramid, with correct winding and an outward normal pointing down. It should be lit like the rest of the model, not left black or unlit.
- Material: dark stone or metal in the Kemet palette.
- Inscribe this text on the base:

  **`RepTrack © ArtyG-Dev`**

  Render `(c)` as the `©` symbol. Draw the text once to a canvas texture, cache it, and map it to the base face. Don't add a font file. Use a system font stack.
- Style: a soft gold or cyan glow, like an engraved inscription, so it looks part of the theme rather than a label stuck on.
- It must read correctly, not mirrored, when you look up at the base from below. Centre it on the face.
- It only needs to be visible when the pyramid is rotated to show its underside. The default camera angle stays the same, so the text doesn't appear in normal Today view.
- Under reduced motion with no manual rotation, nothing changes. The base is simply there.

**Check:** screenshot the pyramid in full-screen view, rotated to show the underside. The base must be solid, the text legible and not mirrored, with no gaps at the edges where the base meets the faces.

---

## 2. Forge: barbell rotates by default, opposite direction to Kemet

**Change:** the barbell's default auto-rotation becomes a turn in the horizontal plane. The bar stays level and spins like it's on a turntable (around the vertical axis), showing the front, the end-on view and the back. It spins **in the opposite direction to the Kemet pyramid**, so the two themes feel different.

- Use the same rotation-speed scaling and maximum-speed cap as Kemet (driven by intensity, about one turn every 8 s at most).
- Remove or replace the old slow roll around the bar's own long axis. A round bar rolling on its axis barely looks like it's moving.
- Manual drag in full-screen view works as before, and on release the bar eases back into the new default spin.
- Reduced motion: no auto-rotation.
- Put the axis and direction in one clearly named constant, e.g. `FORGE_AUTO_ROTATION = { axis: 'vertical', direction: -1 }`. Note in `CLAUDE.md` that switching to an end-over-end tumble (rotation around the horizontal axis perpendicular to the bar) is a one-line change there.

**Check:** two frames about 1 s apart show the barbell rotating in the horizontal plane, in the opposite direction to Kemet's pyramid. Compare against a Kemet capture taken the same way.

---

## 3. Terminal: Japanese katakana instead of Latin letters

**Change:** replace the Latin letters in the Terminal data stream with Japanese katakana characters, mixing normal and horizontally mirrored ("inverted") glyphs.

- Character set: half-width katakana (U+FF66–U+FF9D) give the narrow, dense column look. Full-width katakana (U+30A1–U+30FA) can be mixed in if they look better at the rendered size. Choose one and note it in `DECISIONS.md`.
- **Inverted glyphs:** about half the glyphs, chosen at random per glyph and fixed for that glyph's lifetime, are mirrored horizontally (`scale(-1, 1)` when drawn). Don't flip them every frame, which would add flicker.
- If the stream currently contains digits, keep them. Only the letters are replaced.
- **Fonts and footprint:** don't bundle a CJK font file. Android ships with Noto Sans CJK, so use the system font stack: `"Noto Sans CJK JP", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif`. Check that the glyphs actually render and don't turn into tofu boxes (□). If a device has no katakana glyphs, fall back to the old Latin set rather than showing boxes.
- **Performance:** draw the glyph set once into a cached texture/atlas, including the mirrored versions, and sample from it. Don't call `fillText` per glyph per frame.
- Keep everything else that's already working: depth, data velocity scaling with intensity, visibility tuning, the reduced-motion static frame and the flash limiter.

**Check:** screenshot the Terminal theme at intensity 0.5. Katakana are visible with a mix of normal and mirrored glyphs, and none render as boxes. Also capture the forced fallback path with katakana unavailable, to confirm it switches to the Latin set.

---

## Acceptance additions

- [ ] Kemet: cause of the hollow underside documented. The base is solid and lit, and the `RepTrack © ArtyG-Dev` inscription is legible, not mirrored, from below. No edge gaps.
- [ ] Forge: the default spin is horizontal-plane (vertical axis) and opposite in direction to Kemet. Speed is scaled by intensity and capped. The axis and direction are in one constant, documented in `CLAUDE.md`.
- [ ] Terminal: katakana replace the Latin letters, with a roughly even mix of normal and mirrored glyphs fixed per glyph. No tofu boxes. The fallback to Latin works. Glyphs come from a cached atlas.
- [ ] Screenshots for all three changes added to `docs/screenshots/` and `VISUALS.md`.
- [ ] CPU cost re-measured for Kemet, Forge and Terminal, and still within budget.
- [ ] Full existing acceptance suite still green.
- [ ] Footprint still < 50 MB (no font files added).
- [ ] Pushed, cache version bumped, live site re-verified.
- [ ] `MANUAL_TEST.md` updated with the on-phone checks:
  - Rotate the Kemet pyramid to see the base inscription.
  - Watch the Forge barbell spin opposite to Kemet.
  - Confirm the Terminal katakana render on your phone, not as boxes.
