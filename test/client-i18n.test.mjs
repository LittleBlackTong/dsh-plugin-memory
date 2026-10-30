/**
 * 客户端半（零构建）的 i18n 契约测试。
 *
 * `lib/client.js` 是浏览器模块（`window.__ModuleLoader__.load`），Node 无法直接
 * import，所以这里用 `node:vm` 按浏览器的方式加载它：假 `window/document/
 * MutationObserver/React`，验证——
 *   1. 接的是 DSH 官方语言层（inject 含 locale、命名空间 `memory`、slot 声明
 *      `locale: 'memory'`），不读 navigator.language；
 *   2. 中英字典 key 完全一一对齐，源码里没有漏翻的中文字面量；
 *   3. 侧栏 label 中英（记忆 / Memory），语言切换后 MutationObserver 重新认领；
 *   4. 槽位注入 `t` 缺失时回退中文且不崩；注入的 `t` 座位优先；
 *   5. 英文界面下整块面板（表单 / 健康看板 / 图谱）不残留中文，看板的
 *      label/detail 由 `lib/insights.js` 的结构化 `data` 重建；
 *   6. 旧 payload（没有 `data`）保留服务端中文 detail，向后兼容。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { sectionLabel as libSectionLabel } from '../lib/settings-nav-icon.js'

const CLIENT_SOURCE = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const NAV_ROW_SELECTOR = '[role="dialog"] nav button'
const NAV_ICON_ATTR = 'data-dsh-memory-nav-icon'
const CJK = /[\u4e00-\u9fff]/

// ── the sandbox ────────────────────────────────────────────────────────────

/** Minimal React stub: element trees, context, and fake-able hook state. */
function makeReact({ state } = {}) {
  let stateIndex = 0
  class Component {
    constructor(props) {
      this.props = props ?? {}
      this.state = {}
    }
  }
  Component.prototype.isReactComponent = true
  return {
    // React.memo is an identity wrapper for this harness.
    memo(component) { return component },
    createContext(defaultValue) { return { _default: defaultValue, Provider: 'LocaleContext.Provider' } },
    useContext(context) { return context._default },
    createElement(type, props, ...children) {
      const flat = []
      const push = (value) => {
        if (Array.isArray(value)) { for (const item of value) push(item); return }
        if (value === null || value === undefined || typeof value === 'boolean') return
        flat.push(value)
      }
      for (const child of children) push(child)
      return { type, props: props ?? {}, children: flat }
    },
    useState(initial) {
      if (state !== undefined) {
        const value = state[stateIndex]
        stateIndex += 1
        return [value, () => {}]
      }
      return [typeof initial === 'function' ? initial() : initial, () => {}]
    },
    useEffect() {},
    useRef(value) { return { current: value } },
    useMemo(fn) { return fn() },
    Component,
  }
}

/** Build the browser-ish sandbox: nav rows + styles + observers + loader. */
function browserHarness({ rows: rowTexts, state } = {}) {
  const texts = rowTexts ?? ['General', '记忆', 'Heartbeat', 'Memory']
  const rows = texts.map((textContent) => ({
    textContent,
    attrs: new Set(),
    setAttribute(name) { this.attrs.add(name) },
    removeAttribute(name) { this.attrs.delete(name) },
  }))
  const styles = []
  const observers = []
  let registration

  const documentStub = {
    body: {},
    head: {
      appendChild(node) {
        styles.push(node)
      },
    },
    getElementById: () => null,
    createElement() {
      return {
        id: '',
        textContent: '',
        remove() {
          const index = styles.indexOf(this)
          if (index >= 0) styles.splice(index, 1)
        },
      }
    },
    querySelectorAll(selector) {
      if (selector === NAV_ROW_SELECTOR) return rows
      const match = /^\[([^\]]+)\]$/.exec(selector)
      if (match !== null) return rows.filter((row) => row.attrs.has(match[1]))
      throw new Error(`unexpected selector ${selector}`)
    },
  }
  class MutationObserverStub {
    constructor(callback) {
      this.callback = callback
      observers.push(this)
    }
    observe() {}
    disconnect() {
      this.disconnected = true
    }
  }

  const sandbox = {
    window: {
      __ModuleLoader__: { load(entry) { registration = entry } },
      // A browser language that disagrees with the app language on purpose: the
      // panel must follow DSH's locale layer, never navigator.language.
      navigator: { language: 'en-US' },
    },
    document: documentStub,
    MutationObserver: MutationObserverStub,
    fetch: () => Promise.reject(new Error('no network in this harness')),
    console,
  }
  vm.runInContext(CLIENT_SOURCE, vm.createContext(sandbox), { filename: 'lib/client.js' })
  assert.equal(registration.id, 'dsh-plugin-memory', 'client module id must be the package name')

  const react = makeReact({ state })
  const moduleExports = registration.factory((name) => {
    assert.equal(name, 'react', 'the client half may only require the react platform seed')
    return react
  })
  return { moduleExports, rows, styles, observers }
}

