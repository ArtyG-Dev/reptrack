# VISUALS.md — the 3D skins, shown rather than described

Every animated skin at three levels of progress, on the Today view and in the full-screen
graphic view. These are real renders, not mock-ups. Headless Chromium drew them through the
same WebGL2 code path a phone uses; the machine has no GPU, so SwiftShader ran those shaders
on the CPU. The pixels are the same, only the speed differs.

Regenerate with `npm run visuals` (local) or `npm run visuals -- --url <deployed site>`
(writes to `docs/screenshots/live/`). Each shot is set to its level by feeding the renderer
simulated metrics through `window.__backdrop.setActivity`:

| Shot | `streakLevel` | `monthPercent` | `intensity` |
|---|---|---|---|
| 0 | 0 | 0% | 0 |
| 0.5 | 5 | 50% | 0.5 |
| 1 | 10 | 100% | 1 |

`intensity = clamp(0.6 × streakLevel / 10 + 0.4 × monthPercent, 0, 1)`. It lives in
`js/theme-engine.js`, and `CLAUDE.md` explains the weighting.

---

## Kemet: rotating ten-tier pyramid, halo, sparks, halo-to-pyramid lightning

| | Today | Full screen |
|---|---|---|
| **0** | <img src="docs/screenshots/kemet-0-today.jpg" width="200" alt="Kemet at intensity 0, Today view"> | <img src="docs/screenshots/kemet-0-full.jpg" width="200" alt="Kemet at intensity 0, full screen"> |
| **0.5** | <img src="docs/screenshots/kemet-0_5-today.jpg" width="200" alt="Kemet at intensity 0.5, Today view"> | <img src="docs/screenshots/kemet-0_5-full.jpg" width="200" alt="Kemet at intensity 0.5, full screen"> |
| **1** | <img src="docs/screenshots/kemet-1-today.jpg" width="200" alt="Kemet at intensity 1, Today view"> | <img src="docs/screenshots/kemet-1-full.jpg" width="200" alt="Kemet at intensity 1, full screen"> |

At 0 the pyramid is unlit stone with neon hieroglyph detailing and countable seams, turning
slowly. At 0.5 five tiers are lit, the halo has appeared and sparks fall from it. At 1 all
ten tiers are lit, the apex blooms, the halo is at its brightest, and the sparks travel
further. The 1 Today shot caught a branching bolt from the halo down to the pyramid.

## Forge: 3D barbell, heat shader, embers, heat haze

| | Today | Full screen |
|---|---|---|
| **0** | <img src="docs/screenshots/forge-0-today.jpg" width="200" alt="Forge at intensity 0, Today view"> | <img src="docs/screenshots/forge-0-full.jpg" width="200" alt="Forge at intensity 0, full screen"> |
| **0.5** | <img src="docs/screenshots/forge-0_5-today.jpg" width="200" alt="Forge at intensity 0.5, Today view"> | <img src="docs/screenshots/forge-0_5-full.jpg" width="200" alt="Forge at intensity 0.5, full screen"> |
| **1** | <img src="docs/screenshots/forge-1-today.jpg" width="200" alt="Forge at intensity 1, Today view"> | <img src="docs/screenshots/forge-1-full.jpg" width="200" alt="Forge at intensity 1, full screen"> |

Cold iron at 0, still clearly a barbell. The bar and plates heat dull red, then orange, then
yellow, then white-hot as `monthPercent` climbs, using the existing thresholds. Embers get
denser and rise faster, and heat haze shimmers above the bar near the top of the range.

### Forge plates: `streakLevel` loads the bar

The bar starts bare and gains plates in matching pairs as the level rises, using the table
in `MANUAL_TEST.md` Check 2. Heat still follows `monthPercent`, so plates and heat are two
independent layers. These are held reduced-motion frames, so each shows exactly its level.

