/**
 * `dsh-memory checkup`: one report that says what to do next.
 *
 * The plugin grew four readers over time — `lint` (integrity), `status`
 * (counts), the dashboard payload (freshness, connections) and `graph`
 * (relationships) — and a user staring at all four still has to work out which
 * problem matters. This module assembles them into one graded report with a
 * short, ordered action list, because "here are four numbers" is a diagnostic
 * and "do these three things" is a product.
 *
 * Read-only: every value is derived from the store on disk, nothing is written
 * and nothing is inferred that the other readers would disagree with.
 *
 * @module dsh-plugin-memory/checkup
 */

import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { accessSummary, listPagesWithMeta, today } from './pages.js'
import { collectInsights } from './insights.js'
import { planIndex, INDEX_LINE_MAX, INDEX_SUMMARY_MAX } from './index-page.js'
import { buildMemoryGraph, suggestLinks } from './graph.js'

/** Days without access before a page counts as stale. */
export const STALE_DAYS = 90
/** Share of the boot budget the index may take before it is called out. */
export const INDEX_SHARE_WARN = 0.4

const daysBetween = (from, to) => {
  const a = Date.parse(`${from}T00:00:00`)
  const b = Date.parse(`${to}T00:00:00`)
  if (Number.isNaN(a) || Number.isNaN(b)) return undefined
  return Math.floor((b - a) / 86400000)
}

