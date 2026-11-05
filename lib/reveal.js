/**
 * Reveal a memory page in the OS file manager (Finder / Explorer / xdg).
 *
 * The browser half cannot touch the filesystem, so the panel POSTs the page id
 * to `/api/memory/reveal` and this module runs the platform command. Every path
 * is resolved and confined to the memory store before anything is executed:
 * a crafted id must never reveal (or hint at) a file outside the store.
 *
 * The command is awaited on purpose: `open -R` can fail (sandbox, missing
 * binary), and a fire-and-forget call would report success while nothing
 * opened. Failures carry `code: 'exec-failed'` so the route can answer 500 and
 * the panel can fall back to copying the path.
 *
 * @module dsh-plugin-memory/reveal
 */

import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

/**
 * Resolve `relativePath` inside `memoryDir`, rejecting escapes and non-files.
 *
 * @param {string} memoryDir
 * @param {string} relativePath
 * @returns {string} absolute file path
 */
export function resolveMemoryFile(memoryDir, relativePath) {
  const root = resolve(String(memoryDir ?? ''))
  const raw = String(relativePath ?? '')
  if (raw.length === 0 || raw.includes('\0')) throw new Error('invalid id')
  const candidate = resolve(root, raw)
  if (candidate !== root && !candidate.startsWith(root + sep)) throw new Error('path escapes the memory store')
  if (!existsSync(candidate)) throw new Error('file does not exist')
  if (!statSync(candidate).isFile()) throw new Error('not a file')
  return candidate
}

/** The platform command that opens the file manager with the file selected. */
function revealCommand(platform, path) {
  if (platform === 'darwin') return ['open', ['-R', path]]
  // explorer wants the selection switch and the path as separate argv
  // entries; one combined string breaks on paths containing spaces.
  if (platform === 'win32') return ['explorer', ['/select,', path]]
  return ['xdg-open', [dirname(path)]]
}

/**
 * Reveal one memory page in the file manager, selecting the file.
 *
 * @param {string} memoryDir absolute store dir
 * @param {string} relativePath page id (e.g. `projects/active/x.md`)
 * @param {{ execFile?: (cmd: string, args: string[], cb: (error: Error | null) => void) => void, platform?: string }} [options]
 * @returns {Promise<{ ok: true, path: string }>}
 */
export async function revealFile(memoryDir, relativePath, options = {}) {
  const run = options.execFile ?? execFile
  const platform = options.platform ?? process.platform
  let path
  try {
    path = resolveMemoryFile(memoryDir, relativePath)
  } catch (error) {
    error.code = 'invalid-id'
    throw error
  }
  const [command, args] = revealCommand(platform, path)
  await new Promise((resolvePromise, reject) => {
    try {
      run(command, args, (error) => {
        // explorer.exe exits with code 1 after opening the window; that is a
        // success, not a failure.
        if (error && !(platform === 'win32' && error.code === 1)) reject(error)
        else resolvePromise()
      })
    } catch (error) {
      reject(error)
    }
  }).catch((error) => {
    if (error.code === undefined) error.code = 'exec-failed'
    throw error
  })
  return { ok: true, path }
}
