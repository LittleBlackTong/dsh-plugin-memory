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

test('the inlined view maths matches the canonical module', async () => {
  const seam = loadClient()
  const mod = await import('../lib/graph-view.js')
  const base = { x: 0, y: 0, w: seam.GRAPH_W, h: seam.GRAPH_H }
  // Zoom about an off-centre point, then pan — the two things a user does.
  const mineZoom = seam.zoomAt(base, 123, 45, 1 / 1.15)
  const modZoom = mod.zoomAt(base, 123, 45, 1 / 1.15)
  for (const key of ['x', 'y', 'w', 'h']) {
    assert.ok(Math.abs(mineZoom[key] - modZoom[key]) < 1e-9, `${key}: ${mineZoom[key]} vs ${modZoom[key]}`)
  }
  const scale = { scaleX: 0.5, scaleY: 0.5 }
  // Sandbox objects come from another realm: compare by value, not prototype.
  const plain = (v) => JSON.parse(JSON.stringify(v))
  assert.deepEqual(plain(seam.panBy(base, 100, 40, scale)), plain(mod.panBy(base, 100, 40, scale)))
  // Clamping must agree too: 40 zoom-ins hit the same ceiling in both copies.
  let mine = base
  let theirs = base
  for (let i = 0; i < 40; i += 1) {
    mine = seam.zoomAt(mine, 280, 170, 1 / 1.15)
    theirs = mod.zoomAt(theirs, 280, 170, 1 / 1.15)
  }
  assert.ok(Math.abs(mine.w - theirs.w) < 1e-9)
  assert.equal(mine.w, seam.GRAPH_W * seam.MIN_VIEW_SCALE, 'both copies must clamp at the same tightest viewport')
  assert.ok(mine.w < seam.GRAPH_W * 0.45, 'zooming in must actually get closer than half the base width')
})

test('the graph polls on a sane interval so memory edits show up live', () => {
  const seam = loadClient()
  assert.ok(Number.isFinite(seam.GRAPH_REFRESH_MS))
  assert.ok(seam.GRAPH_REFRESH_MS >= 5000, 'polling faster than 5s would hammer the store')
  assert.ok(seam.GRAPH_REFRESH_MS <= 120000, 'polling slower than 2min stops feeling live')
})

test('screen points map to graph points through the current view', () => {
  const seam = loadClient()
  const rect = { left: 10, top: 20, width: seam.GRAPH_W, height: seam.GRAPH_H }
  const plain = (v) => JSON.parse(JSON.stringify(v))
  assert.deepEqual(plain(seam.toGraphPointIn({ x: 0, y: 0, w: seam.GRAPH_W, h: seam.GRAPH_H }, rect, 10, 20)), { x: 0, y: 0 })
  const zoomed = seam.zoomAt({ x: 0, y: 0, w: seam.GRAPH_W, h: seam.GRAPH_H }, 280, 170, 0.5)
  const centre = seam.toGraphPointIn(zoomed, rect, 10 + 280, 20 + 170)
  assert.ok(Math.abs(centre.x - 280) < 1e-6)
  assert.ok(Math.abs(centre.y - 170) < 1e-6)
})
