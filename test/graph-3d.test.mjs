import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  GRAPH3D_DEFAULTS,
  depthSorted,
  hitTest3D,
  projectPoint,
  rotatePoint,
  spherePositions,
  unrotatePoint,
} from '../lib/graph-3d.js'

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

test('spherePositions: deterministic and every point sits on the sphere', () => {
  const nodes = [
    { id: 'b', type: 'skill' },
    { id: 'a', type: 'project' },
    { id: 'c', type: 'project' },
    { id: 'd', type: 'identity' },
  ]
  const first = spherePositions(nodes, { radius: 100 })
  const second = spherePositions(nodes, { radius: 100 })
  assert.deepEqual(first, second, 'same input, same coordinates')
  for (const point of first) {
    const r = Math.hypot(point.x, point.y, point.z)
    assert.ok(close(r, 100, 1e-6), `${point.id} radius ${r}`)
  }
})

test('spherePositions: stable order (sorted by type, then id) maps to deterministic slots', () => {
  const nodes = [
    { id: 'z', type: 'skill' },
    { id: 'a', type: 'identity' },
  ]
  const positions = spherePositions(nodes, { radius: 10 })
  assert.deepEqual(positions.map((p) => p.id), ['a', 'z'])
})

test('rotatePoint / unrotatePoint are inverse operations', () => {
  const point = { id: 'p', x: 12, y: -34, z: 56 }
  const rotated = rotatePoint(point, 0.7, -0.4)
  const back = unrotatePoint(rotated, 0.7, -0.4)
  assert.ok(close(back.x, point.x, 1e-9))
  assert.ok(close(back.y, point.y, 1e-9))
  assert.ok(close(back.z, point.z, 1e-9))
})

test('projectPoint: centre point lands at the canvas centre; far points shrink', () => {
  const view = { ...GRAPH3D_DEFAULTS, yaw: 0, pitch: 0, zoom: 1 }
  const near = projectPoint({ id: 'near', x: 0, y: 0, z: -100 }, view)
  const far = projectPoint({ id: 'far', x: 0, y: 0, z: 100 }, view)
  assert.ok(close(near.x, view.width / 2, 1e-9))
  assert.ok(close(near.y, view.height / 2, 1e-9))
  assert.ok(near.scale > far.scale, 'nearer means bigger')
  assert.ok(near.depth > far.depth, 'depth is 0 far, 1 near')
})

test('projectPoint: zoom scales the projection around the centre', () => {
  const view = { ...GRAPH3D_DEFAULTS, yaw: 0, pitch: 0, zoom: 1 }
  const point = { id: 'p', x: 100, y: 0, z: 0 }
  const normal = projectPoint(point, view)
  const zoomed = projectPoint(point, { ...view, zoom: 2 })
  const normalOffset = normal.x - view.width / 2
  const zoomedOffset = zoomed.x - view.width / 2
  assert.ok(close(zoomedOffset, normalOffset * 2, 1e-6))
})

test('depthSorted: far-first by default and near-first when asked', () => {
  const points = [{ z: 5 }, { z: -3 }, { z: 1 }]
  assert.deepEqual(depthSorted(points).map((p) => p.z), [-3, 1, 5])
  assert.deepEqual(depthSorted(points, 'near-first').map((p) => p.z), [5, 1, -3])
})

test('hitTest3D: returns the closest node within its projected radius, else null', () => {
  const points = [
    { id: 'a', x: 10, y: 10 },
    { id: 'b', x: 14, y: 10 },
  ]
  const radiusOf = { a: 8, b: 3 }
  assert.equal(hitTest3D(points, 11, 10, (p) => radiusOf[p.id])?.id, 'a')
  assert.equal(hitTest3D(points, 100, 100, () => 5), null)
})

test('graph3d stays dependency-free (node builtins only, no imports)', () => {
  const source = readFileSync(new URL('../lib/graph-3d.js', import.meta.url), 'utf8')
  assert.equal([...source.matchAll(/^import\s/mg)].length, 0, 'pure module has no imports')
})
