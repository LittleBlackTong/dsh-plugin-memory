# 记忆时间轴视图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 dsh-plugin-memory 的记忆面板里新增「时间轴」tab：单线地铁式横向时间轴，从 `log.md` 派生事件，缩放自动联动日/周/月/年刻度，节点不拥挤时显示描述，深浅主题自适应，单击详情、双击打开文件。

**Architecture:** Host 增加一个只读解析模块 `lib/timeline.js`（log.md → events + stats，含事件→页面路径的模糊匹配）并注册 `GET /api/memory/timeline`；Client 把 `MemorySection` 改为 tab 容器，现有 `GraphCard` 原样保留，新增 `TimelineCard` 与一组纯函数（缩放→粒度、刻度、布局/标签碰撞、初始视口）以便 vm 单测。

**Tech Stack:** Node 18+ ESM（host 半，无构建）、`window.__ModuleLoader__` 零构建 CJS 客户端半、`node:test`、React（仅平台种子，client 半不 require 其它 Harness 包）。

**Spec:** `docs/superpowers/specs/2026-11-16-memory-timeline-design.md`

## Global Constraints

- 不新增依赖；不 require 任何 `@deepseek-ai/dsh-client-*` 客户端包（只 `react` 平台种子）。
- host 路由只读、失败返回空 payload + 200，绝不抛错、绝不改动记忆文件。
- 日期按 `YYYY-MM-DD` 解析为 UTC 日（`Date.UTC`），展示用该字符串；不做时区换算。
- 站点标题必须 `escapeHtml` 后再进 DOM（纯文本）。
- 主色/文本/边框一律用 DSH 主题变量 + fallback（`var(--dsw-alias-*, 兜底色)`），跟随深/浅主题。
- 默认只显示关键事件（排除 `NOISE_KINDS`）；「显示全部事件」开关可看全量。
- 初始视口：最近一周（最新事件在右端）。
- 现有 341 个测试 + `npm test` self-test 必须保持全绿。
- 双击打开文件：复用现有 `openInSidebar`（工作区外回退系统文件管理器）；事件无 `path` 时打开 `log.md` 并给出提示文案。

---

## File Structure

| File | 职责 |
|---|---|
| `lib/timeline.js`（新） | 解析 `log.md`、页面索引、事件→路径匹配、group 映射、关键/噪声分类、stats |
| `lib/index.js`（改） | 注册 `GET /api/memory/timeline`、导出 `buildTimeline`/`TIMELINE_ROUTE_PATH` |
| `lib/types/index.d.ts`（改） | `TimelineEvent` / `TimelinePayload` 类型 |
| `lib/client.js`（改） | tab 容器、`TimelineCard`、纯函数（scaleFor/layoutTimeline）、样式、中英文案、双击打开 |
| `test/timeline.test.mjs`（新） | host 解析与路由测试 |
| `test/session-ui.test.mjs`（改） | 时间轴纯函数与渲染测试（vm + React stub） |
| `README.md` / `README.zh.md`（改） | 功能说明加「时间轴视图」 |
| `CHANGELOG.md`（改） | 0.20.0 记录 |

---

### Task 1: Host timeline 解析与只读路由

**Files:**
- Create: `lib/timeline.js`
- Modify: `lib/index.js`（import、路由常量、webServer 路由、导出）
- Modify: `lib/types/index.d.ts`
- Test: `test/timeline.test.mjs`

**Interfaces:**
- Produces:
  - `buildTimeline(memoryDir: string, options?: { }): { events: TimelineEvent[]; stats: { events: number; first?: string; last?: string; pages: number } }`
  - `TimelineEvent = { date: string; kind: string; group: 'fix'|'feat'|'publish'|'decision'|'other'; title: string; path?: string }`
  - `groupOf(kind: string): string`，`isNoiseKind(kind: string): boolean`
  - `TIMELINE_ROUTE_PATH = '/api/memory/timeline'`

- [ ] **Step 1: 写 host 测试（先红）**

`test/timeline.test.mjs` 关键用例（fixture 用 `mkdtempSync`，写 `log.md` 与页面）：

