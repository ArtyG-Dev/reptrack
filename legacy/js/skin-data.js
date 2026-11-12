/* What the Monolith, Constellation and Orrery scenes show — pure, clock-free
 * (the caller passes the date), covered by tests/skin-data.test.js.
 *
 * Like every activity visual, none of this produces copy, and nothing in it
 * shrinks with a lapse: a missed day is simply an unlit bar or no star; what
 * was earned (a lit bar, a star, a ring) is never taken away.
 */

import { shiftDays } from './consistency.js';
import { weekRange } from './summary.js';
import { workingSets } from './progression.js';
import { muscleSets } from './muscles.js';

/* ---------- Monolith: the last four weeks, one face each ---------- */

/** Day states the shader reads. */
export const DAY = Object.freeze({ future: -1, rest: 0, trained: 1, pr: 2 });

/**
 * Four faces, the current week first (the front), each Monday → Sunday.
 * @param {{ trained: Set<string>, prs: Set<string>, frosted?: Set<string>, todayISO: string }} input
 * @returns {{ faces: Array<{ weekStartISO, days: Array<{ dateISO, state, frosted }> }>, states: number[], frost: number[] }}
 *   `states`/`frost` are the same 28 days flattened face by face, for the GPU.
 */
export function monolithFaces({ trained, prs, frosted = new Set(), todayISO }) {
  const { startISO } = weekRange(todayISO);
  const faces = [];
  for (let w = 0; w < 4; w += 1) {
    const weekStartISO = shiftDays(startISO, -7 * w);
    const days = [];
    for (let d = 0; d < 7; d += 1) {
      const dateISO = shiftDays(weekStartISO, d);
      const state = dateISO > todayISO ? DAY.future
        : prs.has(dateISO) ? DAY.pr
          : trained.has(dateISO) ? DAY.trained : DAY.rest;
      days.push({ dateISO, state, frosted: frosted.has(dateISO) });
    }
    faces.push({ weekStartISO, days });
  }
  return {
    faces,
    states: faces.flatMap((f) => f.days.map((d) => d.state)),
    frost: faces.flatMap((f) => f.days.map((d) => (d.frosted ? 1 : 0)))
  };
}

/* ---------- Constellation: one star per training day ---------- */

export const MAX_STARS = 400;
export const STAR_DAYS = 365;
export const LINK_DAYS = 28;              // at level 10, the last 28 days form one figure

/** A stable latitude in [−1, 1] (scaled by the scene) from the date alone, so a
 *  star never moves between visits. FNV-1a over the ISO string. */
export function dateHash(dateISO) {
  let h = 0x811c9dc5;
  for (let i = 0; i < dateISO.length; i += 1) {
    h ^= dateISO.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0xffffffff;
}

function dayOfYear(dateISO) {
  const [y, m, d] = dateISO.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000);
}

/**
 * Stars for the last 365 days, oldest first, capped at MAX_STARS (newest kept).
 * Longitude is the day of the year, so the sky turns with the calendar.
 */
export function starField({ trained, prs, todayISO }) {
  const from = shiftDays(todayISO, -(STAR_DAYS - 1));
  return [...trained]
    .filter((d) => d >= from && d <= todayISO)
    .sort()
    .slice(-MAX_STARS)
    .map((dateISO) => ({
      dateISO,
      lon: (dayOfYear(dateISO) / 365) * Math.PI * 2,
      lat: (dateHash(dateISO) * 2 - 1) * 0.42,          // radians, about ±24°: a band, so the figure reads
      pr: prs.has(dateISO),
      phase: dateHash(`${dateISO}~`) * Math.PI * 2       // twinkle offset
    }));
}

/** How many of the most recent days a level links: level 10 → all 28. */
export function linkWindowDays(level) {
  return Math.round((LINK_DAYS * Math.min(Math.max(level, 0), 10)) / 10);
}

/**
 * The figure's lines: consecutive stars (in date order) inside the window the
 * *peak* level ever reached. A line inside the current level's window is
 * `bright`; one only the peak reached is a faint trace — a lower level never
 * deletes a line, it dims it.
 * @returns {Array<{ from: number, to: number, bright: boolean }>} indices into `stars`
 */
