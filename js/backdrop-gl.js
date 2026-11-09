/* WebGL2 scenes for the four animated skins. js/backdrop.js owns the loop,
 * the pause rules and the time-integrated state (clock, spin, eased values);
 * this module only draws a frame from what it is handed.
 *
 * THE CONTRAST RULE, restated for a GPU. The 2D renderer keeps every frame
 * inside [--backdrop-base, --backdrop-ink] by construction (token colours,
 * source-over only). Lit 3D shading, bloom and additive glow cannot promise
 * that, so here it is enforced instead: every scene renders into an offscreen
 * target, and one final pass — `POST_FS` — clamps each pixel's relative
 * luminance into [L(base), L(ink)] before anything reaches the screen. The
 * scale-down above the ceiling and the grey lift below the floor are both
 * exact in linear RGB, so the bound is a property of the pipeline, not of how
 * carefully a shader was tuned. browser.test.js reads real pixels back to
 * check it for every skin at intensity 0 and 1. In the full-screen view there
 * is no text over the graphic, so the ceiling is lifted (see `ceiling`).
 */

import { compile, vao, target, perspective, multiply, rotationX, rotationY, rotationZ, translation, scaling, bandMatrix, project, strokeNDC } from './gl.js';
import { createBoltTrack, updateBoltTrack, boltBranches, haloStages, smoothstep, LIGHTNING_TRACKS, LIGHTNING, PLATE_SIZES, SLEEVE, FORGE_AUTO_ROTATION, KEMET_AUTO_ROTATION } from './theme-engine.js';

const AXIS = { vertical: rotationY, tumble: rotationZ, roll: rotationX };

const FOV = (30 * Math.PI) / 180;
const PYRAMID_H = 1.25;
const RING_Y = PYRAMID_H + 0.4;
const RING_R = 0.62;
const PARTICLES = 220;
const TERMINAL_COLUMNS = 72;
const TERMINAL_TRAIL = 14;

const V_FULL = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

/* The bounding pass. Also hosts Forge's heat haze, which is a UV wobble and so
 * can only ever re-sample colours already inside the scene. */
const POST_FS = `${HEAD}
in vec2 vUv;
uniform sampler2D uScene;
uniform float uLmin, uLmax, uHaze, uTime;
uniform vec4 uHazeRect;
vec3 lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 enc(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec2 uv = vUv;
  if (uHaze > 0.0) {
    vec2 q = (uv - uHazeRect.xy) / (uHazeRect.zw - uHazeRect.xy);
    float m = smoothstep(0.0, 0.25, q.x) * smoothstep(1.0, 0.75, q.x) * smoothstep(0.0, 0.2, q.y) * smoothstep(1.0, 0.4, q.y);
    uv += vec2(sin(uv.y * 95.0 + uTime * 5.0), sin(uv.x * 60.0 - uTime * 3.7)) * vec2(0.0028, 0.0018) * uHaze * m;
  }
  vec3 c = lin(clamp(texture(uScene, uv).rgb, 0.0, 1.0));
  float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
  if (L > uLmax) c *= uLmax / L;
  if (L < uLmin) c += uLmin - L;
  o = vec4(enc(c), 1.0);
}`;

/* ---------- shared programs ---------- */

const LINE_VS = `#version 300 es
layout(location = 0) in vec3 aP;
out float vAlong;
void main() { vAlong = aP.z; gl_Position = vec4(aP.xy, 0.0, 1.0); }`;
const LINE_FS = `${HEAD}
in float vAlong;
uniform vec3 uColor;
uniform float uAlpha;
void main() { o = vec4(uColor * uAlpha * (1.0 - vAlong * vAlong), 1.0); }`;

const SPRITE_VS = `#version 300 es
uniform vec2 uC, uR;
out vec2 vQ;
void main() {
  int i = gl_VertexID;
  vQ = vec2((i == 1 || i == 2 || i == 4) ? 1.0 : -1.0, (i == 2 || i == 4 || i == 5) ? 1.0 : -1.0);
  gl_Position = vec4(uC + vQ * uR, 0.0, 1.0);
}`;
const SPRITE_FS = `${HEAD}
in vec2 vQ;
uniform vec3 uColor;
uniform float uStrength, uFall;
void main() { float d = dot(vQ, vQ); o = vec4(uColor * uStrength * exp(-d * uFall) * (1.0 - smoothstep(0.7, 1.0, d)), 1.0); }`;

/* ---------- Kemet ---------- */

const SKY_FS = `${HEAD}
in vec2 vUv;
uniform vec3 uSky, uBase, uStar;
uniform float uTime, uAspect;
void main() {
  vec3 col = mix(uBase, uSky, smoothstep(0.3, 1.0, vUv.y));
  vec2 g = vUv * vec2(uAspect, 1.0) * 60.0;
  vec2 id = floor(g);
  float h = hash(id);
  if (h > 0.94 && vUv.y > 0.34) {
    vec2 at = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;
    float d = length(fract(g) - 0.5 - at * 0.6);
    float tw = 0.6 + 0.4 * sin(uTime * (0.4 + h * 1.5) + h * 40.0);
    col = mix(col, uStar, smoothstep(0.14, 0.0, d) * tw * 0.8);
  }
  o = vec4(col, 1.0);
}`;

const PYRAMID_VS = `#version 300 es
layout(location = 0) in vec3 aP;
layout(location = 1) in vec3 aN;
layout(location = 2) in vec2 aUv;
layout(location = 3) in float aFace;
uniform mat4 uMVP, uModel;
out vec3 vN;
out vec2 vUv;
flat out float vFace;
void main() { vN = mat3(uModel) * aN; vUv = aUv; vFace = aFace; gl_Position = uMVP * vec4(aP, 1.0); }`;