const bar = (count, total, width = 20) => {
  if (total <= 0) return ''
  const filled = Math.max(0, Math.min(width, Math.round((count / total) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/**
 * Build the checkup report.
 *
 * @param {string} memoryDir absolute path of the memory store
 * @param {{ bootMaxChars?: number, staleDays?: number, indexShareWarn?: number, today?: string }} [options]
 * @returns {{
 *   store: string, generatedAt: string,
 *   size: { pages: number, chars: number, indexChars: number, indexShare: number, bootMaxChars: number },
 *   freshness: { buckets: Array<{ label: string, count: number, bar: string }>, never: number, stale: number },
 *   links: { pageLinks: number, tagEdges: number, indexLinks: number, isolated: string[], lonely: number, suggestions: number },
 *   integrity: { checks: Array<{ label: string, ok: boolean, detail: string }> },
 *   actions: string[],
 * }}
 */
export function runCheckup(memoryDir, options = {}) {
  const bootMaxChars = options.bootMaxChars ?? 12000
  const staleDays = options.staleDays ?? STALE_DAYS
  const indexShareWarn = options.indexShareWarn ?? INDEX_SHARE_WARN
  const now = options.today ?? today()

  const pages = listPagesWithMeta(memoryDir)
  const insights = collectInsights(memoryDir)
  const graph = buildMemoryGraph(memoryDir)
  // Findings first (shared topic), then everything else as a fallback: a page
  // with no real relationship must be *counted* as lonely whether or not the
  // heuristic can suggest anyone for it. The previous version derived the count
  // from the suggestion list, so the loneliest pages — the ones with nothing to
  // match on — silently disappeared from the report.
  const findings = suggestLinks(graph)
  const suggestions = suggestLinks(graph, { strengths: ['strong', 'weak'] })
  const access = accessSummary(memoryDir, { staleDays })

  // ---- 体量 ----
  const indexChars = insights.overview.indexChars ?? insights.overview.indexBytes
  const indexShare = bootMaxChars > 0 ? indexChars / bootMaxChars : 0

  // ---- 新鲜度 ----
  const buckets = [
    { label: '≤7 天', count: 0 },
    { label: '≤30 天', count: 0 },
    { label: '≤90 天', count: 0 },
    { label: '>90 天', count: 0 },
  ]
  let never = 0
  for (const page of pages) {
    if (page.lastAccess === undefined) {
      never += 1
      continue
    }
    const days = daysBetween(page.lastAccess, now)
    if (days === undefined) { never += 1; continue }
    if (days <= 7) buckets[0].count += 1
    else if (days <= 30) buckets[1].count += 1
    else if (days <= 90) buckets[2].count += 1
    else buckets[3].count += 1
  }
  for (const bucket of buckets) bucket.bar = bar(bucket.count, pages.length)

  // ---- 连接度 ----
  // An index row is not a relationship: `index.md` links every page by design,
  // so counting it as "connected" would report that nothing needs linking.
  // `lonely` therefore means "connected to nothing except its index row" —
  // which is exactly the set `graph --suggest` can help with.
  const linked = new Set()
  for (const edge of graph.edges) {
    if (edge.kind === 'index') continue
    linked.add(edge.source)
    linked.add(edge.target)
  }
  const lonely = graph.nodes
    .filter((node) => node.kind === 'page' && !linked.has(node.id))
    .map((node) => node.id)

  // ---- 一致性 ----
  const plan = planIndex(memoryDir)
  const staleLines = plan.lines.filter((line) => line.changed)
  const overCap = plan.lines.filter((line) => line.current.length > INDEX_LINE_MAX)
  const overSummary = plan.lines.filter((line) => line.declaredChars > INDEX_SUMMARY_MAX)
  const missingFrontmatter = pages.filter((page) => page.salience === undefined || page.type === 'unknown')
  const missingSummaryPages = pages.filter((page) => {
    const line = plan.lines.find((entry) => entry.target === page.path)
    return line !== undefined && line.summary.length === 0
  })
  const checks = [
    { label: 'index 链接完整', ok: insights.health.checks.find((c) => c.id === 'index')?.ok ?? true, detail: insights.health.checks.find((c) => c.id === 'index')?.detail ?? '' },
    { label: '无孤儿页', ok: insights.health.checks.find((c) => c.id === 'orphans')?.ok ?? true, detail: insights.health.checks.find((c) => c.id === 'orphans')?.detail ?? '' },
    { label: 'frontmatter 完整', ok: missingFrontmatter.length === 0, detail: missingFrontmatter.length === 0 ? 'title/type/salience 齐全' : `${missingFrontmatter.length} 页缺 type 或 salience` },
    {
      label: 'index 与页面同步',
      ok: staleLines.length === 0,
      detail: staleLines.length === 0 ? '每行都与页面一致' : `${staleLines.length} 行漂移（index --write 可修）`,
    },
  ]

  // ---- 下一步建议（按"修了最有感"排序）----
  const actions = []
  if (staleLines.length > 0) {
    actions.push(`index 有 ${staleLines.length} 行与页面不一致 → \`dsh-memory index --write\``)
  }
  if (overSummary.length > 0 || overCap.length > 0) {
    actions.push(`${overSummary.length} 个 summary 声明超 ${INDEX_SUMMARY_MAX} 字、${overCap.length} 行超 ${INDEX_LINE_MAX} 字符 → 精简声明或缩短标题`)
  }
  if (lonely.length > 0) {
    actions.push(`${lonely.length} 页只有索引入口、没有内容关系 → \`dsh-memory graph --suggest\``)
  }
  if (missingFrontmatter.length > 0) {
    actions.push(`${missingFrontmatter.length} 页缺 type/salience → 补 frontmatter（lint 会报）`)
  }
  if (missingSummaryPages.length > 0) {
    actions.push(`${missingSummaryPages.length} 页只显示标题（未声明 summary）→ 给页面加 \`summary:\``)
  }
  if (access.stale.length > 0) {
    actions.push(`${access.stale.length} 页超过 ${staleDays} 天未访问 → 整理或归档（优先归档）`)
  }
  if (indexShare > indexShareWarn) {
    actions.push(`index 已占 boot 预算 ${Math.round(indexShare * 100)}% → 精简摘要或拆页，否则会挤掉人格记忆`)
  }

  return {
    store: memoryDir,
    generatedAt: new Date().toISOString(),
    size: {
      pages: pages.length,
      chars: insights.overview.chars,
      indexChars,
      indexShare,
      bootMaxChars,
    },
    freshness: { buckets, never, stale: access.stale.length },
    links: {
      pageLinks: graph.stats.links,
      tagEdges: graph.stats.tagEdges,
      indexLinks: graph.stats.indexLinks,
      isolated: graph.stats.isolated,
      lonely: lonely.length,
      suggestions: findings.reduce((sum, entry) => sum + entry.candidates.length, 0),
    },
    integrity: { checks },
    actions,
  }
}

/**
 * Render the report for a terminal.
 *
 * @param {ReturnType<typeof runCheckup>} report
 * @param {{ color?: boolean }} [options]
 * @returns {string}
 */
export function formatCheckup(report, options = {}) {
  const color = options.color === true
  const pct = Math.round(report.size.indexShare * 100)
  const lines = []
  lines.push(`记忆库体检 · ${report.generatedAt.slice(0, 10)}`)
  lines.push('')
  lines.push(`体量   ${report.size.pages} 页 · ${report.size.chars.toLocaleString()} 字符 · `
    + `索引 ${report.size.indexChars.toLocaleString()} 字符（占 boot 预算 ${pct}%）`)
  lines.push('新鲜度')
  for (const bucket of report.freshness.buckets) {
    lines.push(`  ${bucket.label.padEnd(7)} ${bucket.bar} ${bucket.count}`)
  }
  if (report.freshness.never > 0) lines.push(`  ${'从未戳记'.padEnd(6)} ${report.freshness.never}`)
  lines.push(`连接度   ${report.links.pageLinks} 条页间互链 · ${report.links.tagEdges} 条共享 tag · `
    + `${report.links.indexLinks} 条索引路由`)
  if (report.links.lonely > 0) {
    lines.push(`         ${report.links.lonely} 页只有索引入口（${report.links.suggestions} 条候选可参考）`)
  }
  lines.push('一致性')
  for (const check of report.integrity.checks) {
    const mark = check.ok ? '✓' : '!'
    const tint = color && !check.ok ? '\u001b[33m' : ''
    const reset = color && !check.ok ? '\u001b[0m' : ''
    lines.push(`  ${tint}${mark} ${check.label} · ${check.detail}${reset}`)
  }
  lines.push('')
  if (report.actions.length === 0) {
    lines.push('没有需要处理的问题 —— 记忆库是健康的。')
  } else {
    lines.push(`最该做的 ${report.actions.length} 件事：`)
    report.actions.forEach((action, index) => lines.push(`  ${index + 1}. ${action}`))
  }
  return lines.join('\n')
}

/** `true` when the report contains something worth acting on. */
export function hasWork(report) {
  return report.actions.length > 0
}

/** Kept for callers that want the raw file size without the full report. */
export function indexBytes(memoryDir) {
  const path = join(memoryDir, 'index.md')
  return existsSync(path) ? statSync(path).size : 0
}
