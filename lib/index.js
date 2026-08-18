/**
 * dsh-plugin-memory — long-term memory plugin for DeepSeek Harness.
 *
 * ## What it does
 *
 * 1. **Boot injection (hard guarantee).** Registers a dynamic
 *    runtime-context contribution on `ctx.systemPrompt` that reads the
 *    memory store (SOUL.md / MEMORY.md / index.md + recent log entries)
 *    and injects it at the start of every session. The host deduplicates
 *    by projection: an unchanged store is injected once, and edits make
 *    a new snapshot supersede the old one.
 *
 * 2. **Runtime skill.** Registers the `memory` skill (operator protocol:
 *    bootstrap soul-definition, remember / recall / consolidate / forget)
 *    through `ctx.skills.register()`. Project-level filesystem skills can
 *    still override it.
 *
 * 3. **Portable CLI.** Ships `dsh-memory` (search / lint / status / init /
 *    pack / unpack) so memory stays usable from a shell and migratable
 *    across machines and agents.
 *
 * The memory store itself is plain markdown + git — the plugin never owns
 * the format, only the workflows around it.
 *
 * ## Config
 *
 * | key | default | meaning |
 * |---|---|---|
 * | `enabled` | `true` | master switch: stops boot injection AND skill registration |
 * | `memoryDir` | `~/.memory` | absolute memory-store path (`~` expanded) |
 * | `bootFiles` | `[SOUL.md, MEMORY.md, index.md]` | files injected at boot |
 * | `bootMaxChars` | `6000` | total character budget of the boot block |
 * | `autoInject` | `true` | inject the boot block at session start |
 * | `registerSkill` | `true` | register the embedded `memory` skill |
 * | `scaffold` | `true` | create the store layout + templates when missing |
 * | `settingsUi` | `true` | register the `memory` settings namespace so `enabled` / `memoryDir` / `autoInject` / `registerSkill` appear in the Settings panel and hot-apply |
 *
 * `enabled`, `memoryDir`, `autoInject` and `registerSkill` are editable in
 * the Settings panel and hot-apply: boot injection, the skill registration
 * and the scaffold react to edits immediately. The other keys are
 * composition-time only.
 *
 * ## Install
 *
 * ```sh
 * pnpm add dsh-plugin-memory
 * ```
 *
 * Then add an entry to your profile `cordis.patch.yml`:
 *
 * ```yaml
 * - insert:
 *     - id: dsh-memory
 *       name: dsh-plugin-memory
 *       inject:
 *         - systemPrompt
 *         - skills
 *       config:
 *         memoryDir: '~/.memory'
 * ```
 *
 * @module dsh-plugin-memory
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { renderBootBlock } from './boot.js'
import { ensureMemoryScaffold } from './scaffold.js'
import {
  MEMORY_SKILL_NAME,
  MEMORY_SKILL_DESCRIPTION,
  MEMORY_SKILL_WHEN_TO_USE,
  memorySkillContent,
} from './skill.js'

export const name = 'memory'

/** Settings namespace used by the Settings panel section. */
export const SETTINGS_NAMESPACE = 'memory'

export const inject = ['systemPrompt', 'skills']

/** Schemastery schema applied to the plugin config before startup. */
export const Config = z.object({
  enabled: z.boolean().default(true),
  memoryDir: z.string().default('~/.memory'),
  bootFiles: z.array(z.string()).default(['SOUL.md', 'MEMORY.md', 'index.md']),
  bootMaxChars: z.number().default(6000),
  autoInject: z.boolean().default(true),
  registerSkill: z.boolean().default(true),
  scaffold: z.boolean().default(true),
  settingsUi: z.boolean().default(true),
})

/**
 * The user-facing settings schema: the composition config is the base
 * layer, and edits from the Settings panel live in the user layer. Only
 * fields that can hot-apply are exposed here.
 */
export const SettingsSchema = z.object({
  enabled: z.boolean().default(true),
  memoryDir: z.string().default('~/.memory'),
  autoInject: z.boolean().default(true),
  registerSkill: z.boolean().default(true),
})

/**
 * Expand `~` to the home directory and resolve to an absolute path.
 * @param {string} dir
 * @returns {string}
 */
export function resolveMemoryDir(dir) {
  if (dir === '~') return homedir()
  if (dir.startsWith('~/')) return join(homedir(), dir.slice(2))
  return resolve(dir)
}

/**
 * Cordis plugin entry.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {ReturnType<typeof Config> | import('./types/index.d.ts').MemoryConfig} config
 * @returns {() => void} disposer
 */
