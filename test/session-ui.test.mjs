import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/** Minimal React stub: enough to build and walk an element tree. */
const React = {
  memo(component) { return component },
  createContext(defaultValue) { return { _default: defaultValue } },
  useContext(context) { return context._default },
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
  return captured.__test
}

/** Walk an element tree, collecting every string leaf. */
function collectText(node, out = []) {
  if (node === null || node === undefined) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  collectText(node.children, out)
  return out
}

test('MemoryChip renders the ON state, and nothing without a sessionId', () => {
  const seam = loadClient()
  const withSession = seam.MemoryChip({ sessionId: 's1' })
  assert.ok(withSession !== null, 'chip renders when the slot passes a session id')
  const texts = collectText(withSession)
  assert.ok(texts.some((text) => text.includes('记忆开')), `chip texts: ${texts.join(' | ')}`)
  const trigger = withSession.children[0]
  assert.equal(trigger.props['aria-haspopup'], 'menu')
  assert.equal(trigger.props['aria-expanded'], false, 'the dropdown starts closed')
  assert.ok(!texts.includes('本会话'), 'menu items are not rendered until the chip is opened')
  // 0.19.1: DSH 0.2.2-rc.2 renders the slot without a sessionId; the chip
  // still renders and lets the host route fall back to the active session.
  const withoutSession = seam.MemoryChip({})
  assert.ok(withoutSession !== null && withoutSession !== undefined, 'no slot id still renders the chip')
  assert.ok(collectText(withoutSession).length > 0, 'the fallback chip renders its label')
})

test('MemoryChip follows an injected English t seat', () => {
  const seam = loadClient()
  const t = (key) => seam.DICTS.en[key]
  const node = seam.MemoryChip({ sessionId: 's1', t })
  assert.ok(collectText(node).some((text) => text.includes('Memory on')))
})

test('SessionControls shows the loading line before the fetch resolves', () => {
  const seam = loadClient()
  const texts = collectText(seam.SessionControls({}))
  assert.ok(texts.some((text) => text.includes('读取会话状态中')), `texts: ${texts.join(' | ')}`)
  assert.ok(texts.some((text) => text.includes('会话与工作区')))
})

test('the client half exposes the session route it talks to', () => {
  const seam = loadClient()
  assert.equal(seam.SESSION_URL, '/api/memory/session')
})

// ── v0.20 时间轴视图 ──────────────────────────────────────────────────────

test('scaleFor maps zoom density to day/week/month/year', () => {
  const seam = loadClient()
  assert.equal(seam.scaleFor(54), 'day')
  assert.equal(seam.scaleFor(30), 'day')
  assert.equal(seam.scaleFor(20), 'week')
  assert.equal(seam.scaleFor(7), 'week')
  assert.equal(seam.scaleFor(3), 'month')
  assert.equal(seam.scaleFor(1.6), 'month')
  assert.equal(seam.scaleFor(1), 'year')
})

test('visibleTimelineEvents hides process noise unless showAll is set', () => {
  const seam = loadClient()
  const events = [
    { date: '2026-11-10', kind: 'fix', group: 'fix', title: '修复 A' },
    { date: '2026-11-10', kind: 'note', group: 'other', title: '笔记' },
    { date: '2026-11-10', kind: 'digest', group: 'other', title: 'digest' },
  ]
  assert.equal(seam.visibleTimelineEvents(events, false).length, 1)
  assert.equal(seam.visibleTimelineEvents(events, true).length, 3)
  assert.equal(seam.timelineGroupOf('bugfix'), 'fix')
  assert.equal(seam.timelineGroupOf('unknown'), 'other')
})

test('computeTimelineLayout drops overlapping labels but keeps every station', () => {
  const seam = loadClient()
  const events = [
    { date: '2026-11-10', kind: 'fix', group: 'fix', title: '修复 A' },
    { date: '2026-11-10', kind: 'fix', group: 'fix', title: '修复 B' },
    { date: '2026-11-10', kind: 'fix', group: 'fix', title: '修复 C' },
  ]
  const layout = seam.computeTimelineLayout({ events, width: 600, offset: 0, pxPerDay: 54, showAll: false })
  assert.equal(layout.stations.length, 3)
  assert.equal(layout.labels.length, 1, 'crowded labels collapse to a single one')
  assert.ok(layout.axis.width > 0)
  const empty = seam.computeTimelineLayout({ events: [], width: 600, offset: 0, pxPerDay: 54, showAll: false })
  assert.equal(empty.stations.length, 0)
})

test('initialTimelineOffset keeps the last week visible at the right edge', () => {
  const seam = loadClient()
  const events = [
    { date: '2026-08-18', kind: 'fix', group: 'fix', title: 'old' },
    { date: '2026-11-12', kind: 'fix', group: 'fix', title: 'new' },
  ]
  const offset = seam.initialTimelineOffset({ events, width: 600, pxPerDay: 54 })
  assert.ok(Number.isFinite(offset))
  // Newest event (right edge - 40px) is at x = 600 - 40.
  const span = (Date.parse('2026-11-12T00:00:00Z') - Date.parse('2026-08-18T00:00:00Z')) / 86400000 * 54
  assert.ok(Math.abs(offset + span - (600 - 40)) < 1e-6, 'the newest event sits at the right edge')
  assert.ok(offset < 0, 'the timeline is scrolled left of the origin')
})

test('TimelineCard renders the loading line before the timeline resolves', () => {
  const seam = loadClient()
  const texts = collectText(seam.TimelineCard({}))
  assert.ok(texts.some((text) => text.includes('正在读取记忆时间轴')), `texts: ${texts.join(' | ')}`)
})

test('MemorySection exposes the graph/timeline tabs', () => {
  const seam = loadClient()
  const tree = seam.MemorySection({})
  const texts = collectText(tree)
  assert.ok(texts.includes('图谱'), `tab labels: ${texts.join(' | ')}`)
  assert.ok(texts.includes('时间轴'))
})

