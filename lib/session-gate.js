/**
 * Per-session memory gate: "remember this conversation, or leave it alone?"
 *
 * The plugin has always had a global switch (`enabled`). This module adds the
 * finer layer the user actually needs: a session can opt out of memory even
 * while the plugin is on, and a whole workspace can default to "off" for the
 * projects that should never be remembered.
 *
 * Precedence (highest first):
 *
 * 1. `globalEnabled === false` — the plugin master switch wins over everything;
 * 2. a per-session override (`/memory off`, the composer chip, the panel);
 * 3. `disabledWorkspaces` matching the session cwd (path-boundary match);
 * 4. otherwise enabled.
 *
 * Overrides are keyed by session id and persisted to a small JSON file
 * (`<dshHome>/memory-sessions.json`) so a resumed session keeps its choice.
 * Entries older than `ttlDays` are pruned on read: session ids are never
 * reused, so stale entries would otherwise accumulate forever.
 *
 * This module is pure Node builtins — no host packages, so the gate logic is
 * unit-testable inside a bare checkout (same rule as `boot.js`).
 *
 * @module dsh-plugin-memory/session-gate
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { expandPath } from './paths.js'
import { dirname, join, resolve, sep } from 'node:path'

/** File name of the session-override store, next to the plugin's memory.json. */
export const SESSION_STATE_FILENAME = 'memory-sessions.json'

/** Days an override stays valid before it is pruned. */
export const DEFAULT_TTL_DAYS = 7

/** Absolute path of the session-override store. */
export function defaultSessionStatePath() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), SESSION_STATE_FILENAME)
}

/**
 * Expand a leading `~` to the user's home directory. Non-strings pass through
 * as `undefined` so callers can treat missing config as "no rule".
 *
 * @param {unknown} value
 * @returns {string | undefined}
 */
export function expandHome(value) {
  return expandPath(value)
}

/**
 * Does `cwd` fall inside any of the configured roots?
 *
 * Matching is on path boundaries, so `/Users/x/work` covers
 * `/Users/x/work/repo` but not `/Users/x/work2`. `~` is expanded.
 *
 * @param {string | undefined} cwd
 * @param {string[] | undefined} patterns
 * @returns {boolean}
 */
export function matchesWorkspace(cwd, patterns, options = {}) {
  if (typeof cwd !== 'string' || cwd.trim().length === 0) return false
  // Windows paths are case-insensitive: `C:\\Users\\X` and `c:\\users\\x` are
  // the same workspace, so compare lowercased paths there.
  const platform = options.platform ?? process.platform
  const normalizeCase = (value) => (platform === 'win32' ? value.toLowerCase() : value)
  const target = normalizeCase(resolve(cwd))
  if (!Array.isArray(patterns)) return false
  return patterns.some((pattern) => {
    const expanded = expandHome(pattern)
    if (expanded === undefined || expanded.length === 0) return false
    const root = normalizeCase(resolve(expanded))
    return target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
  })
}

/**
 * Persistent per-session overrides.
 *
 * @param {object} [options]
 * @param {string} [options.path] state-file path (defaults to `<dshHome>/memory-sessions.json`)
 * @param {number} [options.ttlDays] override lifetime in days (default 7)
 * @param {() => number} [options.now] clock injection for tests
 */
export class SessionGate {
  constructor(options = {}) {
    this.path = options.path ?? defaultSessionStatePath()
    this.ttlDays = Number.isFinite(options.ttlDays) && options.ttlDays > 0
      ? options.ttlDays
      : DEFAULT_TTL_DAYS
    this.now = typeof options.now === 'function' ? options.now : () => Date.now()
    /** @type {Map<string, { enabled: boolean, updatedAt: number, cwd?: string }>} */
    this.sessions = new Map()
    this.load()
  }