/** Run apply() against a fake slots/locale/effect context. */
function applyClient(moduleExports, { language = 'zh' } = {}) {
  const slots = { injections: [], registrations: [] }
  const effects = []
  const dictionaries = []
  const localeState = { active: language }
  const ctx = {
    locale: {
      getSnapshot: () => ({ active: localeState.active, revision: 1 }),
      register(namespace, dicts) {
        dictionaries.push({ namespace, dicts })
        return () => {}
      },
    },
    slots: {
      inject(key, callback) {
        slots.injections.push(key)
        callback()
      },
      register(entry, component) {
        slots.registrations.push({ entry, component })
        return () => {}
      },
    },
    effect: (callback, label) => {
      effects.push({ label, dispose: callback() })
      return () => {}
    },
  }
  moduleExports.apply(ctx)
  return { slots, effects, dictionaries, localeState }
}

/** Flatten an element tree to its visible strings (text + text-ish attributes). */
const TEXT_PROPS = ['placeholder', 'aria-label', 'title', 'alt']
function collectText(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  // Stub React has no reconciler: function components are rendered by hand so
  // their copy lands in the tree. Class components (error boundary) are skipped.
  if (typeof node.type === 'function' && node.type.prototype?.isReactComponent !== true) {
    return collectText(node.type(node.props), out)
  }
  for (const prop of TEXT_PROPS) {
    if (typeof node.props?.[prop] === 'string') out.push(node.props[prop])
  }
  for (const child of node.children ?? []) collectText(child, out)
  return out
}

/** Walk the tree and return the first element matching a predicate. */
function findElement(node, predicate) {
  if (node === null || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (predicate(node)) return node
  for (const child of node.children ?? []) {
    const found = findElement(child, predicate)
    if (found !== undefined) return found
  }
  return undefined
}

const claimedTexts = (rows) => rows
  .filter((row) => row.attrs.has(NAV_ICON_ATTR))
  .map((row) => row.textContent.trim())

// ── 1. official locale layer wiring ───────────────────────────────────────

test('the client half injects the locale service and registers the memory dictionaries', () => {
  const { moduleExports } = browserHarness()
  assert.deepEqual([...moduleExports.inject], ['slots', 'locale'], 'the locale service is a declared dependency')

  const { dictionaries } = applyClient(moduleExports)
  assert.equal(dictionaries.length, 1, 'exactly one dictionary registration')
  assert.equal(dictionaries[0].namespace, 'memory')
  assert.deepEqual(Object.keys(dictionaries[0].dicts).sort(), ['en', 'zh'])

  const { zh, en } = dictionaries[0].dicts
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort(), 'the two languages expose identical keys')
  for (const key of Object.keys(zh)) {
    assert.equal(typeof zh[key], 'string', `zh.${key} must be a string`)
    assert.equal(typeof en[key], 'string', `en.${key} must be a string`)
    assert.ok(zh[key].length > 0 && en[key].length > 0, `zh.${key} / en.${key} must not be empty`)
  }
  assert.equal(zh.sectionLabel, '记忆')
  assert.equal(en.sectionLabel, 'Memory')
})

test('the settings section declares the locale namespace and its label follows the app language', () => {
  const { moduleExports } = browserHarness()
  const first = applyClient(moduleExports, { language: 'zh' })
  assert.deepEqual(first.slots.injections, ['settings.section'])
  assert.equal(first.slots.registrations.length, 1)
  const { entry, component } = first.slots.registrations[0]
  assert.equal(entry.name, 'settings.section')
  assert.equal(entry.id, 'memory')
  assert.equal(entry.order, 100)
  assert.equal(entry.locale, 'memory', 'the renderer injects a `t` seat because of this field')
  assert.equal(typeof component, 'function')
  assert.equal(entry.label(), '记忆', 'Chinese app language yields 「记忆」')
  assert.equal(entry.label(), libSectionLabel('zh'), 'the inlined label agrees with lib/settings-nav-icon.js')

  first.localeState.active = 'en'
  assert.equal(entry.label(), 'Memory', 'English app language yields "Memory"')
  assert.equal(entry.label(), libSectionLabel('en'))
})