| | Level 0 | Level 3 | Level 6 | Level 10 |
|---|---|---|---|---|
| **Cool** (month 0%) | <img src="docs/screenshots/forge-plates-L0-cool.jpg" width="150" alt="Forge level 0, cool: bare bar"> | <img src="docs/screenshots/forge-plates-L3-cool.jpg" width="150" alt="Forge level 3, cool: one red plate per side"> | <img src="docs/screenshots/forge-plates-L6-cool.jpg" width="150" alt="Forge level 6, cool: two red plates per side"> | <img src="docs/screenshots/forge-plates-L10-cool.jpg" width="150" alt="Forge level 10, cool: four red plates per side"> |
| **White-hot** (month 100%) | <img src="docs/screenshots/forge-plates-L0-hot.jpg" width="150" alt="Forge level 0, white-hot"> | <img src="docs/screenshots/forge-plates-L3-hot.jpg" width="150" alt="Forge level 3, white-hot"> | <img src="docs/screenshots/forge-plates-L6-hot.jpg" width="150" alt="Forge level 6, white-hot"> | <img src="docs/screenshots/forge-plates-L10-hot.jpg" width="150" alt="Forge level 10, white-hot"> |

The colours stay distinct on a white-hot bar: red + green (level 4), red + blue (5), three
red + blue (9).

<img src="docs/screenshots/forge-plates-L4-hot.jpg" width="150" alt="Forge level 4, white-hot: red and green plates"> <img src="docs/screenshots/forge-plates-L5-hot.jpg" width="150" alt="Forge level 5, white-hot: red and blue plates"> <img src="docs/screenshots/forge-plates-L9-hot.jpg" width="150" alt="Forge level 9, white-hot: three red and one blue plate">

A plate caught mid-slide (level 3 → 4: the small green plate going on), and a drag in the
full-screen view (before, after):

<img src="docs/screenshots/forge-plates-sliding-on.jpg" width="150" alt="A small green plate sliding onto the sleeve mid-animation"> <img src="docs/screenshots/forge-drag-before.jpg" width="150" alt="Forge before a drag"> <img src="docs/screenshots/forge-drag-after.jpg" width="150" alt="Forge after a drag: tilted end-over">

## Fractal: GPU Mandelbrot, zooming toward Seahorse Valley

| | Today | Full screen |
|---|---|---|
| **0** | <img src="docs/screenshots/fractal-0-today.jpg" width="200" alt="Fractal at intensity 0, Today view"> | <img src="docs/screenshots/fractal-0-full.jpg" width="200" alt="Fractal at intensity 0, full screen"> |
| **0.5** | <img src="docs/screenshots/fractal-0_5-today.jpg" width="200" alt="Fractal at intensity 0.5, Today view"> | <img src="docs/screenshots/fractal-0_5-full.jpg" width="200" alt="Fractal at intensity 0.5, full screen"> |
| **1** | <img src="docs/screenshots/fractal-1-today.jpg" width="200" alt="Fractal at intensity 1, Today view"> | <img src="docs/screenshots/fractal-1-full.jpg" width="200" alt="Fractal at intensity 1, full screen"> |

At 0 the whole set is shown, desaturated and at 60 iterations. As intensity rises the view
zooms toward Seahorse Valley (−0.7436, 0.1318), iterations climb to 300 (the mobile cap)
and saturation rises. At 1 the seahorse spirals are resolved. The deepest zoom keeps about
20 float32 steps per pixel, so it stays free of precision blockiness.

## Terminal: perspective data field

| | Today | Full screen |
|---|---|---|
| **0** | <img src="docs/screenshots/terminal-0-today.jpg" width="200" alt="Terminal at intensity 0, Today view"> | <img src="docs/screenshots/terminal-0-full.jpg" width="200" alt="Terminal at intensity 0, full screen"> |
| **0.5** | <img src="docs/screenshots/terminal-0_5-today.jpg" width="200" alt="Terminal at intensity 0.5, Today view"> | <img src="docs/screenshots/terminal-0_5-full.jpg" width="200" alt="Terminal at intensity 0.5, full screen"> |
| **1** | <img src="docs/screenshots/terminal-1-today.jpg" width="200" alt="Terminal at intensity 1, Today view"> | <img src="docs/screenshots/terminal-1-full.jpg" width="200" alt="Terminal at intensity 1, full screen"> |

Glyph columns recede over a grid floor. Near glyphs are large and bright; far ones are small,
dim and blurred. Progress is shown in four ways at once, so it reads in a still frame and not
only in motion:

| | 0 | 0.5 | 1 |
|---|---|---|---|
| Columns falling | 35% | ~68% | 100% |
| Columns led by a glowing head | 12% | ~56% | 100% |
| Trail length | 6 glyphs | 10 | 14 |
| Packet bursts along the grid | none | yes (from 0.3) | yes |
| Fall speed | 0.9× | 2.1× | 3.3× |

