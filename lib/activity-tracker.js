/**
 * Per-agent activity tracker: the two gates that keep memory injection polite.
 *
 * 1. **`hasUserSpoken(id)`** — becomes true on the first REAL user message
 *    (`source.kind === 'user'`). Gates "don't inject until the user actually
 *    asks something".
 * 2. **`isActive(id)`** — the live root agent that most recently received a
 *    real user message. Gates "only the currently active session injects".
 *
 * The host has no "focused session" signal (that is a browser-side concept),
 * so "active" is proxied by the most recent user message — a session the user
 * is not talking to stops being active the moment they speak elsewhere.
 *
 * `shouldInject(id, config)` folds both gates (plus the config toggles) into
 * one predicate, shared by the boot block, the recall nudge and the digest
 * guard so the three never disagree.
 *
 * @module dsh-plugin-memory/activity-tracker
 */

/**
 * @typedef {object} ActivityTrackerOptions
 * @property {unknown} [agents] optional live-agent registry, used only to skip
 *   disposed agents when deciding the active one
 * @property {{ info?: Function, warn?: Function }} [logger]
 */

export class ActivityTracker {
  constructor(options = {}) {
    this.agents = options.agents
    this.logger = options.logger
    /** @type {Map<string, { agent: object, hasUserSpoken: boolean, lastUserSeq: number, stop?: Function }>} */
    this.states = new Map()
    this.seq = 0
    this.disposed = false
  }

  /**
   * Wire one live root agent's inbox feed into the tracker. Idempotent per
   * agent identity.
   * @param {object} agent live agent ({ id, ctx })
   */
  attach(agent) {
    const existing = this.states.get(agent.id)
    if (existing && existing.agent === agent) return
    const entry = { agent, hasUserSpoken: false, lastUserSeq: 0, stop: undefined }
    entry.stop = agent.ctx?.on?.('agent/inbox/inserted', ({ message }) => {
      if (message?.source?.kind === 'user') this.noteUserMessage(agent.id)
    })
    this.states.set(agent.id, entry)
  }

  /** Record a real user message against one agent (monotonic order). */
  noteUserMessage(id) {
    const entry = this.states.get(id)
    if (!entry) return
    entry.hasUserSpoken = true
    entry.lastUserSeq = ++this.seq
  }

  /** Unsubscribe and drop one agent's state. */
  detach(id) {
    const entry = this.states.get(id)
    if (!entry) return
    try {
      entry.stop?.()
    } catch (error) {
      this.logger?.warn?.(`memory: detach listener failed for "${id}": ${error instanceof Error ? error.message : String(error)}`)
    }
    this.states.delete(id)
  }

  /** Whether the agent has ever received a real user message. */
  hasUserSpoken(id) {
    return this.states.get(id)?.hasUserSpoken === true
  }

  /**
   * Whether `id` is the live agent that most recently received a real user
   * message. A never-spoken-to agent is never active.
   */
  isActive(id) {
    const entry = this.states.get(id)
    if (!entry || !entry.hasUserSpoken) return false
    let winner
    let latest = 0
    for (const [agentId, state] of this.states) {
      if (!state.hasUserSpoken) continue
      if (this.agents && this.agents.get(agentId) === undefined) continue
      if (state.lastUserSeq > latest) {
        latest = state.lastUserSeq
        winner = agentId
      }
    }
    return winner === id
  }

  /**
   * Fold the two gates + config toggles into one predicate. With both toggles
   * off, always inject (backward compatible).
   * @param {string} id agent id
   * @param {{ deferUntilUserSpeaks?: boolean, activeSessionOnly?: boolean }} config
   */
  shouldInject(id, config = {}) {
    if (config.deferUntilUserSpeaks !== false && !this.hasUserSpoken(id)) return false
    if (config.activeSessionOnly !== false && !this.isActive(id)) return false
    return true
  }

  /** Detach every tracked agent. */
  dispose() {
    this.disposed = true
    for (const id of [...this.states.keys()]) this.detach(id)
  }
}
