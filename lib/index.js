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
 * 5. **Memory health dashboard.** A read-only `GET /api/memory/insights`
 *    route serves the payload behind the panel's health card (page counts,
 *    freshness distribution, lint-parity checks, stale candidates, recent
 *    activity). It is computed per request from the store on disk — never
 *    cached, never written.
 *
 * 6. **Memory graph.** A read-only `GET /api/memory/graph` route serves the
 *    relationships the store encodes but `index.md` never shows: explicit
 *    page-to-page links plus edges derived from shared frontmatter tags (and,
 *    optionally, same-type grouping). Rendered as an SVG in the panel.
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
 * | `bootMaxChars` | `12000` | total character budget of the boot block |
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
import { renderBootBlock, DEFAULT_BOOT_FILES } from './boot.js'
import {
  accessSummary,
  extractReferencedPages,
  listPagePaths,
  today,
  touchPageFile,
  touchPages,
} from './pages.js'
import { ensureMemoryScaffold } from './scaffold.js'
import { collectInsights } from './insights.js'
import { buildMemoryGraph } from './graph.js'
import { MemoryConfigStore } from './config-store.js'
import { SettingsSchema } from './schema.js'
import { DigestGuard } from './digest-guard.js'
import { RecallNudge } from './recall-nudge.js'
import { AutoCommitter } from './autocommit.js'
import { ActivityTracker } from './activity-tracker.js'
import {
  MEMORY_SKILL_NAME,
  MEMORY_SKILL_DESCRIPTION,
  MEMORY_SKILL_WHEN_TO_USE,
  memorySkillContent,
} from './skill.js'

export const name = 'memory'

/** HTTP route serving the user-facing config to the browser Settings panel. */
export const CONFIG_ROUTE_PATH = '/api/memory/config'

/** Read-only HTTP route serving the memory-health dashboard payload. */
export const INSIGHTS_ROUTE_PATH = '/api/memory/insights'

/** Read-only HTTP route serving the memory graph (nodes + edges). */
export const GRAPH_ROUTE_PATH = '/api/memory/graph'

export const inject = ['systemPrompt', 'skills', 'agents']

