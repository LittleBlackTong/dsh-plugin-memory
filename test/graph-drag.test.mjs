import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyDrag, clampToBox, neighbourLean, releasePositions } from '../lib/graph-drag.js'

const base = new Map([
  ['a', { x: 100, y: 100 }],
  ['b', { x: 140, y: 100 }],
  ['c', { x: 400, y: 300 }],
])
const edges = [
  { source: 'a', target: 'b', kind: 'tag' },
  { source: 'a', target: 'c', kind: 'link' },
]

test('clampToBox keeps coordinates inside and survives non-finite input', () => {
  assert.equal(clampToBox(50, 0, 100), 50)
  assert.equal(clampToBox(-50, 0, 100), 0)
  assert.equal(clampToBox(150, 0, 100), 100)
  assert.equal(clampToBox(Number.NaN, 7, 100), 7)
  assert.equal(clampToBox(Number.POSITIVE_INFINITY, 0, 100), 100)
  assert.equal(clampToBox(Number.NEGATIVE_INFINITY, 0, 100), 0)
})

test('neighbourLean grows with pull and shrinks with distance', () => {
  assert.ok(neighbourLean(10, 1) > neighbourLean(10, 0.3))
  assert.ok(neighbourLean(10, 1) >= neighbourLean(300, 1))
  assert.equal(neighbourLean(Number.NaN, Number.NaN), 0)
  // Never negative, even for a negative pull
  assert.ok(neighbourLean(10, -5) >= 0)
})

test('applyDrag moves the dragged node to the pointer and clamps it in the box', () => {
  const moved = applyDrag(base, 'a', { x: 500, y: 200 }, edges, { width: 560, height: 340 })
  assert.deepEqual(moved.get('a'), { x: 500, y: 200 })
  const clamped = applyDrag(base, 'a', { x: -40, y: 9999 }, edges, { width: 560, height: 340 })
  assert.deepEqual(clamped.get('a'), { x: 0, y: 340 })
})

test('applyDrag nudges neighbours along the drag and leaves the rest alone', () => {
  const moved = applyDrag(base, 'a', { x: 300, y: 100 }, edges)
  const b = moved.get('b')
  const c = moved.get('c')
  // b and c are neighbours of a: they move right, never left.
  assert.ok(b.x > 140, `b did not lean (${b.x})`)
  assert.equal(b.y, 100)
  assert.ok(c.x >= 400, `c should only be nudged toward a (${c.x})`)
  // The drag is horizontal, so vertical components stay put.
  assert.equal(c.y, 300)
})

test('applyDrag never mutates the base layout', () => {
  const snapshot = JSON.stringify([...base])
  applyDrag(base, 'a', { x: 300, y: 100 }, edges)
  assert.equal(JSON.stringify([...base]), snapshot)
})

test('applyDrag on an unknown node returns an unchanged copy', () => {
  const moved = applyDrag(base, 'ghost', { x: 10, y: 10 }, edges)
  assert.equal(moved.size, base.size)
  assert.deepEqual(moved.get('a'), base.get('a'))
  assert.notEqual(moved, base)
})

test('applyDrag tolerates missing edges and a record-shaped layout', () => {
  const record = { a: { x: 10, y: 10 }, b: { x: 20, y: 20 } }
  const moved = applyDrag(record, 'a', { x: 50, y: 50 }, undefined)
  assert.deepEqual(moved.get('a'), { x: 50, y: 50 })
  assert.deepEqual(moved.get('b'), { x: 20, y: 20 })
})

test('releasePositions hands back a fresh copy of the base layout', () => {
  const released = releasePositions(base)
  assert.deepEqual(released.get('a'), base.get('a'))
  assert.notEqual(released, base)
  released.set('a', { x: 0, y: 0 })
  assert.deepEqual(base.get('a'), { x: 100, y: 100 })
})

test('graph-drag.js is dependency-free', () => {
  const source = readFileSync(new URL('../lib/graph-drag.js', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/^import\s+.*?from\s+'([^']+)'/gm)].map((m) => m[1])
  for (const specifier of imports) {
    assert.ok(specifier.startsWith('node:'), `unexpected dependency: ${specifier}`)
  }
})