  /** Read the state file; corrupt or missing files mean "no overrides". */
  load() {
    let raw
    try {
      if (!existsSync(this.path)) return
      raw = JSON.parse(readFileSync(this.path, 'utf8'))
    } catch {
      return
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return
    const sessions = raw.sessions
    if (typeof sessions !== 'object' || sessions === null || Array.isArray(sessions)) return
    for (const [id, entry] of Object.entries(sessions)) {
      if (typeof id !== 'string' || id.length === 0) continue
      if (typeof entry !== 'object' || entry === null || typeof entry.enabled !== 'boolean') continue
      if (!Number.isFinite(entry.updatedAt)) continue
      this.sessions.set(id, {
        enabled: entry.enabled,
        updatedAt: entry.updatedAt,
        cwd: typeof entry.cwd === 'string' ? entry.cwd : undefined,
      })
    }
    this.prune()
  }

  /** Drop expired overrides; returns the number of pruned entries. */
  prune() {
    const cutoff = this.now() - this.ttlDays * 24 * 60 * 60 * 1000
    let removed = 0
    for (const [id, entry] of this.sessions) {
      if (entry.updatedAt < cutoff) {
        this.sessions.delete(id)
        removed += 1
      }
    }
    if (removed > 0) this.persist()
    return removed
  }

  /**
   * The session's explicit choice, or `undefined` when it has none.
   * Expired entries count as "no choice" and are pruned.
   *
   * @param {string} sessionId
   * @returns {boolean | undefined}
   */
  getOverride(sessionId) {
    const entry = this.sessions.get(sessionId)
    if (entry === undefined) return undefined
    const cutoff = this.now() - this.ttlDays * 24 * 60 * 60 * 1000
    if (entry.updatedAt < cutoff) {
      this.sessions.delete(sessionId)
      this.persist()
      return undefined
    }
    return entry.enabled
  }

  /**
   * Pin one session on/off.
   *
   * @param {string} sessionId
   * @param {boolean} enabled
   * @param {string} [cwd] session workspace, kept for debugging the state file
   */
  setOverride(sessionId, enabled, cwd) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return
    this.sessions.set(sessionId, {
      enabled: enabled === true,
      updatedAt: this.now(),
      ...(typeof cwd === 'string' && cwd.length > 0 ? { cwd } : {}),
    })
    this.persist()
  }

  /** Remove one session's override (back to the workspace/global default). */
  clearOverride(sessionId) {
    if (this.sessions.delete(sessionId)) this.persist()
  }

  /**
   * Flip one session. With `explicit` given that value is used instead of the
   * flip, which makes the command handling idempotent.
   *
   * @param {string} sessionId
   * @param {boolean} [explicit]
   * @param {string} [cwd] session workspace, kept for debugging the state file
   * @returns {boolean} the new enabled state
   */
  toggle(sessionId, explicit, cwd) {
    const current = this.getOverride(sessionId) ?? true
    const next = typeof explicit === 'boolean' ? explicit : !current
    this.setOverride(sessionId, next, cwd)
    return next
  }

  /**
   * The one predicate every injection point shares.
   *
   * @param {string} sessionId
   * @param {string | undefined} cwd
   * @param {{ globalEnabled?: boolean, disabledWorkspaces?: string[] }} [config]
   * @returns {boolean}
   */
  effectiveEnabled(sessionId, cwd, config = {}) {
    if (config.globalEnabled === false) return false
    const override = this.getOverride(sessionId)
    if (override !== undefined) return override
    if (matchesWorkspace(cwd, config.disabledWorkspaces)) return false
    return true
  }

  /** Current on-disk session count (debugging / diagnostics). */
  get size() {
    return this.sessions.size
  }

  /** Persist atomically; failures are best-effort and never break a turn. */
  persist() {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const payload = {
        version: 1,
        sessions: Object.fromEntries(this.sessions),
      }
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      renameSync(tmp, this.path)
    } catch {
      // best effort: the in-memory gate still works for this process
    }
  }
}
