import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TYPE_COLORS, layoutGraph, typeColor } from '../lib/graph-layout.js'

const nodes = [
  { id: 'a', degree: 5 },
  { id: 'b', degree: 1 },
  { id: 'c', degree: 1 },
  { id: 'd', degree: 0 },
  { id: 'SOUL.md', degree: 2, hub: true },
]
const edges = [
  { source: 'a', target: 'b', kind: 'tag' },
  { source: 'a', target: 'c', kind: 'link' },
  { source: 'a', target: 'SOUL.md', kind: 'link' },
]

test('layout returns finite coordinates for every node, inside the box', () => {
  const { positions, radius } = layoutGraph(nodes, edges, { width: 400, height: 300 })
  assert.equal(positions.size, nodes.length)
  for (const [id, p] of positions) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${id} has non-finite coords`)
    assert.ok(p.x >= 0 && p.x <= 400, `${id} x=${p.x} outside box`)
    assert.ok(p.y >= 0 && p.y <= 300, `${id} y=${p.y} outside box`)
  }
  // radius grows with degree and is always positive
  assert.ok(radius('a') > radius('d'))
  assert.ok(radius('d') > 0)
})

test('layout is deterministic (same input, same coordinates)', () => {
  const first = layoutGraph(nodes, edges)
  const second = layoutGraph(nodes, edges)
  for (const [id, p] of first.positions) {
    const q = second.positions.get(id)
    assert.equal(p.x, q.x)
    assert.equal(p.y, q.y)
  }
})

test('tied nodes are pushed apart instead of collapsing to one point', () => {
  const tied = [{ id: 'x' }, { id: 'y' }, { id: 'z' }]
  const { positions } = layoutGraph(tied, [])
  const points = [...positions.values()]
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y)
      assert.ok(d > 5, `nodes ${i}/${j} collapsed (distance ${d.toFixed(2)})`)
    }
  }
})

test('an empty graph is handled without throwing', () => {
  const { positions, radius } = layoutGraph([], [])
  assert.equal(positions.size, 0)
  assert.equal(radius('anything'), 5)
})

test('edges pointing at unknown nodes are ignored', () => {
  const { positions } = layoutGraph([{ id: 'a' }], [{ source: 'a', target: 'ghost', kind: 'tag' }])
  assert.equal(positions.size, 1)
  assert.ok(Number.isFinite(positions.get('a').x))
})

test('every memory type has a stable colour', () => {
  for (const [type, color] of Object.entries(TYPE_COLORS)) {
    assert.match(color, /^#[0-9a-f]{6}$/, `${type} colour malformed`)
    assert.equal(typeColor(type), color)
  }
  assert.equal(typeColor('something-new'), TYPE_COLORS.unknown)
})

test('graph-layout.js is dependency-free (node builtins only)', () => {
  const source = readFileSync(new URL('../lib/graph-layout.js', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/^import\s+.*?from\s+'([^']+)'/gm)].map((m) => m[1])
  for (const specifier of imports) {
    assert.ok(specifier.startsWith('node:'), `unexpected dependency: ${specifier}`)
  }
})
