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
 * | `memoryDir` | `~/.memory` | absolute memory-store path (`~` expanded) |
 * | `bootFiles` | `[SOUL.md, MEMORY.md, index.md]` | files injected at boot |
 * | `bootMaxChars` | `6000` | total character budget of the boot block |
 * | `autoInject` | `true` | inject the boot block at session start |
 * | `registerSkill` | `true` | register the embedded `memory` skill |
 * | `scaffold` | `true` | create the store layout + templates when missing |
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

export const inject = ['systemPrompt', 'skills']

/** Schemastery schema applied to the plugin config before startup. */
export const Config = z.object({
  memoryDir: z.string().default('~/.memory'),
  bootFiles: z.array(z.string()).default(['SOUL.md', 'MEMORY.md', 'index.md']),
  bootMaxChars: z.number().default(6000),
  autoInject: z.boolean().default(true),
  registerSkill: z.boolean().default(true),
  scaffold: z.boolean().default(true),
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
  const memoryDir = resolveMemoryDir(config.memoryDir ?? '~/.memory')
  const bootMaxChars = Math.max(512, Number(config.bootMaxChars) || 6000)

  if (config.scaffold !== false) {
    const created = ensureMemoryScaffold(memoryDir)
    if (created.length > 0) {
      ctx.logger?.info(`memory: initialized scaffold at ${memoryDir} (${created.length} entries)`)
    }
  }

  const disposers = []

  if (config.autoInject !== false) {
    disposers.push(ctx.systemPrompt.context({
      name: 'memory-boot',
      order: -200,
      text: () => renderBootBlock(memoryDir, {
        bootFiles: config.bootFiles ?? ['SOUL.md', 'MEMORY.md', 'index.md'],
        bootMaxChars,
      }),
    }))
  }

  if (config.registerSkill !== false) {
    disposers.push(ctx.skills.register({
      name: MEMORY_SKILL_NAME,
      description: MEMORY_SKILL_DESCRIPTION,
      whenToUse: MEMORY_SKILL_WHEN_TO_USE,
      content: memorySkillContent(),
      source: 'dsh-plugin-memory',
      resourceBase: { kind: 'directory', path: memoryDir },
    }))
  }

  ctx.logger?.info(`memory: store at ${memoryDir}`)

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // best-effort teardown
      }
    }
  }
}

export default apply

export { renderBootBlock, ensureMemoryScaffold }
