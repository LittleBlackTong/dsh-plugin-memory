/**
 * Memory insights: the data layer behind the "memory health" dashboard.
 *
 * Everything here is derived from what the store already contains — frontmatter,
 * `last_access` stamps, `index.md` routing entries and `log.md` headlines — so
 * the dashboard never needs a second source of truth and cannot disagree with
 * `dsh-memory lint` / `status`. Read-only: building insights never writes a byte.
 *
 * Depends only on `node:*` builtins plus {@link ./pages.js}, so the standalone
 * CLI can reuse it without the plugin's peer dependencies.
 *
 * @module dsh-plugin-memory/insights
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { listPagePaths, readLastAccess, today } from './pages.js'

/** Type buckets shown on the dashboard, in display order. */
export const KNOWN_TYPES = ['identity', 'user', 'user-preference', 'project', 'skill', 'decision', 'concept', 'fact']

const TYPE_LABELS = {
  identity: '自我',
  user: '关于你',
  'user-preference': '偏好',
  project: '项目',
  skill: '程序性',
  decision: '决策',
  concept: '概念',
  fact: '事实',
  unknown: '未标注',
}

const FRESHNESS_BUCKETS = [
  { key: 'today', label: '今天', maxDays: 0 },
  { key: 'week', label: '≤7 天', maxDays: 7 },
  { key: 'month', label: '≤30 天', maxDays: 30 },
  { key: 'quarter', label: '≤90 天', maxDays: 90 },
  { key: 'stale', label: '>90 天', maxDays: Infinity },
]

/** Parse the frontmatter block into a flat key -> string map. */
export function parseFrontmatter(text) {
  if (!text.startsWith('---')) return {}
  const end = text.indexOf('\n---', 3)
  if (end < 0) return {}
  const fm = {}
  for (const line of text.slice(3, end).split('\n')) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (m) fm[m[1]] = m[2].trim()
  }
  return fm
}

/** Whole-day distance between two `YYYY-MM-DD` stamps, or undefined. */
function daysBetween(from, to) {
  const a = Date.parse(`${from}T00:00:00`)
  const b = Date.parse(`${to}T00:00:00`)
  if (Number.isNaN(a) || Number.isNaN(b)) return undefined
  return Math.floor((b - a) / 86400000)
}

/** Read one page's frontmatter + size into a row for the dashboard. */
function readPage(memoryDir, rel) {
  const abs = join(memoryDir, rel)
  let text = ''
  let bytes = 0
  let mtimeMs = 0
  try {
    text = readFileSync(abs, 'utf8')
    const stat = statSync(abs)
    bytes = stat.size
    mtimeMs = stat.mtimeMs
  } catch {
    return undefined
  }
  const fm = parseFrontmatter(text)
  const salience = Number(fm.salience)
  const lastAccess = readLastAccess(text)
  return {
    path: rel,
    title: fm.title || basename(rel, '.md'),
    type: fm.type || 'unknown',
    typeLabel: TYPE_LABELS[fm.type] ?? fm.type ?? TYPE_LABELS.unknown,
    salience: [1, 2, 3].includes(salience) ? salience : undefined,
    lastAccess,
    daysSinceAccess: lastAccess ? daysBetween(lastAccess, today()) : undefined,
    bytes,
    chars: text.length,
    mtimeMs,
  }
}

/** Index entries are the `- [label](path.md)` lines; everything else is prose. */
function parseIndexEntries(memoryDir) {
  const path = join(memoryDir, 'index.md')
  if (!existsSync(path)) return []
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const entries = []
  for (const match of text.matchAll(/^\s*-\s+\[[^\]]*\]\(([^)]+\.md)\)/gm)) {
    const target = match[1]
    if (/^https?:/.test(target)) continue
    entries.push({ target, exists: existsSync(join(memoryDir, target)) })
  }
  return entries
}

/**
 * Build the dashboard payload. Never throws on a missing or empty store — a
 * fresh install yields a zeroed overview rather than an error.
 *
 * @param {string} memoryDir absolute path of the memory store
 * @returns {object} JSON-serializable insights
 */
