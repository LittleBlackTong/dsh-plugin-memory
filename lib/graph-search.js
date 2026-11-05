/**
 * Graph search + camera focus maths (pure, deterministic).
 *
 * Kept out of the browser half so Node tests can pin both behaviours; the
 * client inlines the same functions (the client can only require platform
 * seeds) and a consistency test keeps the copies from drifting.
 *
 * @module dsh-plugin-memory/graph-search
 */

/** Default number of suggestions the panel shows while typing. */
export const GRAPH_SEARCH_LIMIT = 8

/**
 * Match nodes against a free-text query.
 *
 * Ranking: exact label > label prefix > label substring > id substring >
 * exact type > exact tag > tag substring. Empty query returns no suggestions.
 *
 * @param {Array<{ id: string, label?: string, type?: string, tags?: string[] }>} nodes
 * @param {string} query
 * @param {{ limit?: number }} [options]
 * @returns {Array<{ id: string, label?: string, type?: string, tags?: string[] }>}
 */
export function matchGraphNodes(nodes, query, options = {}) {
  const needle = String(query ?? '').trim().toLowerCase()
  if (needle.length === 0) return []
  const limit = options.limit ?? GRAPH_SEARCH_LIMIT
  const scored = []
  for (const node of nodes) {
    const label = String(node.label ?? '').toLowerCase()
    const id = String(node.id ?? '').toLowerCase()
    const type = String(node.type ?? '').toLowerCase()
    const tags = Array.isArray(node.tags) ? node.tags.map((tag) => String(tag).toLowerCase()) : []
    let score = 0
    if (label === needle) score = 100
    else if (label.startsWith(needle)) score = 80
    else if (label.includes(needle)) score = 60
    else if (id.includes(needle)) score = 40
    else if (type === needle) score = 30
    else if (tags.includes(needle)) score = 20
    else if (tags.some((tag) => tag.includes(needle))) score = 10
    if (score > 0) scored.push({ node, score })
  }
  scored.sort((a, b) => b.score - a.score || String(a.node.label ?? '').localeCompare(String(b.node.label ?? '')))
  return scored.slice(0, limit).map((entry) => entry.node)
}

/**
 * Camera angles that bring a node to the screen centre.
 *
 * `projectPoint` maps a world point through yaw (around Y) then pitch (around
 * X). With `yaw = atan2(x, z)` the rotated x becomes 0; with
 * `pitch = atan2(y, hypot(x, z))` the rotated y becomes 0. Both zeros mean the
 * node projects to the canvas centre exactly.
 *
 * @param {{ x: number, y: number, z: number }} node
 * @returns {{ yaw: number, pitch: number }}
 */
export function focusAngles(node) {
  const x = Number(node?.x ?? 0)
  const y = Number(node?.y ?? 0)
  const z = Number(node?.z ?? 0)
  const ring = Math.hypot(x, z)
  return {
    yaw: Math.atan2(x, z),
    pitch: Math.atan2(y, ring),
  }
}
