/**
 * Index-page compiler: keep `index.md` a routing table instead of a summary dump.
 *
 * The index is injected into every session in full, so its size is a hard
 * context cost — yet the discipline ("one line per page, a short summary") lived
 * only in prose. Measured on a real store, 85% of its lines had drifted into
 * half-paragraph status reports. This module makes the discipline mechanical:
 *
 * - a summary is **declared** by the page (`summary:` in frontmatter): the
 *   compiler never invents prose, which is why a rewrite cannot lower quality;
 *   **declared** by the page (`summary:` in frontmatter) — the compiler never
 *   invents prose, so a rewrite can never lower the summary's quality;
 * - lines are *rewritten in place*: sections, ordering and the funnel list stay
 *   exactly as the agent left them, so an automated pass can never reorder the
 *   user's mental map of their own memory;
 * - pages the index has never mentioned are only **reported**, never inserted —
 *   which section and which order a new page belongs to is editorial judgement,
 *   and that stays with the agent and the user.
 *
 * Everything is derived and dry-run first: `planIndex` never writes, and the CLI
 * requires an explicit `--write`.
 *
 * Depends only on `node:*` builtins plus {@link ./insights.js}.
 *
 * @module dsh-plugin-memory/index-page
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { collectInsights, parseFrontmatter } from './insights.js'

/** Cap for the link label. A routing line is scanned, not read: a
 * page's full title (often a whole clause) belongs in the page, not here. */
export const INDEX_LABEL_MAX = 32

/** Hard cap for one routing line (link + label + summary + salience). */
export const INDEX_LINE_MAX = 132
/** Nominal cap for the summary text; long labels shrink it further. */
export const INDEX_SUMMARY_MAX = 48

const LINE_RE = /^(\s*-\s+)\[([^\]]*)\]\(([^)]+)\)\s*(.*)$/
const HEADING_RE = /^##\s+(.*)$/

/** Strip the markdown scaffolding that would only add noise to a one-liner. */
function stripMarkup(text) {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*>\s?/, '')
    .trim()
}

/**
 * The first real sentence of a page body (skips headings, quotes and blanks).
 * Exported for previews and tooling only — the index compiler does **not** use
 * it, because derived prose measured worse than a declared summary.
 */
export function firstSentence(text) {
  const body = String(text ?? '').replace(/^---[\s\S]*?\n---\n?/, '')
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#') || line.startsWith('>')) continue
    const clean = stripMarkup(line)
    if (clean.length === 0) continue
    const end = clean.search(/[。！？!?.](?:\s|$)/)
    return (end >= 0 ? clean.slice(0, end + 1) : clean).trim()
  }
  return ''
}

/** Clamp to `max` characters, appending an ellipsis when it had to cut. */
export function clampSummary(text, max = INDEX_SUMMARY_MAX) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const head = flat.slice(0, Math.max(1, max - 1))
  // Prefer a natural break (sentence end, then clause) over a hard cut.
  const boundary = Math.max(head.lastIndexOf('。'), head.lastIndexOf('；'), head.lastIndexOf('，'))
  if (boundary >= Math.floor(head.length / 2)) return head.slice(0, boundary + 1)
  return `${head.trimEnd()}…`
}

/**
 * Clamp a link label. Labels come from the page title, which is often a full
 * clause ("macOS 下 dsh web 开机自启（LaunchAgent）+ 本机网络/安装坑"); the index
 * needs the gist, the page keeps the full wording.
 * @param {string} title
 * @param {number} [max]
 * @returns {string}
 */
export function clampLabel(title, max = INDEX_LABEL_MAX) {
  const flat = String(title ?? '').replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}

/**
 * How much room a summary has on one line, given its label. A long label must
 * not push the line past {@link INDEX_LINE_MAX}, so the summary yields first.
 * @param {string} target store-relative page path
 * @param {string} title link label (clamped internally)
 * @param {number} [lineMax]
 * @returns {number} character budget for the summary
 */
export function summaryBudget(target, title, lineMax = INDEX_LINE_MAX) {
  // Rendered markup around the words: "- [" + "](" + ") — " + " `salience:N`".
  const MARKUP_CHARS = 24
  const overhead = MARKUP_CHARS + clampLabel(title).length + String(target ?? '').length
  return Math.max(16, Math.min(INDEX_SUMMARY_MAX, lineMax - overhead))
}

/**
 * The summary a page declares about itself. **Declaration only** — the first
 * sentence of the body is deliberately not used as a fallback: measured against
 * a real store, derived prose summarised "the setup" instead of the point
 * (a preferences page became "confirm the time first", not "code changes are
 * not committed"), which is worse than no summary at all. An undeclared page
 * contributes its title and nothing else.
 * @param {Record<string, string>} frontmatter parsed frontmatter
 * @returns {string} clamped summary, or '' when the page declares none
 */
