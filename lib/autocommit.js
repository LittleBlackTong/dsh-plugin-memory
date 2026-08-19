/**
 * Auto-commit: keep the memory store's git history current without relying
 * on the agent to remember `git commit`.
 *
 * The store is "plain markdown + git" — but history only exists when
 * somebody commits. Agents reliably forget. This module polls the store
 * directory for changes and, once the store has been quiet for a configured
 * grace period (debounce), runs `git add -A && git commit` in it. When the
 * store is not a git repository (or git is unavailable), it does nothing.
 *
 * Independent of dsh-plugin-heartbeat: node builtins only, no plugin deps.
 *
 * @module dsh-plugin-memory/autocommit
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Collect all files under `dir`, skipping `.git`.
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {string[]}
 */
export function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name === '.git') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, out)
    else out.push(full)
  }
  return out
}

/**
 * Latest mtime (ms epoch) across every file in the store (excluding .git).
 * @param {string} dir
 * @returns {number}
 */
export function latestMtimeMs(dir) {
  let latest = 0
  for (const file of walkFiles(dir)) {
    try {
      latest = Math.max(latest, statSync(file).mtimeMs)
    } catch {
      // moved while walking: ignore
    }
  }
  return latest
}

/** @returns {boolean} whether the `git` binary is on PATH */
export function gitAvailable() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * @typedef {object} AutoCommitterOptions
 * @property {boolean} [enabled=true]
 * @property {number} [quietSeconds=60] debounce: commit only after the store stayed unchanged this long
 * @property {number} [intervalSeconds=60] poll period
 * @property {{ info?: Function, warn?: Function }} [logger]
 */

/**
 * Polls one memory store directory and commits changes to its git repo.
 */
export class AutoCommitter {
  /**
   * @param {string} memoryDir absolute store path
   * @param {AutoCommitterOptions} options
   */
  constructor(memoryDir, options = {}) {
    this.memoryDir = memoryDir
    this.enabled = options.enabled !== false
    this.quietMs = Math.max(1, Number(options.quietSeconds) || 60) * 1000
    this.intervalMs = Math.max(15, Number(options.intervalSeconds) || 60) * 1000
    this.logger = options.logger
    this.timer = undefined
    this.disposed = false
    this.dirtySince = 0
    this.committing = false
    this.lastWarnAt = 0
    this.gitOk = false
  }

  /** Begin polling; no-op when disabled or the store isn't a git repo. */
  start() {
    if (this.disposed || !this.enabled) return
    if (!existsSync(join(this.memoryDir, '.git'))) {
      this.logger?.info?.(`memory: auto-commit skipped — ${this.memoryDir} is not a git repository`)
      return
    }
    if (!gitAvailable()) {
      this.logger?.warn?.('memory: auto-commit skipped — git binary not found on PATH')
      return
    }
    this.gitOk = true
    // Flush changes that predate this plugin start (e.g. written last
    // session and never committed) instead of leaving them unversioned.
    this.check(true)
    this.timer = setInterval(() => {
      try {
        this.check(false)
      } catch (error) {
        this.warn(`check failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }, this.intervalMs)
    this.timer.unref?.()
  }

  /** Stop polling; a final in-flight commit is left alone. */
  dispose() {
    this.disposed = true
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  /**
   * Commit when the store is dirty and has stayed dirty for the grace
   * period. The dirty window is measured from the first poll that noticed
   * the change — mtimes cannot be trusted (a fresh file can carry an old
   * timestamp), but `git status` is authoritative. Exposed for tests;
   * `initial` flushes pre-existing dirty state once.
   * @param {boolean} [initial=false]
   */
  check(initial = false) {
    if (this.disposed || !this.gitOk || this.committing) return
    const dirty = this.isDirty()
    if (!dirty) {
      this.dirtySince = 0
      return
    }
    const now = Date.now()
    if (this.dirtySince === 0) this.dirtySince = now
    if (!initial && now - this.dirtySince < this.quietMs) return

    this.committing = true
    try {
      execFileSync('git', ['-C', this.memoryDir, 'add', '-A'], { stdio: 'pipe' })
      if (!this.hasStaged()) {
        // Everything changed is ignored (e.g. .DS_Store, tarballs): nothing
        // to commit — treat as clean so the poll loop stays quiet.
        this.dirtySince = 0
        return
      }
      const stamp = new Date().toISOString()
      execFileSync('git', ['-C', this.memoryDir, 'commit', '-m', `digest: auto-commit memory store ${stamp}`], { stdio: 'pipe' })
      this.dirtySince = 0
      this.logger?.info?.(`memory: auto-committed store at ${this.memoryDir}`)
    } catch (error) {
      this.warn(`auto-commit failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.committing = false
    }
  }

  /** @returns {boolean} whether the index has staged changes to commit */
  hasStaged() {
    try {
      execFileSync('git', ['-C', this.memoryDir, 'diff', '--cached', '--quiet'], { stdio: 'ignore' })
      return false // exit 0: nothing staged
    } catch {
      return true // exit 1: staged changes exist
    }
  }

  /** @returns {boolean} whether git reports uncommitted changes */
  isDirty() {
    try {
      const out = execFileSync('git', ['-C', this.memoryDir, 'status', '--porcelain'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      return out.trim().length > 0
    } catch {
      return false
    }
  }

  /** Rate-limited warnings: at most one per 30 minutes. */
  warn(message) {
    const now = Date.now()
    if (now - this.lastWarnAt < 30 * 60000) return
    this.lastWarnAt = now
    this.logger?.warn?.(`memory: ${message}`)
  }
}
