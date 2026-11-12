import test from 'node:test';
import assert from 'node:assert/strict';
import { MUSCLES } from '../js/exercises-seed.js';
import {
  MANNEQUIN_FIGURES, mannequinParts, mannequinMesh, cameraPose, rayThrough, pickMuscle,
  projectToNDC, partCentre, THREE_QUARTER_YAW
} from '../js/mannequin.js';

const FIGURES = Object.keys(MANNEQUIN_FIGURES);

test('three figures, neutral included, differing only in proportions', () => {
  assert.deepEqual(FIGURES.sort(), ['female', 'male', 'neutral']);
  const shape = (f) => mannequinParts(f).map((p) => `${p.kind}:${p.muscle}`);
  assert.deepEqual(shape('male'), shape('neutral'));
  assert.deepEqual(shape('female'), shape('neutral'));
  assert.notDeepEqual(mannequinParts('male'), mannequinParts('female'));
});

test('every muscle group has its own primitives, and only canonical groups appear', () => {
  for (const f of FIGURES) {
    const parts = mannequinParts(f);
    const groups = new Set(parts.map((p) => p.muscle).filter(Boolean));
    assert.deepEqual([...groups].sort(), [...MUSCLES].sort(), f);
    assert.ok(parts.every((p) => p.kind === 'ellipsoid' || p.kind === 'capsule'), 'smooth primitives only');
    assert.ok(parts.some((p) => p.muscle === null), 'plus plain mannequin pieces');
  }
});

test('the mesh is finite and tags every vertex with its muscle group (or −1)', () => {
  const data = mannequinMesh(mannequinParts('neutral'));
  assert.equal(data.length % 7, 0);
  assert.ok(data.every(Number.isFinite));
  const tags = new Set();
  for (let i = 6; i < data.length; i += 7) tags.add(data[i]);
  assert.deepEqual([...tags].sort((a, b) => a - b), [-1, ...MUSCLES.map((_, i) => i)]);
});

/** Aim a ray from a pose straight at a part's centre and see what it hits. */
function pickAt(figure, yaw, muscle) {
  const parts = mannequinParts(figure);
  const pose = cameraPose(yaw, 0, 0.6);
  const target = partCentre(parts.find((p) => p.muscle === muscle));
  const [x, y] = projectToNDC(pose, target, 0.6);
  return pickMuscle(parts, rayThrough(pose, x, y, 0.6));
}

test('ray-picking finds the muscle under the finger, from the front, the back and the side', () => {
  for (const f of FIGURES) {
    for (const m of ['chest', 'abs', 'quads', 'biceps', 'front-delts']) assert.equal(pickAt(f, 0, m), m, `${f} front: ${m}`);
    for (const m of ['glutes', 'hamstrings', 'calves', 'lower-back', 'triceps']) assert.equal(pickAt(f, Math.PI, m), m, `${f} back: ${m}`);
    assert.equal(pickAt(f, Math.PI / 2, 'side-delts'), 'side-delts', `${f} side`);
  }
});

test('a ray that misses the figure picks nothing; the resting view is three-quarter front', () => {
  const parts = mannequinParts('neutral');
  const pose = cameraPose(0, 0, 0.6);
  assert.equal(pickMuscle(parts, rayThrough(pose, 0.95, 0.95, 0.6)), null);
  assert.ok(THREE_QUARTER_YAW < -0.4 && THREE_QUARTER_YAW > -1.1, 'roughly 35° round from the front');
});
