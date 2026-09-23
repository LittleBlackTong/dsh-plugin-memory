/**
 * Drag maths for the memory graph.
 *
 * Kept pure and dependency-free so it can be unit-tested in Node: the browser
 * half cannot import local modules, and the drag behaviour is exactly the part
 * that is impossible to verify by reading it.
 *
 * The model is deliberately simple — the dragged node follows the pointer, its
 * direct neighbours lean toward it a little, everything else stays put. A full
 * force simulation per frame would be O(n²) and stutter on large stores; this
 * reads as "alive" while staying O(degree).
 *
 * @module dsh-plugin-memory/graph-drag
 */

/**
 * Clamp into `[min, max]`. `NaN` means "no usable input" and falls back to
 * `min`; the infinities are real directions, so they clamp to the edge.
 * @param {number} value @param {number} min @param {number} max
 */
export function clampToBox(value, min, max) {
  if (Number.isNaN(value)) return min
  return Math.min(Math.max(value, min), max)
}

/**
 * How far a neighbour leans toward the dragged node.
 * @param {number} distance current distance between the two nodes
 * @param {number} pull 0..1 strength (scaled down as the drag gets far away)
 * @param {number} [strength] global multiplier
 * @returns {number} offset in px, along the drag direction
 */
export function neighbourLean(distance, pull, strength = 6) {
  const d = Number.isFinite(distance) ? Math.max(1, distance) : 1
  const p = Number.isFinite(pull) ? Math.min(Math.max(pull, 0), 1) : 0
  return (p * strength * 12) / (12 + d)
}

/**
 * Positions for one drag frame.
 *
 * @param {Map<string, {x: number, y: number}> | Record<string, {x: number, y: number}>} positions base layout
 * @param {string} draggedId node under the pointer
 * @param {{x: number, y: number}} target pointer position
 * @param {Array<{source: string, target: string}>} edges
 * @param {{width?: number, height?: number, minPull?: number, strength?: number}} [options]
 * @returns {Map<string, {x: number, y: number}>} new positions (input untouched)
 */
export function applyDrag(positions, draggedId, target, edges, options = {}) {
  const width = options.width ?? 560
  const height = options.height ?? 340
  const minPull = options.minPull ?? 0.3
  const strength = options.strength ?? 6
  const current = positions instanceof Map ? positions : new Map(Object.entries(positions ?? {}))
  const at = (id) => current.get(id)
  const start = at(draggedId)
  const next = new Map(current)

  if (start === undefined) return next

  const x = clampToBox(target?.x, 0, width)
  const y = clampToBox(target?.y, 0, height)
  next.set(draggedId, { x, y })

  // Neighbour set in one pass over the edges.
  const neighbours = new Set()
  for (const edge of edges ?? []) {
    if (edge?.source === draggedId) neighbours.add(edge.target)
    else if (edge?.target === draggedId) neighbours.add(edge.source)
  }

  const dx = x - start.x
  const dy = y - start.y
  const distance = Math.max(1, Math.hypot(dx, dy))
  const ux = dx / distance
  const uy = dy / distance
  const pull = Math.max(minPull, Math.min(1, 1 / (1 + distance / 80)))

  for (const id of neighbours) {
    const base = at(id)
    if (base === undefined) continue
    const lean = neighbourLean(distance, pull, strength)
    next.set(id, {
      x: clampToBox(base.x + ux * lean, 0, width),
      y: clampToBox(base.y + uy * lean, 0, height),
    })
  }
  return next
}

/**
 * Positions after releasing, i.e. the untouched base layout — the client pairs
 * this with a CSS transition so nodes glide back instead of snapping.
 *
 * @param {Map<string, {x: number, y: number}> | Record<string, {x: number, y: number}>} base
 * @returns {Map<string, {x: number, y: number}>}
 */
export function releasePositions(base) {
  return base instanceof Map ? new Map(base) : new Map(Object.entries(base ?? {}))
}