test('the client half never guesses the language from navigator.language', () => {
  // Comments may name it (they explain why); executable code must not read it.
  const codeOnly = CLIENT_SOURCE
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(codeOnly, /navigator\s*\.\s*language/)

  // The sandbox navigator says en-US, yet a zh slot label and the Chinese
  // fallback win: the app language comes from ctx.locale, not the browser.
  const { moduleExports } = browserHarness()
  const { slots } = applyClient(moduleExports, { language: 'zh' })
  assert.equal(slots.registrations[0].entry.label(), '记忆')
  assert.ok(collectText(moduleExports.__test.MemoryForm({})).includes('读取配置中…'))
})

// ── 2. every key is translated, nobody is half-translated ─────────────────

test('every key the panel asks for exists in both dictionaries, and no key is dead', () => {
  const { moduleExports } = browserHarness()
  const { DICTS } = moduleExports.__test
  const referenced = new Set([...CLIENT_SOURCE.matchAll(/\bt\(\s*'([^']+)'\s*\)/g)].map((match) => match[1]))
  assert.ok(referenced.size > 60, `expected the panel to use many keys, saw ${referenced.size}`)

  // `sectionLabel` is read straight off DICTS by the sidebar label resolver.
  const allowUnreferenced = new Set(['sectionLabel'])
  for (const key of Object.keys(DICTS.zh)) {
    assert.ok(referenced.has(key) || allowUnreferenced.has(key), `dead dictionary key: ${key}`)
  }
  for (const key of referenced) {
    assert.ok(Object.hasOwn(DICTS.zh, key), `t('${key}') has no zh string`)
    assert.ok(Object.hasOwn(DICTS.en, key), `t('${key}') has no en string`)
  }
})

test('Chinese user-facing strings live only in the dictionaries (nothing half-translated)', () => {
  const lines = CLIENT_SOURCE.split('\n')
  let inDicts = false
  const raw = []
  for (const [index, line] of lines.entries()) {
    if (line.trim().startsWith('const DICTS = {')) inDicts = true
    if (inDicts) {
      if (line.trim() === '}') inDicts = false
      continue
    }
    const trimmed = line.trim()
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue
    if (CJK.test(line)) raw.push(`${index + 1}: ${trimmed}`)
  }
  assert.deepEqual(raw, [], 'a hard-coded Chinese string outside DICTS would ship untranslated in English')
})

// ── 3. sidebar label + icon follow a language switch ─────────────────────

test('the sidebar mark is claimed only on the exact label row', () => {
  const { moduleExports, rows } = browserHarness()
  applyClient(moduleExports, { language: 'zh' })
  assert.deepEqual(claimedTexts(rows), ['记忆'], 'Chinese label claims the Chinese row only')
  assert.equal(rows.find((row) => row.textContent === 'Memory').attrs.has(NAV_ICON_ATTR), false,
    'another section showing the English word must not be claimed')
  assert.equal(rows.find((row) => row.textContent === 'Heartbeat').attrs.has(NAV_ICON_ATTR), false)
})

test('sidebar label and icon re-align after a language switch', () => {
  const { moduleExports, rows, observers } = browserHarness()
  const first = applyClient(moduleExports, { language: 'zh' })
  const entry = first.slots.registrations[0].entry
  assert.equal(entry.label(), '记忆')
  assert.deepEqual(claimedTexts(rows), ['记忆'])

  // The app switches language: the shell repaints the nav (our row's text node
  // becomes "Memory", the old English decoy row is gone), then mutations fire.
  first.localeState.active = 'en'
  assert.equal(entry.label(), 'Memory')
  rows[3].textContent = 'Plugins' // the old English decoy row repaints into another section
  rows[1].textContent = 'Memory' // our row takes the English label
  assert.ok(observers.length > 0, 'a MutationObserver watches the nav')
  for (const observer of observers) observer.callback()
  assert.deepEqual(claimedTexts(rows), ['Memory'], 'the mark follows the relabelled row')
})

test('teardown removes the mark, the stylesheet and the observer', () => {
  const { moduleExports, rows, styles, observers } = browserHarness()
  const { effects } = applyClient(moduleExports)
  assert.ok(claimedTexts(rows).length > 0)
  assert.equal(styles.length, 1)
  for (const effect of effects) effect.dispose()
  assert.equal(claimedTexts(rows).length, 0)
  assert.equal(styles.length, 0)
  assert.ok(observers.length > 0)
  assert.ok(observers.every((observer) => observer.disconnected === true))
  const labels = effects.map((effect) => effect.label)
  assert.ok(labels.includes('memory: dictionaries'))
  assert.ok(labels.includes('memory: settings nav icon'))
})

// ── 4. t seat / fallback ─────────────────────────────────────────────────

test('a missing t seat falls back to Chinese without crashing', () => {
  const { moduleExports } = browserHarness()
  const seam = moduleExports.__test
  assert.equal(seam.fallbackT('loading'), '读取配置中…')
  assert.equal(seam.fallbackT('missing.key'), 'missing.key', 'unknown keys degrade to the key, never throw')
  assert.equal(seam.fallbackT('graphRelations', { count: 2 }), '2 条关系')

  const tree = seam.MemoryForm({})
  assert.ok(collectText(tree).includes('读取配置中…'))
  const graphTree = seam.GraphCard({})
  assert.ok(collectText(graphTree).includes('正在构建记忆图谱…'))
  const insightsTree = seam.InsightsCard({})
  assert.ok(collectText(insightsTree).includes('正在统计记忆库…'))
})

test('an injected t seat wins over the fallback and reaches every card', () => {
  const { moduleExports } = browserHarness()
  const seam = moduleExports.__test
  const seat = (key) => `SEAT:${key}`
  assert.ok(collectText(seam.MemoryForm({ t: seat })).includes('SEAT:loading'))
  assert.ok(collectText(seam.GraphCard({ t: seat })).includes('SEAT:graphLoading'))
  assert.ok(collectText(seam.InsightsCard({ t: seat })).includes('SEAT:insightsLoading'))

  // MemorySection hands the seat to the whole tree through React context.
  const tree = seam.MemorySection({ t: seat })
  const provider = findElement(tree, (node) => node.type !== undefined && node.props !== undefined && typeof node.props.value === 'function')
  assert.equal(provider?.props.value, seat, 'the panel tree is wrapped in the LocaleContext provider')
})

// ── 5. English panel, end to end ─────────────────────────────────────────

test('the whole settings form renders in English (no Chinese left)', () => {
  const { moduleExports } = browserHarness({
    state: [{}, 'ready', undefined, false],
  })
  const seam = moduleExports.__test
  const t = (key) => seam.DICTS.en[key]
  const texts = collectText(seam.MemoryForm({ t }))
  for (const expected of [
    'Enable memory plugin',
    'Memory directory',
    'Inject memory at session start',
    'Inject only after you speak',
    'Inject into the active session only',
    'Register the memory skill',
    'Proactive recall',
    'Recall interval (minutes)',
    'Recalls per session',
    'Feedback / open an issue',
    'Current: memory store at',
  ]) {
    assert.ok(texts.some((text) => text.includes(expected)), `missing English copy: ${expected}`)
  }
  const leftovers = texts.filter((text) => CJK.test(text))
  assert.deepEqual(leftovers, [], 'the English form must not leak Chinese copy')

  // The same tree in the fallback language is Chinese (so the test is meaningful).
  const { moduleExports: zhClient } = browserHarness({
    state: [{}, 'ready', undefined, false],
  })
  const zhTexts = collectText(zhClient.__test.MemoryForm({}))
  assert.ok(zhTexts.includes('启用记忆插件'))
  assert.ok(zhTexts.includes('记忆目录'))
  assert.ok(zhTexts.some((text) => text.includes('当前：记忆库位于')))
})

const insightsPayload = {
  overview: { pages: 3, indexEntries: 4, chars: 1200 },
  freshness: {
    // The host sends Chinese labels; the client must ignore them and use `key`.
    buckets: [
      { key: 'today', label: '今天', count: 1 },
      { key: 'stale', label: '>90 天', count: 2 },
    ],
    never: 1,
  },
  health: {
    score: 72,
    checks: [
      { id: 'index', ok: true, label: 'index 链接完整', detail: '4 条路由全部有效', data: { routes: 4, missing: 0 } },
      { id: 'orphans', ok: false, label: '无孤儿页', detail: '2 页未收录：a.md、b.md', data: { count: 2, sample: ['a.md', 'b.md'] } },
      { id: 'frontmatter', ok: false, label: 'frontmatter 完整', detail: '缺 salience 1 页 / 缺 type 2 页', data: { missingSalience: 1, missingType: 2 } },
      { id: 'freshness', ok: false, label: '访问新鲜度', detail: '2 页陈旧或从未戳记', data: { atRisk: 2 } },
    ],
  },
  stalePages: [{ path: 'user/old.md', title: 'old page', daysSinceAccess: 120 }],
  recent: ['[2026-09-23] feature | shipped'],
}

test('the health dashboard rebuilds English labels and details from structured data', () => {
  const { moduleExports } = browserHarness({ state: [insightsPayload, 'ready'] })
  const seam = moduleExports.__test
  const t = (key) => seam.DICTS.en[key]
  const texts = collectText(seam.InsightsCard({ t }))
  for (const expected of [
    'Memory health',
    'Access freshness',
    'today',
    '>90 days',
    'never',
    'Health checks',
    'index links complete',
    '4 routes all valid',
    '2 pages not in the index: a.md, b.md',
    'missing salience on 1 pages / missing type on 2 pages',
    '2 pages are stale or never stamped',
    '120 days since last access',
    'Recent activity',
  ]) {
    assert.ok(texts.some((text) => text.includes(expected)), `missing English dashboard copy: ${expected}`)
  }
  // The host's Chinese label/detail strings must not survive when data exists.
  const leftovers = texts.filter((text) => CJK.test(text))
  assert.deepEqual(leftovers, [], 'English dashboard must not render the host Chinese strings')
})

test('a pre-0.11 payload without structured data keeps the host detail (backward compatible)', () => {
  const { moduleExports } = browserHarness()
  const seam = moduleExports.__test
  const t = (key) => seam.DICTS.en[key]
  assert.equal(seam.checkDetail({ id: 'index', ok: true, detail: '1 条路由全部有效' }, t), '1 条路由全部有效')
  assert.equal(seam.checkDetail({ id: 'index', ok: true }, t), '', 'a missing detail degrades to empty, never throws')
  assert.equal(seam.checkLabel({ id: 'mystery', label: 'x' }, t), 'x', 'unknown ids keep the host label')
  assert.equal(seam.bucketLabel({ key: 'mystery', label: 'y' }, t), 'y', 'unknown buckets keep the host label')

  const oldPayload = {
    ...insightsPayload,
    health: { score: 50, checks: [{ id: 'index', ok: false, label: 'index 链接完整', detail: '1 条指向不存在的页' }] },
  }
  const { moduleExports: oldClient, styles } = browserHarness({ state: [oldPayload, 'ready'] })
  const texts = collectText(oldClient.__test.InsightsCard({ t }))
  assert.ok(texts.some((text) => text.includes('index links complete')), 'the label is still translated')
  assert.ok(texts.some((text) => text.includes('1 条指向不存在的页')), 'the old Chinese detail still renders')
  assert.deepEqual(styles, [], 'this harness never mounted the graph stylesheet')
})

test('the graph card renders its copy and type legend in English', () => {
  const { moduleExports } = browserHarness()
  const seam = moduleExports.__test
  const t = (key) => seam.DICTS.en[key]
  const graph = {
    nodes: [
      { id: 'a', label: 'alpha', type: 'project', tags: [], degree: 2, x: 100, y: 100, r: 8, color: '#4c8bf5' },
      { id: 'b', label: 'beta', type: 'user', tags: [], degree: 1, x: 160, y: 100, r: 6, color: '#8b7bf5' },
      { id: 'c', label: 'gamma', type: 'meta', tags: [], degree: 0, x: 200, y: 60, r: 6, color: '#5b6068', hub: true },
    ],
    edges: [{ source: 'a', target: 'b', kind: 'tag', weight: 1 }],
    stats: { pages: 3, links: 1, tagEdges: 1, indexLinks: 2, isolated: ['c'] },
  }
  const texts = collectText(seam.GraphView({ graph, t }))
  for (const expected of [
    'Memory graph',
    '3 pages · 1 page links · 1 shared tags',
    '2 index routes (dashed)',
    '1 pages isolated',
    'project',
    'about you',
    'shared tag',
    'page links',
  ]) {
    assert.ok(texts.some((text) => text.includes(expected)), `missing English graph copy: ${expected}`)
  }
  const leftovers = texts.filter((text) => CJK.test(text))
  assert.deepEqual(leftovers, [], 'the English graph must not leak Chinese copy')
  // The svg carries a translated accessible name.
  const svg = findElement(seam.GraphView({ graph, t }), (node) => node.type === 'svg')
  assert.equal(svg?.props['aria-label'], 'Memory graph')

  // Chinese fallback still works when no t seat is available.
  const zhTexts = collectText(seam.GraphView({ graph }))
  assert.ok(zhTexts.includes('记忆图谱'))
  assert.ok(zhTexts.includes('━ 页间互链'))
  assert.equal(findElement(seam.GraphView({ graph }), (node) => node.type === 'svg')?.props['aria-label'], '记忆图谱')
})

test('type labels translate known types and keep unknown ones verbatim', () => {
  const { moduleExports } = browserHarness()
  const seam = moduleExports.__test
  const en = (key) => seam.DICTS.en[key]
  const zh = (key) => seam.DICTS.zh[key]
  assert.equal(seam.typeLabel('user-preference', zh), '偏好')
  assert.equal(seam.typeLabel('user-preference', en), 'preference')
  assert.equal(seam.typeLabel('unknown', zh), '未标注')
  assert.equal(seam.typeLabel('unknown', en), 'untagged')
  for (const type of ['identity', 'user', 'project', 'skill', 'decision', 'concept', 'fact']) {
    assert.ok(!CJK.test(seam.typeLabel(type, en)), `en type label for ${type} must be English`)
  }
  assert.equal(seam.typeLabel('meta', en), 'meta', 'a type we do not know is not invented')
})

// ── 7. v0.13.0: manual growth recap button + panel accessibility ───────────

test('v0.13.0 the panel offers a manual growth recap with a status line', () => {
  const config = { enabled: true, memoryDir: '/tmp/memory', growthRecapEnabled: true }
  const { moduleExports } = browserHarness({ state: [config, 'ready', undefined, false, false, undefined] })
  const texts = collectText(moduleExports.__test.MemoryForm({}))
  assert.ok(texts.includes('立即回顾'), 'the button label is rendered')
  assert.ok(texts.includes('手动触发一次成长回顾（尊重发言权仲裁；没有新内容时不发）'), 'the hint is rendered')
  const button = findElement(moduleExports.__test.MemoryForm({}), (node) => node.type === 'button' && node.props?.['aria-label'] === '立即回顾')
  assert.ok(button !== undefined, 'the button carries an aria-label')
})

test('v0.13.0 panel controls are keyboard/label accessible and talk to the control route', () => {
  assert.ok(CLIENT_SOURCE.includes("const CONTROL_URL = '/api/memory/control'"), 'the panel posts to the control route')
  assert.ok(CLIENT_SOURCE.includes("'aria-label': label"), 'inputs/toggles/selects expose a label')
  assert.ok(CLIENT_SOURCE.includes("role: 'alert'"), 'errors are announced')
  assert.ok(CLIENT_SOURCE.includes("role: 'status'"), 'the recap result is announced')
  assert.ok(CLIENT_SOURCE.includes(':focus-visible'), 'keyboard focus has a visible outline')
  // The new copy is translated in both languages and referenced (no dead keys).
  const { DICTS } = browserHarness().moduleExports.__test
  for (const key of ['growthNow', 'growthNowHint', 'growthNowRunning', 'growthNowOk', 'growthNowDeferred', 'growthNowEmpty', 'growthNowDisabled', 'growthNowFailed']) {
    assert.equal(typeof DICTS.zh[key], 'string', `zh.${key}`)
    assert.equal(typeof DICTS.en[key], 'string', `en.${key}`)
    assert.ok(CLIENT_SOURCE.includes(`t('${key}')`), `${key} is actually used`)
  }
})

// ── 8. v0.13.1: focus ring must target the real panel, labels complete ─────

test('v0.13.1 focus-visible rules target the panel marker, not a dead <section> selector', () => {
  const config = { enabled: true, memoryDir: '/tmp/memory' }
  const { moduleExports } = browserHarness({ state: [config, 'ready', undefined, false, false, undefined] })
  const tree = moduleExports.__test.MemoryForm({})
  const texts = collectText(tree)
  assert.ok(texts.includes('最短间隔') || CLIENT_SOURCE.includes("t('recallIntervalMin')"), 'the min interval input is labelled')
  assert.ok(texts.includes('最长间隔') || CLIENT_SOURCE.includes("t('recallIntervalMax')"), 'the max interval input is labelled')
  assert.ok(CLIENT_SOURCE.includes("'data-dsh-memory-panel': ''"), 'the form root carries the panel marker')
  assert.ok(CLIENT_SOURCE.includes('[data-dsh-memory-panel] :focus-visible'), 'the focus rule matches the marker')
  assert.ok(!CLIENT_SOURCE.includes('section [role="switch"]:focus-visible'), 'the dead <section> selector is gone')
})

test('v0.13.1 every control in the ready panel exposes an aria-label', () => {
  const config = { enabled: true, memoryDir: '/tmp/memory' }
  const { moduleExports } = browserHarness({ state: [config, 'ready', undefined, false, false, undefined] })
  const tree = moduleExports.__test.MemoryForm({})
  const controls = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const child of node) walk(child); return }
    if (typeof node.type === 'function' && node.type.prototype?.isReactComponent !== true) {
      walk(node.type(node.props))
      return
    }
    if (node.type === 'input' || node.type === 'select' || node.type === 'button') controls.push(node)
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
  assert.ok(controls.length >= 10, `expected the ready panel controls, saw ${controls.length}`)
  const unlabelled = controls.filter((node) => typeof node.props?.['aria-label'] !== 'string' || node.props['aria-label'].length === 0)
  assert.deepEqual(unlabelled.map((node) => node.type), [], 'every input/select/button needs a label')
})

