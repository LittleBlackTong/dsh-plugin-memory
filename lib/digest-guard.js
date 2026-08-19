/**
 * Digest guard: mechanical insurance against the agent "getting lazy" and
 * skipping the end-of-session memory digest.
 *
 * The operator protocol (skills/memory.md) already makes digest an explicit
 * duty, but instructions alone are not a guarantee — one skipped digest and
 * key facts evaporate. This module closes that gap with the same delivery
 * mechanics the harness's own heartbeat-style plugins use: it watches every
 * ROOT agent's `agent/turn-stopping` boundary and, when the agent is idle
 * and the memory store has not been written for a while, injects a synthetic
 * user-role reminder via `agent.followup()`. The agent then has a real turn
 * to run `remember`; writing log.md/index.md refreshes the store mtime and
 * the reminder stays quiet until the cooldown expires.
 *
 * Independent of dsh-plugin-heartbeat: this lives inside dsh-plugin-memory,
 * depends on no other plugin, and both plugins' messages simply take turns
 * in the same per-agent inbox queue.
 *
 * @module dsh-plugin-memory/digest-guard
 */

import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** A digest must touch these files; their mtime is the freshness signal. */
export const DIGEST_MARKER_FILES = ['log.md', 'index.md']

/**
 * Latest mtime (ms epoch) across the digest marker files.
 * @param {string} memoryDir
 * @returns {number} 0 when none of the markers exist or can be read
 */
export function lastStoreWriteMs(memoryDir) {
  let latest = 0
  for (const name of DIGEST_MARKER_FILES) {
    const path = join(memoryDir, name)
    if (!existsSync(path)) continue
    try {
      latest = Math.max(latest, statSync(path).mtimeMs)
    } catch {
      // unreadable marker: treat as missing
    }
  }
  return latest
}

/**
 * Build the nudge message in the exact shape `dsh-agent-loop` expects for
 * `followup()` (role 'user', content array, plugin source).
 * @param {number} staleMinutes how long the store has been unwritten
 * @returns {{ id: string, role: 'user', content: [{type:'text', text:string}], source: {kind:'plugin', plugin:string} }}
 */
export function buildDigestNudgeMessage(staleMinutes) {
  return {
    id: `memory-digest-${randomUUID()}`,
    role: 'user',
    content: [{
      type: 'text',
      text: [
        `【记忆 digest 提醒】距上次记忆写入已超过 ${staleMinutes} 分钟。`,
        '请现在执行 remember 沉淀：把本次会话值得持久化的关键事实、偏好、决策写回记忆库（更新对应页面与 index.md，并追加 log.md 条目）。',
        '若本会话确实没有值得持久化的内容，也在 log.md 记一条「## [日期] digest | 无新增」并说明原因——这同样会解除提醒。',
        '完成后继续手头的事即可，不要开启新任务。',
      ].join('\n'),
    }],
    source: { kind: 'plugin', plugin: 'memory' },
  }
}

/**
 * @typedef {object} DigestGuardOptions
 * @property {() => { enabled: boolean, afterMinutes: number, cooldownMinutes: number, maxPerSession: number }} readConfig
 * @property {() => string} getMemoryDir resolve the current store dir on every check
 * @property {unknown} [agents] optional live-agent registry for liveness checks
 * @property {{ info?: Function, warn?: Function }} [logger]
 */

/**
 * One guard per live ROOT agent, lifecycle-hooked to the agent's context.
 */
export class DigestGuard {
  /**
   * @param {object} agent live root agent (ReactLoopAgent shape: ctx, status, inbox, followup)
   * @param {DigestGuardOptions} options
   */
  constructor(agent, options) {
    this.agent = agent
    this.readConfig = options.readConfig
    this.getMemoryDir = options.getMemoryDir
    this.agents = options.agents
    this.logger = options.logger
    this.disposed = false
    this.stopTurnStopping = undefined
    this.nudges = 0
    this.lastNudgeAt = 0
  }

  /** Subscribe to the agent's turn boundary. */
  start() {
    if (this.disposed) return
    this.stopTurnStopping = this.agent.ctx.on?.('agent/turn-stopping', () => {
      try {
        this.onTurnStopped()
      } catch (error) {
        this.logger?.warn?.(`memory: digest check failed for agent "${this.agent.id}": ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }

  /** Cancel subscriptions; the guard stops observing. */
  dispose() {
    this.disposed = true
    this.stopTurnStopping?.()
    this.stopTurnStopping = undefined
  }

  /** Evaluate whether a digest reminder is due right now. */
  onTurnStopped() {
    if (this.disposed) return
    if (this.agents && this.agents.get(this.agent.id) !== this.agent) {
      this.dispose()
      return
    }
    const config = this.readConfig()
    if (!config.enabled) return
    if (this.nudges >= Math.max(1, Number(config.maxPerSession ?? 2))) return
    if (this.agent.status !== 'idle') return
    const inbox = this.agent.inbox
    if (inbox && Array.isArray(inbox.nextStep) && inbox.nextStep.length > 0) return

    const now = Date.now()
    const cooldownMs = Math.max(0, Number(config.cooldownMinutes ?? 180)) * 60000
    if (now - this.lastNudgeAt < cooldownMs) return

    const afterMs = Math.max(1, Number(config.afterMinutes ?? 120)) * 60000
    const lastWrite = lastStoreWriteMs(this.getMemoryDir())
    if (now - lastWrite < afterMs) return

    const staleMinutes = Math.max(1, Math.round((now - lastWrite) / 60000))
    this.agent.followup(buildDigestNudgeMessage(staleMinutes))
    this.lastNudgeAt = now
    this.nudges += 1
    this.logger?.info?.(`memory: digest nudge #${this.nudges} for agent "${this.agent.id}" (store idle ${staleMinutes}min)`)
  }
}
