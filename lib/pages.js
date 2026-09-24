/**
 * Page-reference bookkeeping: which memory pages a session actually loaded,
 * and how to mark them as accessed.
 *
 * The salience/decay rules in `MEMORY.md` only work if `last_access` moves.
 * Historically that field was honor-system: the template shipped it, the rules
 * referenced it, and nothing ever wrote it — so every page aged in place and
 * the decay table stayed fiction. This module closes that loop mechanically:
 * whatever the boot block actually hands the model counts as an access, and
 * its `last_access` is stamped once per session.
 *
 * Everything here is date-granular (a page is touched at most once per day)
 * and conservative: pages without frontmatter are left alone rather than
 * rewritten, and a missing store is simply a no-op.
 *
 * Depends only on `node:*` builtins so the standalone CLI can reuse it.
 *
 * @module dsh-plugin-memory/pages
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** Category directories a memory page may live under. */
export const PAGE_DIRS = [
  'identity',
  'user',
  'skills',
  'decisions',
  'projects',
  'concepts',
]

/** Today's date as `YYYY-MM-DD` (local time, matching the frontmatter convention). */
export function today() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Walk a store and return every markdown page path relative to the store root
 * (meta files at the root are excluded — they are not "pages").
 *
 * @param {string} memoryDir absolute path of the memory store
 * @param {string[]} [dirs] directories to walk (defaults to {@link PAGE_DIRS})
 * @returns {string[]} store-relative paths using `/` separators
 */
export function listPagePaths(memoryDir, dirs = PAGE_DIRS) {
  const out = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name.startsWith('.')) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.md')) out.push(relative(memoryDir, path).split(sep).join('/'))
    }
  }
  for (const dir of dirs) walk(join(memoryDir, dir))
  return out
}

/**
 * Extract the memory pages a rendered boot block refers to.
 *
 * Only references that (a) look like a store-relative markdown path and
 * (b) resolve to a real file are returned, so prose like `SOUL.md` or a
 * placeholder `xxx.md` never becomes a phantom access. Paths are matched in
 * the three forms the boot block actually produces: bare
 * (`user/profile.md`), backticked (`` `decisions/foo.md` ``) and linked
 * (`[x](user/profile.md)`).
 *
 * @param {string} text the rendered boot block
 * @param {string} memoryDir absolute path of the memory store
 * @param {string[]} [dirs] directories a page may live under
 * @returns {string[]} de-duplicated store-relative page paths, in first-seen order
 */
