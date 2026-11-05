/**
 * Cross-platform path helpers: home expansion, Windows-style variables and
 * newline normalisation.
 *
 * The plugin runs on macOS, Windows and Linux. Two things differ enough to
 * hurt: `~` is POSIX-only (Windows users write `%USERPROFILE%` / `$HOME`),
 * and Windows editors save markdown with CRLF — frontmatter regexes anchored
 * with `^...$` silently stop matching on `\r`-suffixed lines.
 *
 * @module dsh-plugin-memory/paths
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Normalise CRLF / lone CR to LF.
 *
 * Used on **read** paths only: files written back keep their own newline
 * style (see the callers that detect `\r\n` before writing).
 *
 * @param {unknown} text
 * @returns {string}
 */
export function normalizeNewlines(text) {
  if (typeof text !== 'string') return ''
  return text.replace(/\r\n?/g, '\n')
}

/**
 * Expand a user-supplied path value:
 *  - `~`, `~/x`, `~\x` → the user's home directory
 *  - `%USERPROFILE%` / `%APPDATA%` (Windows style)
 *  - `$HOME` / `${HOME}` (POSIX style)
 * Unknown variables are left verbatim; non-strings return `undefined`.
 *
 * @param {unknown} value
 * @param {{ home?: string, env?: Record<string, string | undefined> }} [options]
 * @returns {string | undefined}
 */
export function expandPath(value, options = {}) {
  if (typeof value !== 'string') return undefined
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  let text = value.trim()
  if (text.length === 0) return undefined
  text = text.replace(/%([A-Za-z0-9_]+)%/g, (match, name) => (
    typeof env[name] === 'string' ? env[name] : match
  ))
  text = text.replace(/\$\{([A-Za-z0-9_]+)\}|\$([A-Za-z0-9_]+)/g, (match, braced, plain) => {
    const name = braced ?? plain
    return typeof env[name] === 'string' ? env[name] : match
  })
  if (text === '~') return home
  if (text.startsWith('~/') || text.startsWith('~\\')) return join(home, text.slice(2))
  return text
}
