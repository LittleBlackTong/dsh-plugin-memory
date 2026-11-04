/**
 * Deterministic 3D sphere placement + perspective projection for the memory
 * graph.
 *
 * The client half cannot import local modules (it only gets the platform's
 * `react` seat at runtime), so the same maths is **inlined** in `client.js` —
 * exactly like `graph-drag`/`graph-view`. Keeping the pure implementation here
 * lets Node tests pin the behaviour.
 *
 * No randomness: the same nodes always land on the same slots, and the same
 * view always projects to the same screen coordinates. That matters because the
 * panel re-renders every frame while the user rotates.
 *
 * @module dsh-plugin-memory/graph-3d
 */

/** Defaults shared by the panel and the tests. */
export const GRAPH3D_DEFAULTS = Object.freeze({
  width: 560,
  height: 400,
  radius: 250,
  focal: 900,
  camera: 340,
  zoom: 1,
  yaw: 0,
  pitch: 0,
})

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/**
 * Distribute nodes evenly over a sphere (Fibonacci sphere).
 *
 * Nodes are sorted by `type` then `id` first, so a given type forms a
 * contiguous band on the sphere instead of being scattered — that is what makes
 * the colours readable when the sphere rotates.
 *
 * @param {Array<{ id: string, type?: string }>} nodes
 * @param {{ radius?: number }} [options]
 * @returns {Array<{ id: string, x: number, y: number, z: number }>}
 */
export function spherePositions(nodes, options = {}) {
  const radius = options.radius ?? GRAPH3D_DEFAULTS.radius
  const sorted = [...nodes].sort((a, b) => {
    const byType = String(a.type ?? '').localeCompare(String(b.type ?? ''))
    if (byType !== 0) return byType
    return String(a.id).localeCompare(String(b.id))
  })
  const count = sorted.length
  return sorted.map((node, index) => {
    // y walks from +1 to -1; the ring radius shrinks toward the poles.
    const y = 1 - ((index + 0.5) * 2) / count
    const ring = Math.sqrt(Math.max(0, 1 - y * y))
    const angle = index * GOLDEN_ANGLE
    return {
      id: node.id,
      x: Math.cos(angle) * ring * radius,
      y: y * radius,
      z: Math.sin(angle) * ring * radius,
    }
  })
}

/** Rotate a world point by yaw (around Y) then pitch (around X). */
export function rotatePoint(point, yaw, pitch) {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  // yaw around Y
  const x1 = point.x * cy - point.z * sy
  const z1 = point.x * sy + point.z * cy
  // pitch around X
  return {
    id: point.id,
    x: x1,
    y: point.y * cp - z1 * sp,
    z: point.y * sp + z1 * cp,
  }
}

/** Inverse of {@link rotatePoint}. */
export function unrotatePoint(point, yaw, pitch) {
  const cy = Math.cos(-yaw)
  const sy = Math.sin(-yaw)
  const cp = Math.cos(-pitch)
  const sp = Math.sin(-pitch)
  // undo pitch
  const y1 = point.y * cp - point.z * sp
  const z1 = point.y * sp + point.z * cp
  // undo yaw
  return {
    id: point.id,
    x: point.x * cy - z1 * sy,
    y: y1,
    z: point.x * sy + z1 * cy,
  }
}

/**
 * Project one world point to screen space.
 *
 * @param {{ id: string, x: number, y: number, z: number }} point
 * @param {object} [view] overrides: width/height/radius/focal/camera/zoom/yaw/pitch
 * @returns {{ id: string, x: number, y: number, z: number, scale: number, depth: number }}
 */
export function projectPoint(point, view = {}) {
  const width = view.width ?? GRAPH3D_DEFAULTS.width
  const height = view.height ?? GRAPH3D_DEFAULTS.height
  const radius = view.radius ?? GRAPH3D_DEFAULTS.radius
  const focal = view.focal ?? GRAPH3D_DEFAULTS.focal
  const camera = view.camera ?? GRAPH3D_DEFAULTS.camera
  const zoom = view.zoom ?? GRAPH3D_DEFAULTS.zoom
  const rotated = rotatePoint(point, view.yaw ?? 0, view.pitch ?? 0)
  // Perspective: nearer (smaller z) means a larger scale.
  const scale = (focal / Math.max(60, focal + rotated.z + camera)) * zoom
  // Depth is 1 when nearest the camera (z = -radius) and 0 at the far pole.
  const depth = Math.max(0, Math.min(1, (radius - rotated.z) / (2 * radius)))
  return {
    id: point.id,
    x: width / 2 + rotated.x * scale,
    y: height / 2 + rotated.y * scale,
    z: rotated.z,
    scale,
    depth,
  }
}

/**
 * Sort projected points for painter's algorithm (farthest first by default).
 * @param {Array<{ z: number }>} points
 * @param {'far-first' | 'near-first'} [direction]
 */
export function depthSorted(points, direction = 'far-first') {
  const sorted = [...points].sort((a, b) => a.z - b.z)
  return direction === 'near-first' ? sorted.reverse() : sorted
}

/**
 * Return the closest projected node within its hit radius.
 *
 * @param {Array<{ id: string, x: number, y: number }>} points
 * @param {number} x
 * @param {number} y
 * @param {(point: { id: string }) => number} [radiusOf]
 * @returns {{ id: string, x: number, y: number } | null}
 */
export function hitTest3D(points, x, y, radiusOf = () => 8) {
  let best = null
  let bestDistance = Infinity
  for (const point of points) {
    const distance = Math.hypot(point.x - x, point.y - y)
    if (distance <= radiusOf(point) && distance < bestDistance) {
      best = point
      bestDistance = distance
    }
  }
  return best
}
