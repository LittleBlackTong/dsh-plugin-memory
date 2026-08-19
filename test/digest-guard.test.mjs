import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  DigestGuard,
  buildDigestNudgeMessage,
  lastStoreWriteMs,
} from '../lib/digest-guard.js'

/** Fake root agent with the surface DigestGuard touches. */
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

const TMP = mkdtempSync(join(tmpdir(), 'dsh-memory-guard-'))

/** Create a store dir whose log.md mtime is `ageMinutes` in the past. */
function makeStore(ageMinutes) {
  const dir = mkdtempSync(join(TMP, 'store-'))
  writeFileSync(join(dir, 'log.md'), '# log\n')
  if (ageMinutes > 0) {
    const past = new Date(Date.now() - ageMinutes * 60000)
    utimesSync(join(dir, 'log.md'), past, past)
  }
  return dir
}

function makeGuard(agent, dir, overrides = {}) {
  const config = {
    enabled: true,
    afterMinutes: 1,
    cooldownMinutes: 0,
    maxPerSession: 2,
    ...overrides,
  }
  return new DigestGuard(agent, {
    readConfig: () => config,
    getMemoryDir: () => dir,
  })
}

test('lastStoreWriteMs: 0 for missing markers, latest mtime across markers', () => {
  const empty = mkdtempSync(join(TMP, 'empty-'))
  assert.equal(lastStoreWriteMs(empty), 0)
  const dir = makeStore(5)
  assert.ok(lastStoreWriteMs(dir) > 0)
  assert.ok(Date.now() - lastStoreWriteMs(dir) >= 5 * 60000 - 5000)
})

test('buildDigestNudgeMessage has the followup shape the harness expects', () => {
  const message = buildDigestNudgeMessage(42)
  assert.ok(message.id.startsWith('memory-digest-'))
  assert.equal(message.role, 'user')
  assert.equal(message.content.length, 1)
  assert.equal(message.content[0].type, 'text')
  assert.ok(message.content[0].text.includes('digest'))
  assert.equal(message.source.kind, 'plugin')
  assert.equal(message.source.plugin, 'memory')
})

test('nudges an idle agent when the store is stale', () => {
  const agent = makeAgent()
  const guard = makeGuard(agent, makeStore(10))
  guard.start()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 1)
  assert.equal(agent.followups[0].source.plugin, 'memory')
  guard.dispose()
})

test('stays quiet when the store was written recently', () => {
  const agent = makeAgent()
  const guard = makeGuard(agent, makeStore(0))
  guard.start()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 0)
  guard.dispose()
})

test('stays quiet while the agent is busy', () => {
  const agent = makeAgent({ status: 'busy' })
  const guard = makeGuard(agent, makeStore(10))
  guard.start()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 0)
  guard.dispose()
})

test('stays quiet when a next-turn step is already queued', () => {
  const agent = makeAgent({ nextStep: [{ id: 'x' }] })
  const guard = makeGuard(agent, makeStore(10))
  guard.start()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 0)
  guard.dispose()
})

test('respects maxPerSession: at most N nudges per session', () => {
  const agent = makeAgent()
  const guard = makeGuard(agent, makeStore(10), { maxPerSession: 2 })
  guard.start()
  agent.emitTurnStopped()
  agent.emitTurnStopped()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 2)
  guard.dispose()
})

test('respects the cooldown between nudges', () => {
  const agent = makeAgent()
  const guard = makeGuard(agent, makeStore(10), { cooldownMinutes: 60 })
  guard.start()
  agent.emitTurnStopped()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 1)
  guard.dispose()
})

test('disabled: never nudges', () => {
  const agent = makeAgent()
  const guard = makeGuard(agent, makeStore(10), { enabled: false })
  guard.start()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 0)
  guard.dispose()
})

test('dispose stops observing turn boundaries', () => {
  const agent = makeAgent()
  const guard = makeGuard(agent, makeStore(10))
  guard.start()
  guard.dispose()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 0)
})
