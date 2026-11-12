/* The 3D muscle map — pure geometry. A stylised artist's mannequin built from
 * smooth primitives (ellipsoids and capsules): one or a mirrored pair per
 * muscle group, plus plain "body" pieces (head, neck, pelvis, joints, hands,
 * feet, shins) that carry no muscle. No model file, no library.
 *
 * Coordinates: metres-ish, y up, the figure faces +z, feet at y = 0.
 * The camera orbits the figure (yaw about y, pitch about x), so a picking ray
 * is built straight in world space and the parts never move.
 *
 * Covered by tests/mannequin.test.js. Rendered by js/mannequin-gl.js.
 */

import { MUSCLES } from './exercises-seed.js';

/** Proportions only: the three figures are the same mannequin at different widths. */
export const MANNEQUIN_FIGURES = Object.freeze({
  neutral: { shoulder: 0.2, chest: 1, waist: 0.135, hip: 0.15 },
  male: { shoulder: 0.225, chest: 1.08, waist: 0.14, hip: 0.14 },
  female: { shoulder: 0.185, chest: 0.94, waist: 0.12, hip: 0.165 }
});

export const HEIGHT = 1.8;
export const CENTRE_Y = 0.92;

const E = (muscle, c, r) => ({ kind: 'ellipsoid', muscle, c, r });
const C = (muscle, a, b, r) => ({ kind: 'capsule', muscle, a, b, r });
const mirror = (part) => (part.kind === 'ellipsoid'
  ? { ...part, c: [-part.c[0], part.c[1], part.c[2]] }
  : { ...part, a: [-part.a[0], part.a[1], part.a[2]], b: [-part.b[0], part.b[1], part.b[2]] });
const pair = (part) => [part, mirror(part)];

/** Every primitive of a figure. `muscle` is a MUSCLES id, or null for a body piece. */
export function mannequinParts(figure = 'neutral') {
  const { shoulder: S, chest: K, waist: W, hip: H } = MANNEQUIN_FIGURES[figure] || MANNEQUIN_FIGURES.neutral;
  const elbowY = 1.12;
  const wristY = 0.86;
  const armX = S + 0.035;
  return [
    // Body pieces: the mannequin itself, neutral grey.
    E(null, [0, 1.66, 0], [0.095, 0.115, 0.105]),                 // head
    C(null, [0, 1.48, -0.01], [0, 1.56, 0], 0.045),                // neck
    E(null, [0, 1.22, 0], [W + 0.03, 0.22, 0.095]),                // torso core
    E(null, [0, 0.95, 0], [H, 0.09, 0.1]),                         // pelvis
    ...pair(E(null, [armX + 0.005, elbowY, 0], [0.042, 0.042, 0.042])),       // elbows
    ...pair(E(null, [armX + 0.01, wristY - 0.06, 0.01], [0.04, 0.06, 0.025])), // hands
    ...pair(E(null, [H * 0.55, 0.5, 0.01], [0.055, 0.05, 0.055])),           // knees
    ...pair(C(null, [H * 0.55, 0.46, 0.035], [H * 0.55, 0.1, 0.03], 0.04)),   // shins
    ...pair(E(null, [H * 0.55, 0.035, 0.05], [0.045, 0.035, 0.1])),          // feet

    // Muscle groups.
    ...pair(E('chest', [0.085 * K, 1.36, 0.075], [0.085 * K, 0.065, 0.045])),
    ...pair(C('traps', [0.035, 1.5, -0.03], [S - 0.07, 1.44, -0.03], 0.04)),
    ...pair(E('front-delts', [S - 0.02, 1.41, 0.04], [0.045, 0.055, 0.04])),
    ...pair(E('side-delts', [S + 0.012, 1.4, 0], [0.04, 0.06, 0.045])),
    ...pair(E('rear-delts', [S - 0.02, 1.41, -0.045], [0.045, 0.055, 0.04])),
    ...pair(E('upper-back-lats', [0.075, 1.27, -0.07], [0.09 + (S - 0.2) * 0.4, 0.15, 0.045])),
    E('lower-back', [0, 1.05, -0.075], [0.08, 0.075, 0.035]),
    E('abs', [0, 1.13, 0.085], [0.065, 0.13, 0.035]),
    ...pair(E('obliques', [W + 0.005, 1.12, 0.035], [0.035, 0.1, 0.055])),
    ...pair(C('biceps', [armX, 1.33, 0.022], [armX + 0.005, elbowY + 0.04, 0.022], 0.038)),
    ...pair(C('triceps', [armX, 1.33, -0.022], [armX + 0.005, elbowY + 0.04, -0.022], 0.038)),
    ...pair(C('forearms', [armX + 0.007, elbowY - 0.03, 0.005], [armX + 0.01, wristY, 0.008], 0.035)),
    ...pair(E('hip-flexors', [0.075, 0.93, 0.075], [0.04, 0.045, 0.03])),
    ...pair(E('glutes', [0.075, 0.9, -0.08], [0.08, 0.08, 0.055])),
    ...pair(C('quads', [H * 0.6, 0.85, 0.035], [H * 0.56, 0.56, 0.035], 0.062)),
    ...pair(C('hamstrings', [H * 0.6, 0.84, -0.035], [H * 0.56, 0.58, -0.035], 0.058)),
    ...pair(C('adductors', [H * 0.25, 0.82, 0], [H * 0.42, 0.6, 0], 0.035)),
    ...pair(C('calves', [H * 0.56, 0.42, -0.04], [H * 0.55, 0.18, -0.035], 0.048))
  ];
}

