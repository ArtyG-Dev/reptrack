import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY, monolithFaces, MAX_STARS, starField, dateHash, linkWindowDays, constellationLinks,
  TWINKLE, twinkle, twinkleHz, REGIONS, PLANET, planetSize, orreryPlanets
} from '../js/skin-data.js';
import { MUSCLES } from '../js/exercises-seed.js';

const TODAY = '2026-11-11';            // a Wednesday

test('monolith: four faces, this week first, Monday to Sunday', () => {
  const m = monolithFaces({ trained: new Set(['2026-11-09', '2026-11-03']), prs: new Set(['2026-11-03']), frosted: new Set(['2026-10-20']), todayISO: TODAY });
  assert.deepEqual(m.faces.map((f) => f.weekStartISO), ['2026-11-09', '2026-11-02', '2026-10-26', '2026-10-19']);
  assert.equal(m.faces[0].days[0].state, DAY.trained);
  assert.equal(m.faces[0].days[3].state, DAY.future, 'Thursday has not happened yet');
  assert.equal(m.faces[1].days[1].state, DAY.pr);
  assert.equal(m.faces[3].days[1].frosted, true);
  assert.equal(m.states.length, 28);
  assert.equal(m.frost.reduce((a, b) => a + b, 0), 1);
});

test('constellation: one star per training day in the last 365, stable positions, PR days marked', () => {
  const trained = new Set(['2025-11-11', '2025-11-12', '2026-06-01', '2026-11-11']);
  const stars = starField({ trained, prs: new Set(['2026-06-01']), todayISO: TODAY });
  assert.deepEqual(stars.map((s) => s.dateISO), ['2025-11-12', '2026-06-01', '2026-11-11'], 'a year and a day ago is outside');
  assert.equal(stars[1].pr, true);
  assert.deepEqual(starField({ trained, prs: new Set(), todayISO: TODAY })[1].lat, stars[1].lat, 'same date, same place');
  for (const s of stars) assert.ok(Math.abs(s.lat) <= 0.42 && s.lon >= 0 && s.lon < Math.PI * 2);
  assert.notEqual(dateHash('2026-06-01'), dateHash('2026-06-02'));
});

test('constellation: never more than 400 stars, newest kept', () => {
  const trained = new Set();
  for (let i = 0; i < 1000; i += 1) trained.add(new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10));
  const stars = starField({ trained, prs: new Set(), todayISO: '2026-09-26' });
  assert.ok(stars.length <= MAX_STARS);
  assert.equal(stars.at(-1).dateISO, '2026-09-26');
});

test('constellation lines: grow with the level, the last 28 days at 10, and a lower level only dims them', () => {
  const trained = new Set();
  for (let i = 0; i < 60; i += 2) trained.add(new Date(Date.UTC(2026, 10, 11 - i)).toISOString().slice(0, 10));
  const stars = starField({ trained, prs: new Set(), todayISO: TODAY });
  assert.equal(linkWindowDays(10), 28);
  assert.equal(linkWindowDays(0), 0);
  const at = (level, peakLevel) => constellationLinks(stars, { level, peakLevel, todayISO: TODAY });
  assert.equal(at(0, 0).length, 0);
  const ten = at(10, 10);
  assert.equal(ten.length, 13, '14 stars in 28 days, 13 lines: one connected figure');
  assert.ok(ten.every((l) => l.bright));
  assert.ok(at(5, 5).length < ten.length && at(5, 5).length > 0);
  const dropped = at(3, 10);
  assert.equal(dropped.length, ten.length, 'a drop never deletes a line');
  assert.ok(dropped.some((l) => !l.bright) && dropped.some((l) => l.bright), 'older lines fade to a trace');
});

test('twinkle stays within a 15% swing and at most 1 Hz, at any intensity', () => {
  assert.equal(TWINKLE.maxSwing, 0.15);
  assert.ok(twinkleHz(1) <= TWINKLE.maxHz && twinkleHz(0) > 0);
  for (const k of [0, 0.5, 1]) {
    for (let t = 0; t < 5; t += 0.01) {
      const b = twinkle(t, 1.3, k);
      assert.ok(b >= 1 - TWINKLE.maxSwing - 1e-9 && b <= 1 + 1e-9);
    }
  }
});

test('orrery: eight regions cover every muscle exactly once', () => {
  assert.equal(REGIONS.length, 8);
  const all = REGIONS.flatMap((r) => r.muscles);
  assert.deepEqual([...all].sort(), [...MUSCLES].sort());
});

test('orrery: size has a floor, grows with weekly sets; rings are lifetime PRs, up to 3', () => {
  assert.equal(planetSize(0), PLANET.minSize);
  assert.ok(planetSize(5) > planetSize(1));
  assert.equal(planetSize(100), PLANET.sizeAtFull);
  const byId = new Map([['bench', { id: 'bench', primaryMuscles: ['chest'], secondaryMuscles: ['triceps'] }]]);
  const sets = [
    { exerciseId: 'bench', dateISO: '2026-11-10', isPR: true },
    { exerciseId: 'bench', dateISO: '2025-01-10', isPR: true },
    { exerciseId: 'bench', dateISO: '2025-01-03', isPR: true },
    { exerciseId: 'bench', dateISO: '2024-01-03', isPR: true },
    { exerciseId: 'bench', dateISO: '2026-11-10', isPR: true, isWarmup: true }
  ];
  const planets = orreryPlanets({ sets, exercisesById: byId, todayISO: TODAY });
  const chest = planets.find((p) => p.id === 'chest');
  const arms = planets.find((p) => p.id === 'arms');
  assert.equal(chest.weekly, 1, 'warm-ups do not count');
  assert.equal(chest.rings, 3, 'four PRs, capped at three rings');
  assert.equal(arms.weekly, 0.5);
  assert.equal(arms.rings, 0, 'PRs count for the region of the primary muscles only');
  assert.equal(arms.size > PLANET.minSize, true);
});

test('orrery: orbits nest outward, and no planet outruns the shared rotation cap', async () => {
  const { orbitRadius, planetAngle } = await import('../js/skin-data.js');
  for (let i = 1; i < 8; i += 1) assert.ok(orbitRadius(i) > orbitRadius(i - 1));
  for (let i = 0; i < 8; i += 1) {
    const rate = planetAngle(i, 1) - planetAngle(i, 0);
    assert.ok(rate > 0 && rate <= 1 + 1e-12, `planet ${i} turns at ${rate.toFixed(3)} × spin`);
  }
});