/** Schemastery schema applied to the plugin config before startup. */
export const Config = z.object({
  enabled: z.boolean().default(true),
  memoryDir: z.string().default('~/.memory'),
  bootFiles: z.array(z.string()).default(['SOUL.md', 'MEMORY.md', 'index.md']),
  bootMaxChars: z.number().default(12000),
  // Explicit per-file caps, composition-time only. Unlisted files share what
  // is left; `index.md` is served first in the redistribution pass, and each
  // file takes at most twice the even share (see allocateBootBudget).
  bootFileBudgets: z.union([z.dict(z.number()), z.const(undefined)]),
  autoInject: z.boolean().default(true),
  registerSkill: z.boolean().default(true),
  scaffold: z.boolean().default(true),
  configFile: z.union([z.string(), z.const(undefined)]),
  // Gate 1: don't inject until the session's first real user message.
  deferUntilUserSpeaks: z.boolean().default(true),
  // Gate 2: only the currently active session (most recent user message) injects.
  activeSessionOnly: z.boolean().default(true),
  // Digest guard: inject a synthetic reminder when the agent sits idle and
  // the store has not been written for a while, so the end-of-session
  // digest cannot be silently skipped.
  digestNudgeEnabled: z.boolean().default(true),
  digestNudgeAfterMinutes: z.number().default(120),
  digestNudgeCooldownMinutes: z.number().default(180),
  digestNudgeMaxPerSession: z.number().default(2),
  // Recall nudge: when the agent sits idle, invite it to surface a real
  // memory about the user in a first-person voice (the "persona" half —
  // conversational only, never mutates the store). The interval is a random
  // draw inside [minMinutes, maxMinutes] each time, so recalls never feel
  // metronomic.
  recallEnabled: z.boolean().default(true),
  recallIntervalMinMinutes: z.number().default(30),
  recallIntervalMaxMinutes: z.number().default(240),
  recallMaxPerSession: z.number().default(3),
  // Auto-commit: keep the store's git history current after a quiet period.
  autoCommit: z.boolean().default(true),
  autoCommitQuietSeconds: z.number().default(60),
  autoCommitIntervalSeconds: z.number().default(60),
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
  const bootMaxChars = Math.max(512, Number(config.bootMaxChars) || 12000)
  const bootFiles = config.bootFiles && config.bootFiles.length > 0 ? config.bootFiles : DEFAULT_BOOT_FILES
  const bootFileBudgets = config.bootFileBudgets
  const scaffoldEnabled = config.scaffold !== false

  // Single user-facing config source: composition defaults + memory.json.
  const store = new MemoryConfigStore({
    path: typeof config.configFile === 'string' && config.configFile.trim().length > 0 ? config.configFile : undefined,
    base: {
      enabled: config.enabled !== false,
      memoryDir: config.memoryDir ?? '~/.memory',
      autoInject: config.autoInject !== false,
      registerSkill: config.registerSkill !== false,
      deferUntilUserSpeaks: config.deferUntilUserSpeaks !== false,
      activeSessionOnly: config.activeSessionOnly !== false,
      recallEnabled: config.recallEnabled !== false,
      recallIntervalMinMinutes: config.recallIntervalMinMinutes ?? 30,
      recallIntervalMaxMinutes: config.recallIntervalMaxMinutes ?? 240,
      recallMaxPerSession: config.recallMaxPerSession ?? 3,
    },
  })

  // Per-agent activity tracker: the single source of truth for both gates.
  // Created before `rebuild()` so the boot block's `text` closure can consult
  // it, and shared with the digest guard + recall nudge so they never disagree.
  const tracker = new ActivityTracker({ agents: ctx.agents, logger: ctx.logger })

  let bootDispose
  let skillDispose
  let scaffoldedDir
  let committer
  let currentMemoryDir = resolveMemoryDir(store.get().memoryDir)

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

  const disposeCommitter = () => {
    if (committer !== undefined) {
      committer.dispose()
      committer = undefined
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

    // Auto-commit follows the store dir: create on first build, restart
    // when the dir changes. (The first rebuild must create it too — the
    // dir only "changes" on a later config edit.)
    if (committer === undefined || memoryDir !== currentMemoryDir) {
      currentMemoryDir = memoryDir
      disposeCommitter()
      if (resolved.enabled && config.autoCommit !== false) {
        committer = new AutoCommitter(memoryDir, {
          quietSeconds: config.autoCommitQuietSeconds,
          intervalSeconds: config.autoCommitIntervalSeconds,
          logger: ctx.logger,
        })
        committer.start()
      }
    }

    if (wantBoot) {
      disposeBoot()
      bootDispose = ctx.systemPrompt.context({
        name: 'memory-boot',
        order: -200,
        text: (context) => {
          // Per-agent gate: no agent context (e.g. a global preview) injects
          // unconditionally; an agent injects only once it has spoken and is
          // the active session.
          const agent = context?.agent
          if (agent && !tracker.shouldInject(agent.id, store.get())) return ''
          return renderBootBlock(memoryDir, { bootFiles, bootMaxChars, bootFileBudgets })
        },
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

  // Activity tracker: attach to every live ROOT agent so the two gates
  // (has-user-spoken + active-session) see real user messages as they land.
  ctx.effect(() => {
    const stopCreated = ctx.on('agent/created', ({ agent }) => {
      if (!ctx.agents.roots().includes(agent)) return
      agent.ctx.effect(() => {
        tracker.attach(agent)
        return () => {
          tracker.detach(agent.id)
        }
      })
    })
    return () => stopCreated()
  }, 'memory.activity-tracker()')

  // Page access bookkeeping: the salience/decay table in MEMORY.md is only
  // real if `last_access` moves — it shipped as an honor-system field that
  // nothing ever wrote, so every page aged in place and the decay rules
  // stayed fiction. Stamp the pages the boot block actually hands the model,
  // on the session's first real user message. Deliberately NOT inside the
  // `text()` callback: prompt building stays synchronous and side-effect
  // free, and nothing is stamped for a session the gates kept silent.
  if (config.trackPageAccess !== false) {
    const stamped = new Set()
    ctx.effect(() => {
      const stopCreated = ctx.on('agent/created', ({ agent }) => {
        if (!ctx.agents.roots().includes(agent)) return
        agent.ctx.effect(() => {
          const stopInserted = ctx.on('agent/inbox/inserted', ({ agent: target, message }) => {
            if (target?.id !== agent.id) return
            if (message?.source?.kind !== 'user') return
            if (stamped.has(agent.id)) return
            if (!tracker.shouldInject(agent.id, store.get())) return
            stamped.add(agent.id)
            try {
              const memoryDir = currentMemoryDir
              const block = renderBootBlock(memoryDir, { bootFiles, bootMaxChars, bootFileBudgets })
              const referenced = extractReferencedPages(block, memoryDir)
              const touched = touchPages(memoryDir, [...bootFiles, ...referenced])
              if (touched.length > 0) {
                ctx.logger?.info?.(`memory: last_access stamped on ${touched.length} page(s)`)
              }
            } catch (error) {
              ctx.logger?.warn?.(`memory: last_access stamp failed: ${error instanceof Error ? error.message : String(error)}`)
            }
          })
          return () => stopInserted?.()
        })
      })
      return () => stopCreated()
    }, 'memory.page-access()')
  }

  // Digest guard: one per live ROOT agent, so a skipped end-of-session
  // digest is caught mechanically instead of relying on the agent's
  // self-discipline. Independent of dsh-plugin-heartbeat — the nudge is
  // a plugin-source followup, queued behind whatever else the agent does.
  if (config.digestNudgeEnabled !== false) {
    ctx.effect(() => {
      const stopCreated = ctx.on('agent/created', ({ agent }) => {
        if (!ctx.agents.roots().includes(agent)) return
        const guard = new DigestGuard(agent, {
          readConfig: () => {
            const resolved = store.get()
            return {
              enabled: resolved.enabled,
              afterMinutes: config.digestNudgeAfterMinutes,
              cooldownMinutes: config.digestNudgeCooldownMinutes,
              maxPerSession: config.digestNudgeMaxPerSession,
              deferUntilUserSpeaks: resolved.deferUntilUserSpeaks,
              activeSessionOnly: resolved.activeSessionOnly,
            }
          },
          getMemoryDir: () => currentMemoryDir,
          agents: ctx.agents,
          tracker,
          logger: ctx.logger,
        })
        agent.ctx.effect(() => {
          guard.start()
          return () => {
            guard.dispose()
          }
        })
      })
      return () => stopCreated()
    }, 'memory.digest-guard()')
  }

  // Recall nudge: one per live ROOT agent, on the same idle boundary as the
  // digest guard but on a cadence (interval + per-session cap) instead of
  // store staleness. Conversational only — it never writes the store.
  if (config.recallEnabled !== false) {
    ctx.effect(() => {
      const stopCreated = ctx.on('agent/created', ({ agent }) => {
        if (!ctx.agents.roots().includes(agent)) return
        const nudge = new RecallNudge(agent, {
          readConfig: () => {
            const resolved = store.get()
            return {
              enabled: resolved.enabled && resolved.recallEnabled !== false,
              minMinutes: resolved.recallIntervalMinMinutes,
              maxMinutes: resolved.recallIntervalMaxMinutes,
              maxPerSession: resolved.recallMaxPerSession,
              deferUntilUserSpeaks: resolved.deferUntilUserSpeaks,
              activeSessionOnly: resolved.activeSessionOnly,
            }
          },
          getMemoryDir: () => currentMemoryDir,
          agents: ctx.agents,
          tracker,
          logger: ctx.logger,
        })
        agent.ctx.effect(() => {
          nudge.start()
          return () => {
            nudge.dispose()
          }
        })
      })
      return () => stopCreated()
    }, 'memory.recall-nudge()')
  }

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

    // Read-only health dashboard payload. Built fresh on every request from the
    // store on disk, so the panel always reflects the newest state and the
    // plugin never caches a stale view of the user's memory.
    const disposeInsightsRoute = webCtx.webServer.register({
      kind: 'exact',
      path: INSIGHTS_ROUTE_PATH,
      handler: async (req, res) => {
        try {
          if (req.method !== 'GET') {
            res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: 'method not allowed' }))
            return
          }
          const insights = collectInsights(currentMemoryDir)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(insights))
        } catch (error) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      },
    })
    webCtx.effect(() => disposeInsightsRoute, 'memory.insights-route()')
    ctx.logger?.info(`memory: insights route at ${INSIGHTS_ROUTE_PATH}`)

    // Read-only memory graph: the relationships `index.md` alone cannot show.
    const disposeGraphRoute = webCtx.webServer.register({
      kind: 'exact',
      path: GRAPH_ROUTE_PATH,
      handler: async (req, res) => {
        try {
          if (req.method !== 'GET') {
            res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: 'method not allowed' }))
            return
          }
          const url = new URL(req.url ?? '/', 'http://localhost')
          const includeTypeEdges = url.searchParams.get('types') === '1'
          const graph = buildMemoryGraph(currentMemoryDir, { includeTypeEdges })
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(graph))
        } catch (error) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      },
    })
    webCtx.effect(() => disposeGraphRoute, 'memory.graph-route()')
    ctx.logger?.info(`memory: graph route at ${GRAPH_ROUTE_PATH}`)
  })

  return () => {
    disposeBoot()
    disposeSkill()
    disposeCommitter()
    tracker.dispose()
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

export { renderBootBlock, ensureMemoryScaffold, SettingsSchema, MemoryConfigStore, ActivityTracker }
export { touchPages, touchPageFile, extractReferencedPages, listPagePaths, accessSummary, today }
export { collectInsights, readRecentLog } from './insights.js'
export { buildMemoryGraph, EDGE_KINDS } from './graph.js'
