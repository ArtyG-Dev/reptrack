import test from 'node:test';
import assert from 'node:assert/strict';

import { computeChart } from '../js/chart.js';

const points = (...values) => values.map((value, i) => ({ label: `2026-01-0${i + 1}`, value }));

test('points map inside the plot area, oldest left, newest right', () => {
  const c = computeChart(points(100, 105, 110), { width: 600, height: 200 });
  assert.equal(c.points.length, 3);
  assert.equal(c.points[0].x, c.plot.x);
  assert.equal(c.points.at(-1).x, c.plot.x + c.plot.w);
  for (const p of c.points) {
    assert.ok(p.y >= c.plot.y - 0.01 && p.y <= c.plot.y + c.plot.h + 0.01, `y ${p.y} inside plot`);
  }
});

test('higher values sit higher on the canvas', () => {
  const c = computeChart(points(100, 120));
  assert.ok(c.points[1].y < c.points[0].y);
});

test('a single point is centred rather than dividing by zero', () => {
  const c = computeChart(points(100));
  assert.equal(c.points.length, 1);
  assert.ok(Number.isFinite(c.points[0].x) && Number.isFinite(c.points[0].y));
  assert.equal(c.points[0].x, c.plot.x + c.plot.w / 2);
});

test('a flat series still produces a usable axis', () => {
  const c = computeChart(points(100, 100, 100));
  assert.ok(c.max > c.min);
  assert.ok(c.yTicks.length >= 2);
  for (const p of c.points) assert.ok(Number.isFinite(p.y));
});

test('the y axis brackets the data and never goes negative', () => {
  const c = computeChart(points(80, 140));
  assert.ok(c.min <= 80 && c.max >= 140);
  assert.ok(c.min >= 0);
});

test('no data yields empty geometry instead of throwing', () => {
  const c = computeChart([]);
  assert.deepEqual(c.points, []);
  assert.ok(c.yTicks.length >= 1);
});

test('at most three x labels are drawn, first and last included', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ label: `2026-02-${String(i + 1).padStart(2, '0')}`, value: 100 + i }));
  const c = computeChart(many);
  assert.ok(c.xLabels.length <= 3);
  assert.equal(c.xLabels[0].label, many[0].label);
  assert.equal(c.xLabels.at(-1).label, many.at(-1).label);
});

test('bars: one shared scale for this week and last, longest value fills the plot', async () => {
  const { computeBars } = await import('../js/chart.js');
  const c = computeBars([{ label: 'Chest', value: 10, previous: 5 }, { label: 'Lats', value: 2.5, previous: 12 }], { width: 400, labelWidth: 100, valueWidth: 40 });
  assert.equal(c.max, 12);
  assert.equal(c.plotW, 260);
  assert.equal(c.bars[1].prevW, 260, 'the largest of either series fills the width');
  assert.ok(Math.abs(c.bars[0].w - 260 * 10 / 12) < 0.01);
  assert.ok(c.bars[1].y > c.bars[0].y + c.bars[0].h, 'rows do not overlap');
  assert.ok(c.bars[0].prevY >= c.bars[0].y + c.bars[0].h, 'last week sits under this week');
  assert.equal(c.height, 4 * 2 + 2 * 30);
});

test('bars: zeros and an empty chart stay finite', async () => {
  const { computeBars } = await import('../js/chart.js');
  const c = computeBars([{ label: 'Calves', value: 0 }]);
  assert.equal(c.bars[0].w, 0);
  assert.equal(c.bars[0].prevW, 0);
  assert.equal(computeBars([]).bars.length, 0);
});