const PYRAMID_FS = `${HEAD}
in vec3 vN;
in vec2 vUv;
flat in float vFace;
uniform float uTier[10];
uniform float uFrac, uK, uTime;
uniform vec3 uStone, uGold, uGoldHot, uGlyph, uArc;
uniform sampler2D uInscription;
float glyph(vec2 p, float r) {
  p -= 0.5;
  float k = fract(r * 7.0);
  if (k < 0.3) return step(abs(p.x), 0.07) * step(abs(p.y), 0.3);
  if (k < 0.55) return step(abs(p.y), 0.08) * step(abs(p.x), 0.26);
  if (k < 0.8) return smoothstep(0.05, 0.0, abs(length(p * vec2(1.0, 1.6)) - 0.2));
  return step(abs(p.x), 0.06) * step(abs(p.y), 0.3) + step(abs(p.y + 0.18), 0.06) * step(abs(p.x), 0.2);
}
void main() {
  if (vFace > 3.5) {
    // The base: dark stone, lit like the faces, with the maker's mark engraved
    // in gold and a soft cyan glow around it. Text band is 4:1, centred.
    float diffB = max(dot(normalize(vN), normalize(vec3(-0.45, 0.55, 0.75))), 0.0);
    vec3 col = uStone * (0.55 + 0.75 * diffB) * 0.8;
    vec2 t = vec2((vUv.x - 0.08) / 0.84, (vUv.y - 0.5) / 0.21 + 0.5);
    vec2 ink = all(greaterThanEqual(t, vec2(0.0))) && all(lessThanEqual(t, vec2(1.0))) ? texture(uInscription, t).rg : vec2(0.0);
    col = mix(col, uGlyph, ink.g * 0.6);
    col = mix(col, uGoldHot * 1.15, ink.r);
    float edge = smoothstep(0.035, 0.0, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
    o = vec4(mix(col, uArc, edge * 0.5), 1.0);
    return;
  }
  float h = clamp(vUv.y, 0.0, 0.9999);
  float u = vUv.x / max(1.0 - h, 0.02);
  int tier = int(floor(h * 10.0));
  float lit = uTier[tier];
  float fh = fract(h * 10.0);
  float diff = max(dot(normalize(vN), normalize(vec3(-0.45, 0.55, 0.75))), 0.0);

  vec3 col = uStone * (0.55 + 0.75 * diff);
  vec2 cell = vec2(floor((u + 1.0) * 5.0), float(tier) + vFace * 17.0);
  float r = hash(cell);
  float mark = r > 0.4 ? glyph(vec2(fract((u + 1.0) * 5.0), fh), r) : 0.0;
  col = mix(col, uGlyph, clamp(mark, 0.0, 1.0) * (0.22 + 0.55 * lit) * (0.75 + 0.25 * sin(uTime * 0.8 + r * 30.0)));

  vec3 gold = mix(uGold, uGoldHot, clamp(0.35 * uFrac + 0.65 * uK, 0.0, 1.0));
  col = mix(col, gold * (0.8 + 0.45 * diff), lit * (0.7 + 0.25 * uFrac));

  // Tier seams: a fixed pixel width at any size, so ten tiers stay countable.
  float w = fwidth(h * 10.0) * 1.3;
  float seam = 1.0 - smoothstep(w * 0.5, w * 1.6, min(fh, 1.0 - fh));
  col = mix(col, uGlyph, seam * (tier == 0 && fh < 0.5 ? 0.0 : 0.75));

  float edge = smoothstep(0.9, 1.0, abs(u));
  col = mix(col, uArc, edge * (0.3 + 0.5 * uK));
  o = vec4(col, 1.0);
}`;

const RING_VS = `#version 300 es
uniform mat4 uMVP;
uniform float uR, uY;
out vec2 vL;
void main() {
  int i = gl_VertexID;
  vec2 q = vec2((i == 1 || i == 2 || i == 4) ? 1.0 : -1.0, (i == 2 || i == 4 || i == 5) ? 1.0 : -1.0) * 1.8;
  vL = q;
  gl_Position = uMVP * vec4(q.x * uR, uY, q.y * uR, 1.0);
}`;
const RING_FS = `${HEAD}
in vec2 vL;
uniform vec3 uHalo, uHaloHot;
uniform float uStrength, uTime;
void main() {
  float d = length(vL);
  float band = exp(-pow((d - 1.0) / 0.08, 2.0));
  float outer = exp(-pow((d - 1.0) / 0.38, 2.0)) * 0.4;
  float shimmer = 0.85 + 0.15 * sin(atan(vL.y, vL.x) * 6.0 + uTime * 0.7);
  o = vec4(mix(uHalo, uHaloHot, band) * (band + outer) * shimmer * uStrength, 1.0);
}`;

/* GPU particles: every position is a function of (seed, time) in the vertex
 * shader, so there is no per-frame CPU work and no buffer upload. */
const SPARK_VS = `#version 300 es
layout(location = 0) in float aSeed;
uniform mat4 uMVP;
uniform float uTime, uCount, uTravel, uSpill, uPx, uY, uR;
out float vA;
float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  float a = aSeed * 2.399 + uTime * 0.05;
  float life = fract(uTime * (0.18 + 0.12 * h1(aSeed)) + h1(aSeed * 3.3));
  float rr = uR * (0.75 + 0.3 * h1(aSeed * 5.1)) * (1.0 + (uSpill - 1.0) * life);
  vec3 p = vec3(cos(a) * rr, uY - life * uTravel, sin(a) * rr);
  vec4 c = uMVP * vec4(p, 1.0);
  gl_Position = c;
  vA = aSeed < uCount ? sin(life * 3.14159) : 0.0;
  gl_PointSize = vA > 0.0 ? clamp(uPx * 0.012 / c.w, 1.0, 10.0) : 0.0;
}`;
const POINT_FS = `${HEAD}
in float vA;
uniform vec3 uColor;
uniform float uStrength;
void main() { float d = length(gl_PointCoord - 0.5); o = vec4(uColor * vA * uStrength * smoothstep(0.5, 0.0, d), 1.0); }`;

/* ---------- Forge ---------- */

const FORGE_BG_FS = `${HEAD}
in vec2 vUv;
uniform vec3 uBase, uHot;
uniform vec2 uC;
uniform float uR, uA, uAspect;
void main() {
  vec2 d = (vUv - uC) * vec2(uAspect, 1.0);
  o = vec4(mix(uBase, uHot, uA * exp(-dot(d, d) / (uR * uR))), 1.0);
}`;

const BARBELL_VS = `#version 300 es
layout(location = 0) in vec3 aP;
layout(location = 1) in vec3 aN;
layout(location = 2) in float aPart;
uniform mat4 uMVP, uMV;
out vec3 vN;
out vec3 vObj;
flat out float vPart;
void main() { vN = mat3(uMV) * aN; vObj = aP; vPart = aPart; gl_Position = uMVP * vec4(aP, 1.0); }`;

const BARBELL_FS = `${HEAD}
in vec3 vN;
in vec3 vObj;
flat in float vPart;
uniform vec3 uIron, uGlow, uEmber, uHeatA, uHeatB, uHeatC, uInk, uPlate;
uniform float uHeatT, uMonth, uClarity, uHeat, uAlpha;
vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0) * 3.0;
  if (t < 1.0) return mix(uHeatA, uHeatB, t);
  if (t < 2.0) return mix(uHeatB, uHeatC, t - 1.0);
  return mix(uHeatC, uInk, t - 2.0);
}
void main() {
  vec3 n = normalize(vN);
  vec3 L = normalize(vec3(-0.35, 0.7, 0.6));
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 22.0);
  float rim = pow(1.0 - abs(n.z), 2.0);
  vec3 iron = mix(uIron, uEmber, uHeat * 0.45);
  float ang = atan(vObj.z, vObj.y);
  float rr = length(vObj.yz);
  // Plates are drawn from a unit cylinder, so rr runs 0 (hub) → 1 (rim).
  bool plate = vPart > 1.5;
  vec3 body = plate && rr > 0.2 ? uPlate : iron;
  vec3 col = body * (0.5 + 1.1 * diff) + uGlow * (spec * (0.3 + 0.6 * uClarity) + rim * (0.12 + 0.4 * uClarity));
  if (plate) {
    float rings = smoothstep(0.03, 0.0, abs(fract(rr * 5.0) - 0.5) - 0.44) * step(0.2, rr);
    float spokes = smoothstep(0.12, 0.0, abs(sin(ang * 3.0))) * step(0.2, rr) * step(rr, 0.6);
    col = mix(col, body * 0.45, max(rings * 0.5, spokes * 0.55));
    // A dark seam where each plate meets the next, so a stack of identical
    // plates still reads as a countable stack rather than one thick block.
    float seam = 1.0 - smoothstep(0.0, 0.14, min(vObj.x, 1.0 - vObj.x));
    col *= 1.0 - 0.6 * seam * step(0.2, rr);
  } else if (vPart < 0.5) {
    col *= 0.8 + 0.35 * step(0.5, fract(ang * 1.9 + vObj.x * 12.0)) * step(abs(vObj.x), 0.85);
  }
  // Heat follows monthPercent on the steel. The plates take only a warm wash,
  // so their colours still read when the bar is white-hot.
  float carry = vPart < 0.5 ? 1.0 : (plate ? 0.1 : 0.85);
  col = mix(col, ramp(uHeatT) * (0.9 + 0.3 * diff), uMonth * carry * (0.5 + 0.45 * uHeatT));
  o = vec4(col, uAlpha);
}`;