/* ---------- mesh ---------- */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** A unit sphere as (latitude, longitude) quads, positions = normals. */
function sphereGrid(lat = 12, lon = 18) {
  const tris = [];
  const at = (i, j) => {
    const t = (i / lat) * Math.PI; const p = (j / lon) * Math.PI * 2;
    return [Math.sin(t) * Math.cos(p), Math.cos(t), Math.sin(t) * Math.sin(p)];
  };
  for (let i = 0; i < lat; i += 1) {
    for (let j = 0; j < lon; j += 1) {
      const a = at(i, j); const b = at(i + 1, j); const c = at(i + 1, j + 1); const d = at(i, j + 1);
      tris.push(a, b, c, a, c, d);
    }
  }
  return tris;
}
const SPHERE = sphereGrid();

/**
 * Interleaved triangles for every part: position 3, normal 3, muscle index 1
 * (into MUSCLES, or −1 for a body piece). One static buffer per figure.
 */
export function mannequinMesh(parts) {
  const out = [];
  const push = (p, n, m) => out.push(p[0], p[1], p[2], n[0], n[1], n[2], m);
  for (const part of parts) {
    const m = part.muscle ? MUSCLES.indexOf(part.muscle) : -1;
    if (part.kind === 'ellipsoid') {
      const [rx, ry, rz] = part.r;
      for (const v of SPHERE) push(add(part.c, [v[0] * rx, v[1] * ry, v[2] * rz]), norm([v[0] / rx, v[1] / ry, v[2] / rz]), m);
    } else {
      // A capsule: the sphere grid split at its equator, each half moved to one end.
      const axis = sub(part.b, part.a);
      const up = norm(axis);
      const side = norm(Math.abs(up[1]) < 0.9 ? cross(up, [0, 1, 0]) : cross(up, [1, 0, 0]));
      const fwd = cross(side, up);
      for (const v of SPHERE) {
        const end = v[1] >= 0 ? part.b : part.a;
        const n = add(add(scale(side, v[0]), scale(up, v[1])), scale(fwd, v[2]));
        push(add(end, scale(n, part.r)), n, m);
      }
    }
  }
  return new Float32Array(out);
}

/* ---------- camera and picking ---------- */

export const FOV = (32 * Math.PI) / 180;
/** The Progress screen's resting view: three-quarter front. */
export const THREE_QUARTER_YAW = -0.62;

/** Where the camera sits for a heading (yaw) and tilt (pitch), looking at the figure's middle. */
export function cameraPose(yaw, pitch, aspect = 0.6) {
  const half = HEIGHT * 0.56;                                      // fit the full height, with room
  const dist = Math.max(half, (half * 0.55) / Math.max(aspect, 0.2)) / Math.tan(FOV / 2);
  const target = [0, CENTRE_Y, 0];
  const eye = add(target, [Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist]);
  const forward = norm(sub(target, eye));
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  return { eye, target, forward, right, up, dist };
}

/** The world-space ray through a point given in normalised device coordinates (−1…1, y up). */
export function rayThrough(pose, ndcX, ndcY, aspect) {
  const t = Math.tan(FOV / 2);
  const dir = norm(add(pose.forward, add(scale(pose.right, ndcX * t * aspect), scale(pose.up, ndcY * t))));
  return { origin: pose.eye, dir };
}

function hitEllipsoid(part, { origin, dir }) {
  const o = sub(origin, part.c).map((v, i) => v / part.r[i]);
  const d = dir.map((v, i) => v / part.r[i]);
  const a = dot(d, d); const b = 2 * dot(o, d); const c = dot(o, o) - 1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t > 0 ? t : Infinity;
}

/* Ray–capsule (I. Quilez). */
function hitCapsule(part, { origin, dir }) {
  const ba = sub(part.b, part.a); const oa = sub(origin, part.a);
  const baba = dot(ba, ba); const bard = dot(ba, dir); const baoa = dot(ba, oa);
  const rdoa = dot(dir, oa); const oaoa = dot(oa, oa);
  const a = baba - bard * bard; const b = baba * rdoa - baoa * bard; const c = baba * oaoa - baoa * baoa - part.r * part.r * baba;
  let h = b * b - a * c;
  if (h >= 0 && a !== 0) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t > 0) return t;
    const oc = y <= 0 ? oa : sub(origin, part.b);
    const bb = dot(dir, oc); const cc = dot(oc, oc) - part.r * part.r;
    h = bb * bb - cc;
    if (h > 0) { const t2 = -bb - Math.sqrt(h); if (t2 > 0) return t2; }
  }
  return Infinity;
}

/** The muscle group under a ray, or null (a body piece in front, or nothing). */
export function pickMuscle(parts, ray) {
  let best = Infinity; let muscle = null;
  for (const part of parts) {
    const t = part.kind === 'ellipsoid' ? hitEllipsoid(part, ray) : hitCapsule(part, ray);
    if (t < best) { best = t; muscle = part.muscle; }
  }
  return muscle;
}

/** Where a muscle's first primitive sits on screen, for tests and screenshots. */
export function projectToNDC(pose, point, aspect) {
  const v = sub(point, pose.eye);
  const z = dot(v, pose.forward);
  const t = Math.tan(FOV / 2);
  return [dot(v, pose.right) / (z * t * aspect), dot(v, pose.up) / (z * t)];
}

export function partCentre(part) {
  return part.kind === 'ellipsoid' ? part.c : scale(add(part.a, part.b), 0.5);
}
