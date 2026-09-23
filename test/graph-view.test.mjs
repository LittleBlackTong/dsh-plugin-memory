import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_VIEW,
  MAX_VIEW_SCALE,
  MIN_VIEW_SCALE,
  isZoomed,
  panBy,
  resetView,
  toGraphPoint,
  zoomAt,
} from '../lib/graph-view.js'

const base = { ...DEFAULT_VIEW }

test('zoomAt keeps the focus point exactly under the cursor', () => {
  // The whole point of zoom-about-a-point: this invariant must hold for any
  // focus, in both directions.
  for (const focus of [{ x: 0, y: 0 }, { x: 280, y: 170 }, { x: 560, y: 340 }, { x: 123, y: 45 }]) {
    for (const factor of [1 / 1.15, 1.15, 0.5, 2]) {
      const next = zoomAt(base, focus.x, focus.y, factor)
      const k = next.w / base.w
      const projected = {
        x: next.x + (focus.x - base.x) * k,
        y: next.y + (focus.y - base.y) * k,
      }
      assert.ok(Math.abs(projected.x - focus.x) < 1e-9, `x drifted: ${projected.x} vs ${focus.x}`)
      assert.ok(Math.abs(projected.y - focus.y) < 1e-9, `y drifted: ${projected.y} vs ${focus.y}`)
    }
  }
})

test('zoomAt zooming in shrinks the viewport and zooming out grows it', () => {
  const zoomedIn = zoomAt(base, 280, 170, 1 / 1.15)
  assert.ok(zoomedIn.w < base.w)
  const zoomedOut = zoomAt(base, 280, 170, 1.15)
  assert.ok(zoomedOut.w > base.w)
})

test('zoomAt respects the min and max scale', () => {
  // Zooming in shrinks the viewport toward width * MIN_VIEW_SCALE.
  let view = { ...base }
  for (let i = 0; i < 40; i += 1) view = zoomAt(view, 280, 170, 1 / 1.15)
  assert.ok(Math.abs(view.w - DEFAULT_VIEW.w * MIN_VIEW_SCALE) < 1e-6, `tightest zoom not clamped: ${view.w}`)
  for (let i = 0; i < 80; i += 1) view = zoomAt(view, 280, 170, 1.15)
  assert.ok(Math.abs(view.w - DEFAULT_VIEW.w * MAX_VIEW_SCALE) < 1e-6, `widest zoom not clamped: ${view.w}`)
})

test('zoomAt keeps the aspect ratio and ignores a broken factor', () => {
  const next = zoomAt(base, 100, 100, 1 / 1.15)
  assert.ok(Math.abs(next.w / next.h - DEFAULT_VIEW.w / DEFAULT_VIEW.h) < 1e-9)
  assert.deepEqual(zoomAt(base, 100, 100, Number.NaN), base)
  assert.deepEqual(zoomAt(base, 100, 100, 0), base)
})

test('panBy converts screen pixels to graph units and moves opposite the drag', () => {
  const scale = { scaleX: 0.5, scaleY: 0.5 }
  const moved = panBy(base, 100, 40, scale)
  assert.equal(moved.x, base.x - 50)
  assert.equal(moved.y, base.y - 20)
  assert.equal(moved.w, base.w)
  assert.equal(moved.h, base.h)
  // Drag back to where it started → original view.
  const back = panBy(moved, -100, -40, scale)
  assert.equal(back.x, base.x)
  assert.equal(back.y, base.y)
  // Non-finite deltas must not poison the view.
  assert.deepEqual(panBy(base, Number.NaN, Number.NaN, scale), base)
})

test('isZoomed notices both scale changes and pans', () => {
  assert.equal(isZoomed({ ...base }), false)
  assert.equal(isZoomed(zoomAt(base, 280, 170, 1 / 1.15)), true)
  assert.equal(isZoomed({ ...base, x: 40 }), true)
  assert.deepEqual(resetView(), DEFAULT_VIEW)
  assert.equal(isZoomed(resetView()), false)
})

test('toGraphPoint maps screen coordinates through the current view', () => {
  const rect = { left: 10, top: 20, width: 560, height: 340 }
  // Identity view: a click at the element's top-left is graph (0,0).
  assert.deepEqual(toGraphPoint(base, rect, 10, 20), { x: 0, y: 0 })
  assert.deepEqual(toGraphPoint(base, rect, 570, 360), { x: 560, y: 340 })

  // Zoomed in 2x with the focus at the centre: the centre still maps to itself.
  const zoomed = zoomAt(base, 280, 170, 0.5)
  const centre = toGraphPoint(zoomed, rect, 10 + 280, 20 + 170)
  assert.ok(Math.abs(centre.x - 280) < 1e-6, `centre x drifted: ${centre.x}`)
  assert.ok(Math.abs(centre.y - 170) < 1e-6, `centre y drifted: ${centre.y}`)

  // A degenerate rect falls back to raw client coordinates instead of NaN.
  assert.deepEqual(toGraphPoint(base, { left: 0, top: 0, width: 0, height: 0 }, 5, 6), { x: 5, y: 6 })
})

test('graph-view.js is dependency-free', () => {
  const source = readFileSync(new URL('../lib/graph-view.js', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/^import\s+.*?from\s+'([^']+)'/gm)].map((m) => m[1])
  for (const specifier of imports) {
    assert.ok(specifier.startsWith('node:'), `unexpected dependency: ${specifier}`)
  }
})
