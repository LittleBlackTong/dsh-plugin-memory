/**
 * Recall nudge: the "persona" half of dsh-plugin-memory.
 *
 * DigestGuard makes sure the agent WRITES memory back; this module makes it
 * USE memory like a long-term companion would — when a conversation lulls,
 * it invites the agent to surface one real, remembered fact about the user
 * in a first-person voice ("I remember / last time we…"), instead of a dry
 * status line. The delivery mechanics mirror DigestGuard (watch every ROOT
 * agent's `agent/turn-stopping` boundary, inject a synthetic followup only
 * while the agent is idle and no next-turn step is queued), but the trigger
 * is a *cadence*, not store staleness: at most `maxPerSession` recalls per
 * session, spaced by at least `intervalMinutes`.
 *
 * The nudge never invents material — it only hands the agent a few real
 * `log.md` headlines as a seed and tells it to pick one it actually
 * remembers. No store write happens here, so the recall is conversational
 * only and never mutates the memory library.
 *
 * Independent of dsh-plugin-heartbeat: lives inside dsh-plugin-memory,
 * depends on no other plugin, and queues behind the same per-agent inbox.
 *
 * @module dsh-plugin-memory/recall-nudge
 */

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseLogEntries } from './boot.js'
import {
  GROWTH_STATE_FILENAME,
  collectGrowth,
  growthRecapDue,
  renderGrowthRecap,
  writeGrowthState,
} from './growth.js'

/** Poll cadence while the agent sits idle (ms). Short enough to feel prompt, long enough to stay cheap. */
const POLL_INTERVAL_MS = 30000

/**
 * Draw a random interval in [minMinutes, maxMinutes] minutes (ms).
 * The spread makes recalls feel human rather than metronomic.
 * @param {number} minMinutes lower bound in minutes
 * @param {number} maxMinutes upper bound in minutes
 * @returns {number} milliseconds
 */
export function randomIntervalMs(minMinutes, maxMinutes) {
  const min = Math.max(0, Number(minMinutes ?? 30))
  const max = Math.max(min, Number(maxMinutes ?? min))
  return (min + Math.random() * (max - min)) * 60000
}

/**
 * Seed candidates for a recall: the most recent log.md headlines, which are
 * the closest thing to "what we've been through lately". Empty when the
 * store has no log yet — in that case there is nothing to recall and the
 * nudge stays quiet.
 * @param {string} memoryDir absolute path of the memory store
 * @param {number} count max candidates to surface (default 3)
 * @returns {string[]}
 */
export function listRecallCandidates(memoryDir, count = 3) {
  const logPath = join(memoryDir, 'log.md')
  if (!existsSync(logPath)) return []
  try {
    const text = readFileSync(logPath, 'utf8')
    return parseLogEntries(text, count)
  } catch {
    return []
  }
}

/**
 * Build the recall message in the same followup shape DigestGuard uses
 * (role 'user', content array, plugin source). The text is an invitation,
 * not a command: first-person, Small-Blue voice, explicitly bounded by
 * "only what's really in memory, never invent, don't repeat yourself".
 * @param {string[]} candidates optional seed headlines
 * @returns {{ id: string, role: 'user', content: [{type:'text', text:string}], source: {kind:'plugin:memory'} }}
 */
export function buildRecallNudgeMessage(candidates) {
  const list = Array.isArray(candidates)
    ? candidates.filter((c) => typeof c === 'string' && c.trim().length > 0)
    : []
  const seed = list.length > 0
    ? `\n可作引子（挑一条顺眼的就行，不用核对是否提过）：\n${list.map((c) => `- ${c}`).join('\n')}`
    : ''
  return {
    id: `memory-recall-${randomUUID()}`,
    role: 'user',
    content: [{
      type: 'text',
      text: [
        '【小蓝主动追忆】对话空了下来，是自然提起往事的好时机。请以「小蓝」的口吻（外松内紧、先结论后细节），主动对阿周提起一件你记得的、关于他或你们之间的事——偏好、往事、未了的决定、最近的进展都行，像老友自然想起来那样，别端着。',
        '- 只提记忆里真实存在的，绝不编造；',
        '- 用第一人称（我记得 / 上次我们…），别用「据记忆库记录」这种机器腔；',
        '- 一句到三句即可，别写成任务汇报；',
        '- 若话题正不合适，就只回一句日常状态带过，不硬聊。',
        // 2026-10-08 修 bug 的关键一句。旧文案是「换着说，别重复最近提过的」，
        // 见 test/recall-nudge.test.mjs 的 prompt-shape 三条断言。
        '- 想到哪件就直接开口说，不要先在思考里打草稿、不要排练措辞，也不要列举「已经提过哪些」来自查。',
        seed,
      ].filter(Boolean).join('\n'),
    }],
    // Session format v4 admits only a producer-owned kind. The retired
    // {kind:'plugin', plugin:'memory'} wrapper is rejected at adoption
    // ("format v4 message requires a producer-owned source kind").
    source: { kind: 'plugin:memory' },
  }
}

