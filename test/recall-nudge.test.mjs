import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  RecallNudge,
  buildRecallNudgeMessage,
  listRecallCandidates,
  randomIntervalMs,
} from '../lib/recall-nudge.js'

/** Fake root agent with the surface RecallNudge touches. */
function makeAgent({ status = 'idle', nextStep = [] } = {}) {
  const listeners = new Map()
  const agent = {
    id: 'root-1',
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

function makeNudge(agent, dir, overrides = {}) {
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
  })
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
  assert.equal(message.source.kind, 'plugin')
  assert.equal(message.source.plugin, 'memory')
})

test('recalls an idle agent when the store has a log', () => {
  const agent = makeAgent()
  const nudge = makeNudge(agent, makeStore())
  nudge.start()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 1)
  assert.equal(agent.followups[0].source.plugin, 'memory')
  nudge.dispose()
})

test('stays quiet when there is nothing to recall (no log)', () => {
  const agent = makeAgent()
  const nudge = makeNudge(agent, makeStore(false))
  nudge.start()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 0)
  nudge.dispose()
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
  const nudge = makeNudge(agent, makeStore(), { maxPerSession: 2 })
  nudge.start()
  agent.emitTurnStopped()
  agent.emitTurnStopped()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 2)
  nudge.dispose()
})

test('respects the interval between recalls', () => {
  const agent = makeAgent()
  const nudge = makeNudge(agent, makeStore(), { minMinutes: 60, maxMinutes: 60 })
  nudge.start()
  agent.emitTurnStopped()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 1)
  nudge.dispose()
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
  const nudge = makeNudge(agent, makeStore(), { minMinutes: 0, maxMinutes: 0 })
  nudge.start()
  // No turn boundary emitted — the poll timer alone must trigger it.
  t.mock.timers.tick(30000)
  assert.equal(agent.followups.length, 1)
  assert.equal(agent.followups[0].source.plugin, 'memory')
  nudge.dispose()
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