export function declaredSummary(frontmatter = {}, max = INDEX_SUMMARY_MAX) {
  const value = frontmatter.summary
  if (typeof value !== 'string' || value.trim().length === 0) return ''
  return clampSummary(value, max)
}

/** Render one routing line exactly the way the compiler would. */
export function renderIndexLine({ target, title, salience, summary }) {
  const label = clampLabel(title) || String(target ?? '')
  const badge = salience === undefined ? '' : ` \`salience:${salience}\``
  const text = summary && summary.length > 0 ? ` — ${summary}` : ''
  return `- [${label}](${target})${text}${badge}`
}

/** Parse an index file into its funnel (title + intro) and its sections. */
export function parseIndexPage(text) {
  const lines = String(text ?? '').split('\n')
  let title = ''
  const intro = []
  const sections = []
  let current

  // Flat indexes exist: entries before the first `##` still have to parse, so
  // they land in an implicit section instead of being mistaken for funnel prose.
  const ensureSection = () => {
    if (current === undefined) current = { heading: '', name: '', intro: [], items: [] }
    if (sections.length === 0) sections.push(current)
    else if (sections[sections.length - 1] !== current) sections.push(current)
    return current
  }

  for (const line of lines) {
    const heading = HEADING_RE.exec(line)
    if (heading !== null) {
      current = { heading: line, name: heading[1].trim(), intro: [], items: [] }
      sections.push(current)
      continue
    }
    const item = LINE_RE.exec(line)
    if (item !== null) {
      ensureSection().items.push({ label: item[2], target: item[3], rest: item[4].trim(), raw: line })
      continue
    }
    if (current === undefined) {
      if (title === '' && line.startsWith('# ')) {
        title = line
        continue
      }
      // Once the title is known, everything up to the first section is funnel
      // prose and is preserved verbatim (blank lines included).
      if (title !== '') intro.push(line)
      continue
    }
    if (line.trim().length > 0 || current.items.length === 0) current.intro.push(line)
  }
  return { title, intro, sections }
}

/** Every page the index currently mentions, in file order. */
export function indexTargets(parsed) {
  const targets = new Set()
  for (const section of parsed.sections) {
    for (const item of section.items) targets.add(item.target)
  }
  return targets
}

/** Compare content, not spacing: a whitespace-only re-render is not a change. */
const normalise = (value) => value.replace(/\s+/g, ' ').trim()

/**
 * Compare the index against the store without touching anything.
 *
 * @param {string} memoryDir absolute path of the memory store
 * @returns {{
 *   parsed: object,
 *   lines: Array<{ target: string, section: string, current: string, next: string,
 *                  summary: string, title: string, salience?: number,
 *                  source: 'declared'|'derived', changed: boolean }>,
 *   stale: number,
 *   missing: string[],
 *   removed: string[],
 * }}
 */
export function planIndex(memoryDir) {
  const indexPath = join(memoryDir, 'index.md')
  const text = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : ''
  const parsed = parseIndexPage(text)
  const insights = collectInsights(memoryDir)
  const pageByPath = new Map((insights.pages ?? []).map((page) => [page.path, page]))
  const targets = indexTargets(parsed)

  const lines = []
  let stale = 0
  for (const section of parsed.sections) {
    for (const item of section.items) {
      const page = pageByPath.get(item.target)
      // Root meta files (SOUL.md / MEMORY.md / log.md …) are not "pages": they
      // have no frontmatter and are not derived, so they are never rewritten.
      if (page === undefined) continue
      let pageText = ''
      try {
        pageText = readFileSync(join(memoryDir, item.target), 'utf8')
      } catch {
        continue
      }
      const fm = parseFrontmatter(pageText)
      const summary = declaredSummary(fm, summaryBudget(item.target, page.title))
      const declared = summary.length > 0
      const declaredChars = typeof fm.summary === 'string' ? fm.summary.trim().length : 0
      const next = renderIndexLine({
        target: item.target,
        title: page.title,
        salience: page.salience,
        summary,
      })
      const changed = normalise(next) !== normalise(item.raw)
      if (changed) stale += 1
      lines.push({
        target: item.target,
        section: section.name,
        current: item.raw,
        next,
        summary,
        declaredChars,
        title: page.title,
        salience: page.salience,
        source: declared ? 'declared' : 'derived',
        changed,
      })
    }
  }

  // Only *derived pages* are candidates for the missing/removed reports: a root
  // meta file listed in the index (SOUL.md …) is neither an orphan nor a page.
  const listed = new Set(lines.map((line) => line.target))
  const missing = [...pageByPath.keys()].filter((path) => !listed.has(path)).sort()
  const removed = [...targets]
    .filter((path) => !existsSync(join(memoryDir, path)))
    .sort()
  return { parsed, lines, stale, missing, removed }
}

