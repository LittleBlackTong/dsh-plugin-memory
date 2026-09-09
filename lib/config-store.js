/**
 * Memory configuration store: one JSON file as the single user-facing
 * config source, layered over the composition defaults.
 *
 * Why not the `settings` service? The Web settings wire only serves a
 * hard-coded allowlist (`WEB_SETTINGS_NAMESPACES` in dsh-host-apiproxy) and
 * rejects every other namespace with `settings-not-exposed`; a plugin cannot
 * add itself to that list yet. This store keeps the same "base + user layer"
 * semantics with a private JSON file and an in-process watch, and the plugin
 * serves it over its own HTTP route for the browser UI.
 *
 * @module dsh-plugin-memory/config-store
 */

import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { SettingsSchema } from './schema.js'

export const MEMORY_CONFIG_FILENAME = 'memory.json'

export function defaultConfigPath() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), MEMORY_CONFIG_FILENAME)
}

const FIELDS = ['enabled', 'memoryDir', 'autoInject', 'registerSkill', 'deferUntilUserSpeaks', 'activeSessionOnly', 'recallEnabled', 'recallIntervalMinMinutes', 'recallIntervalMaxMinutes', 'recallMaxPerSession']

function pickFields(input) {
  const picked = {}
  for (const key of FIELDS) {
    if (input[key] !== undefined) picked[key] = input[key]
  }
  return picked
}

/**
 * @typedef {object} MemorySettings
 * @property {boolean} enabled
 * @property {string} memoryDir
 * @property {boolean} autoInject
 * @property {boolean} registerSkill
 * @property {boolean} recallEnabled
 */

/**
 * @param {object} options
 * @param {string} [options.path] absolute config-file path (defaults to `<dshHome>/memory.json`)
 * @param {object} [options.base] composition defaults ({enabled, memoryDir, autoInject, registerSkill, recallEnabled})
 */
export class MemoryConfigStore {
  constructor(options = {}) {
    this.path = options.path ?? defaultConfigPath()
    this.base = {
      enabled: options.base?.enabled !== false,
      memoryDir: typeof options.base?.memoryDir === 'string' && options.base.memoryDir.trim().length > 0
        ? options.base.memoryDir
        : '~/.memory',
      autoInject: options.base?.autoInject !== false,
      registerSkill: options.base?.registerSkill !== false,
      deferUntilUserSpeaks: options.base?.deferUntilUserSpeaks !== false,
      activeSessionOnly: options.base?.activeSessionOnly !== false,
      recallEnabled: options.base?.recallEnabled !== false,
      recallIntervalMinMinutes: options.base?.recallIntervalMinMinutes ?? 30,
      recallIntervalMaxMinutes: options.base?.recallIntervalMaxMinutes ?? 240,
      recallMaxPerSession: options.base?.recallMaxPerSession ?? 3,
    }
    this.config = { ...this.base }
    this.watchers = new Set()
    this.load()
  }

  /** Read the user file if present; invalid files are ignored, not fatal. */
  load() {
    let raw
    try {
      if (!existsSync(this.path)) return
      raw = JSON.parse(readFileSync(this.path, 'utf8'))
    } catch {
      return // corrupt file: keep last good config
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return
    try {
      const picked = pickFields(raw)
      if (picked.memoryDir !== undefined && (typeof picked.memoryDir !== 'string' || picked.memoryDir.trim().length === 0)) return
      const resolved = SettingsSchema({ ...this.base, ...picked })
      this.config = {
        enabled: resolved.enabled,
        memoryDir: resolved.memoryDir,
        autoInject: resolved.autoInject,
        registerSkill: resolved.registerSkill,
        deferUntilUserSpeaks: resolved.deferUntilUserSpeaks,
        activeSessionOnly: resolved.activeSessionOnly,
        recallEnabled: resolved.recallEnabled,
        recallIntervalMinMinutes: resolved.recallIntervalMinMinutes,
        recallIntervalMaxMinutes: resolved.recallIntervalMaxMinutes,
        recallMaxPerSession: resolved.recallMaxPerSession,
      }
    } catch {
      // schema validation failed: keep last good config
    }
  }

  /** Current effective config (stable reference until the next update). */
  get() {
    return this.config
  }

  /**
   * Apply a partial update, persist it, and notify watchers.
   * @param {Partial<MemorySettings>} patch
   * @returns {MemorySettings} the new effective config
   * @throws {Error} on invalid fields or values
   */
  update(patch) {
    if (typeof patch !== 'object' || patch === null) throw new Error('config patch must be an object')
    const picked = pickFields(patch)
    if (picked.memoryDir !== undefined && (typeof picked.memoryDir !== 'string' || picked.memoryDir.trim().length === 0)) {
      throw new Error('memoryDir must be a non-empty path string')
    }
    const next = SettingsSchema({
      ...this.base,
      ...this.config,
      ...picked,
    })
    this.config = {
      enabled: next.enabled,
      memoryDir: next.memoryDir,
      autoInject: next.autoInject,
      registerSkill: next.registerSkill,
      deferUntilUserSpeaks: next.deferUntilUserSpeaks,
      activeSessionOnly: next.activeSessionOnly,
      recallEnabled: next.recallEnabled,
      recallIntervalMinMinutes: next.recallIntervalMinMinutes,
      recallIntervalMaxMinutes: next.recallIntervalMaxMinutes,
      recallMaxPerSession: next.recallMaxPerSession,
    }
    this.persist()
    for (const watcher of this.watchers) {
      try {
        watcher(this.config)
      } catch {
        // best-effort notification
      }
    }
    return this.config
  }

  /** Subscribe to config changes; returns the disposer. */
  watch(callback) {
    this.watchers.add(callback)
    return () => this.watchers.delete(callback)
  }

  persist() {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, `${JSON.stringify(this.config, null, 2)}\n`)
      renameSync(tmp, this.path)
    } catch (error) {
      // Persistence is best-effort; the in-memory config is already applied.
      // Surface the failure so the route can report it.
      throw new Error(`config persisted in memory but not to disk: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
