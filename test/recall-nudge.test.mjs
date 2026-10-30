import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  RecallNudge,
  buildRecallNudgeMessage,
  listRecallCandidates,
  randomIntervalMs,
} from '../lib/recall-nudge.js'
import { ActivityTracker } from '../lib/activity-tracker.js'

/** Fake root agent with the surface RecallNudge + ActivityTracker touch. */
function makeAgent({ id = 'root-1', status = 'idle', nextStep = [] } = {}) {
  const listeners = new Map()
  const agent = {
    id,
    status,
    inbox: { nextStep },
    followups: [],
    ctx: {
      on(event, cb) {
        listeners.set(event, cb)
        return () => listeners.delete(event)
      },
    },
    followup(message) {
      this.followups.push(message)
    },
  }
  agent.emitTurnStopped = () => listeners.get('agent/turn-stopping')?.()
  agent.emitInboxInserted = (message) => listeners.get('agent/inbox/inserted')?.({ message })
  return agent
}

const LOG_TEXT = [
  '# log',
  '',
  '## [2026-08-18] project | dsh-plugin-memory 已发布 npm',
  '## [2026-08-19] fix | 心跳插件 v0.1.1：设置面板区块',
].join('\n')

/** Create a store dir; `withLog=false` simulates an empty store. */
function makeStore(withLog = true) {
  const dir = mkdtempSync(join(tmpdir(), 'memory-recall-'))
  if (withLog) writeFileSync(join(dir, 'log.md'), LOG_TEXT, 'utf8')
  return dir
}

function makeNudge(agent, dir, overrides = {}, tracker, extra = {}) {
  const config = {
    enabled: true,
    minMinutes: 0,
    maxMinutes: 0,
    maxPerSession: 2,
    ...overrides,
  }
  return new RecallNudge(agent, {
    readConfig: () => config,
    getMemoryDir: () => dir,
    tracker,
    ...extra,
  })
}

/** A tracker with `agent` attached and one real user message recorded. */
function makeSpokenTracker(agent) {
  const tracker = new ActivityTracker()
  tracker.attach(agent)
  agent.emitInboxInserted({ source: { kind: 'user' } })
  return tracker
}

