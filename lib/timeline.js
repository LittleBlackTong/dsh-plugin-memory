/**
 * Memory timeline projection.
 *
 * The timeline is derived entirely from the files the memory library already
 * owns: `log.md` supplies the events (one `## [YYYY-MM-DD] kind | title`
 * heading each), and page frontmatter supplies the title/file names used to
 * attach an event to a page so the client can open it. Nothing is cached and
 * nothing is written: a missing or unreadable log yields an empty timeline,
 * never an error.
 *
 * @module timeline
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** Log kinds folded into the five timeline groups. */
export const GROUP_OF = {
  fix: 'fix',
  bugfix: 'fix',
  repair: 'fix',
  feat: 'feat',
  feature: 'feat',
  implement: 'feat',
  impl: 'feat',
  publish: 'publish',
  release: 'publish',
  deliverable: 'publish',
  decision: 'decision',
  design: 'decision',
}

/**
 * Process-noise kinds hidden by default on the timeline. Everything else is a
 * key memory event and is shown without opting in.
 */
export const NOISE_KINDS = new Set([
  'note',
  'digest',
  'install',
  'uninstall',
  'setup',
  'bootstrap',
  'task',
  'probe',
  'recall',
  'consolidate',
  'ops',
  'schedule',
  'export',
])

const LOG_LINE = /^## \[(\d{4}-\d{2}-\d{2})\] (\w+) \| (.+)$/
const PAGE_SKIP = new Set(['SOUL.md', 'MEMORY.md', 'index.md', 'log.md', 'BOOTSTRAP.md'])

/** @param {string} kind @returns {'fix'|'feat'|'publish'|'decision'|'other'} */
export function groupOf(kind) {
  return GROUP_OF[kind] ?? 'other'
}

/** @param {string} kind @returns {boolean} */
export function isNoiseKind(kind) {
  return NOISE_KINDS.has(kind)
}

/**
 * Index memory pages (outside `raw/`) with their frontmatter title, relative
 * path and file stem, so log events can be matched back to a file.
 *
 * @param {string} memoryDir
 * @returns {{ path: string, title: string | undefined, name: string }[]}
 */
function readPageIndex(memoryDir) {
  const pages = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const absolute = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'raw') walk(absolute)
        continue
      }
      if (!entry.name.endsWith('.md') || PAGE_SKIP.has(entry.name)) continue
      try {
        const text = readFileSync(absolute, 'utf8')
        const heading = /^title:\s*(.+)$/m.exec(text)
        const title = heading?.[1]?.trim().replace(/^["']|["']$/g, '')
        pages.push({
          path: relative(memoryDir, absolute).split(sep).join('/'),
          title,
          name: entry.name.replace(/\.md$/, ''),
        })
      } catch {
        // unreadable page: skip it, keep the rest of the timeline
      }
    }
  }
  walk(memoryDir)
  return pages
}

/**
 * The most specific page whose title or file stem appears in the event title.
 * Free-text headings cannot always be resolved; an undefined result is fine.
 *
 * @param {string} title
 * @param {{ path: string, title: string | undefined, name: string }[]} pages
 * @returns {string | undefined}
 */
function matchPath(title, pages) {
  let best
  for (const page of pages) {
    for (const needle of [page.title, page.name]) {
      if (typeof needle !== 'string' || needle.length === 0) continue
      if (!title.includes(needle)) continue
      if (best === undefined || needle.length > best.length) best = { path: page.path, length: needle.length }
    }
  }
  return best?.path
}

/**
 * Build the timeline payload served by `GET /api/memory/timeline`.
 *
 * @param {string} memoryDir
 * @returns {{ events: object[], stats: { events: number, first?: string, last?: string, pages: number } }}
 */
export function buildTimeline(memoryDir) {
  const pages = typeof memoryDir === 'string' && existsSync(memoryDir) ? readPageIndex(memoryDir) : []
  let text = ''
  try {
    const logPath = join(memoryDir, 'log.md')
    if (existsSync(logPath)) text = readFileSync(logPath, 'utf8')
  } catch {
    // unreadable log: empty timeline
  }

  const events = []
  for (const line of text.split(/\r?\n/)) {
    const match = LOG_LINE.exec(line)
    if (!match) continue
    const [, date, kind, rawTitle] = match
    const title = rawTitle.trim()
    /** @type {{ date: string, kind: string, group: string, title: string, path?: string }} */
    const event = { date, kind, group: groupOf(kind), title }
    const path = matchPath(title, pages)
    if (path !== undefined) event.path = path
    events.push(event)
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  /** @type {{ events: number, first?: string, last?: string, pages: number }} */
  const stats = { events: events.length, pages: pages.length }
  if (events.length > 0) {
    stats.first = events[0].date
    stats.last = events[events.length - 1].date
  }
  return { events, stats }
}