const EMBER_VS = `#version 300 es
layout(location = 0) in float aSeed;
uniform mat4 uMVP;
uniform float uTime, uCount, uRise, uPx;
out float vA;
out float vHot;
float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  float speed = (0.25 + 0.5 * h1(aSeed * 2.1)) * uRise;
  float life = fract(uTime * speed / 1.6 + h1(aSeed * 7.3));
  vec3 p = vec3((h1(aSeed) - 0.5) * 3.2 + sin(uTime * 0.7 + aSeed) * 0.06, -0.1 + life * 1.6, (h1(aSeed * 4.7) - 0.5) * 0.6);
  vec4 c = uMVP * vec4(p, 1.0);
  gl_Position = c;
  vA = aSeed < uCount ? sin(life * 3.14159) * (0.6 + 0.4 * sin(uTime * 3.0 + aSeed)) : 0.0;
  vHot = h1(aSeed * 9.9);
  gl_PointSize = vA > 0.0 ? clamp(uPx * (0.012 + 0.012 * h1(aSeed * 3.9)) / c.w, 1.0, 16.0) : 0.0;
}`;
const EMBER_FS = `${HEAD}
in float vA;
in float vHot;
uniform vec3 uSpark, uHot;
uniform float uStrength;
void main() { float d = length(gl_PointCoord - 0.5); o = vec4(mix(uSpark, uHot, vHot) * vA * uStrength * smoothstep(0.5, 0.05, d), 1.0); }`;

/* ---------- Fractal ---------- */

const BLOOM_FS = `${HEAD}
in vec2 vUv;
uniform vec3 uA, uB, uBase;
uniform float uTime, uAspect, uLift;
vec3 blob(vec3 col, vec3 c, vec2 p, vec2 at, float r, float a) { vec2 d = p - at; return mix(col, c, a * exp(-dot(d, d) / (r * r))); }
void main() {
  vec2 p = vUv * vec2(uAspect, 1.0);
  float s = uTime * 0.0785;
  vec3 col = uBase;
  col = blob(col, uA, p, vec2((0.30 + sin(s) * 0.11) * uAspect, 0.80 + cos(s * 0.83) * 0.07), 0.45, 0.6 * uLift);
  col = blob(col, uB, p, vec2((0.74 + sin(s + 1.7) * 0.09) * uAspect, 0.66 + cos(s * 0.83 + 2.1) * 0.10), 0.40, 0.6 * uLift);
  col = blob(col, uA, p, vec2((0.18 + sin(s + 3.4) * 0.07) * uAspect, 0.52 + cos(s * 0.83 + 4.2) * 0.12), 0.28, 0.5 * uLift);
  o = vec4(col, 1.0);
}`;

/* highp is mandatory in WebGL2 fragment shaders (GLSL ES 3.00), so float32
 * precision is guaranteed; ZOOM.minHalf keeps ~20 ulps per pixel at the
 * deepest zoom, which is where float32 Mandelbrots start to block up. */
const MANDEL_FS = `${HEAD}
in vec2 vUv;
uniform vec2 uCentre;
uniform float uHalf, uAspect, uIter, uTime, uSat, uFeather;
uniform vec3 uA, uB, uInk, uBase;
void main() {
  vec2 c = (vUv - 0.5) * 2.0 * vec2(uAspect, 1.0) * uHalf + uCentre;
  vec2 z = vec2(0.0);
  float n = 0.0;
  bool out_ = false;
  for (int i = 0; i < 400; i++) {
    if (float(i) >= uIter) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    if (dot(z, z) > 256.0) { out_ = true; break; }
    n += 1.0;
  }
  vec3 col = uBase;
  float a = 1.0;
  if (out_) {
    float mu = n + 1.0 - log2(log2(dot(z, z)) * 0.5);
    float ph = mu * 0.04 + uTime * 0.03;
    vec3 w = 0.5 + 0.5 * cos(6.28318 * (ph + vec3(0.0, 0.33, 0.67)));
    vec3 pal = (uA * w.x + uB * w.y + uInk * w.z) / (w.x + w.y + w.z);
    float edge = clamp(log(max(mu, 1.0)) / log(uIter), 0.0, 1.0);
    col = mix(pal, uInk, smoothstep(0.8, 1.0, edge) * 0.7);     // filaments nearest the set run hottest
    col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, uSat);
    a = smoothstep(0.08, 0.6, edge);                             // far exterior is clear, so no hard rectangle
  } else {
    col = mix(uBase, uB, 0.2);
  }
  a *= smoothstep(0.0, uFeather, vUv.y) * smoothstep(0.0, uFeather * 0.4, 1.0 - vUv.y);
  o = vec4(col, a);
}`;

const ZOOM = Object.freeze({
  start: [-0.6, 0.0],
  startHalf: 1.2,
  target: [-0.743643887, 0.131825904],   // Seahorse Valley
  minHalf: 8e-4,
  minIter: 60,
  maxIter: 300                            // clamped for mobile GPUs
});

/* ---------- Terminal ---------- */

const FLOOR_FS = `${HEAD}
in vec2 vUv;
uniform vec3 uBase, uGrid, uS2, uInk;
uniform float uTime, uAspect, uTanY, uPitch, uCamY, uBurst, uPulse;
void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 d = vec3(ndc.x * uTanY * uAspect, ndc.y * uTanY, -1.0);
  float c = cos(uPitch), s = sin(uPitch);
  vec3 w = vec3(d.x, c * d.y - s, -s * d.y - c);   // view ray, un-pitched into world space
  vec3 col = uBase;
  if (w.y < -0.002) {
    float t = uCamY / -w.y;
    vec2 p = vec2(w.x, w.z) * t;
    vec2 g = abs(fract(p) - 0.5);
    vec2 fw = fwidth(p);
    float line = max(1.0 - smoothstep(0.0, fw.x * 1.5, 0.5 - g.x), 1.0 - smoothstep(0.0, fw.y * 1.5, 0.5 - g.y));
    float fade = exp(-t * 0.07);
    col = mix(col, uGrid, line * fade * uPulse);
    float ix = floor(p.x + 0.5);
    float hx = hash(vec2(ix, 3.0));
    if (hx < uBurst && abs(p.x - ix) < 0.12) {
      float head = -32.0 + fract(uTime * (0.18 + 0.2 * hx) + hx * 7.0) * 34.0;
      float dz = p.y - head;
      float pk = dz < 0.0 ? exp(dz * 1.6) : exp(-dz * 12.0);   // sharp head, trail behind it
      col = mix(col, uInk, pk * fade * 0.9);
    }
  } else {
    col = mix(col, uS2, exp(-abs(w.y) * 18.0) * 0.35);
  }
  o = vec4(col, 1.0);
}`;

