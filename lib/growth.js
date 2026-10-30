/**
 * Growth recap: the "look how far we've come" half of the persona.
 *
 * A long-term companion should occasionally *notice* its own growth instead of
 * only reacting — "this week I kept these things, and touched those pages".
 * Everything here is derived from what the memory store already proves: the
 * recent `log.md` headlines and page mtimes. No new bookkeeping, no invented
 * progress.
 *
 * The recap is delivered on the recall-nudge channel at most once every
 * `growthRecapIntervalDays`; `<store>/.growth-recap.json` records the last
 * delivery so a restart does not repeat the same week.
 *
 * This module depends only on `node:*` builtins plus {@link ./pages.js}.
 *
 * @module dsh-plugin-memory/growth
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { listPagePaths } from './pages.js'

/** State file recording the last delivered recap (store-relative). */
export const GROWTH_STATE_FILENAME = '.growth-recap.json'

const DAY_MS = 24 * 60 * 60 * 1000

/** Start of the local day containing `epochMs`. */
function dayStart(epochMs) {
  const date = new Date(epochMs)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Parse one `log.md` headline: `## [2026-10-30] release | 标题`.
 * @param {string} line
 * @returns {{title: string, date: string, kind: string} | undefined}
 */
export function parseGrowthLogEntry(line) {
  const match = /^##\s+\[(\d{4}-\d{2}-\d{2})\]\s*(.*)$/.exec(line)
  if (match === null) return undefined
  const rest = match[2].trim()
  if (rest.length === 0) return undefined
  const pipe = rest.indexOf('|')
  const kind = pipe >= 0 ? (rest.slice(0, pipe).trim() || 'note') : 'note'
  const title = pipe >= 0 ? rest.slice(pipe + 1).trim() : rest
  if (title.length === 0) return undefined
  return { title, date: match[1], kind }
}

/**
 * Collect this week's growth from the store.
 *
 * - `entries`: `log.md` headlines dated inside the window, newest first, at
 *   most `max`.
 * - `pagesChanged`: memory pages whose mtime falls inside the window.
 * - `newPages`: pages that were also *created* inside the window (birthtime),
 *   i.e. genuinely new memories rather than edits to old ones.
 *
 * Never throws: a missing/corrupt store yields an empty recap.
 *
 * @param {object} options
 * @param {string} options.storeDir absolute memory-store path
 * @param {number} [options.sinceDays] window size in days (default 7)
 * @param {number} [options.max] headline cap (default 5)
 * @param {number} [options.now] epoch ms (injectable for tests)
 * @returns {{ entries: Array<{title: string, date: string, kind: string}>, pagesChanged: number, newPages: number }}
 */
export function collectGrowth({ storeDir, sinceDays = 7, max = 5, now = Date.now() } = {}) {
  const days = Number.isFinite(Number(sinceDays)) ? Math.max(0, Number(sinceDays)) : 7
  const limit = Number.isFinite(Number(max)) ? Math.max(0, Number(max)) : 5
  const windowStartMs = dayStart(now) - days * DAY_MS

  // 1. Recent log headlines (the durable proof of what happened).
  const entries = []
  const logPath = join(storeDir, 'log.md')
  if (existsSync(logPath)) {
    try {
      for (const line of readFileSync(logPath, 'utf8').split('\n')) {
        const entry = parseGrowthLogEntry(line)
        if (entry === undefined) continue
        const entryMs = Date.parse(`${entry.date}T00:00:00`)
        if (!Number.isFinite(entryMs) || entryMs < windowStartMs) continue
        entries.push(entry)
      }
    } catch {
      // unreadable log: still report page activity
    }
  }
  entries.reverse()
  entries.splice(limit)

  // 2. Page activity from mtimes (birthtime separates new pages from edits).
  let pagesChanged = 0
  let newPages = 0
  try {
    for (const rel of listPagePaths(storeDir)) {
      let stat
      try {
        stat = statSync(join(storeDir, rel))
      } catch {
        continue
      }
      if (stat.mtimeMs < windowStartMs) continue
      pagesChanged += 1
      if (stat.birthtimeMs > 0 && stat.birthtimeMs >= windowStartMs) newPages += 1
    }
  } catch {
    // store vanished mid-scan: keep the log half
  }

  return { entries, pagesChanged, newPages }
}

/**
 * Render the first-person recap. At most two sentences (well under the
 * "≤5 sentences" contract), each half omitted when there is nothing to say.
 *
 * @param {object} options
 * @param {Array<{title: string}>} [options.entries]
 * @param {number} [options.pagesChanged]
 * @param {number} [options.newPages]
 * @param {'zh'|'en'} [options.language]
 * @returns {string} recap text, '' when there is no growth to report
 */
export function renderGrowthRecap({ entries, pagesChanged = 0, newPages = 0, language = 'zh' } = {}) {
  const titles = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry.title === 'string' && entry.title.trim().length > 0)
    .slice(0, 5)
    .map((entry) => entry.title.trim())
  const changed = Math.max(0, Number(pagesChanged) || 0)
  const fresh = Math.max(0, Math.min(changed, Number(newPages) || 0))
  const sentences = []

  if (language === 'en') {
    if (titles.length > 0) {
      sentences.push(`This week I remembered ${titles.length} thing${titles.length === 1 ? '' : 's'}: ${titles.join('; ')}.`)
    }
    if (changed > 0) {
      sentences.push(`I also touched ${changed} memory page${changed === 1 ? '' : 's'}${fresh > 0 ? ` (${fresh} new)` : ''}.`)
    }
  } else {
    if (titles.length > 0) {
      sentences.push(`这周我记住了 ${titles.length} 件：${titles.join('；')}。`)
    }
    if (changed > 0) {
      sentences.push(`另外改了 ${changed} 页记忆${fresh > 0 ? `（其中 ${fresh} 页是新写的）` : ''}。`)
    }
  }
  return sentences.join('')
}

/**
 * Read the last-delivered state; anything unreadable means "never recapped".
 * @param {string} statePath absolute `.growth-recap.json` path
 * @returns {{ version: number, lastAt: number } | undefined}
 */
export function readGrowthState(statePath) {
  if (typeof statePath !== 'string' || statePath.length === 0 || !existsSync(statePath)) return undefined
  let raw
  try {
    raw = JSON.parse(readFileSync(statePath, 'utf8'))
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const lastAt = Number(raw.lastAt)
  if (!Number.isFinite(lastAt) || lastAt <= 0) return undefined
  return { version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : 1, lastAt }
}

/**
 * Whether a recap is due now.
 * @param {object} options
 * @param {string} options.statePath absolute state-file path
 * @param {number} [options.intervalDays] default 7
 * @param {number} [options.now]
 * @returns {boolean}
 */
export function growthRecapDue({ statePath, intervalDays = 7, now = Date.now() } = {}) {
  const state = readGrowthState(statePath)
  if (state === undefined) return true
  const days = Number.isFinite(Number(intervalDays)) ? Math.max(0, Number(intervalDays)) : 7
  return now - state.lastAt >= days * DAY_MS
}

/**
 * Persist the delivery time atomically.
 * @param {string} statePath absolute state-file path
 * @param {number} [lastAt] epoch ms (default now)
 * @returns {{ version: number, lastAt: number }}
 */
export function writeGrowthState(statePath, lastAt = Date.now()) {
  const state = { version: 1, lastAt }
  mkdirSync(dirname(statePath), { recursive: true })
  const tmp = `${statePath}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state)}\n`, 'utf8')
  renameSync(tmp, statePath)
  return state
}