export function extractReferencedPages(text, memoryDir, dirs = PAGE_DIRS) {
  if (typeof text !== 'string' || text.length === 0) return []
  const known = new Set(listPagePaths(memoryDir, dirs))
  if (known.size === 0) return []
  const pattern = /([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*\.md)\b/g
  const seen = new Set()
  const found = []
  for (const match of text.matchAll(pattern)) {
    const candidate = match[1]
    if (!known.has(candidate) || seen.has(candidate)) continue
    seen.add(candidate)
    found.push(candidate)
  }
  return found
}

/**
 * Rewrite one page's `last_access` to `date` when it actually differs.
 * Keeps every other byte of the file intact.
 *
 * @param {string} filePath absolute path of the page
 * @param {string} [date] `YYYY-MM-DD` (defaults to today)
 * @returns {boolean} true when the file was rewritten
 */
export function touchPageFile(filePath, date = today()) {
  if (!existsSync(filePath)) return false
  let text
  try {
    text = readFileSync(filePath, 'utf8')
  } catch {
    return false
  }
  const match = /^last_access:.*$/m.exec(text)
  // No `last_access` line: leave the page alone rather than inventing
  // frontmatter the author did not write.
  if (match === null) return false
  if (match[0] === `last_access: ${date}`) return false
  const next = text.slice(0, match.index) + `last_access: ${date}` + text.slice(match.index + match[0].length)
  try {
    writeFileSync(filePath, next, 'utf8')
  } catch {
    return false
  }
  return true
}

/**
 * Stamp `last_access` on the given store-relative pages.
 *
 * @param {string} memoryDir absolute path of the memory store
 * @param {string[]} paths store-relative page paths
 * @param {{ date?: string, dirs?: string[] }} [options]
 * @returns {string[]} the relative paths that were actually rewritten
 */
export function touchPages(memoryDir, paths, options = {}) {
  const date = options.date ?? today()
  const allowed = new Set(listPagePaths(memoryDir, options.dirs ?? PAGE_DIRS))
  const touched = []
  for (const path of Array.isArray(paths) ? paths : []) {
    if (typeof path !== 'string' || !allowed.has(path)) continue
    if (touchPageFile(join(memoryDir, path), date)) touched.push(path)
  }
  return touched
}

/**
 * Parse `last_access` out of page text (frontmatter only, by convention the
 * first such line). Returns `undefined` when absent.
 * @param {string} text page content
 * @returns {string | undefined}
 */
export function readLastAccess(text) {
  const match = /^last_access:\s*(\S+)/m.exec(text ?? '')
  return match ? match[1] : undefined
}

/**
 * Store-wide access summary, used by the CLI `status` command: how many pages
 * are stale (older than `staleDays`, or never stamped), and the oldest stamp.
 *
 * @param {string} memoryDir absolute path of the memory store
 * @param {{ staleDays?: number, now?: Date }} [options]
 * @returns {{ total: number, missing: number, stale: string[], oldest?: { path: string, lastAccess: string } }}
 */
export function accessSummary(memoryDir, options = {}) {
  const staleDays = Math.max(1, Number(options.staleDays ?? 90))
  const now = options.now ?? new Date()
  const cutoff = now.getTime() - staleDays * 86400000
  const paths = listPagePaths(memoryDir)
  let missing = 0
  let oldest
  const stale = []
  for (const path of paths) {
    const abs = join(memoryDir, path)
    const lastAccess = readLastAccess(readFileSync(abs, 'utf8'))
    if (!lastAccess) {
      missing += 1
      stale.push(path)
      continue
    }
    const at = Date.parse(`${lastAccess}T00:00:00`)
    if (Number.isNaN(at)) {
      stale.push(path)
      continue
    }
    if (at < cutoff) stale.push(path)
    if (oldest === undefined || at < Date.parse(`${oldest.lastAccess}T00:00:00`)) oldest = { path, lastAccess }
  }
  return { total: paths.length, missing, stale, oldest }
}

/** @returns {number} mtime (ms) of a path, 0 when it does not exist */
export function mtimeOf(path) {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Every page with the metadata the query command filters on.
 *
 * A thin wrapper over {@link listPagePaths}: callers that only need metadata
 * should not re-implement the frontmatter walk, and this keeps the CLI and the
 * dashboard agreeing on what counts as a page.
 *
 * @param {string} memoryDir absolute path of the memory store
 * @returns {Array<{ path: string, title: string, type: string, salience?: number, tags: string[], lastAccess?: string }>}
 */
export function listPagesWithMeta(memoryDir) {
  const out = []
  for (const rel of listPagePaths(memoryDir)) {
    let text = ''
    try {
      text = readFileSync(join(memoryDir, rel), 'utf8')
    } catch {
      continue
    }
    const end = text.startsWith('---') ? text.indexOf('\n---', 3) : -1
    const fm = {}
    if (end > 0) {
      for (const line of text.slice(3, end).split('\n')) {
        const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
        if (m) fm[m[1]] = m[2].trim()
      }
    }
    const salience = Number(fm.salience)
    const tagMatch = /^\[(.*)\]$/.exec(fm.tags ?? '')
    out.push({
      path: rel,
      title: fm.title || rel.split('/').pop().replace(/\.md$/, ''),
      type: fm.type || 'unknown',
      salience: [1, 2, 3].includes(salience) ? salience : undefined,
      tags: tagMatch ? tagMatch[1].split(',').map((t) => t.trim()).filter(Boolean) : [],
      lastAccess: fm.last_access,
    })
  }
  return out
}