const GLYPH_VS = `#version 300 es
layout(location = 0) in vec4 aG;
uniform mat4 uVP;
uniform float uTime, uSpeed, uDensity, uPx, uRate, uTrail, uHeadGlow;
uniform vec3 uInk, uS1, uS2;
out vec3 vCol;
out float vGlyph, vA, vBlur;
float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  float seed = aG.z, trail = aG.w;
  float on = step(h1(seed * 1.7), uDensity);
  float sp = (0.7 + 0.9 * h1(seed * 3.1)) * uSpeed;
  float head = 7.5 - mod(uTime * sp + h1(seed) * 12.0, 12.0);
  float y = head + trail * 0.36;
  vec4 clip = uVP * vec4(aG.x, y, aG.y, 1.0);
  gl_Position = clip;
  float fog = exp(-clip.w * 0.05);
  vA = on * fog * max(0.0, 1.0 - trail / uTrail) * step(0.0, y) * step(y, 7.5);
  vBlur = clamp((clip.w - 5.0) / 18.0, 0.0, 1.0);
  float bucket = h1(seed * 5.3);
  // A bright leading glyph is earned: the share of columns whose head glows
  // in --backdrop-ink rises with intensity; the rest lead in a stream colour.
  bool glows = trail < 0.5 && h1(seed * 7.9) < uHeadGlow;
  vCol = glows ? uInk : (bucket < 0.5 ? uS1 : uS2);
  vGlyph = floor(h1(seed * 9.1 + trail * 3.7 + floor(uTime * uRate + h1(seed) * 9.0)) * 16.0);
  gl_PointSize = vA > 0.0 ? clamp(0.55 * uPx / clip.w, 1.0, 64.0) : 0.0;
}`;
const GLYPH_FS = `${HEAD}
in vec3 vCol;
in float vGlyph, vA, vBlur;
uniform sampler2D uAtlas;
uniform float uBright;
void main() {
  vec2 uv = (vec2(vGlyph, 0.0) + gl_PointCoord) / vec2(16.0, 1.0);
  float a = texture(uAtlas, uv, vBlur * 2.5).r;
  o = vec4(vCol * a * vA * uBright, 1.0);
}`;

/* ---------- geometry ---------- */

function pyramidMesh() {
  const c = [[-1, 0, 1], [1, 0, 1], [1, 0, -1], [-1, 0, -1]];
  const apex = [0, PYRAMID_H, 0];
  const out = [];
  for (let k = 0; k < 4; k += 1) {
    const a = c[k];
    const b = c[(k + 1) % 4];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [apex[0] - a[0], apex[1] - a[1], apex[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(...n);
    const nn = n.map((v) => v / len);
    out.push(...a, ...nn, -1, 0, k, ...b, ...nn, 1, 0, k, ...apex, ...nn, 0, 1, k);
  }
  /* The base (face 4): the same four corners as the sides, so there is no
   * seam, normal straight down. Its uv carries the inscription: u runs with
   * +x and the text's "up" runs with +z — which, seen from below (looking up
   * the +y axis), is a proper rotation of the page, never a mirror image. */
  const down = [0, -1, 0];
  const uv = ([x, , z]) => [(x + 1) / 2, (1 - z) / 2];
  for (const tri of [[c[0], c[3], c[2]], [c[0], c[2], c[1]]]) {
    for (const v of tri) out.push(...v, ...down, ...uv(v), 4);
  }
  return new Float32Array(out);
}

/** "RepTrack © ArtyG-Dev", drawn once with a system font stack (no font file)
 *  into two channels: red is the sharp lettering, green a blurred copy for the
 *  engraved glow. Cached as a texture for the life of the context. */
const INSCRIPTION = 'RepTrack \u00a9 ArtyG-Dev';
function inscriptionTexture(gl) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  let size = 120;
  const font = (px) => `600 ${px}px system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif`;
  g.font = font(size);
  size = Math.floor(size * Math.min(1, (c.width * 0.9) / g.measureText(INSCRIPTION).width));
  g.font = font(size);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.filter = 'blur(10px)';
  g.fillStyle = '#00ff00';
  g.fillText(INSCRIPTION, c.width / 2, c.height / 2);
  g.filter = 'none';
  g.globalCompositeOperation = 'lighter';   // a texture channel merge, not a draw to the screen
  g.fillStyle = '#ff0000';
  g.fillText(INSCRIPTION, c.width / 2, c.height / 2);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** A capped cylinder along X. Layout: position, normal, part. */
function cylinder(out, x0, x1, r, part, seg = 40) {
  for (let i = 0; i < seg; i += 1) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const [c0, s0, c1, s1] = [Math.cos(a0), Math.sin(a0), Math.cos(a1), Math.sin(a1)];
    const v = (x, c, s) => [x, c * r, s * r, 0, c, s, part];
    out.push(...v(x0, c0, s0), ...v(x1, c0, s0), ...v(x1, c1, s1), ...v(x0, c0, s0), ...v(x1, c1, s1), ...v(x0, c1, s1));
    for (const [x, nx] of [[x0, -1], [x1, 1]]) {
      out.push(x, 0, 0, nx, 0, 0, part, x, c0 * r, s0 * r, nx, 0, 0, part, x, c1 * r, s1 * r, nx, 0, 0, part);
    }
  }
}

/** The bar, sleeves and collars — everything but the plates, which are
 *  drawn one by one from `plateMesh()` so they can be loaded with the level. */
const SLEEVE_TIP = SLEEVE.end + 0.075;
function barbellMesh() {
  const out = [];
  cylinder(out, -1.02, 1.02, 0.045, 0);
  for (const s of [-1, 1]) {
    const span = (a, b) => (s < 0 ? [-b, -a] : [a, b]);
    cylinder(out, ...span(1.02, SLEEVE_TIP), 0.075, 1);
    cylinder(out, ...span(1.0, 1.06), 0.12, 1);                      // inner collar
    cylinder(out, ...span(SLEEVE.end + 0.002, SLEEVE.end + 0.052), 0.105, 1);   // end collar
  }
  return new Float32Array(out);
}

/** One plate: a unit cylinder along +x, scaled to size when drawn. */
function plateMesh() {
  const out = [];
  cylinder(out, 0, 1, 1, 2, 56);
  return new Float32Array(out);
}

/** Columns spread through the camera's frustum, so every depth — near, large
 *  and bright; far, small and dim — is populated whatever the aspect ratio. */
function glyphColumns() {
  const out = [];
  for (let i = 0; i < TERMINAL_COLUMNS; i += 1) {
    const z = -3 - ((i + Math.random()) / TERMINAL_COLUMNS) ** 1.3 * 26;
    const x = (Math.random() - 0.5) * 2 * Math.abs(z) * 0.55;
    for (let t = 0; t < TERMINAL_TRAIL; t += 1) out.push(x, z, i + 0.5, t);
  }
  return new Float32Array(out);
}

function glyphAtlas(gl) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 512, 32);
  g.fillStyle = '#fff';
  g.font = 'bold 26px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  [...'0123456789ABCDEF'].forEach((ch, i) => g.fillText(ch, i * 32 + 16, 17));
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  return tex;
}