```js
import { buildTimeline, groupOf, isNoiseKind, NOISE_KINDS } from '../lib/timeline.js'

// fixture log.md:
// # Memory Log
// ## [2026-11-10] fix | dsh-plugin-memory 0.19.4（双向兼容）
// ## [2026-11-12] publish | 商店分支重建
// ## [2026-11-12] note | 无新增的普通日志
// ## [bad-date] fix | 非法日期应被跳过

test('buildTimeline parses log headings into events', () => {
  const { events, stats } = buildTimeline(dir)
  assert.deepEqual(events.map((e) => [e.date, e.kind, e.group]), [
    ['2026-11-10', 'fix', 'fix'],
    ['2026-11-12', 'publish', 'publish'],
    ['2026-11-12', 'note', 'other'],
  ])
  assert.equal(stats.events, 3)
  assert.equal(stats.first, '2026-11-10')
  assert.equal(stats.last, '2026-11-12')
})

test('buildTimeline matches events to page paths by title and file name', () => {
  // 页面 projects/active/dsh-plugin-memory.md frontmatter title: dsh-plugin-memory 插件本体
  // 事件标题 "dsh-plugin-memory 0.19.4（双向兼容）" → path: 'projects/active/dsh-plugin-memory.md'
  // 无匹配事件省略 path
})

test('buildTimeline tolerates missing/corrupt log and invalid dates', () => {
  assert.deepEqual(buildTimeline(emptyDir), { events: [], stats: { events: 0, pages: 0 } })
  // 无 log.md → 空；坏 JSON 无关；日期非 YYYY-MM-DD → 跳过
})

test('group mapping and noise classification', () => {
  assert.equal(groupOf('bugfix'), 'fix')
  assert.equal(groupOf('release'), 'publish')
  assert.equal(groupOf('design'), 'decision')
  assert.equal(groupOf('task'), 'other')
  assert.equal(isNoiseKind('note'), true)
  assert.equal(isNoiseKind('fix'), false)
  assert.equal(NOISE_KINDS.has('digest'), true)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/timeline.test.mjs`
Expected: FAIL（`buildTimeline` 未定义）。

- [ ] **Step 3: 实现 `lib/timeline.js`**

```js
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export const GROUP_OF = {
  fix: 'fix', bugfix: 'fix', repair: 'fix',
  feat: 'feat', feature: 'feat', implement: 'feat', impl: 'feat',
  publish: 'publish', release: 'publish', deliverable: 'publish',
  decision: 'decision', design: 'decision',
}
export const NOISE_KINDS = new Set(['note','digest','install','uninstall','setup','bootstrap','task','probe','recall','consolidate','ops','schedule','export'])
export const groupOf = (kind) => GROUP_OF[kind] ?? 'other'
export const isNoiseKind = (kind) => NOISE_KINDS.has(kind)

const LOG_LINE = /^## \[(\d{4}-\d{2}-\d{2})\] (\w+) \| (.+)$/
const PAGE_SKIP = new Set(['SOUL.md','MEMORY.md','index.md','log.md','BOOTSTRAP.md'])

function readPageIndex(memoryDir) {
  const pages = []
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const ent of entries) {
      const p = join(dir, ent.name)
      if (ent.isDirectory()) { if (ent.name !== 'raw') walk(p); continue }
      if (!ent.name.endsWith('.md') || PAGE_SKIP.has(ent.name)) continue
      try {
        const text = readFileSync(p, 'utf8')
        const title = /^title:\s*(.+)$/m.exec(text)?.[1]?.trim().replace(/^["']|["']$/g, '')
        pages.push({ path: relative(memoryDir, p).split(sep).join('/'), title, name: ent.name.replace(/\.md$/, '') })
      } catch { /* skip unreadable page */ }
    }
  }
  walk(memoryDir)
  return pages
}

function matchPath(title, pages) {
  let best
  for (const page of pages) {
    for (const needle of [page.title, page.name]) {
      if (typeof needle !== 'string' || needle.length === 0) continue
      if (title.includes(needle) && (best === undefined || needle.length > best.len)) best = { path: page.path, len: needle.length }
    }
  }
  return best?.path
}

export function buildTimeline(memoryDir) {
  const logPath = join(memoryDir, 'log.md')
  const pages = existsSync(memoryDir) ? readPageIndex(memoryDir) : []
  const events = []
  let text = ''
  try { text = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '' } catch { text = '' }
  for (const line of text.split(/\r?\n/)) {
    const m = LOG_LINE.exec(line)
    if (!m) continue
    const [, date, kind, title] = m
    const event = { date, kind, group: groupOf(kind), title: title.trim() }
    const path = matchPath(event.title, pages)
    if (path !== undefined) event.path = path
    events.push(event)
  }
  events.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
  const stats = { events: events.length, pages: pages.length }
  if (events.length > 0) { stats.first = events[0].date; stats.last = events[events.length - 1].date }
  return { events, stats }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/timeline.test.mjs`
Expected: PASS（4 个用例）。

- [ ] **Step 5: 注册 host 路由 + 类型 + 导出**

