import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isOwnNavRow,
  navIconCss,
  brainCircuitMaskUrl,
  BRAIN_CIRCUIT_PATHS,
  MEMORY_SECTION_LABEL,
  NAV_ICON_ATTR,
} from '../lib/settings-nav-icon.js'

// ── isOwnNavRow: the only decision this feature makes ──────────────────────
//
// The settings shell renders every `settings.section` entry as a <button> in
// the panel's <nav>. We claim the one whose visible text equals our own label.
// Claiming the wrong row would hide someone else's glyph, so the match is
// exact (after trimming) rather than substring.

test('isOwnNavRow claims the row whose text is exactly our label', () => {
  assert.equal(isOwnNavRow('Memory', MEMORY_SECTION_LABEL), true)
  assert.equal(isOwnNavRow('  Memory  ', MEMORY_SECTION_LABEL), true, 'surrounding whitespace is trimmed')
})

test('isOwnNavRow refuses anything that is not an exact match', () => {
  assert.equal(isOwnNavRow('记忆 Memory', MEMORY_SECTION_LABEL), false, 'the old bilingual label must not match')
  assert.equal(isOwnNavRow('Memory graph', MEMORY_SECTION_LABEL), false, 'a longer label is a different section')
  assert.equal(isOwnNavRow('Model', MEMORY_SECTION_LABEL), false)
})

test('isOwnNavRow refuses an unresolved label', () => {
  // A locale that has not resolved yet yields an empty label. Matching on that
  // would mark the whole nav, so an empty wanted label matches nothing.
  assert.equal(isOwnNavRow('Memory', ''), false)
  assert.equal(isOwnNavRow('Memory', '   '), false)
  assert.equal(isOwnNavRow('Memory', undefined), false)
  assert.equal(isOwnNavRow('', ''), false)
})

test('isOwnNavRow tolerates a null row text', () => {
  assert.equal(isOwnNavRow(null, MEMORY_SECTION_LABEL), false)
  assert.equal(isOwnNavRow(undefined, MEMORY_SECTION_LABEL), false)
})

// ── navIconCss: hide the shell's gear, paint ours ──────────────────────────

test('navIconCss hides the shell glyph and paints the mark on the marked row', () => {
  const css = navIconCss('data:image/svg+xml,ABC')
  assert.match(css, new RegExp(NAV_ICON_ATTR), 'the stylesheet must be scoped to our marker attribute')
  assert.match(css, /display:\s*none/, "the shell's fallback gear must be hidden")
  assert.match(css, /mask-image/, 'the mark is painted via a mask')
  assert.match(css, /data:image\/svg\+xml,ABC/, 'the caller-supplied mask url is embedded verbatim')
})

test('navIconCss keeps the mark on currentColor so it follows the theme', () => {
  const css = navIconCss('data:image/svg+xml,ABC')
  assert.match(css, /background-color:\s*currentColor/)
})

// ── the mark itself ────────────────────────────────────────────────────────

test('the mark is a 16px outline drawn with the shell icon stroke width', () => {
  const svg = brainCircuitMaskUrl()
  const decoded = decodeURIComponent(svg.replace(/^data:image\/svg\+xml,/, ''))
  assert.match(decoded, /viewBox="0 0 16 16"/, 'must match the shell icon grid')
  assert.match(decoded, /stroke-width="1\.3"/, 'must match ICON_MEDIUM_STROKE')
  assert.match(decoded, /stroke-linecap="round"/)
  assert.match(decoded, /stroke-linejoin="round"/)
})

test('the mark is painted pure black because a mask reads alpha only', () => {
  const svg = brainCircuitMaskUrl()
  const decoded = decodeURIComponent(svg.replace(/^data:image\/svg\+xml,/, ''))
  // No currentColor / no theme colour: the visible colour comes from the CSS
  // background-color on the ::before pseudo-element.
  assert.doesNotMatch(decoded, /currentColor/)
  assert.match(decoded, /stroke="#000"/)
})

test('the mark carries one closed brain outline plus its nodes', () => {
  // Shape sanity: a brain half (closed path) and the circuit side. Pinning the
  // counts keeps a rewrite from silently dropping half the artwork.
  const paths = BRAIN_CIRCUIT_PATHS.filter((p) => p.kind === 'path')
  const circles = BRAIN_CIRCUIT_PATHS.filter((p) => p.kind === 'circle')
  assert.equal(paths.length, 4, '1 brain outline + 3 spokes from the brain edge')
  assert.ok(paths[0].d.endsWith('Z'), 'the brain outline must be closed')
  assert.equal(circles.length, 5, 'five nodes: three on spokes, one top, one bottom')
})