/* ---------- small helpers ---------- */

const lum = ([r, g, b]) => {
  const ch = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};

function displace3(a, b, depth, amp, rand) {
  if (depth <= 0) return [a, b];
  const m = a.map((v, i) => (v + b[i]) / 2 + (rand() - 0.5) * amp);
  return [...displace3(a, m, depth - 1, amp * 0.55, rand).slice(0, -1), ...displace3(m, b, depth - 1, amp * 0.55, rand)];
}

/* ---------- the renderer ---------- */

export function createGLBackdrop(canvas) {
  let gl = null;
  try {
    gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, premultipliedAlpha: false, powerPreference: 'low-power' });
  } catch { gl = null; }
  if (!gl) return null;

  let r = null;                       // every GPU resource; rebuilt after context loss
  let size = { w: 0, h: 0 };
  let tracks = {};
  let bolts = [];
  const info = {};                    // what the last frame actually used, for diagnostics

  /* Programs and meshes are built on first use, so a skin only ever pays for
   * its own shaders — and nothing is compiled until a glass skin is chosen. */
  const SOURCES = {
    post: [POST_FS], line: [LINE_FS, LINE_VS], sprite: [SPRITE_FS, SPRITE_VS],
    sky: [SKY_FS], pyramid: [PYRAMID_FS, PYRAMID_VS], ring: [RING_FS, RING_VS], spark: [POINT_FS, SPARK_VS],
    forgeBg: [FORGE_BG_FS], barbell: [BARBELL_FS, BARBELL_VS], ember: [EMBER_FS, EMBER_VS],
    bloom: [BLOOM_FS], mandel: [MANDEL_FS], floor: [FLOOR_FS], glyph: [GLYPH_FS, GLYPH_VS]
  };
  const MAKERS = {
    pyramidMesh: () => vao(gl, pyramidMesh(), [[0, 3], [1, 3], [2, 2], [3, 1]]),
    barbellMesh: () => vao(gl, barbellMesh(), [[0, 3], [1, 3], [2, 1]]),
    plateMesh: () => vao(gl, plateMesh(), [[0, 3], [1, 3], [2, 1]]),
    seeds: () => vao(gl, Float32Array.from({ length: PARTICLES }, (_, i) => i), [[0, 1]]),
    glyphs: () => vao(gl, glyphColumns(), [[0, 4]]),
    lines: () => vao(gl, new Float32Array(6), [[0, 3]], gl.DYNAMIC_DRAW),
    atlas: () => glyphAtlas(gl),
    inscription: () => inscriptionTexture(gl)
  };

  function build() {
    const store = { empty: gl.createVertexArray(), ms: null, resolve: null };
    r = new Proxy(store, {
      get(target, key) {
        if (key in target) return target[key];
        if (SOURCES[key]) target[key] = compile(gl, SOURCES[key][1] || V_FULL, SOURCES[key][0]);
        else if (MAKERS[key]) target[key] = MAKERS[key]();
        return target[key];
      }
    });
    void r.post;                        // the bounding pass every skin needs: fail fast if it cannot build
    size = { w: 0, h: 0 };
  }

  /** The scene target the bounding pass reads. Below 2× device pixels it is
   *  multisampled (4×) and resolved, which is what keeps pyramid and plate
   *  edges clean; at 2× the pixels are already small enough that MSAA would
   *  quadruple the fill bandwidth on exactly the phones where it costs most,
   *  for edges nobody can see — so it renders straight into the target. */
  function ensureTargets(w, h, dpr) {
    const want = dpr >= 1.75 ? 0 : Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
    if (size.w === w && size.h === h && r.resolve && size.samples === want) return;
    r.resolve?.free();
    if (r.ms) { gl.deleteFramebuffer(r.ms.fbo); gl.deleteRenderbuffer(r.ms.colour); gl.deleteRenderbuffer(r.ms.depth); r.ms = null; }
    r.resolve = target(gl, w, h);
    size = { w, h, samples: want };
    if (!want) return;
    const samples = want;
    const fbo = gl.createFramebuffer();
    const colour = gl.createRenderbuffer();
    const depth = gl.createRenderbuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.bindRenderbuffer(gl.RENDERBUFFER, colour);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, colour);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT16, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    r.ms = { fbo, colour, depth };
  }

  try { build(); } catch (error) {
    console.warn('WebGL2 scene failed to build; using the 2D backdrop.', error);
    return null;
  }

  /* ---------- per-frame helpers ---------- */

  const blend = (mode) => {
    if (!mode) { gl.disable(gl.BLEND); return; }
    gl.enable(gl.BLEND);
    if (mode === 'add') gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  };

  const fullscreen = (prog) => { gl.bindVertexArray(r.empty); gl.drawArrays(gl.TRIANGLES, 0, 3); return prog; };

  /** Frame a scene into the band: the camera looks at `targetY` and backs off
   *  until both `needH` (half height) and `needW` (half width) fit. */
  function camera(f, { targetY, needH, needW, tilt }) {
    const bandPx = ((f.band[1] - f.band[0]) / 2) * size.h;
    const aspect = size.w / Math.max(bandPx, 1);
    const half = Math.max(needH, needW / aspect);
    const dist = half / Math.tan(FOV / 2);
    const eye = [0, targetY + dist * Math.sin(tilt), dist * Math.cos(tilt)];
    const view = multiply(rotationX(tilt), translation(-eye[0], -eye[1], -eye[2]));
    const proj = multiply(bandMatrix(f.band[0], f.band[1]), perspective(FOV, aspect, 0.1, 80));
    return { view, proj, vp: multiply(proj, view) };
  }

  function sprite(colour, ndc, rx, ry, strength, fall = 3) {
    r.sprite.use().rgb('uColor', colour).f('uC', ndc[0], ndc[1]).f('uR', rx, ry).f('uStrength', strength).f('uFall', fall);
    gl.bindVertexArray(r.empty);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function lines(points, widthPx, colour, alpha) {
    const data = new Float32Array(strokeNDC(points, widthPx, size.w, size.h));
    if (!data.length) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, r.lines.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    r.line.use().rgb('uColor', colour).f('uAlpha', alpha);
    gl.bindVertexArray(r.lines.va);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 3);
  }

  /** Lightning: every strike is requested through the shared flash limiter
   *  (theme-engine.js). Intensity buys branching and frequency, never a rate
   *  past the cap. Bolts are world-space polylines projected each frame. */
  function strike(f, name, level, make) {
    tracks[name] ??= createBoltTrack();
    if (f.still) return;
    if (updateBoltTrack(tracks[name], f.t, level, f.limiter, f.rand)) bolts.push({ bornAt: f.t, ...make() });
  }

  function drawBolts(f, toNDC) {
    bolts = bolts.filter((b) => f.t - b.bornAt <= LIGHTNING.durationS);
    blend('add');
    for (const b of bolts) {
      const env = 1 - (f.t - b.bornAt) / LIGHTNING.durationS;
      for (const path of [b.points, ...b.branches]) {
        const ndc = path.map(toNDC);
        const main = path === b.points ? 1 : 0.6;
        lines(ndc, 7 * f.dpr, b.glow, 0.35 * env * main * b.peak);
        lines(ndc, 1.6 * f.dpr, b.core, env * main * b.peak);
      }
    }
  }

  function branchesFrom(points, count, rand, toward) {
    const out = [];
    for (let i = 0; i < count; i += 1) {
      const from = points[1 + Math.floor(rand() * (points.length - 2))];
      out.push(displace3(from, toward(from), 3, 0.12, rand));
    }
    return out;
  }

  /* ---------- scenes ---------- */

  function kemet(f) {
    const P = f.palette;
    const stage = haloStages(f.month);
    blend(null);
    r.sky.use().rgb('uSky', P.sky).rgb('uBase', P.base).rgb('uStar', P.star).f('uTime', f.t).f('uAspect', size.w / size.h);
    fullscreen();

    const cam = camera(f, f.full ? { targetY: 0.82, needH: 1.3, needW: 1.75, tilt: 0.42 } : { targetY: 0.5, needH: 1.16, needW: 1.85, tilt: 0.42 });
    // The user's drag (theme-engine orbit) turns the whole scene in world space;
    // the pyramid's own auto-rotation is about its vertical axis inside that.
    const orbit = multiply(rotationX(f.orbit.pitch), rotationY(f.orbit.yaw));
    const vp = multiply(cam.vp, orbit);
    const model = AXIS[KEMET_AUTO_ROTATION.axis](KEMET_AUTO_ROTATION.direction * f.spin);
    const mvp = multiply(vp, model);

    gl.enable(gl.DEPTH_TEST);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, r.inscription);
    gl.activeTexture(gl.TEXTURE0);
    r.pyramid.use().i('uInscription', 1).m4('uMVP', mvp).m4('uModel', multiply(orbit, model)).fv('uTier', f.tierGlow).f('uFrac', f.level).f('uK', f.k).f('uTime', f.t)
      .rgb('uStone', P.stone).rgb('uGold', P.gold).rgb('uGoldHot', P.goldHot).rgb('uGlyph', P.glyph).rgb('uArc', P.arc);
    gl.bindVertexArray(r.pyramidMesh.va);
    gl.drawArrays(gl.TRIANGLES, 0, r.pyramidMesh.count);
    gl.depthMask(false);

    blend('add');
    const apex = project(vp, [0, PYRAMID_H, 0]);
    const bandPx = ((f.band[1] - f.band[0]) / 2) * size.h;
    const bloomR = (bandPx * (0.18 + 0.22 * f.k)) / size.h;
    sprite(P.haloHot, apex, (bloomR * size.h) / size.w, bloomR, 0.08 + 0.42 * f.k * f.k);

    const ringR = RING_R * (1 + 0.08 * stage.brighten);
    if (stage.presence > 0.001) {
      const breathe = 0.9 + 0.1 * Math.sin(f.t * 0.35);
      r.ring.use().m4('uMVP', vp).f('uR', ringR).f('uY', RING_Y).f('uTime', f.t).rgb('uHalo', P.halo).rgb('uHaloHot', P.haloHot)
        .f('uStrength', stage.presence * (0.35 + 0.3 * stage.brighten + 0.35 * stage.strike) * breathe);
      gl.bindVertexArray(r.empty);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Sparks: the 25/50/90% staging sets how many and how far they travel;
      // overall intensity scales both on top.
      const count = stage.presence * (24 + 46 * stage.brighten + 80 * stage.strike) * (0.6 + 0.4 * f.k);
      r.spark.use().m4('uMVP', vp).f('uTime', f.t).f('uCount', count).f('uTravel', 0.3 + 0.5 * stage.brighten + 0.7 * stage.strike)
        .f('uSpill', 1 + 0.6 * stage.strike).f('uPx', size.h * 1.4).f('uY', RING_Y).f('uR', ringR)
        .rgb('uColor', P.haloHot).f('uStrength', 0.9);
      gl.bindVertexArray(r.seeds.va);
      gl.drawArrays(gl.POINTS, 0, PARTICLES);
    }

    // Pyramid crawl, then halo-to-pyramid strikes — both through the one limiter.
    const face = (k, u, h) => {
      const c = [[-1, 0, 1], [1, 0, 1], [1, 0, -1], [-1, 0, -1]];
      const a = c[k]; const b = c[(k + 1) % 4];
      const base = a.map((v, i) => v + (b[i] - v) * (u + 1) / 2);
      const p = base.map((v, i) => v + ([0, PYRAMID_H, 0][i] - v) * h);
      const cs = Math.cos(f.spin); const sn = Math.sin(f.spin);
      return [p[0] * cs + p[2] * sn, p[1], -p[0] * sn + p[2] * cs];
    };
    const front = () => {
      // The face whose outward normal points most toward the camera.
      let best = 0; let score = -Infinity;
      for (let k = 0; k < 4; k += 1) {
        const a = -f.spin + (k * Math.PI) / 2;
        const s = Math.cos(a);
        if (s > score) { score = s; best = k; }
      }
      return f.rand() < 0.7 ? best : (best + (f.rand() < 0.5 ? 1 : 3)) % 4;
    };
    strike(f, 'pyramid', f.k, () => {
      const k = front();
      const h0 = f.rand() * 0.3;
      const points = displace3(face(k, f.rand() * 1.6 - 0.8, h0), face(k, f.rand() * 1.2 - 0.6, Math.min(0.95, h0 + 0.35 + f.rand() * 0.4)), 4, 0.1, f.rand);
      return { points, branches: branchesFrom(points, boltBranches(f.k), f.rand, (p) => [p[0] * 0.8, p[1] - 0.25, p[2] * 0.8]), core: P.ink, glow: P.arc, peak: 0.55 + 0.45 * f.k };
    });
    if (stage.presence > 0.05) {
      strike(f, 'halo', f.k, () => {
        const a = f.rand() * Math.PI * 2;
        const from = [Math.cos(a) * ringR, RING_Y, Math.sin(a) * ringR];
        const to = f.rand() < 0.5 ? [0, PYRAMID_H, 0] : face(front(), f.rand() * 0.8 - 0.4, 0.45 + f.rand() * 0.4);
        const points = displace3(from, to, 4, 0.14, f.rand);
        return { points, branches: branchesFrom(points, boltBranches(f.k), f.rand, () => face(front(), f.rand() * 1.4 - 0.7, 0.2 + f.rand() * 0.6)), core: P.haloHot, glow: P.arc, peak: (0.5 + 0.5 * f.k) * stage.presence };
      });
    }
    drawBolts(f, (p) => project(vp, p));
    // For tests: where the inscription's start, end and "up" land on screen,
    // and whether the base faces the camera (its down-normal, in view space).
    const towardCamera = multiply(cam.view, multiply(orbit, model));
    info.kemet = {
      apex,
      base: project(vp, [1, 0, 1]),
      heading: KEMET_AUTO_ROTATION.direction * f.spin,
      inscription: {
        start: project(mvp, [-0.84, 0, 0]),
        end: project(mvp, [0.84, 0, 0]),
        up: project(mvp, [0, 0, 0.4]),             // the text's top edge is toward +z
        centre: project(mvp, [0, 0, 0]),
        facing: -towardCamera[6] > 0.5           // view-space z of the (0,-1,0) normal
      }
    };
    gl.depthMask(true);
    gl.disable(gl.DEPTH_TEST);
  }

  function forge(f) {
    const P = f.palette;
    const cam = camera(f, f.full ? { targetY: 0.1, needH: 1.0, needW: 2.4, tilt: 0.16 } : { targetY: 0.05, needH: 0.8, needW: 2.45, tilt: 0.16 });
    // World-space drag offset first, then the three-quarter starting view, then
    // the bar's own auto-rotation (FORGE_AUTO_ROTATION: a level turntable spin,
    // opposite to Kemet's). The glow, embers and haze follow the bar round as
    // long as the spin keeps it level.
    const orbit = multiply(rotationX(f.orbit.pitch), rotationY(f.orbit.yaw));
    const yaw = multiply(orbit, rotationY(-0.42));
    const autoAngle = FORGE_AUTO_ROTATION.direction * f.spin;
    const model = multiply(yaw, AXIS[FORGE_AUTO_ROTATION.axis](autoAngle));
    const mv = multiply(cam.view, model);
    const vpYaw = multiply(cam.vp, FORGE_AUTO_ROTATION.axis === 'vertical' ? model : yaw);
    const centre = project(vpYaw, [0, 0, 0]);
    const monthGlow = smoothstep(0.15, 0.30, f.month);   // the 2D renderer's thresholds, unchanged
    const heatT = Math.min(Math.max((f.month - 0.22) / (0.95 - 0.22), 0), 1);

    blend(null);
    const hot = P.ember.map((v, i) => v + (P.glow[i] - v) * f.heat);
    const breathe = 0.9 + 0.1 * Math.sin(f.t * 0.22);
    r.forgeBg.use().rgb('uBase', P.base).rgb('uHot', hot).f('uC', (centre[0] + 1) / 2, (centre[1] + 1) / 2)
      .f('uR', 0.35 + 0.25 * f.heat).f('uA', (0.3 + 0.55 * f.heat) * breathe).f('uAspect', size.w / size.h);
    fullscreen();

    gl.enable(gl.DEPTH_TEST);
    const steel = r.barbell.use().m4('uMVP', multiply(cam.proj, mv)).m4('uMV', mv)
      .rgb('uIron', P.iron).rgb('uGlow', P.glow).rgb('uEmber', P.ember).rgb('uHeatA', P.heatA).rgb('uHeatB', P.heatB).rgb('uHeatC', P.heatC).rgb('uInk', P.ink)
      .rgb('uPlate', P.iron).f('uHeatT', heatT).f('uMonth', monthGlow).f('uClarity', f.level).f('uHeat', f.heat).f('uAlpha', 1);
    gl.bindVertexArray(r.barbellMesh.va);
    gl.drawArrays(gl.TRIANGLES, 0, r.barbellMesh.count);

    // Plates: the same list on both sides, mirrored, so the bar is never
    // lopsided. A plate sliding off fades, so it is drawn last and blended.
    const drawPlate = (p, side) => {
      const x = side > 0 ? p.x0 : -p.x1;
      const m = multiply(model, multiply(translation(x, 0, 0), scaling(p.x1 - p.x0, p.radius, p.radius)));
      const pmv = multiply(cam.view, m);
      steel.m4('uMVP', multiply(cam.proj, pmv)).m4('uMV', pmv).rgb('uPlate', P[PLATE_SIZES[p.size].token]).f('uAlpha', p.alpha);
      gl.drawArrays(gl.TRIANGLES, 0, r.plateMesh.count);
    };
    gl.bindVertexArray(r.plateMesh.va);
    const plates = f.plates || [];
    for (const p of plates) if (p.alpha >= 1) { drawPlate(p, 1); drawPlate(p, -1); }
    const fading = plates.filter((p) => p.alpha < 1);
    if (fading.length) {
      blend('alpha');
      gl.depthMask(false);
      for (const p of fading) { drawPlate(p, 1); drawPlate(p, -1); }
      gl.depthMask(true);
    }
    gl.disable(gl.DEPTH_TEST);

    // For tests: the bar's ends on screen, and a point on each seated plate's
    // rim that faces the camera, to sample its colour.
    const rimPoint = (p) => {
      const a = Math.PI / 3;
      return project(multiply(cam.vp, model), [(p.x0 + p.x1) / 2, p.radius * 0.96 * Math.cos(a), p.radius * 0.96 * Math.sin(a)]);
    };
    const endWorld = [model[0] * SLEEVE_TIP, model[1] * SLEEVE_TIP, model[2] * SLEEVE_TIP];   // where the right end is, before the camera
    info.forge = {
      heading: autoAngle,
      endWorld,
      ends: [project(vpYaw, [-SLEEVE_TIP, 0, 0]), project(vpYaw, [SLEEVE_TIP, 0, 0])],
      plates: plates.map((p) => ({ size: p.size, alpha: p.alpha, moving: p.moving, rim: rimPoint(p) }))
    };

    blend('add');
    if (monthGlow > 0) {
      const ends = [project(vpYaw, [-1.9, 0, 0]), project(vpYaw, [1.9, 0, 0])];
      const rx = Math.abs(ends[1][0] - ends[0][0]) * 0.55;
      const ramp = heatT < 1 / 3 ? P.heatA : heatT < 2 / 3 ? P.heatB : P.heatC;
      sprite(ramp, centre, rx, rx * (size.w / size.h) * 0.35, 0.18 * monthGlow * (0.5 + heatT), 2.2);
    }
    const count = 22 + 170 * f.k;
    r.ember.use().m4('uMVP', vpYaw).f('uTime', f.t).f('uCount', count).f('uRise', 0.6 + 1.6 * f.k).f('uPx', size.h * 1.4)
      .rgb('uSpark', P.spark).rgb('uHot', heatT > 0.5 ? P.heatC : P.heatB).f('uStrength', 0.55 + 0.6 * f.k);
    gl.bindVertexArray(r.seeds.va);
    gl.drawArrays(gl.POINTS, 0, PARTICLES);

    // Heat haze above the bar, only once it is genuinely hot.
    const top = project(vpYaw, [0, 0.62, 0]);
    const uvTop = (top[1] + 1) / 2;
    return { haze: monthGlow * Math.min(Math.max((f.k - 0.5) / 0.45, 0), 1), hazeRect: [0.04, (centre[1] + 1) / 2, 0.96, Math.min(1, uvTop + 0.12)] };
  }

  function fractal(f) {
    const P = f.palette;
    blend(null);
    r.bloom.use().rgb('uA', P.bloomA).rgb('uB', P.bloomB).rgb('uBase', P.base).f('uTime', f.t).f('uAspect', size.w / size.h).f('uLift', 0.55 + 0.45 * f.glow);
    fullscreen();

    const y0 = Math.round(((f.band[0] + 1) / 2) * size.h);
    const h = Math.max(1, Math.round(((f.band[1] - f.band[0]) / 2) * size.h));
    const zoom = f.k ** 1.3;
    const aspect = size.w / h;
    // At zero the whole set must fit, which a narrow portrait view decides by width.
    const startHalf = Math.max(ZOOM.startHalf, 1.6 / aspect);
    const half = startHalf * (ZOOM.minHalf / startHalf) ** zoom * (1 + 0.03 * Math.sin(f.t * 0.1));
    const shrink = half / startHalf;
    const centre = ZOOM.target.map((v, i) => v + (ZOOM.start[i] - v) * shrink);
    info.fractal = { half, iterations: Math.round(ZOOM.minIter + (ZOOM.maxIter - ZOOM.minIter) * f.k), saturation: 0.35 + 0.65 * f.k };

    gl.viewport(0, y0, size.w, h);
    blend('alpha');
    r.mandel.use().f('uCentre', centre[0], centre[1]).f('uHalf', half).f('uAspect', aspect)
      .f('uIter', info.fractal.iterations).f('uTime', f.t).f('uSat', info.fractal.saturation)
      .f('uFeather', f.full ? 0.001 : 0.5).rgb('uA', P.bloomA).rgb('uB', P.bloomB).rgb('uInk', P.ink).rgb('uBase', P.base);
    fullscreen();
    gl.viewport(0, 0, size.w, size.h);

    /* Lightning traces the set's real boundary: the main cardioid
     * c(θ) = e^{iθ}/2 − e^{2iθ}/4, which runs straight through Seahorse Valley,
     * so it stays on-screen at every zoom depth. */
    const toNDC = ([x, y]) => [(x - centre[0]) / (half * aspect), f.band[0] + ((y - centre[1]) / half + 1) * ((f.band[1] - f.band[0]) / 2)];
    strike(f, 'boundary', f.k, () => {
      const card = (t) => [Math.cos(t) / 2 - Math.cos(2 * t) / 4, Math.sin(t) / 2 - Math.sin(2 * t) / 4];
      let best = Math.PI; let dist = Infinity;
      for (let i = 0; i < 720; i += 1) {
        const t = (i / 720) * Math.PI * 2;
        const [x, y] = card(t);
        const d = Math.hypot(x - centre[0], y - centre[1]);
        if (d < dist) { dist = d; best = t; }
      }
      const span = Math.min(2.5, half * 1.8) * (0.5 + f.rand());
      const start = best - span / 2 + (f.rand() - 0.5) * span;
      const pts = [];
      for (let i = 0; i <= 18; i += 1) {
        const [x, y] = card(start + (span * i) / 18);
        const jitter = (f.rand() - 0.5) * half * 0.05;
        pts.push([x + jitter, y + jitter, 0]);
      }
      const branches = [];
      for (let i = 0; i < boltBranches(f.k); i += 1) {
        const from = pts[1 + Math.floor(f.rand() * (pts.length - 2))];
        const to = [from[0] + (f.rand() - 0.5) * half * 0.6, from[1] + (f.rand() - 0.5) * half * 0.6, 0];
        branches.push(displace3(from, to, 3, half * 0.08, f.rand));
      }
      return { points: pts, branches, core: P.ink, glow: P.bloomA, peak: 0.6 + 0.4 * f.k };
    });
    drawBolts(f, toNDC);
  }

  function terminal(f) {
    const P = f.palette;
    const pitch = 0.16;
    const camY = 2.4;
    const aspect = size.w / size.h;
    const fov = f.full ? FOV * 1.6 : FOV * 1.9;
    blend(null);
    r.floor.use().rgb('uBase', P.base).rgb('uGrid', P.grid).rgb('uS2', P.stream2).rgb('uInk', P.ink)
      .f('uTime', f.t).f('uAspect', aspect).f('uTanY', Math.tan(fov / 2)).f('uPitch', pitch).f('uCamY', camY)
      .f('uBurst', Math.min(Math.max((f.k - 0.3) / 0.5, 0), 1) * 0.4).f('uPulse', (0.75 + 0.25 * Math.sin(f.t * 0.35)) * (0.8 + 0.6 * f.k));
    fullscreen();

    const view = multiply(rotationX(pitch), translation(0, -camY, 0));
    const vp = multiply(perspective(fov, aspect, 0.1, 80), view);
    blend('add');
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, r.atlas);
    r.glyph.use().m4('uVP', vp).f('uTime', f.t).f('uSpeed', 0.9 + 2.4 * f.k).f('uDensity', 0.35 + 0.65 * f.k).f('uPx', size.h)
      .f('uRate', 2 + 6 * f.k).f('uTrail', 6 + 8 * f.k).f('uHeadGlow', 0.12 + 0.88 * f.k).rgb('uInk', P.ink).rgb('uS1', P.stream).rgb('uS2', P.stream2).i('uAtlas', 0).f('uBright', 1.5 + 0.6 * f.k);
    gl.bindVertexArray(r.glyphs.va);
    gl.drawArrays(gl.POINTS, 0, r.glyphs.count);
  }

  const SCENES = { kemet, forge, fractal, terminal };

  return {
    gl,
    resize() {},                        // targets follow the canvas size in render()
    /** Draw one frame. `f` is everything backdrop.js knows; see its draw(). */
    render(f) {
      if (!r || gl.isContextLost()) return false;
      const scene = SCENES[f.skin];
      if (!scene) return false;
      ensureTargets(canvas.width, canvas.height, f.dpr);
      gl.bindFramebuffer(gl.FRAMEBUFFER, (r.ms || r.resolve).fbo);
      gl.viewport(0, 0, size.w, size.h);
      gl.clearColor(f.palette.base[0] / 255, f.palette.base[1] / 255, f.palette.base[2] / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const extra = scene(f) || {};
      gl.disable(gl.BLEND);

      if (r.ms) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, r.ms.fbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, r.resolve.fbo);
        gl.blitFramebuffer(0, 0, size.w, size.h, 0, 0, size.w, size.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      const ceiling = f.full ? 1 : lum(f.palette.ink) * 0.995;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, r.resolve.tex);
      r.post.use().i('uScene', 0).f('uLmin', lum(f.palette.base)).f('uLmax', ceiling).f('uTime', f.t)
        .f('uHaze', extra.haze || 0).f('uHazeRect', ...(extra.hazeRect || [0, 0, 1, 1]));
      fullscreen();
      return true;
    },
    resetLightning() { tracks = {}; bolts = []; },
    info,
    trackNames: LIGHTNING_TRACKS,
    lost() { r = null; tracks = {}; bolts = []; },
    restore() { try { build(); return true; } catch { return false; } },
    readPixels() {
      const out = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return { width: canvas.width, height: canvas.height, data: out, flipped: true };
    }
  };
}