test('listRecallCandidates: recent log headlines, empty when no log', () => {
  const dir = makeStore()
  try {
    const candidates = listRecallCandidates(dir, 3)
    assert.equal(candidates.length, 2)
    assert.ok(candidates[0].includes('已发布 npm'))
    assert.ok(candidates[1].includes('心跳插件'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  const empty = makeStore(false)
  try {
    assert.deepEqual(listRecallCandidates(empty, 3), [])
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

test('buildRecallNudgeMessage has the followup shape the harness expects', () => {
  const message = buildRecallNudgeMessage(['a', 'b'])
  assert.ok(message.id.startsWith('memory-recall-'))
  assert.equal(message.role, 'user')
  assert.equal(message.content.length, 1)
  assert.equal(message.content[0].type, 'text')
  assert.ok(message.content[0].text.includes('小蓝主动追忆'))
  assert.ok(message.content[0].text.includes('a'))
  // Session format v4 admits only a producer-owned kind; the retired
  // {kind:'plugin', plugin:'memory'} wrapper is rejected at adoption.
  assert.deepEqual(message.source, { kind: 'plugin:memory' })
})

// ── prompt shape (2026-10-08 regression) ───────────────────────────────────
//
// Symptom: the GUI showed the recall request, then "done" with no text at all.
// Session events showed assistant messages carrying `reasoning` and nothing
// else — no text, no tool call — so the turn ended empty.
//
// Cause: the prompt said 「换着说，别重复最近提过的」. To honour it the model
// enumerated every topic it had already raised (a list that grows with the
// session), burned its whole reasoning budget doing so, and never emitted the
// actual line. The prompt must not impose that enumeration, and must say to
// speak directly instead of drafting inside the reasoning block.

test('the prompt never asks the model to enumerate what it already said', () => {
  const text = buildRecallNudgeMessage(['a', 'b', 'c']).content[0].text
  assert.doesNotMatch(text, /别重复/, 'asking to avoid repeats forces a scan of the whole session')
  assert.doesNotMatch(text, /换着说/, 'the old wording is the regression trigger')
})

test('the prompt tells the model to speak directly instead of drafting first', () => {
  const text = buildRecallNudgeMessage(['a']).content[0].text
  assert.match(text, /不要先/, 'must forbid warming up inside the reasoning block')
  assert.match(text, /草稿|排练/, 'must name the draft-first failure mode explicitly')
})

test('the prompt frames the seeds as optional rather than a checklist to compare', () => {
  const text = buildRecallNudgeMessage(['a', 'b', 'c']).content[0].text
  assert.match(text, /不必核对|不用核对/, 'comparing seeds is the second budget sink')
})

test('arms on first eligible idle, then recalls after the (zero) interval', () => {
  const agent = makeAgent()
  const dir = makeStore()
  const tracker = makeSpokenTracker(agent)
  const nudge = makeNudge(agent, dir, {}, tracker)
  nudge.start()
  agent.emitTurnStopped() // arms the interval (min=0 → 0ms)
  assert.equal(agent.followups.length, 0)
  agent.emitTurnStopped() // interval elapsed → fire
  assert.equal(agent.followups.length, 1)
  assert.deepEqual(agent.followups[0].source, { kind: 'plugin:memory' })
  nudge.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('stays quiet when there is nothing to recall (no log)', () => {
  const agent = makeAgent()
  const dir = makeStore(false)
  const tracker = makeSpokenTracker(agent)
  const nudge = makeNudge(agent, dir, {}, tracker)
  nudge.start()
  agent.emitTurnStopped()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 0)
  nudge.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('never recalls before the user has spoken (defer gate)', () => {
  const agent = makeAgent()
  const dir = makeStore()
  const tracker = new ActivityTracker()
  tracker.attach(agent) // NOT spoken
  const nudge = makeNudge(agent, dir, {}, tracker)
  nudge.start()
  agent.emitTurnStopped()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 0)
  nudge.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('only the active session recalls (active gate)', () => {
  const agentA = makeAgent({ id: 'root-a' })
  const agentB = makeAgent({ id: 'root-b' })
  const dir = makeStore()
  const tracker = new ActivityTracker()
  tracker.attach(agentA)
  tracker.attach(agentB)
  // User spoke to A first, then B → B is the active session.
  agentA.emitInboxInserted({ source: { kind: 'user' } })
  agentB.emitInboxInserted({ source: { kind: 'user' } })

  const nudgeA = makeNudge(agentA, dir, {}, tracker)
  const nudgeB = makeNudge(agentB, dir, {}, tracker)
  nudgeA.start()
  nudgeB.start()
  agentA.emitTurnStopped(); agentA.emitTurnStopped()
  agentB.emitTurnStopped(); agentB.emitTurnStopped()
  assert.equal(agentA.followups.length, 0, 'non-active session must stay quiet')
  assert.equal(agentB.followups.length, 1, 'active session recalls')
  nudgeA.dispose(); nudgeB.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('stays quiet while the agent is busy', () => {
  const agent = makeAgent({ status: 'busy' })
  const nudge = makeNudge(agent, makeStore())
  nudge.start()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 0)
  nudge.dispose()
})

test('stays quiet when a next-turn step is already queued', () => {
  const agent = makeAgent({ nextStep: [{ id: 'x' }] })
  const nudge = makeNudge(agent, makeStore())
  nudge.start()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 0)
  nudge.dispose()
})

test('respects maxPerSession: at most N recalls per session', () => {
  const agent = makeAgent()
  const dir = makeStore()
  const tracker = makeSpokenTracker(agent)
  const nudge = makeNudge(agent, dir, { maxPerSession: 2 }, tracker)
  nudge.start()
  agent.emitTurnStopped() // arm
  agent.emitTurnStopped() // fire #1
  agent.emitTurnStopped() // fire #2
  agent.emitTurnStopped() // capped
  assert.equal(agent.followups.length, 2)
  nudge.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('first eligible idle arms the interval and does not fire within it', () => {
  const agent = makeAgent()
  const dir = makeStore()
  const tracker = makeSpokenTracker(agent)
  const nudge = makeNudge(agent, dir, { minMinutes: 60, maxMinutes: 60 }, tracker)
  nudge.start()
  agent.emitTurnStopped() // arm: next = now + 60min
  assert.equal(agent.followups.length, 0)
  agent.emitTurnStopped() // still within the interval
  assert.equal(agent.followups.length, 0)
  nudge.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('disabled: never recalls', () => {
  const agent = makeAgent()
  const nudge = makeNudge(agent, makeStore(), { enabled: false })
  nudge.start()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 0)
  nudge.dispose()
})

test('dispose stops observing turn boundaries', () => {
  const agent = makeAgent()
  const nudge = makeNudge(agent, makeStore())
  nudge.start()
  nudge.dispose()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 0)
})

test('polls while fully idle: fires a recall with no turn boundary', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const agent = makeAgent()
  const dir = makeStore()
  const tracker = makeSpokenTracker(agent)
  const nudge = makeNudge(agent, dir, {}, tracker)
  nudge.start()
  // No turn boundary emitted — the poll timer alone must arm, then fire.
  t.mock.timers.tick(30000) // first poll: arms (min=0)
  assert.equal(agent.followups.length, 0)
  t.mock.timers.tick(30000) // second poll: fires
  assert.equal(agent.followups.length, 1)
  assert.deepEqual(agent.followups[0].source, { kind: 'plugin:memory' })
  nudge.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('randomIntervalMs stays within [min, max] and clamps max < min', () => {
  assert.equal(randomIntervalMs(10, 10), 10 * 60000)
  for (let i = 0; i < 100; i++) {
    const ms = randomIntervalMs(5, 15)
    assert.ok(ms >= 5 * 60000 && ms <= 15 * 60000)
  }
  // max < min clamps to min
  assert.equal(randomIntervalMs(20, 5), 20 * 60000)
})

// ── A. 发言权仲裁（v0.12.0）─────────────────────────────────────────────────
//
// 与 heartbeat 共享 ~/.dsh/proactive-cooldown.json：注入前先 claim，被拒则本次
// 跳过、不消耗追忆节奏（下次触发再试）。测试用注入的 claimLock 桩，协议本身
// 在 test/proactive-lock.test.mjs 里单测。

test('a refused claim skips this recall without consuming the cadence', () => {
  const agent = makeAgent()
  const dir = makeStore()
  const tracker = makeSpokenTracker(agent)
  const claims = []
  const results = [{ ok: false, deferredBy: 'heartbeat' }, { ok: true }]
  const nudge = makeNudge(agent, dir, {}, tracker, {
    claimLock: (options) => {
      claims.push(options)
      return results.shift() ?? { ok: false, deferredBy: 'heartbeat' }
    },
  })
  nudge.start()
  agent.emitTurnStopped() // arm
  agent.emitTurnStopped() // claim refused → skip, cadence untouched
  assert.equal(agent.followups.length, 0)
  assert.equal(claims.length, 1)
  assert.equal(claims[0].cooldownSeconds, 180, 'the configured cooldown is handed to the lock')
  agent.emitTurnStopped() // next trigger retries and succeeds
  assert.equal(agent.followups.length, 1)
  assert.ok(agent.followups[0].id.startsWith('memory-recall-'))
  assert.equal(claims.length, 2)
  nudge.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('the claim receives proactiveCooldownSeconds, including the 0 = off escape hatch', () => {
  const agent = makeAgent()
  const dir = makeStore()
  const tracker = makeSpokenTracker(agent)
  const seen = []
  const nudge = makeNudge(agent, dir, { proactiveCooldownSeconds: 0 }, tracker, {
    claimLock: (options) => { seen.push(options.cooldownSeconds); return { ok: true } },
  })
  nudge.start()
  agent.emitTurnStopped()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 1)
  assert.deepEqual(seen, [0])
  nudge.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('a throwing claimLock never blocks the recall (arbitration is best-effort)', () => {
  const agent = makeAgent()
  const dir = makeStore()
  const tracker = makeSpokenTracker(agent)
  const nudge = makeNudge(agent, dir, {}, tracker, {
    claimLock: () => { throw new Error('lock file broken') },
  })
  nudge.start()
  agent.emitTurnStopped()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 1, 'a broken lock must not silence the memory plugin')
  nudge.dispose()
  rmSync(dir, { recursive: true, force: true })
})

// ── D. 成长回顾（v0.12.0）───────────────────────────────────────────────────
//
// 成长回顾复用同一个追忆通道：到期 → 发成长回顾；不到期 → 走原追忆逻辑。
// 状态文件 <store>/.growth-recap.json 记录 lastAt。

function todayStamp() {
  const date = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Store with one log entry dated today, so a growth recap has material. */
function makeGrowthStore() {
  const dir = makeStore(false)
  writeFileSync(join(dir, 'log.md'), `## [${todayStamp()}] release | 成长测试条目\n`, 'utf8')
  return dir
}

function growthExtras(overrides = {}, claimLock) {
  return {
    readGrowthConfig: () => ({ enabled: true, intervalDays: 7, language: 'zh', ...overrides }),
    claimLock: claimLock ?? (() => ({ ok: true })),
  }
}

test('growth recap fires instead of recall when the week is due', () => {
  const agent = makeAgent()
  const dir = makeGrowthStore()
  const tracker = makeSpokenTracker(agent)
  const nudge = makeNudge(agent, dir, {}, tracker, growthExtras())
  nudge.start()
  agent.emitTurnStopped() // arm
  agent.emitTurnStopped() // growth due → recap, not recall
  assert.equal(agent.followups.length, 1)
  const message = agent.followups[0]
  assert.ok(message.id.startsWith('memory-growth-'))
  assert.ok(message.content[0].text.includes('成长回顾'))
  assert.ok(message.content[0].text.includes('成长测试条目'))
  assert.deepEqual(message.source, { kind: 'plugin:memory' })
  const state = JSON.parse(readFileSync(join(dir, '.growth-recap.json'), 'utf8'))
  assert.ok(Math.abs(state.lastAt - Date.now()) < 60_000, 'delivery time is persisted')
  nudge.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('growth recap is not repeated inside the interval: recall takes over', () => {
  const agent = makeAgent()
  const dir = makeGrowthStore()
  writeFileSync(join(dir, '.growth-recap.json'), JSON.stringify({ version: 1, lastAt: Date.now() }), 'utf8')
  const tracker = makeSpokenTracker(agent)
  const nudge = makeNudge(agent, dir, {}, tracker, growthExtras())
  nudge.start()
  agent.emitTurnStopped()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 1)
  assert.ok(agent.followups[0].id.startsWith('memory-recall-'), 'normal recall resumes when the recap is not due')
  nudge.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('growth recap is due again once growthRecapIntervalDays has elapsed', () => {
  const agent = makeAgent()
  const dir = makeGrowthStore()
  writeFileSync(join(dir, '.growth-recap.json'),
    JSON.stringify({ version: 1, lastAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }), 'utf8')
  const tracker = makeSpokenTracker(agent)
  const nudge = makeNudge(agent, dir, {}, tracker, growthExtras())
  nudge.start()
  agent.emitTurnStopped()
  agent.emitTurnStopped()
  assert.ok(agent.followups[0].id.startsWith('memory-growth-'))
  nudge.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('growth recap passes through the arbitration lock too', () => {
  const agent = makeAgent()
  const dir = makeGrowthStore()
  const tracker = makeSpokenTracker(agent)
  const nudge = makeNudge(agent, dir, {}, tracker, growthExtras({}, () => ({ ok: false, deferredBy: 'heartbeat' })))
  nudge.start()
  agent.emitTurnStopped()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 0)
  assert.equal(existsSync(join(dir, '.growth-recap.json')), false,
    'a recap that never happened must not be recorded as delivered')
  nudge.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('growth disabled: the normal recall path is untouched', () => {
  const agent = makeAgent()
  const dir = makeGrowthStore()
  const tracker = makeSpokenTracker(agent)
  const nudge = makeNudge(agent, dir, {}, tracker, {
    readGrowthConfig: () => ({ enabled: false, intervalDays: 7 }),
    claimLock: () => ({ ok: true }),
  })
  nudge.start()
  agent.emitTurnStopped()
  agent.emitTurnStopped()
  assert.ok(agent.followups[0].id.startsWith('memory-recall-'))
  nudge.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('a broken growth check falls back to recall (failure must not block追忆)', () => {
  const agent = makeAgent()
  const dir = makeGrowthStore()
  const tracker = makeSpokenTracker(agent)
  const nudge = makeNudge(agent, dir, {}, tracker, {
    readGrowthConfig: () => { throw new Error('growth config unavailable') },
    claimLock: () => ({ ok: true }),
  })
  nudge.start()
  agent.emitTurnStopped()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 1)
  assert.ok(agent.followups[0].id.startsWith('memory-recall-'))
  nudge.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('a state-write failure still delivers the recap once', () => {
  const agent = makeAgent()
  const dir = makeGrowthStore()
  const tracker = makeSpokenTracker(agent)
  // A directory where the state file should be makes the atomic write fail.
  mkdirSync(join(dir, '.growth-recap.json'))
  const nudge = makeNudge(agent, dir, {}, tracker, growthExtras())
  nudge.start()
  agent.emitTurnStopped()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 1, 'persisting the timestamp is not allowed to eat the message')
  assert.ok(agent.followups[0].id.startsWith('memory-growth-'))
  nudge.dispose()
  rmSync(dir, { recursive: true, force: true })
})