`lib/index.js`：
- import：`import { buildTimeline } from './timeline.js'`
- 常量：`export const TIMELINE_ROUTE_PATH = '/api/memory/timeline'`
- 在 graph 路由同一个 `ctx.inject(['webServer'], ...)` 或新增 effect 中注册：
  ```js
  ctx.inject(['webServer'], (webCtx) => {
    const disposeTimeline = webCtx.webServer.register({
      kind: 'exact',
      path: TIMELINE_ROUTE_PATH,
      handler: (req, res) => {
        try {
          const payload = buildTimeline(currentMemoryDir)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(payload))
        } catch (error) {
          ctx.logger?.warn?.(`memory: timeline failed: ${error instanceof Error ? error.message : String(error)}`)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ events: [], stats: { events: 0, pages: 0 } }))
        }
      },
    })
    webCtx.effect(() => () => disposeTimeline, 'memory.timeline-route()')
  })
  ```
- 底部导出：`export { buildTimeline } from './timeline.js'`
- `lib/types/index.d.ts` 增加 `TimelineEvent` / `TimelinePayload` / `buildTimeline` 声明。

- [ ] **Step 6: 全量测试 + commit**

Run: `node --test` → 全绿；`npm test` → self-test PASS。
```bash
git add lib/timeline.js lib/index.js lib/types/index.d.ts test/timeline.test.mjs
git commit -m "feat: timeline host parser and /api/memory/timeline route"
```

---

### Task 2: Client 时间轴视图（tab + TimelineCard）

**Files:**
- Modify: `lib/client.js`（DICTS、常量、纯函数、样式、TimelineCard、MemorySection tab 容器、__test 导出）
- Test: `test/session-ui.test.mjs`（扩）

**Interfaces:**
- Consumes（Task 1）：`GET /api/memory/timeline` 返回 `{ events: [{date,kind,group,title,path?}], stats }`。
- Produces（导出到 `__test`）：
  - `scaleFor(pxPerDay: number): 'day'|'week'|'month'|'year'`
  - `computeTimelineLayout({ events, width, offset, pxPerDay, showAll }): { axis: {left,width}, ticks: [{x,label}], stations: [{x,y,size,group,date,title,index}], labels: [{x,y,text}] }`
  - `initialTimelineOffset({ events, width, pxPerDay }): number`（最近一周）
  - `TimelineCard({ t })`（React 组件）

- [ ] **Step 1: 写 client 测试（先红）**（`test/session-ui.test.mjs`，`loadClient()` 已存在）

```js
test('scaleFor maps zoom density to day/week/month/year', () => {
  const seam = loadClient()
  assert.equal(seam.scaleFor(54), 'day')
  assert.equal(seam.scaleFor(20), 'week')
  assert.equal(seam.scaleFor(3), 'month')
  assert.equal(seam.scaleFor(1), 'year')
})

test('computeTimelineLayout drops overlapping labels but keeps stations', () => {
  const seam = loadClient()
  const events = [
    { date: '2026-11-10', kind: 'fix', group: 'fix', title: '修复 A' },
    { date: '2026-11-10', kind: 'fix', group: 'fix', title: '修复 B' }, // 同日，拥挤
  ]
  const layout = seam.computeTimelineLayout({ events, width: 600, offset: 0, pxPerDay: 54, showAll: false })
  assert.equal(layout.stations.length, 2)
  assert.equal(layout.labels.length, 1, 'overlapping labels collapse to one')
})

test('initialTimelineOffset keeps the last week visible', () => {
  const seam = loadClient()
  const events = [{ date: '2026-11-12', kind: 'fix', group: 'fix', title: 'x' }]
  const offset = seam.initialTimelineOffset({ events, width: 600, pxPerDay: 54 })
  assert.ok(Number.isFinite(offset))
  assert.ok(offset < 0, 'the newest event sits at the right edge')
})

test('TimelineCard renders stats, stations and detail card', () => {
  const seam = loadClient()
  const node = seam.TimelineCard({ t: (k) => seam.DICTS.zh[k] })
  assert.ok(node !== null)
  // 含统计行与「显示全部事件」开关
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/session-ui.test.mjs`
Expected: FAIL（`scaleFor`/`computeTimelineLayout` 未定义）。

- [ ] **Step 3: 实现纯函数**

在 `lib/client.js`（`GraphView` 附近）新增：

