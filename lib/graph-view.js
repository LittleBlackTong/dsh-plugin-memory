/**
 * View maths for the memory graph: wheel zoom and canvas panning.
 *
 * Pure and dependency-free, for the same reason as `graph-drag`: the browser
 * half cannot import local modules, so the maths is mirrored there and a test
 * asserts the two agree. Zoom-about-a-point is exactly the kind of arithmetic
 * that looks right and drifts under the cursor.
 *
 * @module dsh-plugin-memory/graph-view
 */

/** @type {{x: number, y: number, w: number, h: number}} */
export const DEFAULT_VIEW = { x: 0, y: 0, w: 560, h: 340 }

/**
 * Viewport width is expressed as a fraction of the base width:
 * `minScale` = tightest zoom (2.5x in), `maxScale` = widest (0.4x out).
 */
export const MIN_VIEW_SCALE = 0.4
export const MAX_VIEW_SCALE = 2.5

/** @param {{x: number, y: number, w: number, h: number}} view */
export function isZoomed(view, base = DEFAULT_VIEW) {
  return view.w < base.w - 1 || Math.abs(view.x - base.x) > 1 || Math.abs(view.y - base.y) > 1
}

/**
 * Zoom about a graph-space point, keeping that point under the cursor.
 *
 * @param {{x: number, y: number, w: number, h: number}} view current view
 * @param {number} fx focus x in graph coordinates
 * @param {number} fy focus y in graph coordinates
 * @param {number} factor >1 zooms out, <1 zooms in
 * @param {{width?: number, height?: number, minScale?: number, maxScale?: number}} [options]
 * @returns {{x: number, y: number, w: number, h: number}} next view
 */
export function zoomAt(view, fx, fy, factor, options = {}) {
  const width = options.width ?? DEFAULT_VIEW.w
  const height = options.height ?? DEFAULT_VIEW.h
  const minScale = options.minScale ?? MIN_VIEW_SCALE
  const maxScale = options.maxScale ?? MAX_VIEW_SCALE
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1
  const nextW = Math.min(width * maxScale, Math.max(width * minScale, view.w * safeFactor))
  const k = nextW / view.w
  return {
    x: fx - (fx - view.x) * k,
    y: fy - (fy - view.y) * k,
    w: nextW,
    h: height * (nextW / width),
  }
}

/** @param {{width?: number, height?: number}} [options] */
export function resetView(options = {}) {
  return {
    x: 0,
    y: 0,
    w: options.width ?? DEFAULT_VIEW.w,
    h: options.height ?? DEFAULT_VIEW.h,
  }
}

/**
 * One pan step: move the view by the pointer delta, converted from screen
 * pixels to graph units.
 *
 * @param {{x: number, y: number, w: number, h: number}} start view when the drag began
 * @param {number} dxPx pointer delta in screen pixels
 * @param {number} dyPx pointer delta in screen pixels
 * @param {{scaleX: number, scaleY: number}} scale graph-units per screen pixel
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function panBy(start, dxPx, dyPx, scale) {
  return {
    x: start.x - (Number.isFinite(dxPx) ? dxPx : 0) * (scale?.scaleX ?? 1),
    y: start.y - (Number.isFinite(dyPx) ? dyPx : 0) * (scale?.scaleY ?? 1),
    w: start.w,
    h: start.h,
  }
}

/**
 * Screen point -> graph point for the current view. Node dragging needs this,
 * otherwise a drag lands somewhere else as soon as the user zooms.
 *
 * @param {{x: number, y: number, w: number, h: number}} view
 * @param {{left: number, top: number, width: number, height: number}} rect element box
 * @param {number} clientX
 * @param {number} clientY
 * @returns {{x: number, y: number}}
 */
export function toGraphPoint(view, rect, clientX, clientY) {
  if (rect === undefined || rect.width === 0 || rect.height === 0) return { x: clientX, y: clientY }
  return {
    x: view.x + ((clientX - rect.left) / rect.width) * view.w,
    y: view.y + ((clientY - rect.top) / rect.height) * view.h,
  }
}