/**
 * Build the growth-recap followup: the weekly "what I kept this week" line,
 * delivered on the same channel as a recall and in the same message shape.
 * @param {string} recap first-person recap text from renderGrowthRecap()
 * @returns {{ id: string, role: 'user', content: [{type:'text', text:string}], source: {kind:'plugin:memory'} }}
 */
export function buildGrowthRecapNudgeMessage(recap) {
  const text = typeof recap === 'string' ? recap.trim() : ''
  return {
    id: `memory-growth-${randomUUID()}`,
    role: 'user',
    content: [{
      type: 'text',
      text: [
        '【小蓝成长回顾】距离上次回顾有一阵子了。下面是我这周真实记住的事（第一人称，最多五句）：',
        text,
        '用自然口语说给阿周听，别念成汇报、别加戏，也不要编造这里没写的事；说完继续手头的事即可。',
      ].filter(Boolean).join('\n'),
    }],
    source: { kind: 'plugin:memory' },
  }
}

/**
 * @typedef {object} RecallNudgeOptions
 * @property {() => { enabled: boolean, minMinutes: number, maxMinutes: number, maxPerSession: number, deferUntilUserSpeaks?: boolean, activeSessionOnly?: boolean, proactiveCooldownSeconds?: number }} readConfig
 * @property {() => { enabled: boolean, intervalDays: number, language?: 'zh'|'en' }} [readGrowthConfig] weekly-recap config; omitted = no recap
 * @property {(options: { now: number, cooldownSeconds: number }) => { ok: boolean, deferredBy?: string }} [claimLock] shared proactive lock (see proactive-lock.js)
 * @property {() => string} getMemoryDir resolve the current store dir on every check
 * @property {unknown} [agents] optional live-agent registry for liveness checks
 * @property {import('./activity-tracker.js').ActivityTracker} [tracker] gate source: has-user-spoken + active-session
 * @property {{ info?: Function, warn?: Function }} [logger]
 */

/**
 * One recall-nudge per live ROOT agent, lifecycle-hooked to the agent's
 * context — same pattern as DigestGuard so the two never share state but
 * both fire only on a real idle boundary.
 */
export class RecallNudge {
  /**
   * @param {object} agent live root agent (ReactLoopAgent shape: ctx, status, inbox, followup)
   * @param {RecallNudgeOptions} options
   */
  constructor(agent, options) {
    this.agent = agent
    this.readConfig = options.readConfig
    this.getMemoryDir = options.getMemoryDir
    this.agents = options.agents
    this.tracker = options.tracker
    this.logger = options.logger
    this.claimLock = options.claimLock
    this.readGrowthConfig = options.readGrowthConfig
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS
    this.disposed = false
    this.stopTurnStopping = undefined
    this.timer = undefined
    this.recalls = 0
    // 0 = "not armed yet": the first eligible idle moment arms the interval so
    // the first recall never fires instantly after the user's first turn.
    this.nextRecallAt = 0
  }

