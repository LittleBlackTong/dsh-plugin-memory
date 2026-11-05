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
 * | `proactiveCooldownSeconds` | `180` | shared proactive-speech lock with heartbeat (0 = off) |
 * | `toneGuideEnabled` | `true` | inject the context-sensitive tone section after SOUL |
 * | `toneIntensity` | `low` | `low` / `medium` / `off` (pure engineering voice) |
 * | `growthRecapEnabled` | `true` | weekly growth recap on the recall channel |
 * | `growthRecapIntervalDays` | `7` | days between growth recaps |
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
import { renderBootBlock, DEFAULT_BOOT_FILES, needsSoulBootstrap, readBootstrapStatus } from './boot.js'
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
import { buildToneGuide } from './tone.js'
import { claimProactiveLock, defaultProactiveCooldownPath } from './proactive-lock.js'
import { AutoCommitter } from './autocommit.js'
import { ActivityTracker } from './activity-tracker.js'
import { SessionGate, expandHome, matchesWorkspace } from './session-gate.js'
import { markBootstrapComplete, readSoulProfile, writeSoulProfile } from './soul.js'
import { resolveMemoryFile, revealFile } from './reveal.js'
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
export const CONTROL_ROUTE_PATH = '/api/memory/control'

/** Per-session memory gate: GET the state, POST a toggle. */
export const SESSION_ROUTE_PATH = '/api/memory/session'

/** Basic soul profile (managed SOUL.md block): GET the fields, POST a save. */
export const SOUL_ROUTE_PATH = '/api/memory/soul'

/** Reveal one memory page in the OS file manager (Finder/Explorer/xdg). */
export const REVEAL_ROUTE_PATH = '/api/memory/reveal'