export function constellationLinks(stars, { level, peakLevel, todayISO }) {
  const peak = Math.max(level, peakLevel || 0);
  const peakFrom = shiftDays(todayISO, -(linkWindowDays(peak) - 1));
  const nowFrom = shiftDays(todayISO, -(linkWindowDays(level) - 1));
  if (linkWindowDays(peak) === 0) return [];
  const links = [];
  for (let i = 1; i < stars.length; i += 1) {
    if (stars[i - 1].dateISO < peakFrom) continue;
    links.push({ from: i - 1, to: i, bright: linkWindowDays(level) > 0 && stars[i - 1].dateISO >= nowFrom });
  }
  return links;
}

/* Twinkle: a gentle brightness swing, never a flash. Both bounds are tested in
 * node and measured from real pixels in Chromium. */
export const TWINKLE = Object.freeze({ maxSwing: 0.15, maxHz: 1 });

/** Twinkle rate in Hz at an intensity: slow at rest, never past maxHz. */
export function twinkleHz(k) {
  return 0.15 + (TWINKLE.maxHz - 0.15) * Math.min(Math.max(k, 0), 1);
}

/** Brightness multiplier for one star at time t: within [1 − maxSwing, 1]. */
export function twinkle(t, phase, k) {
  return 1 - TWINKLE.maxSwing * 0.5 * (1 + Math.sin(2 * Math.PI * twinkleHz(k) * t + phase));
}

/* ---------- Orrery: eight planets, one per body region ---------- */

export const REGIONS = Object.freeze([
  { id: 'chest', name: 'Chest', muscles: ['chest'] },
  { id: 'back', name: 'Back', muscles: ['lats', 'upper-back', 'lower-back'] },
  { id: 'shoulders', name: 'Shoulders', muscles: ['front-delts', 'side-delts', 'rear-delts'] },
  { id: 'arms', name: 'Arms', muscles: ['biceps', 'triceps', 'forearms'] },
  { id: 'core', name: 'Core', muscles: ['abs', 'obliques', 'hip-flexors'] },
  { id: 'quads', name: 'Quads', muscles: ['quads'] },
  { id: 'posterior', name: 'Posterior chain', muscles: ['glutes', 'hamstrings', 'adductors'] },
  { id: 'calves', name: 'Calves', muscles: ['calves'] }
]);

export const PLANET = Object.freeze({ minSize: 0.35, sizeAtFull: 1, fullSets: 20, maxRings: 3 });

/** Size from this week's weighted sets: never below minSize, so an untrained
 *  region is still a planet, and easing toward 1 by `fullSets`. */
export function planetSize(weightedSets) {
  const t = Math.min(Math.max(weightedSets, 0) / PLANET.fullSets, 1);
  return PLANET.minSize + (PLANET.sizeAtFull - PLANET.minSize) * Math.sqrt(t);
}

/**
 * @returns {Array<{ id, name, muscles, weekly, size, rings }>} in REGIONS order.
 * `rings` = lifetime PRs on exercises whose primary muscles touch the region,
 * capped at 3. Lifetime, so a ring once earned stays.
 */
export function orreryPlanets({ sets = [], exercisesById = new Map(), todayISO }) {
  const { startISO, endISO } = weekRange(todayISO);
  const week = muscleSets(sets, exercisesById, startISO, endISO);
  const prs = workingSets(sets).filter((s) => s.isPR);
  return REGIONS.map((region) => {
    const weekly = region.muscles.reduce((sum, m) => sum + (week[m] || 0), 0);
    const prCount = prs.filter((s) => (exercisesById.get(s.exerciseId)?.primaryMuscles || []).some((m) => region.muscles.includes(m))).length;
    return { ...region, weekly, size: planetSize(weekly), rings: Math.min(PLANET.maxRings, prCount) };
  });
}

/** Orbit radius of planet i (0 = innermost), in scene units. */
export function orbitRadius(i) {
  return 0.42 + i * 0.13;
}

/** Planet i's angle on its orbit. Inner planets run faster (Kepler-like), and
 *  every planet runs at most as fast as `spin`, which backdrop.js integrates
 *  under the shared one-turn-per-8-seconds cap. */
export function planetAngle(i, spin) {
  return i * 2.39996 + spin * (orbitRadius(0) / orbitRadius(i)) ** 1.5;
}