export function apply(ctx, config = {}) {
  const bootMaxChars = Math.max(512, Number(config.bootMaxChars) || 6000)
  const bootFiles = config.bootFiles ?? ['SOUL.md', 'MEMORY.md', 'index.md']
  const scaffoldEnabled = config.scaffold !== false

  // Optional settings surface: the resolved value (composition base + user
  // layer) feeds every rebuild, so edits in the Settings panel hot-apply.
  let settingsScope
  ctx.inject(['settings'], (settingsCtx) => {
    if (config.settingsUi === false) return
    settingsScope = settingsCtx.settings.register(SETTINGS_NAMESPACE, SettingsSchema, {
      base: {
        enabled: config.enabled !== false,
        memoryDir: config.memoryDir ?? '~/.memory',
        autoInject: config.autoInject !== false,
        registerSkill: config.registerSkill !== false,
      },
    })
    settingsCtx.effect(() => () => {
      settingsScope = undefined
    }, 'memory.settings()')
  })

  const readConfig = () => {
    const resolved = settingsScope?.get()
    const rawDir = typeof resolved?.memoryDir === 'string' && resolved.memoryDir.trim().length > 0
      ? resolved.memoryDir
      : typeof config.memoryDir === 'string' && config.memoryDir.trim().length > 0
        ? config.memoryDir
        : '~/.memory'
    return {
      enabled: resolved?.enabled ?? config.enabled !== false,
      memoryDir: resolveMemoryDir(rawDir),
      autoInject: resolved?.autoInject ?? config.autoInject !== false,
      registerSkill: resolved?.registerSkill ?? config.registerSkill !== false,
    }
  }

  let bootDispose
  let skillDispose
  let scaffoldedDir

  const disposeBoot = () => {
    if (bootDispose !== undefined) {
      bootDispose()
      bootDispose = undefined
    }
  }

  const disposeSkill = () => {
    if (skillDispose !== undefined) {
      skillDispose()
      skillDispose = undefined
    }
  }

  /**
   * Bring boot injection, skill registration and the scaffold in line with
   * the current resolved config. Called once at startup and on every
   * settings change; teardown + re-register keeps it correct for both
   * toggle and memory-dir edits.
   */
  const rebuild = () => {
    const cfg = readConfig()
    const wantBoot = cfg.enabled && cfg.autoInject
    const wantSkill = cfg.enabled && cfg.registerSkill

    if (cfg.enabled && scaffoldEnabled && cfg.memoryDir !== scaffoldedDir) {
      const created = ensureMemoryScaffold(cfg.memoryDir)
      scaffoldedDir = cfg.memoryDir
      if (created.length > 0) {
        ctx.logger?.info(`memory: initialized scaffold at ${cfg.memoryDir} (${created.length} entries)`)
      }
    }

    if (wantBoot) {
      disposeBoot()
      bootDispose = ctx.systemPrompt.context({
        name: 'memory-boot',
        order: -200,
        text: () => renderBootBlock(cfg.memoryDir, { bootFiles, bootMaxChars }),
      })
    } else {
      disposeBoot()
    }

    if (wantSkill) {
      disposeSkill()
      skillDispose = ctx.skills.register({
        name: MEMORY_SKILL_NAME,
        description: MEMORY_SKILL_DESCRIPTION,
        whenToUse: MEMORY_SKILL_WHEN_TO_USE,
        content: memorySkillContent(),
        source: 'dsh-plugin-memory',
        resourceBase: { kind: 'directory', path: cfg.memoryDir },
      })
    } else {
      disposeSkill()
    }

    ctx.logger?.info(
      `memory: ${cfg.enabled ? `enabled, store at ${cfg.memoryDir}` : 'disabled'}`
      + ` (boot ${wantBoot ? 'on' : 'off'}, skill ${wantSkill ? 'on' : 'off'})`,
    )
  }

  rebuild()

  // Settings-panel hot edits: any change re-applies the resolved config.
  ctx.effect(() => {
    const unwatch = settingsScope?.watch(() => rebuild())
    return () => {
      unwatch?.()
    }
  }, 'memory.settings-watch()')

  return () => {
    disposeBoot()
    disposeSkill()
  }
}

// DSH's loader unwraps a package's default export before it starts the
// Cordis plugin. Keep the default export callable for direct consumers, but
// attach the Cordis metadata to that function so injected services and the
// config schema survive the unwrap step.
Object.defineProperties(apply, {
  name: { value: name },
  inject: { value: inject },
  Config: { value: Config },
})

export default apply

export { renderBootBlock, ensureMemoryScaffold }