test('v0.13.1 result copy maps the host reasons and auto-clears', () => {
  const { DICTS } = browserHarness().moduleExports.__test
  assert.equal(typeof DICTS.zh.growthNowBusy, 'string')
  assert.equal(typeof DICTS.en.growthNowBusy, 'string')
  assert.ok(CLIENT_SOURCE.includes("t('growthNowBusy')"), 'busy is surfaced instead of masquerading as "no content"')
  assert.ok(CLIENT_SOURCE.includes("reason === 'no-content'"), 'no-content maps to the empty-copy branch')
  assert.ok(CLIENT_SOURCE.includes('setGrowthNotice(undefined), 5000'), 'the notice clears after ~5s')
})

// ── 9. v0.13.1: no-session/error copy + panel marker scope ────────────────

test('v0.13.1 no-session and error results read as their own sentences', () => {
  const { DICTS } = browserHarness().moduleExports.__test
  assert.equal(typeof DICTS.zh.growthNowNoSession, 'string')
  assert.equal(typeof DICTS.en.growthNowNoSession, 'string')
  assert.equal(typeof DICTS.zh.growthNowError, 'string')
  assert.ok(!DICTS.zh.growthNowError.endsWith('：'), 'the standalone error line has no dangling colon')
  assert.ok(!DICTS.en.growthNowError.endsWith(':'), 'the standalone error line has no dangling colon')
  assert.ok(DICTS.zh.growthNowFailed.endsWith('：'), 'the concatenated network error keeps its colon')
  assert.ok(CLIENT_SOURCE.includes("reason === 'no-session'"), 'no-session maps to its own copy')
  assert.ok(CLIENT_SOURCE.includes("t('growthNowError')"), 'error/agent-gone use the standalone copy')
})

test('v0.13.1 the panel marker wraps the config form and the two cards', () => {
  const { moduleExports } = browserHarness({ state: [{}, 'ready', undefined, false, false, undefined] })
  const tree = moduleExports.__test.MemorySection({})
  // The marker must sit on MemorySection's own wrapper so the health/graph
  // cards share the focus-ring scope (the form root is not the whole panel).
  let markerDepth = -1
  const walk = (node, depth) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const child of node) walk(child, depth); return }
    if (typeof node.type === 'function' && node.type.prototype?.isReactComponent !== true) { walk(node.type(node.props), depth); return }
    if (node.props?.['data-dsh-memory-panel'] !== undefined) markerDepth = depth
    for (const child of node.children ?? []) walk(child, depth + 1)
  }
  walk(tree, 0)
  assert.ok(markerDepth >= 0, 'the panel marker is rendered')
  assert.ok(markerDepth <= 3, `marker should wrap the section, saw depth ${markerDepth}`)
})