export function collectInsights(memoryDir) {
  const paths = listPagePaths(memoryDir)
  const pages = paths.map((rel) => readPage(memoryDir, rel)).filter(Boolean)
  const indexEntries = parseIndexEntries(memoryDir)
  const indexPath = join(memoryDir, 'index.md')

  // Freshness distribution: a page with no stamp at all is "never".
  const buckets = FRESHNESS_BUCKETS.map((b) => ({ key: b.key, label: b.label, count: 0 }))
  let never = 0
  for (const page of pages) {
    if (page.daysSinceAccess === undefined) {
      never += 1
      continue
    }
    const bucket = FRESHNESS_BUCKETS.find((b) => page.daysSinceAccess <= b.maxDays) ?? FRESHNESS_BUCKETS.at(-1)
    buckets.find((b) => b.key === bucket.key).count += 1
  }

  const byType = new Map()
  const bySalience = new Map()
  for (const page of pages) {
    byType.set(page.type, (byType.get(page.type) ?? 0) + 1)
    if (page.salience !== undefined) bySalience.set(page.salience, (bySalience.get(page.salience) ?? 0) + 1)
  }

  const stalePages = pages
    .filter((p) => p.daysSinceAccess === undefined || p.daysSinceAccess > 90)
    .sort((a, b) => (b.daysSinceAccess ?? Infinity) - (a.daysSinceAccess ?? Infinity))
    .slice(0, 8)
    .map((p) => ({ path: p.path, title: p.title, salience: p.salience, daysSinceAccess: p.daysSinceAccess ?? null }))

  // Checks mirror `dsh-memory lint` so the panel and the CLI cannot disagree.
  const unstamped = pages.filter((p) => !p.lastAccess).length
  const missingSalience = pages.filter((p) => p.salience === undefined).length
  const missingType = pages.filter((p) => p.type === 'unknown').length
  const missingLink = indexEntries.filter((e) => !e.exists)
  const indexedTargets = new Set(indexEntries.filter((e) => e.exists).map((e) => e.target.replace(/^\.\//, '')))
  const orphans = paths.filter((rel) => !indexedTargets.has(rel))
  const staleCount = pages.filter((p) => p.daysSinceAccess !== undefined && p.daysSinceAccess > 90).length

  const atRisk = staleCount + never
  const checks = [
    {
      id: 'index',
      ok: missingLink.length === 0,
      label: 'index 链接完整',
      detail: missingLink.length === 0 ? `${indexEntries.length} 条路由全部有效` : `${missingLink.length} 条指向不存在的页`,
    },
    {
      id: 'orphans',
      ok: orphans.length === 0,
      label: '无孤儿页',
      detail: orphans.length === 0 ? '每页都在 index 里' : `${orphans.length} 页未收录：${orphans.slice(0, 3).join('、')}${orphans.length > 3 ? '…' : ''}`,
    },
    {
      id: 'frontmatter',
      ok: missingSalience === 0 && missingType === 0,
      label: 'frontmatter 完整',
      detail: missingSalience === 0 && missingType === 0
        ? 'title/type/salience 齐全'
        : `缺 salience ${missingSalience} 页 / 缺 type ${missingType} 页`,
    },
    {
      id: 'freshness',
      ok: atRisk === 0,
      label: '访问新鲜度',
      detail: atRisk === 0 ? '没有超过 90 天未访问的页' : `${atRisk} 页陈旧或从未戳记`,
    },
  ]

  const totalPages = pages.length
  const score = totalPages === 0
    ? 100
    : Math.max(0, 100 - Math.round(
      (orphans.length * 15 + missingSalience * 8 + missingType * 5 + atRisk * 10 + missingLink.length * 15)
      / totalPages,
    ))

  const totalBytes = pages.reduce((sum, p) => sum + p.bytes, 0)
  const indexBytes = existsSync(indexPath) ? statSync(indexPath).size : 0
  const logSize = (() => {
    try {
      return statSync(join(memoryDir, 'log.md')).size
    } catch {
      return 0
    }
  })()
  const newest = pages.reduce((max, p) => Math.max(max, p.mtimeMs), 0)
  const recent = readRecentLog(memoryDir, 5)

  return {
    generatedAt: new Date().toISOString(),
    store: memoryDir,
    overview: {
      pages: totalPages,
      // Character count, not bytes/3: a CJK page is ~3 bytes per character, so a
      // byte-based estimate overshoots Chinese stores by roughly 3x.
      chars: pages.reduce((sum, p) => sum + p.chars, 0),
      bytes: totalBytes,
      indexEntries: indexEntries.length,
      indexBytes,
      logBytes: logSize,
      lastWrite: newest > 0 ? new Date(newest).toISOString() : null,
      neverAccessed: never,
    },
    byType: [...byType.entries()]
      .map(([type, count]) => ({ type, label: TYPE_LABELS[type] ?? type, count }))
      .sort((a, b) => b.count - a.count),
    pages: pages.map((p) => ({
      path: p.path,
      title: p.title,
      type: p.type,
      salience: p.salience,
      lastAccess: p.lastAccess,
    })),
    bySalience: [1, 2, 3].map((level) => ({ level, count: bySalience.get(level) ?? 0 })),
    freshness: { buckets, never },
    stalePages,
    recent,
    health: { score, checks },
  }
}

/**
 * The most recent `count` `log.md` headlines, newest last (same parser shape
 * the recall nudge uses, so the dashboard never invents activity).
 * @param {string} memoryDir absolute path of the memory store
 * @param {number} count max entries
 */
export function readRecentLog(memoryDir, count = 5) {
  const path = join(memoryDir, 'log.md')
  if (!existsSync(path)) return []
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const entries = []
  for (const line of text.split('\n')) {
    if (line.startsWith('## [')) entries.push(line.slice(3).trim())
  }
  return entries.slice(-count).reverse()
}
