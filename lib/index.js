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
 * 4. **Settings panel.** `enabled` / `memoryDir` / `autoInject` /
 *    `registerSkill` are editable in the Settings panel and hot-apply.
 *    They live in `<dshHome>/memory.json` and are served to the browser
 *    through the plugin's own HTTP route — the settings wire only serves
 *    a hard-coded namespace allowlist, so a plugin namespace is never
 *    remotely writable (see `lib/config-store.js`).
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
 * | `configFile` | `<dshHome>/memory.json` | user-facing config file (Settings panel) |
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
import { MemoryConfigStore } from './config-store.js'
import { SettingsSchema } from './schema.js'
import {
  MEMORY_SKILL_NAME,
  MEMORY_SKILL_DESCRIPTION,
  MEMORY_SKILL_WHEN_TO_USE,
  memorySkillContent,
} from './skill.js'

export const name = 'memory'

/** HTTP route serving the user-facing config to the browser Settings panel. */
export const CONFIG_ROUTE_PATH = '/api/memory/config'

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
  configFile: z.union([z.string(), z.const(undefined)]),
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

  // Single user-facing config source: composition defaults + memory.json.
  const store = new MemoryConfigStore({
    path: typeof config.configFile === 'string' && config.configFile.trim().length > 0 ? config.configFile : undefined,
    base: {
      enabled: config.enabled !== false,
      memoryDir: config.memoryDir ?? '~/.memory',
      autoInject: config.autoInject !== false,
      registerSkill: config.registerSkill !== false,
    },
  })

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
   * config-store change; teardown + re-register keeps it correct for both
   * toggle and memory-dir edits.
   */
  const rebuild = () => {
    const resolved = store.get()
    const memoryDir = resolveMemoryDir(resolved.memoryDir)
    const wantBoot = resolved.enabled && resolved.autoInject
    const wantSkill = resolved.enabled && resolved.registerSkill

    if (resolved.enabled && scaffoldEnabled && memoryDir !== scaffoldedDir) {
      const created = ensureMemoryScaffold(memoryDir)
      scaffoldedDir = memoryDir
      if (created.length > 0) {
        ctx.logger?.info(`memory: initialized scaffold at ${memoryDir} (${created.length} entries)`)
      }
    }

    if (wantBoot) {
      disposeBoot()
      bootDispose = ctx.systemPrompt.context({
        name: 'memory-boot',
        order: -200,
        text: () => renderBootBlock(memoryDir, { bootFiles, bootMaxChars }),
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
        resourceBase: { kind: 'directory', path: memoryDir },
      })
    } else {
      disposeSkill()
    }

    ctx.logger?.info(
      `memory: ${resolved.enabled ? `enabled, store at ${memoryDir}` : 'disabled'}`
      + ` (boot ${wantBoot ? 'on' : 'off'}, skill ${wantSkill ? 'on' : 'off'})`,
    )
  }

  rebuild()

  // Settings-panel hot edits: any store change re-applies the config.
  ctx.effect(() => {
    const unwatch = store.watch(() => rebuild())
    return () => {
      unwatch()
    }
  }, 'memory.config-watch()')

  // Browser config route (optional: headless deployments have no webServer).
  ctx.inject(['webServer'], (webCtx) => {
    const disposeRoute = webCtx.webServer.register({
      kind: 'exact',
      path: CONFIG_ROUTE_PATH,
      handler: async (req, res) => {
        try {
          if (req.method === 'GET') {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(store.get()))
            return
          }
          if (req.method === 'POST') {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            const body = Buffer.concat(chunks).toString('utf8')
            let patch
            try {
              patch = JSON.parse(body)
            } catch {
              res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ error: 'body must be JSON' }))
              return
            }
            const next = store.update(patch)
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(next))
            return
          }
          res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: 'method not allowed' }))
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      },
    })
    webCtx.effect(() => disposeRoute, 'memory.config-route()')
    ctx.logger?.info(`memory: config route at ${CONFIG_ROUTE_PATH} (store ${store.path})`)
  })

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

export { renderBootBlock, ensureMemoryScaffold, SettingsSchema, MemoryConfigStore }