  /** Subscribe to the turn boundary AND poll while the agent sits idle. */
  start() {
    if (this.disposed) return
    this.stopTurnStopping = this.agent.ctx.on?.('agent/turn-stopping', () => {
      this.safeCheck()
    })
    // A turn boundary only fires when a turn ends; a fully idle agent never
    // produces one, so we also poll on a short interval. This is what makes
    // recall proactive (heartbeat-style) rather than turn-reactive.
    this.timer = setInterval(() => {
      this.safeCheck()
    }, this.pollIntervalMs)
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  /** Shared guard wrapper so both triggers stay exception-safe. */
  safeCheck() {
    if (this.disposed) return
    try {
      this.onTurnStopped()
    } catch (error) {
      this.logger?.warn?.(`memory: recall check failed for agent "${this.agent.id}": ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Deliver one growth recap now because the user asked for it (settings-panel
   * "review now"). Manual means: the weekly cadence is not required and the
   * per-session recall cap is not consulted, but the plugin must still be
   * enabled, the agent idle, growth material must exist, and the shared
   * speech-floor lock still wins. Never throws.
   *
   * @returns {{ delivered: boolean, reason: string }}
   */
  forceGrowthRecap() {
    if (this.disposed) return { delivered: false, reason: 'disposed' }
    if (this.agents && this.agents.get(this.agent.id) !== this.agent) return { delivered: false, reason: 'agent-gone' }
    let config
    try {
      config = this.readConfig()
    } catch (error) {
      this.logger?.warn?.(`memory: growth-now config read failed: ${error instanceof Error ? error.message : String(error)}`)
      return { delivered: false, reason: 'error' }
    }
    if (!config || config.enabled !== true) return { delivered: false, reason: 'disabled' }
    if (this.agent.status !== 'idle') return { delivered: false, reason: 'busy' }
    if (typeof this.readGrowthConfig !== 'function') return { delivered: false, reason: 'growth-disabled' }
    let growthConfig
    try {
      growthConfig = this.readGrowthConfig()
    } catch {
      return { delivered: false, reason: 'growth-disabled' }
    }
    if (!growthConfig || growthConfig.enabled !== true) return { delivered: false, reason: 'growth-disabled' }
    const now = Date.now()
    try {
      const storeDir = this.getMemoryDir()
      const intervalDays = Math.max(1, Number(growthConfig.intervalDays ?? 7))
      const growth = collectGrowth({ storeDir, sinceDays: intervalDays, max: 5, now })
      if (growth.entries.length === 0 && growth.pagesChanged === 0) return { delivered: false, reason: 'no-content' }
      const recap = renderGrowthRecap({
        ...growth,
        language: growthConfig.language === 'en' ? 'en' : 'zh',
      })
      if (recap.length === 0) return { delivered: false, reason: 'no-content' }
      const claim = this.claimProactive(now, config)
      if (!claim.ok) return { delivered: false, reason: 'deferred', deferredBy: claim.deferredBy }
      try {
        writeGrowthState(join(storeDir, GROWTH_STATE_FILENAME), now)
      } catch (error) {
        this.logger?.warn?.(`memory: growth-now state write failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      this.agent.followup(buildGrowthRecapNudgeMessage(recap))
      this.recalls += 1
      return { delivered: true, reason: 'delivered' }
    } catch (error) {
      this.logger?.warn?.(`memory: growth-now failed: ${error instanceof Error ? error.message : String(error)}`)
      return { delivered: false, reason: 'error' }
    }
  }

  /** Cancel subscriptions and the poll timer; the nudge stops observing. */
  dispose() {
    this.disposed = true
    this.stopTurnStopping?.()
    this.stopTurnStopping = undefined
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  /** Evaluate whether a recall is due right now. */
  onTurnStopped() {
    if (this.disposed) return
    if (this.agents && this.agents.get(this.agent.id) !== this.agent) {
      this.dispose()
      return
    }
    const config = this.readConfig()
    if (!config.enabled || config.recallEnabled === false) return
    // Both gates: don't recall before the user has spoken, and only for the
    // currently active session (most recent user message).
    if (this.tracker && !this.tracker.shouldInject(this.agent.id, config)) return
    if (this.recalls >= Math.max(1, Number(config.maxPerSession ?? 3))) return
    if (this.agent.status !== 'idle') return
    const inbox = this.agent.inbox
    if (inbox && Array.isArray(inbox.nextStep) && inbox.nextStep.length > 0) return

    const now = Date.now()
    if (this.nextRecallAt === 0) {
      // First eligible idle moment: arm the interval from here instead of
      // firing instantly (the pre-gate bug). Returns so the next check honors it.
      this.nextRecallAt = now + randomIntervalMs(config.minMinutes, config.maxMinutes)
      return
    }
    if (now < this.nextRecallAt) return

    // Growth recap first: when the week is due it replaces this recall, but it
    // shares the same cadence, per-session cap and arbitration lock.
    const growth = this.planGrowth(now)
    if (growth !== undefined) {
      const claim = this.claimProactive(now, config)
      if (!claim.ok) {
        this.logger?.info?.(`memory: growth recap deferred for agent "${this.agent.id}" (${claim.deferredBy} holds the lock)`)
        return // next trigger retries; the cadence is not consumed
      }
      try {
        writeGrowthState(growth.statePath, now)
      } catch (error) {
        // Losing the timestamp only means the recap may repeat; it must not
        // eat the message the user was about to see.
        this.logger?.warn?.(`memory: growth recap state write failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      this.agent.followup(growth.message)
      this.nextRecallAt = now + randomIntervalMs(config.minMinutes, config.maxMinutes)
      this.recalls += 1
      this.logger?.info?.(`memory: growth recap #${this.recalls} for agent "${this.agent.id}"`)
      return
    }

    const candidates = listRecallCandidates(this.getMemoryDir(), 3)
    if (candidates.length === 0) return

    const claim = this.claimProactive(now, config)
    if (!claim.ok) {
      this.logger?.info?.(`memory: recall deferred for agent "${this.agent.id}" (${claim.deferredBy} holds the lock)`)
      return // next trigger retries; the cadence is not consumed
    }

    this.agent.followup(buildRecallNudgeMessage(candidates))
    this.nextRecallAt = now + randomIntervalMs(config.minMinutes, config.maxMinutes)
    this.recalls += 1
    this.logger?.info?.(`memory: recall nudge #${this.recalls} for agent "${this.agent.id}"`)
  }

  /**
   * Ask the shared proactive lock for permission to speak. A missing lock
   * (no other proactive plugin installed) or a broken/unwritable lock file
   * never blocks the message: arbitration is best-effort, not a gate.
   * @param {number} now epoch ms
   * @param {{ proactiveCooldownSeconds?: number }} config
   * @returns {{ ok: boolean, deferredBy?: string }}
   */
  claimProactive(now, config) {
    if (typeof this.claimLock !== 'function') return { ok: true }
    try {
      const result = this.claimLock({
        now,
        cooldownSeconds: Math.max(0, Number(config.proactiveCooldownSeconds ?? 180)),
      })
      return result ?? { ok: true }
    } catch (error) {
      this.logger?.warn?.(`memory: proactive lock failed: ${error instanceof Error ? error.message : String(error)}`)
      return { ok: true }
    }
  }

  /**
   * Plan a weekly growth recap, or undefined when it is not due / has nothing
   * to say. Reads only the store; never throws (a broken recap must fall
   * through to the normal recall path).
   * @param {number} now epoch ms
   * @returns {{ message: object, statePath: string } | undefined}
   */
  planGrowth(now) {
    if (typeof this.readGrowthConfig !== 'function') return undefined
    let growthConfig
    try {
      growthConfig = this.readGrowthConfig()
    } catch (error) {
      this.logger?.warn?.(`memory: growth config unavailable: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
    if (!growthConfig || growthConfig.enabled !== true) return undefined
    try {
      const storeDir = this.getMemoryDir()
      const intervalDays = Math.max(1, Number(growthConfig.intervalDays ?? 7))
      const statePath = join(storeDir, GROWTH_STATE_FILENAME)
      if (!growthRecapDue({ statePath, intervalDays, now })) return undefined
      const growth = collectGrowth({ storeDir, sinceDays: intervalDays, max: 5, now })
      if (growth.entries.length === 0 && growth.pagesChanged === 0) return undefined
      const recap = renderGrowthRecap({
        ...growth,
        language: growthConfig.language === 'en' ? 'en' : 'zh',
      })
      if (recap.length === 0) return undefined
      return { statePath, message: buildGrowthRecapNudgeMessage(recap) }
    } catch (error) {
      this.logger?.warn?.(`memory: growth recap skipped: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }
}
