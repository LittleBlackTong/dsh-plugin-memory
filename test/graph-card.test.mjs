import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/** Minimal React stub: enough to build and walk an element tree. */
const React = {
  // React.memo is an identity wrapper for this harness.
  memo(component) { return component },
  createElement(type, props, ...children) {
    const flat = []
    const push = (value) => {
      if (Array.isArray(value)) { for (const item of value) push(item); return }
      if (value === null || value === undefined || value === false) return
      flat.push(value)
    }
    for (const child of children) push(child)
    return { type, props: props ?? {}, children: flat }
  },
  useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
  useEffect() {},
  useRef(value) { return { current: value } },
  useMemo(fn) { return fn() },
  Component: class { constructor(p) { this.props = p } },
}

/** Load the browser half in a sandbox and return its test seam. */
function loadClient() {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let captured
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(options) {
          captured = options.factory((id) => {
            if (id === 'react') return React
            throw new Error(`unexpected require: ${id}`)
          })
        },
      },
    },
    document: {
      getElementById: () => null,
      createElement: () => ({ id: '', textContent: '', setAttribute() {} }),
      head: { appendChild() {} },
    },
    console,
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  assert.ok(captured !== undefined, 'factory did not run')
  assert.equal(typeof captured.apply, 'function')
  assert.ok(Array.isArray(captured.inject))
  return captured.__test
}

/** Walk an element tree, collecting every element of a given tag. */
function findAll(node, tag, out = []) {
  if (node === null || typeof node !== 'object') return out
  if (node.type === tag) out.push(node)
  for (const child of node.children ?? []) findAll(child, tag, out)
  return out
}

const graph = {
  nodes: [
    { id: 'a', label: 'A', type: 'project', tags: [], degree: 2, x: 100, y: 100, r: 8, color: '#4c8bf5' },
    { id: 'b', label: 'B', type: 'skill', tags: [], degree: 1, x: 160, y: 100, r: 6, color: '#8b7bf5' },
    { id: 'SOUL.md', label: 'SOUL', type: 'meta', tags: [], degree: 1, hub: true, x: 80, y: 60, r: 10, color: '#5b6068' },
  ],
  edges: [{ source: 'a', target: 'b', kind: 'tag', weight: 1 }, { source: 'a', target: 'SOUL.md', kind: 'link', weight: 1 }],
  stats: { pages: 2, links: 1, tagEdges: 1, typeEdges: 0, isolated: [] },
}

test('the browser half loads with only react available and exposes a seam', () => {
  const seam = loadClient()
  assert.equal(typeof seam.GraphCard, 'function')
  assert.equal(typeof seam.GraphView, 'function')
  assert.equal(seam.GRAPH_W, 560)
  assert.equal(seam.GRAPH_H, 340)
})

test('the inlined drag maths matches the canonical module behaviour', async () => {
  const seam = loadClient()
  const { applyDrag } = await import('../lib/graph-drag.js')
  const base = new Map([['a', { x: 100, y: 100 }], ['b', { x: 140, y: 100 }], ['c', { x: 400, y: 300 }]])
  const edges = [{ source: 'a', target: 'b' }, { source: 'a', target: 'c' }]
  const target = { x: 300, y: 150 }
  const mine = seam.applyDrag(base, 'a', target, edges, { width: 560, height: 340 })
  const theirs = applyDrag(base, 'a', target, edges, { width: 560, height: 340 })
  // The sandbox has its own realm, so compare by value: JSON, not prototypes.
  const plain = (map) => JSON.parse(JSON.stringify([...map.entries()].sort()))
  assert.deepEqual(plain(mine), plain(theirs))
  // The copy must not alias the base map.
  assert.notEqual(mine, base)
  assert.deepEqual(base.get('a'), { x: 100, y: 100 })
})

test('the inlined clamp treats infinities as directions, NaN as missing', () => {
  const { clampToBox } = loadClient()
  assert.equal(clampToBox(-5, 0, 100), 0)
  assert.equal(clampToBox(500, 0, 100), 100)
  assert.equal(clampToBox(Number.NaN, 7, 100), 7)
  assert.equal(clampToBox(Number.POSITIVE_INFINITY, 0, 100), 100)
})

test('GraphView renders one group per node and one line per edge', () => {
  const seam = loadClient()
  const tree = seam.GraphView({ graph })
  const lines = findAll(tree, 'line')
  const groups = findAll(tree, 'g')
  assert.equal(lines.length, graph.edges.length)
  assert.equal(groups.length, graph.nodes.length)
  // Drag wiring lives on the group, so dot and label travel together.
  for (const group of groups) {
    assert.equal(typeof group.props.onPointerDown, 'function')
    assert.equal(typeof group.props.onPointerMove, 'function')
    assert.equal(typeof group.props.onPointerUp, 'function')
    assert.match(group.props.transform, /^translate\(-?\d+(\.\d+)? -?\d+(\.\d+)?\)$/)
  }
})

test('edges are drawn from live positions, not stale node coordinates', () => {
  const seam = loadClient()
  const tree = seam.GraphView({ graph })
  const lines = findAll(tree, 'line')
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  for (const line of lines) {
    assert.ok(line.props.x1 >= 0 && line.props.x1 <= seam.GRAPH_W)
    assert.ok(line.props.y1 >= 0 && line.props.y1 <= seam.GRAPH_H)
  }
  // With no drag in flight, endpoints equal the server coordinates.
  const edge = graph.edges[0]
  const expected = byId.get(edge.source)
  assert.equal(lines[0].props.x1, expected.x)
})

test('an empty graph renders nothing rather than an empty card', () => {
  const seam = loadClient()
  assert.equal(seam.GraphView({ graph: { nodes: [], edges: [], stats: { pages: 0 } } }), null)
})