/** Resolve one memory page to its absolute path (copy-path fallback). */
export const PATH_ROUTE_PATH = '/api/memory/path'

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
  // Shared proactive-speech arbitration with dsh-plugin-heartbeat: one JSON
  // file, claimed before any synthetic followup. 180s default; 0 = off.
  proactiveCooldownSeconds: z.number().default(180),
  // Tone drift: inject a bounded "how to shift register by context" section
  // after SOUL. `off` restores the pre-0.12.0 boot block exactly.
  toneGuideEnabled: z.boolean().default(true),
  toneIntensity: z.union([z.const('low'), z.const('medium'), z.const('off')]).default('low'),
  // Weekly growth recap, delivered on the recall channel.
  growthRecapEnabled: z.boolean().default(true),
  growthRecapIntervalDays: z.number().default(7),
  // Workspaces that default to memory off: sessions whose cwd falls inside
  // one of these roots start muted. A per-session override (the composer chip
  // or `/memory on`) still wins, so this is a default, not a hard block.
  disabledWorkspaces: z.array(z.string()).default([]),
  // Where per-session overrides live (default `<dshHome>/memory-sessions.json`).
  sessionStateFile: z.union([z.string(), z.const(undefined)]),
  // Days a session override stays valid before it is pruned. Default 7.
  sessionTtlDays: z.number().default(7),
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
  const expanded = expandHome(dir)
  return resolve(expanded ?? dir)
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
      proactiveCooldownSeconds: config.proactiveCooldownSeconds ?? 180,
      toneGuideEnabled: config.toneGuideEnabled !== false,
      toneIntensity: ['low', 'medium', 'off'].includes(config.toneIntensity) ? config.toneIntensity : 'low',
      growthRecapEnabled: config.growthRecapEnabled !== false,
      growthRecapIntervalDays: config.growthRecapIntervalDays ?? 7,
      disabledWorkspaces: Array.isArray(config.disabledWorkspaces) ? config.disabledWorkspaces : [],
    },
  })

  // Per-agent activity tracker: the single source of truth for both gates.
  // Created before `rebuild()` so the boot block's `text` closure can consult
  // it, and shared with the digest guard + recall nudge so they never disagree.
  const tracker = new ActivityTracker({ agents: ctx.agents, logger: ctx.logger })

  // Per-session memory gate: a session can opt out even while the plugin is
  // on, and whole workspaces can default to off. Precedence: global switch >
  // session override > disabledWorkspaces > on. Shared by the boot block,
  // page-access stamping, the digest guard and the recall nudge.
  const sessionGate = new SessionGate({
    path: typeof config.sessionStateFile === 'string' && config.sessionStateFile.trim().length > 0
      ? config.sessionStateFile
      : undefined,
    ttlDays: config.sessionTtlDays,
  })
  const sessionCwd = (agent) => agent?.session?.header?.cwd
  const sessionEnabled = (agent, resolved) => sessionGate.effectiveEnabled(
    agent.id,
    sessionCwd(agent),
    { globalEnabled: resolved.enabled, disabledWorkspaces: resolved.disabledWorkspaces },
  )
  const describeSession = (agent, resolved) => {
    const cwd = sessionCwd(agent)
    return {
      sessionId: agent.id,
      cwd,
      override: sessionGate.getOverride(agent.id),
      workspaceDisabled: matchesWorkspace(cwd, resolved.disabledWorkspaces),
      globalEnabled: resolved.enabled !== false,
      effective: sessionGate.effectiveEnabled(agent.id, cwd, {
        globalEnabled: resolved.enabled,
        disabledWorkspaces: resolved.disabledWorkspaces,
      }),
    }
  }
  const setWorkspaceDefault = (resolved, cwd, off) => {
    if (typeof cwd !== 'string' || cwd.trim().length === 0) return false
    const current = Array.isArray(resolved.disabledWorkspaces) ? resolved.disabledWorkspaces : []
    const without = current.filter((entry) => entry !== cwd)
    store.update({ disabledWorkspaces: off ? [...without, cwd] : without })
    return true
  }
  const handleMemoryCommand = (agent, rawInput) => {
    const resolved = store.get()
    const arg = String(rawInput ?? '').trim().toLowerCase()
    const cwd = sessionCwd(agent)
    if (arg === '' || arg === 'status') {
      const status = describeSession(agent, resolved)
      return {
        kind: 'success',
        text: `Memory is ${status.effective ? 'ON' : 'OFF'} for this session`
          + (status.workspaceDisabled ? ' (this workspace defaults to OFF)' : '')
          + (status.override !== undefined ? ' [explicit session override]' : ''),
      }
    }
    if (arg === 'on' || arg === 'off') {
      sessionGate.setOverride(agent.id, arg === 'on', cwd)
      return { kind: 'success', text: `Memory is now ${arg.toUpperCase()} for this session.` }
    }
    if (arg === 'workspace-off' || arg === 'workspace-on') {
      if (!setWorkspaceDefault(resolved, cwd, arg === 'workspace-off')) {
        return { kind: 'error', text: 'This session has no workspace directory to remember.' }
      }
      return {
        kind: 'success',
        text: arg === 'workspace-off'
          ? `This workspace (${cwd}) now defaults to memory OFF.`
          : `This workspace (${cwd}) no longer defaults to memory OFF.`,
      }
    }
    return { kind: 'error', text: 'Usage: /memory [on|off|status|workspace-off|workspace-on]' }
  }

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
          const resolved = store.get()
          const agent = context?.agent
          // User intent first (the session switch), then the two polite gates.
          if (agent && !sessionEnabled(agent, resolved)) return ''
          if (agent && !tracker.shouldInject(agent.id, resolved)) return ''
          // Tone drift rides on the boot block (charged to its budget). Read
          // live from the store so the Settings select applies on the next
          // prompt build without a reload.
          const toneGuide = resolved.toneGuideEnabled
            ? buildToneGuide({ intensity: resolved.toneIntensity, language: 'zh' })
            : ''
          return renderBootBlock(memoryDir, { bootFiles, bootMaxChars, bootFileBudgets, toneGuide })
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

  // Human command plane: `/memory on|off|status|workspace-off|workspace-on`.
  // Commands never enter the model context (the host executes them in the UI
  // command plane), and the handler's `agent` is the session the command ran
  // in. Optional injection keeps older hosts without a commands service alive.
  ctx.inject(['commands'], (cmdCtx) => {
    cmdCtx.effect(() => {
      const dispose = cmdCtx.commands.register({
        name: 'memory',
        description: 'Turn long-term memory on/off for this session (/memory on|off|status)',
        handler: ({ agent, rawInput }) => handleMemoryCommand(agent, rawInput),
      })
      return () => {
        dispose?.()
      }
    }, 'memory.command()')
  })

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
            const resolved = store.get()
            if (!sessionEnabled(agent, resolved)) return
            if (!tracker.shouldInject(agent.id, resolved)) return
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

  /** Claim the cross-plugin proactive lock (see lib/proactive-lock.js). */
  const claimSharedProactiveLock = ({ now, cooldownSeconds }) => claimProactiveLock({
    path: defaultProactiveCooldownPath(),
    speaker: 'memory',
    cooldownSeconds,
    now,
  })

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
              enabled: resolved.enabled && sessionEnabled(agent, resolved),
              afterMinutes: config.digestNudgeAfterMinutes,
              cooldownMinutes: config.digestNudgeCooldownMinutes,
              maxPerSession: config.digestNudgeMaxPerSession,
              deferUntilUserSpeaks: resolved.deferUntilUserSpeaks,
              activeSessionOnly: resolved.activeSessionOnly,
              proactiveCooldownSeconds: resolved.proactiveCooldownSeconds,
            }
          },
          getMemoryDir: () => currentMemoryDir,
          agents: ctx.agents,
          tracker,
          logger: ctx.logger,
          claimLock: claimSharedProactiveLock,
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
  // Live recall nudges by agent id: the settings-panel "review now" button
  // reaches them through /api/memory/control (manual growth recap).
  const nudges = new Map()
  {
    ctx.effect(() => {
      const stopCreated = ctx.on('agent/created', ({ agent }) => {
        if (!ctx.agents.roots().includes(agent)) return
        const nudge = new RecallNudge(agent, {
          readConfig: () => {
            const resolved = store.get()
            return {
              enabled: resolved.enabled && sessionEnabled(agent, resolved),
              recallEnabled: resolved.recallEnabled !== false,
              minMinutes: resolved.recallIntervalMinMinutes,
              maxMinutes: resolved.recallIntervalMaxMinutes,
              maxPerSession: resolved.recallMaxPerSession,
              deferUntilUserSpeaks: resolved.deferUntilUserSpeaks,
              activeSessionOnly: resolved.activeSessionOnly,
              proactiveCooldownSeconds: resolved.proactiveCooldownSeconds,
            }
          },
          readGrowthConfig: () => {
            const resolved = store.get()
            return {
              enabled: resolved.growthRecapEnabled !== false,
              intervalDays: resolved.growthRecapIntervalDays,
              language: 'zh',
            }
          },
          getMemoryDir: () => currentMemoryDir,
          agents: ctx.agents,
          tracker,
          logger: ctx.logger,
          claimLock: claimSharedProactiveLock,
        })
        nudges.set(agent.id, nudge)
        agent.ctx.effect(() => {
          nudge.start()
          return () => {
            nudges.delete(agent.id)
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

    // Manual proactive controls: today only "review my week now", which rides
    // the same recall channel as the weekly recap (same message shape, same
    // arbitration lock) but ignores the weekly cadence because the user asked.
    const disposeControlRoute = webCtx.webServer.register({
      kind: 'exact',
      path: CONTROL_ROUTE_PATH,
      handler: async (req, res) => {
        try {
          if (req.method !== 'POST') {
            res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: 'method not allowed' }))
            return
          }
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          let body
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          } catch {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: 'body must be JSON' }))
            return
          }
          const action = typeof body?.action === 'string' ? body.action : ''
          if (action !== 'growth-now') {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: `unknown action ${JSON.stringify(action)}` }))
            return
          }
          const wanted = typeof body?.sessionId === 'string' ? body.sessionId : undefined
          const candidates = [...nudges.entries()]
            .filter(([id]) => wanted === undefined || id === wanted)
            .map(([id, nudge]) => ({ id, nudge }))
            // Prefer the session the user most recently spoke in; the settings
            // panel has no session id of its own, so without this a recap could
            // land in a background conversation.
            .sort((a, b) => {
              const rank = (entry) => (typeof tracker?.isActive === 'function' && tracker.isActive(entry.id) ? 1 : 0)
              return rank(b) - rank(a)
            })
            .map((entry) => entry.nudge)
          if (candidates.length === 0) {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: true, delivered: false, reason: 'no-session' }))
            return
          }
          let last = { delivered: false, reason: 'no-session' }
          for (const nudge of candidates) {
            last = nudge.forceGrowthRecap()
            if (last.delivered) break
          }
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(last.delivered ? { ok: true, delivered: true } : { ok: true, delivered: false, reason: last.reason }))
        } catch (error) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      },
    })
    webCtx.effect(() => disposeControlRoute, 'memory.control-route()')

    // Per-session gate route: the composer chip and the Settings panel both
    // read and write it. A missing sessionId means "the active session" — the
    // same proxy /api/memory/control uses (the panel has no session id of its
    // own; the browser chip always passes one).
    const disposeSessionRoute = webCtx.webServer.register({
      kind: 'exact',
      path: SESSION_ROUTE_PATH,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const resolveAgent = (sessionId) => {
            const id = typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : tracker.activeId()
            if (id === undefined) return undefined
            const direct = ctx.agents.get?.(id)
            if (direct !== undefined) return direct
            // Some hosts key the registry differently from the session id the
            // client sends; scanning the roots keeps the chip working either way.
            const roots = typeof ctx.agents.roots === 'function' ? ctx.agents.roots() : []
            return roots.find((agent) => agent.id === id
              || agent.session?.header?.id === id
              || agent.session?.id === id)
          }
          const sendJson = (status, payload) => {
            res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(payload))
          }
          if (req.method === 'GET') {
            const agent = resolveAgent(url.searchParams.get('sessionId') ?? undefined)
            if (agent === undefined) {
              sendJson(200, { ok: false, reason: 'no-session' })
              return
            }
            sendJson(200, { ok: true, ...describeSession(agent, store.get()) })
            return
          }
          if (req.method === 'POST') {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            let body
            try {
              body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
            } catch {
              sendJson(400, { error: 'body must be JSON' })
              return
            }
            const agent = resolveAgent(typeof body?.sessionId === 'string' ? body.sessionId : undefined)
            if (agent === undefined) {
              sendJson(200, { ok: false, reason: 'no-session' })
              return
            }
            const action = typeof body?.action === 'string' ? body.action : ''
            const resolved = store.get()
            const cwd = sessionCwd(agent)
            if (action === 'toggle') sessionGate.toggle(agent.id, undefined, cwd)
            else if (action === 'on' || action === 'off') sessionGate.setOverride(agent.id, action === 'on', cwd)
            else if (action === 'clear') sessionGate.clearOverride(agent.id)
            else if (action === 'workspace-off' || action === 'workspace-on') {
              if (!setWorkspaceDefault(resolved, cwd, action === 'workspace-off')) {
                sendJson(400, { error: 'this session has no workspace directory' })
                return
              }
            } else {
              sendJson(400, { error: `unknown action ${JSON.stringify(action)}` })
              return
            }
            sendJson(200, { ok: true, ...describeSession(agent, store.get()) })
            return
          }
          sendJson(405, { error: 'method not allowed' })
        } catch (error) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      },
    })
    webCtx.effect(() => disposeSessionRoute, 'memory.session-route()')
    ctx.logger?.info(`memory: session route at ${SESSION_ROUTE_PATH}`)

    // Basic soul profile: the Settings panel's card edits three fields inside
    // SOUL.md's managed block. Saving also marks BOOTSTRAP complete, so a user
    // who never chats about their soul stops seeing the forging nudge.
    const disposeSoulRoute = webCtx.webServer.register({
      kind: 'exact',
      path: SOUL_ROUTE_PATH,
      handler: async (req, res) => {
        try {
          const sendJson = (status, payload) => {
            res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(payload))
          }
          if (req.method === 'GET') {
            sendJson(200, {
              ok: true,
              profile: readSoulProfile(currentMemoryDir),
              bootstrapStatus: readBootstrapStatus(currentMemoryDir),
              needsBootstrap: needsSoulBootstrap(currentMemoryDir),
            })
            return
          }
          if (req.method === 'POST') {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            let body
            try {
              body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
            } catch {
              sendJson(400, { error: 'body must be JSON' })
              return
            }
            const profile = writeSoulProfile(currentMemoryDir, {
              agentName: body?.agentName,
              userName: body?.userName,
              summary: body?.summary,
            })
            const bootstrapChanged = markBootstrapComplete(currentMemoryDir)
            sendJson(200, {
              ok: true,
              profile,
              bootstrapChanged,
              bootstrapStatus: readBootstrapStatus(currentMemoryDir),
            })
            return
          }
          sendJson(405, { error: 'method not allowed' })
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      },
    })
    webCtx.effect(() => disposeSoulRoute, 'memory.soul-route()')
    ctx.logger?.info(`memory: soul route at ${SOUL_ROUTE_PATH}`)

    // 双击图谱节点 → 在系统文件管理器里定位这份记忆页。路径在 reveal.js 里
    // 做 realpath 边界校验，越界或非文件一律拒绝。
    const disposeRevealRoute = webCtx.webServer.register({
      kind: 'exact',
      path: REVEAL_ROUTE_PATH,
      handler: async (req, res) => {
        const sendJson = (status, payload) => {
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(payload))
        }
        try {
          if (req.method !== 'POST') {
            sendJson(405, { error: 'method not allowed' })
            return
          }
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          let body
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          } catch {
            sendJson(400, { error: 'body must be JSON' })
            return
          }
          const result = await revealFile(currentMemoryDir, body?.id)
          sendJson(200, { ok: true, path: result.path })
        } catch (error) {
          const status = error?.code === 'invalid-id' ? 400 : 500
          sendJson(status, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    })
    webCtx.effect(() => disposeRevealRoute, 'memory.reveal-route()')
    ctx.logger?.info(`memory: reveal route at ${REVEAL_ROUTE_PATH}`)

    // 复制路径兜底：只解析绝对路径，不执行任何命令。reveal 失败时客户端
    // 用它把路径写进剪贴板，用户自己在文件管理器里跳过去。
    const disposePathRoute = webCtx.webServer.register({
      kind: 'exact',
      path: PATH_ROUTE_PATH,
      handler: async (req, res) => {
        const sendJson = (status, payload) => {
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(payload))
        }
        try {
          if (req.method !== 'GET') {
            sendJson(405, { error: 'method not allowed' })
            return
          }
          const url = new URL(req.url ?? PATH_ROUTE_PATH, 'http://localhost')
          const path = resolveMemoryFile(currentMemoryDir, url.searchParams.get('id'))
          sendJson(200, { ok: true, path })
        } catch (error) {
          sendJson(400, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    })
    webCtx.effect(() => disposePathRoute, 'memory.path-route()')
    ctx.logger?.info(`memory: path route at ${PATH_ROUTE_PATH}`)

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
          const includeSuggestions = url.searchParams.get('suggest') === '1'
          const graph = buildMemoryGraph(currentMemoryDir, { includeTypeEdges, includeSuggestions })
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

export { renderBootBlock, ensureMemoryScaffold, SettingsSchema, MemoryConfigStore, ActivityTracker, SessionGate }
export { touchPages, touchPageFile, extractReferencedPages, listPagePaths, accessSummary, today }
export { collectInsights, readRecentLog } from './insights.js'
export { buildMemoryGraph, EDGE_KINDS } from './graph.js'
export { buildToneGuide, TONE_INTENSITIES, TONE_GUIDE_MAX_LINES } from './tone.js'
export { claimProactiveLock, readProactiveLock, defaultProactiveCooldownPath } from './proactive-lock.js'
export { collectGrowth, renderGrowthRecap, growthRecapDue } from './growth.js'
