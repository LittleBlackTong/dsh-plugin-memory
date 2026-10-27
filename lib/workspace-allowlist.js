/**
 * Workspace allowlist: gate memory access by the session's working directory.
 *
 * Deliberately free of host-only dependencies (`@deepseek-ai/schemastery` and
 * friends only exist inside a running profile) so the pure path logic stays
 * unit-testable in a bare checkout.
 *
 * @module dsh-plugin-memory/workspace-allowlist
 */

import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

/**
 * Expand `~` to the home directory and resolve to an absolute path.
 *
 * @param {string} dir
 * @returns {string}
 */
export function resolveMemoryDir(dir) {
  if (dir === '~') return homedir()
  if (dir.startsWith('~/')) return join(homedir(), dir.slice(2))
  return resolve(dir)
}

/**
 * Does a session cwd fall inside the configured workspace allowlist?
 *
 * An empty allowlist means "no restriction" (the historical behaviour).
 * Entries match on path boundaries, so `~/dafeiyu` covers
 * `/Users/wangyi/dafeiyu/qq-bridge` but not `/Users/wangyi/dafeiyu2`.
 * `workspaceExclude` is checked first and wins over the allowlist.
 *
 * @param {string | undefined} cwd session workspace (`agent.session.header.cwd`)
 * @param {string[]} workspaces allowlisted roots
 * @param {string[]} workspaceExclude excluded roots
 * @returns {boolean}
 */
export function isWorkspaceAllowed(cwd, workspaces, workspaceExclude) {
  const toRoot = (value) => (typeof value === 'string' && value.trim().length > 0
    ? resolve(resolveMemoryDir(value.trim()))
    : undefined)
  const roots = (Array.isArray(workspaces) ? workspaces : []).map(toRoot).filter(Boolean)
  if (roots.length === 0) return true
  if (typeof cwd !== 'string' || cwd.trim().length === 0) return false
  const target = resolve(cwd)
  const within = (root) => target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
  const blocked = (Array.isArray(workspaceExclude) ? workspaceExclude : []).map(toRoot).filter(Boolean)
  if (blocked.some(within)) return false
  return roots.some(within)
}