/**
 * Rewrite the lines the plan marked stale. Sections, ordering and any content
 * the plan did not touch are preserved byte-for-byte; nothing is added or
 * deleted, so the blast radius is exactly the lines reported by `--check`.
 *
 * @param {string} memoryDir absolute path of the memory store
 * @param {{ parsed: object, lines: Array<object> }} plan from {@link planIndex}
 * @returns {{ written: number, bytesBefore: number, bytesAfter: number }}
 */
export function applyIndex(memoryDir, plan) {
  const indexPath = join(memoryDir, 'index.md')
  const before = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : ''
  const replacement = new Map()
  for (const line of plan.lines) {
    if (line.changed) replacement.set(normalise(line.current), line.next)
  }
  let written = 0
  const out = before.split('\n').map((raw) => {
    const next = replacement.get(normalise(raw))
    if (next === undefined) return raw
    written += 1
    return next
  }).join('\n')
  if (written > 0) writeFileSync(indexPath, out, 'utf8')
  return { written, bytesBefore: before.length, bytesAfter: out.length }
}

/**
 * One-shot migration: copy a summary that already lives in an index line back
 * into the page's frontmatter, so the index and the declaration can never drift
 * again. Pages that already declare `summary:` are left alone.
 *
 * @param {string} memoryDir absolute path of the memory store
 * @param {{ lines: Array<{ target: string, summary: string, current: string }> }} plan
 * @returns {{ synced: string[], skipped: string[] }}
 */
export function syncDeclaredSummaries(memoryDir, plan) {
  const synced = []
  const skipped = []
  for (const line of plan.lines) {
    // Prefer an explicit "— summary" tail; fall back to nothing (never invent).
    const tail = /\s+[—–-]\s+(.+?)(?:\s+`salience:[^`]*`)?\s*$/.exec(line.current)
    const summary = (tail ? tail[1] : '').trim()
    if (summary.length === 0) {
      skipped.push(line.target)
      continue
    }
    const abs = join(memoryDir, line.target)
    let text = ''
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      skipped.push(line.target)
      continue
    }
    if (/^summary:/m.test(text)) {
      skipped.push(line.target)
      continue
    }
    const end = text.indexOf('\n---', 3)
    if (!text.startsWith('---') || end < 0) {
      skipped.push(line.target)
      continue
    }
    const next = `${text.slice(0, end)}\nsummary: ${clampSummary(summary)}${text.slice(end)}`
    try {
      writeFileSync(abs, next, 'utf8')
      synced.push(line.target)
    } catch {
      skipped.push(line.target)
    }
  }
  return { synced, skipped }
}

/**
 * Issues the index has, for `lint` and `index --check`. Kept in one place so
 * the CLI, the lint command and the dashboard cannot disagree.
 *
 * @param {string} memoryDir absolute path of the memory store
 * @param {{ includeNoSummary?: boolean }} [options] `no-summary` is advisory, so
 *   `lint` opts out (it stays a quality nudge, not a failure)
 * @returns {Array<{ kind: string, target?: string, detail: string }>}
 */
export function indexIssues(memoryDir, options = {}) {
  const plan = planIndex(memoryDir)
  const issues = []
  for (const line of plan.lines) {
    // Scope: what is wrong with the *index*. "This line no longer matches its
    // page" is `index --check`'s job (a rewrite fixes it), so lint stays free of
    // duplicate reporting.
    if (line.current.length > INDEX_LINE_MAX) {
      issues.push({
        kind: 'line-too-long',
        target: line.target,
        detail: `index 行 ${line.current.length} 字符（上限 ${INDEX_LINE_MAX}）：${line.target}`,
      })
    } else if (line.declaredChars > INDEX_SUMMARY_MAX) {
      // The header cap: rewrite will clamp it, so say so instead of silently
      // trimming the author's words on the next `--write`.
      issues.push({
        kind: 'summary-too-long',
        target: line.target,
        detail: `summary 声明 ${line.declaredChars} 字（上限 ${INDEX_SUMMARY_MAX}）：${line.target}`,
      })
    }
  }
  for (const path of plan.missing) {
    issues.push({
      kind: 'missing',
      target: path,
      detail: `页面未收录进 index（分节与顺序需人工决定）：${path}`,
    })
  }
  for (const path of plan.removed) {
    issues.push({
      kind: 'removed',
      target: path,
      detail: `index 指向已不存在的页（是否删行需人工确认）：${path}`,
    })
  }
  if (options.includeNoSummary === false) return issues
  for (const line of plan.lines) {
    if (line.summary.length === 0) {
      issues.push({
        kind: 'no-summary',
        target: line.target,
        detail: `页面未声明 summary（index 只有标题；补 frontmatter \`summary:\` 后会自动同步）：${line.target}`,
      })
    }
  }
  return issues
}
