/**
 * Deterministic force-directed layout for the memory graph.
 *
 * Split out of the browser half so the maths can be unit-tested in Node and
 * reused by the standalone report/preview without duplicating it. No
 * randomness, no dependency: same input, same coordinates, every time.
 *
 * @module dsh-plugin-memory/graph-layout
 */

/** Canvas the renderer draws into. Shared so the panel and any static report
 * (or preview) agree on the picture's proportions. */
export const GRAPH_CANVAS = { width: 560, height: 340 }

/** Colour per memory type, shared by the SVG renderer and any static report. */
export const TYPE_COLORS = {
  project: '#4c8bf5',
  skill: '#8b7bf5',
  decision: '#f5a623',
  concept: '#30a46c',
  user: '#e5484d',
  'user-preference': '#e5484d',
  identity: '#e0712f',
  fact: '#8b8f96',
  meta: '#5b6068',
  unknown: '#8b8f96',
}

/** @param {string} type */
export function typeColor(type) {
  return TYPE_COLORS[type] ?? TYPE_COLORS.unknown
}

/**
 * Place nodes inside a width x height box.
 *
 * @param {Array<{ id: string, degree?: number, hub?: boolean }>} nodes
 * @param {Array<{ source: string, target: string, kind?: string }>} edges
 * @param {{ width?: number, height?: number, iterations?: number }} [options]
 * @returns {{ positions: Map<string, {x: number, y: number}>, radius: (id: string) => number }}
 */
export function layoutGraph(nodes, edges, options = {}) {
  const width = options.width ?? 560
  const height = options.height ?? 340
  const iterations = options.iterations ?? 220
  const positions = new Map()
  if (nodes.length === 0) {
    return { positions, radius: () => 5 }
  }

  const cx = width / 2
  const cy = height / 2
  nodes.forEach((node, index) => {
    const angle = (index / nodes.length) * Math.PI * 2
    positions.set(node.id, { x: cx + Math.cos(angle) * 110, y: cy + Math.sin(angle) * 80 })
  })

  const degrees = new Map(nodes.map((node) => [node.id, node.degree ?? 0]))
  const radius = (id) => 4.5 + Math.min(7.5, Math.sqrt(degrees.get(id) ?? 0) * 2.4)
  const springs = []
  for (const edge of edges) {
    if (!positions.has(edge.source) || !positions.has(edge.target)) continue
    springs.push({ a: edge.source, b: edge.target, w: edge.kind === 'link' ? 1.6 : 0.5 })
  }

  for (let iter = 0; iter < iterations; iter += 1) {
    const cool = 1 - iter / (iterations * 1.18)

    // pairwise repulsion
    for (let i = 0; i < nodes.length; i += 1) {
      const pi = positions.get(nodes[i].id)
      for (let j = i + 1; j < nodes.length; j += 1) {
        const pj = positions.get(nodes[j].id)
        let dx = pi.x - pj.x
        let dy = pi.y - pj.y
        let d2 = dx * dx + dy * dy
        if (d2 < 1) {
          // Coincident nodes: nudge them apart deterministically.
          dx = (i - j) * 0.7 + 0.3
          dy = 0.4 * (j - i) + 0.2
          d2 = dx * dx + dy * dy
        }
        const d = Math.sqrt(d2)
        const push = (46 * cool) / d2
        const ux = (dx / d) * push
        const uy = (dy / d) * push
        pi.x += ux
        pi.y += uy
        pj.x -= ux
        pj.y -= uy
      }
    }

    // spring attraction along edges
    for (const spring of springs) {
      const pa = positions.get(spring.a)
      const pb = positions.get(spring.b)
      const dx = pb.x - pa.x
      const dy = pb.y - pa.y
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy))
      const pull = (d - 78) * 0.016 * spring.w * cool
      const ux = (dx / d) * pull
      const uy = (dy / d) * pull
      pa.x += ux
      pa.y += uy
      pb.x -= ux
      pb.y -= uy
    }

    // centring, with hubs pulled a little harder so they read as hubs
    for (const node of nodes) {
      const p = positions.get(node.id)
      const strength = node.hub ? 0.022 : 0.0035
      p.x += (cx - p.x) * strength * cool
      p.y += (cy - p.y) * strength * cool
    }
  }

  // normalise into the box, preserving aspect ratio
  const pad = 30
  const xs = [...positions.values()].map((p) => p.x)
  const ys = [...positions.values()].map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const scale = Math.min(
    (width - pad * 2) / Math.max(1, maxX - minX),
    (height - pad * 2) / Math.max(1, maxY - minY),
  )
  for (const p of positions.values()) {
    p.x = pad + (p.x - minX) * scale
    p.y = pad + (p.y - minY) * scale
  }

  return { positions, radius }
}