```js
const DAY_MS = 86400000
const TIMELINE_URL = '/api/memory/timeline'
const TIMELINE_NOISE = new Set(['note','digest','install','uninstall','setup','bootstrap','task','probe','recall','consolidate','ops','schedule','export'])
const TIMELINE_GROUPS = { fix:'修复', feat:'功能', publish:'发布', decision:'决策', other:'其他' } // 用 DICTS 文案
const timelineGroupOf = (kind) => ({ fix:'fix',bugfix:'fix',feat:'feat',feature:'feat',implement:'feat',impl:'feat',publish:'publish',release:'publish',deliverable:'publish',decision:'decision',design:'decision' })[kind] ?? 'other'
function scaleFor(pxPerDay) { return pxPerDay >= 30 ? 'day' : pxPerDay >= 7 ? 'week' : pxPerDay >= 1.6 ? 'month' : 'year' }
function visibleTimelineEvents(events, showAll) { return (events || []).filter((e) => showAll || !TIMELINE_NOISE.has(e.kind)) }
function initialTimelineOffset({ events, width, pxPerDay }) {
  const list = visibleTimelineEvents(events, false)
  if (list.length === 0) return 0
  const last = Date.parse(list[list.length - 1].date + 'T00:00:00Z')
  const first = Date.parse(list[0].date + 'T00:00:00Z')
  const weekAgo = last - 7 * DAY_MS
  const anchor = weekAgo > first ? weekAgo : first
  return width - 40 - (last - anchor) / DAY_MS * pxPerDay
}
function computeTimelineLayout({ events, width, offset, pxPerDay, showAll }) {
  // 线性时间轴；刻度按 scaleFor(pxPerDay) 生成；同日站点 ±9px / 上下交错；
  // 标签按 x 排序做碰撞检测（左缘 - 上一右缘 < 8px 则跳过），22 字截断。
  // 返回 { axis, ticks, stations, labels }；所有坐标是 px。
}
```

- [ ] **Step 4: 实现 TimelineCard + tab 容器 + 样式 + 文案**

- `ensureTimelineStyles()`：注入 `<style id="dsh-memory-timeline-style">`，类名 `dsh-mem-tl-*`；颜色用 `var(--dsw-alias-*, 兜底)`，站点色用 5 组 CSS 变量（深浅主题各一组，参考 `ensureGraphStyles` 现有做法）。
- `TimelineCard`：state（payload/status/offset/pxPerDay/showAll/selected/fetchedAt），`fetch(TIMELINE_URL)` + `setInterval(15000)`，失败静默保留旧数据；拖拽（pointer events）、wheel 缩放（`offset = mx - (mx - offset) * (next/px)`）、「回到今天」、`showAll` 开关、双击站点 → `openTimelineEvent(event)`。
- `openTimelineEvent`：`event.path` 存在 → 复用 `openInSidebar(path)` 的底层（从现有 `openInSidebar(id)` 抽出 `openMemoryFile(relPath)`，图谱节点路径走同一函数）；无 path → 打开 `log.md` 并显示 `timelineNoPage` 文案。
- `MemorySection` 改为：tab 栏（图谱/时间轴）+ 条件渲染 `GraphCard` / `TimelineCard`（默认图谱；切 tab 才挂载该卡片）。`__test` 追加导出：`scaleFor`、`computeTimelineLayout`、`initialTimelineOffset`、`TimelineCard`、`openTimelineEvent`。

- [ ] **Step 5: 运行 client 测试 + 全量**

Run: `node --test test/session-ui.test.mjs` → PASS；`node --test` → 全绿；`npm test` → PASS。

- [ ] **Step 6: commit**

```bash
git add lib/client.js test/session-ui.test.mjs
git commit -m "feat: memory panel timeline tab (single-line metro layout, zoom-linked scale, adaptive labels)"
```

---

### Task 3: 文档、CHANGELOG 与发布前校验

**Files:**
- Modify: `README.md`、`README.zh.md`、`CHANGELOG.md`
- Modify: `package.json`（版本 0.20.0）
- 测试：全量

- [ ] **Step 1: README 功能段**：在 Features / 功能列表加「时间轴视图」条目（中英）：记忆面板新增「时间轴」tab——单线地铁式横向滚动、拖动/滚轮缩放、缩放自动联动日/周/月/年、节点不拥挤时显示描述、单击看详情、双击打开文件、深浅主题跟随、默认只显示关键事件。
- [ ] **Step 2: CHANGELOG 0.20.0**：`### Added` 记录上述功能 + `GET /api/memory/timeline`。
- [ ] **Step 3: 版本**：`package.json` → `0.20.0`。
- [ ] **Step 4: 全量校验**：`node --test`、`npm test`、`npm pack --dry-run`（确认 files 含 lib/timeline.js）。

---

## Self-Review（spec 覆盖）

| Spec 要求 | 对应 Task |
|---|---|
| 面板 tab（图谱/时间轴） | Task 2 Step 4 |
| 单线 + 多色站点 | Task 2 computeTimelineLayout/TimelineCard |
| 拖动 + 滚轮缩放 + 自动粒度 | Task 2 Step 3/4 |
| 节点不拥挤显示描述 | Task 2 Step 3（标签碰撞） |
| 深浅主题跟随 | Task 2 Step 4（DSH 变量） |
| 默认关键事件 + 显示全部开关 | Task 2 Step 3（visibleTimelineEvents） |
| 单击详情 / 双击打开文件 | Task 2 Step 4 |
| 初始视口最近一周 | Task 2 Step 3（initialTimelineOffset） |
| `GET /api/memory/timeline` + 解析/匹配/容错 | Task 1 |
| README/CHANGELOG/版本 | Task 3 |
