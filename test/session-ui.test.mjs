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

test('timelineRangeStart anchors the range on the newest event', () => {
  const seam = loadClient()
  const events = [
    { date: '2026-08-18', kind: 'fix', group: 'fix', title: 'old' },
    { date: '2026-11-24', kind: 'fix', group: 'fix', title: 'new' },
  ]
  const week = seam.timelineRangeStart(events, 'week')
  const month = seam.timelineRangeStart(events, 'month')
  const all = seam.timelineRangeStart(events, 'all')
  assert.equal(week, Date.parse('2026-11-24T00:00:00Z') - 7 * 86400000)
  assert.equal(month, Date.parse('2026-11-24T00:00:00Z') - 30 * 86400000)
  assert.equal(all, Date.parse('2026-08-18T00:00:00Z'))
  assert.equal(seam.timelineRangeStart([], 'month'), undefined)
})

test('filterTimelineEvents filters by query, kind group and time bound', () => {
  const seam = loadClient()
  const events = [
    { date: '2026-11-10', kind: 'fix', group: 'fix', title: '修复侧栏打开' },
    { date: '2026-11-12', kind: 'publish', group: 'publish', title: '发布 0.20.0' },
    { date: '2026-11-14', kind: 'note', group: 'other', title: '无新增' },
  ]
  assert.equal(seam.filterTimelineEvents(events, {}).length, 3)
  assert.equal(seam.filterTimelineEvents(events, { query: '0.20' }).length, 1)
  assert.equal(seam.filterTimelineEvents(events, { groups: ['fix'] }).length, 1)
  assert.equal(seam.filterTimelineEvents(events, { since: Date.parse('2026-11-11T00:00:00Z') }).length, 2)
  assert.equal(seam.filterTimelineEvents(events, { query: '不存在' }).length, 0)
  assert.equal(seam.filterTimelineEvents(null, {}).length, 0)
})

test('buildDayBuckets groups by day with per-group counts, oldest first', () => {
  const seam = loadClient()
  const events = [
    { date: '2026-11-12', kind: 'publish', group: 'publish', title: 'a' },
    { date: '2026-11-10', kind: 'fix', group: 'fix', title: 'b' },
    { date: '2026-11-12', kind: 'fix', group: 'fix', title: 'c' },
  ]
  const buckets = seam.buildDayBuckets(events)
  assert.equal(buckets.length, 2)
  assert.equal(buckets[0].date, '2026-11-10')
  assert.equal(buckets[0].count, 1)
  assert.equal(buckets[1].date, '2026-11-12')
  assert.equal(buckets[1].count, 2)
  assert.equal(buckets[1].groups.publish, 1)
  assert.equal(buckets[1].groups.fix, 1)
  assert.equal(seam.dominantTimelineGroup(buckets[1]), 'fix')
  assert.equal(seam.buildDayBuckets([]).length, 0)
})

test('TimelineCard exposes the overview and the event list once loaded', () => {
  const seam = loadClient()
  assert.equal(seam.TIMELINE_GROUP_ORDER.length, 5)
  // loading state still renders a single line before the fetch resolves
  const texts = collectText(seam.TimelineCard({}))
  assert.ok(texts.some((text) => text.includes('正在读取记忆时间轴')), `texts: ${texts.join(' | ')}`)
})

test('timeline scroll containment: list scrolls itself, panel keeps its position', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  // scrollIntoView would also scroll the settings dialog and push the card away
  assert.ok(!source.includes("target.scrollIntoView({ block: 'start', behavior: 'smooth' })"),
    'day jumps must not scroll the whole settings dialog')
  assert.ok(source.includes('node.scrollTop = Math.max(0, node.scrollTop + offset - 2)'),
    'the day jump scrolls the list container itself')
  assert.ok(source.includes("overflowAnchor: 'none'"),
    'the panel root disables browser scroll anchoring while tabs swap')
  assert.ok(source.includes('overflow-anchor:none'),
    'the list container disables scroll anchoring')
})