Measured over 12 frames at each level: bright-glyph coverage is **0.24% → 0.99% → 4.77%** of
the screen, and average light is 28 → 32 → 51. At 0 it is sparse but readable, which keeps the
original "clearly visible at default" fix. (Any single still is a lottery about where the
columns happen to be, which is why those numbers are averaged.)

---

## What the tests prove from real pixels

Screenshots show what it looks like. These assertions show it is true every time, and they
run on every `npm test` (`tests/visuals.test.js`, plus the pixel tests in
`tests/browser.test.js`):

| Claim | How it is checked |
|---|---|
| Every skin renders through WebGL2, at `min(devicePixelRatio, 2)` | Diagnostics report `webgl2`; at DPR 3 the backing store is exactly 2× CSS pixels |
| The animation is running, not frozen | Two screenshots 500 ms apart differ, on Today and full screen, for every skin |
| Reduced motion holds still, and tiers stay countable | Under `prefers-reduced-motion` two screenshots are byte-identical. On Kemet, all 9 tier seams are counted from the pixel column through the front face |
| Text over the graphic stays readable | At intensity 0 and 1, every text element on Today and in full screen is checked against the glass composited over the real backdrop pixels behind it: ≥ 4.5:1 |
| No frame exceeds the declared luminance ceiling | Every pixel of every skin at five metric combinations is ≤ `--backdrop-ink` |
| Flash safety (WCAG 2.3.1) | 10 s at maximum intensity on all four skins in real Chromium never puts more than 3 flashes in a 1 s window. Same in `tests/theme-engine.test.js` at 30 and 60 fps |
| Rotation is capped | Rotation speeds up with intensity and never exceeds 2π/8 rad/s |
| It scales with progress | Kemet/Forge get brighter with the level; the month layer moves on its own; Fractal's zoom, iterations, saturation and edge detail all rise; Terminal carries more light |
| WebGL2 unavailable → the old 2D skins, never blank | `webgl2` forced unavailable: the 2D renderer animates and the frame is not blank |
| Context loss recovers | `WEBGL_lose_context` hands over to 2D (still animating), and restore brings the 3D scene back |
| Drag turns both 3D scenes visibly | One shared orbit. A drag changes >2% of the frame; right moves the near side right; up tilts the near end up and the far end down. It holds while dragging, eases back after release, and stays put under reduced motion |
| Forge plates | Plates per level match the table (Today and full screen), the bar ends never clip, plate colours stay > 60 RGB apart at heat 0 and 1, slide-on and fade-off are seen mid-animation, and a level gained between visits replays once |
| Full-screen view | Focus moves in and returns to **View**; Esc, ✕ and browser back all close it (back stays in the app); a fixed overlay covers the viewport without the Fullscreen API; drag rotates Kemet/Forge, holds auto-rotation and resumes it on release |

## CPU, measured honestly

`npm run skins`, recorded in `ACCEPTANCE.md`. The headless machine has **no GPU**, which
splits the numbers in two:

| | What it measures | Result |
|---|---|---|
| App JavaScript on the main thread | What RepTrack's own code costs per frame | **+0.7–0.9% of a core** per skin, inside the +5% gate |
| Main-thread total | The above, plus the main thread blocked while SwiftShader renders GPU work on the CPU | 56–82%. An artefact: a WebGL2 canvas that only *clears* already costs 14% here vs 3% for 2D |
| GPU process | SwiftShader rasterising the scene on the CPU | 190–290% (2–3 cores). This is GPU work emulated on a CPU, so it is recorded, not gated |
| 2D fallback | What runs where WebGL2 is unavailable | 2.4–2.9%, inside the gate |

The ~5%-on-a-mid-range-Android target is about a real GPU, which nothing here has. That is
the one check left for the phone: `MANUAL_TEST.md` → Check 2.

## Live site

The same 24 shots were captured from the **deployed** site after this push, in
`docs/screenshots/live/`. All four skins rendered through WebGL2 there, and the shots match the
local ones. Example, Kemet at 1 from the live deployment:

<img src="docs/screenshots/live/kemet-1-today.jpg" width="200" alt="Kemet at intensity 1, Today view, captured from the live site"> <img src="docs/screenshots/live/kemet-1-full.jpg" width="200" alt="Kemet at intensity 1, full screen, captured from the live site">

Status codes, the service worker scope and the cache version are recorded in `DEPLOYMENT.md` →
"Live verification".
