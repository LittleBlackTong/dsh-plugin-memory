/**
 * Proactive-speech arbitration: the shared "who may speak right now" lock.
 *
 * Two independent plugins can each decide, on their own timer, that the agent
 * should say something unprompted — dsh-plugin-memory (recall / digest /
 * growth recap) and dsh-plugin-heartbeat. Without arbitration both fire in the
 * same quiet window and the user gets a burst of synthetic followups.
 *
 * They cannot import each other (plugin boundary: zero cross-plugin imports),
 * so the protocol is a single JSON file both implementations understand:
 *
 * ```json
 * { "version": 1, "speaker": "memory" | "heartbeat", "at": 1760000000000 }
 * ```
 *
 * A speaker may claim only when the file is absent, corrupt, owns the same
 * `speaker` name (its own lock), or the previous claim is older than the
 * cooldown. Writes are atomic (tmp + rename) so a reader never sees a partial
 * document; a corrupt file degrades to "no lock" because a broken cooldown
 * must never silence the plugin forever.
 *
 * This module depends only on `node:*` builtins.
 *
 * @module dsh-plugin-memory/proactive-lock
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** File name of the shared arbitration protocol (same on both sides). */
export const PROACTIVE_COOLDOWN_FILENAME = 'proactive-cooldown.json'

/** Protocol version written into the file. */
export const PROACTIVE_LOCK_VERSION = 1

/**
 * The shared cooldown file location: `${DSH_HOME||~/.dsh}/proactive-cooldown.json`.
 * Both plugins resolve it the same way so they meet on the same file.
 * @returns {string} absolute path
 */
export function defaultProactiveCooldownPath() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), PROACTIVE_COOLDOWN_FILENAME)
}

/**
 * Read the current lock, tolerating every kind of damage.
 *
 * @param {string} path absolute lock-file path
 * @returns {{version: number, speaker: string, at: number} | undefined}
 *   the parsed lock, or undefined when missing/corrupt (== no lock)
 */
export function readProactiveLock(path) {
  if (typeof path !== 'string' || path.length === 0 || !existsSync(path)) return undefined
  let raw
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const at = Number(raw.at)
  if (!Number.isFinite(at)) return undefined
  return {
    version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : PROACTIVE_LOCK_VERSION,
    speaker: typeof raw.speaker === 'string' && raw.speaker.length > 0 ? raw.speaker : 'unknown',
    at,
  }
}

/**
 * Try to take the proactive-speech lock.
 *
 * The lock is advisory and single-file: claim right before injecting a
 * followup, and if it is refused, skip this round (the next scheduled trigger
 * tries again). `cooldownSeconds <= 0` turns arbitration off entirely (the
 * config escape hatch) and writes nothing.
 *
 * @param {object} [options]
 * @param {string} [options.path] lock-file path (defaults to the shared path)
 * @param {string} [options.speaker] who is speaking ('memory' here)
 * @param {number} [options.cooldownSeconds] arbitration window; default 180, 0 = off
 * @param {number} [options.now] epoch ms (injectable for tests)
 * @returns {{ ok: true, disabled?: true } | { ok: false, deferredBy: string }}
 */
export function claimProactiveLock(options = {}) {
  const path = typeof options.path === 'string' && options.path.length > 0
    ? options.path
    : defaultProactiveCooldownPath()
  const speaker = typeof options.speaker === 'string' && options.speaker.length > 0
    ? options.speaker
    : 'memory'
  const rawCooldown = Number(options.cooldownSeconds ?? 180)
  const cooldownSeconds = Number.isFinite(rawCooldown) ? Math.max(0, rawCooldown) : 180
  const rawNow = Number(options.now ?? Date.now())
  const now = Number.isFinite(rawNow) ? rawNow : Date.now()

  // Explicitly disabled: everyone may speak, and we leave the protocol file
  // untouched so the other side's state is not clobbered for nothing.
  if (cooldownSeconds === 0) return { ok: true, disabled: true }

  const current = readProactiveLock(path)
  if (current !== undefined && current.speaker !== speaker) {
    const cooldownMs = cooldownSeconds * 1000
    if (current.at > now - cooldownMs) {
      return { ok: false, deferredBy: current.speaker }
    }
  }

  const lock = { version: PROACTIVE_LOCK_VERSION, speaker, at: now }
  try {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    writeFileSync(tmp, `${JSON.stringify(lock)}\n`, 'utf8')
    renameSync(tmp, path)
  } catch {
    // An unwritable lock file must not break the caller: arbitration is
    // best-effort, the message itself is still worth delivering.
    return { ok: true, disabled: true }
  }
  return { ok: true }
}
