import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  DigestGuard,
  buildDigestNudgeMessage,
  buildIndexDriftHint,
  lastStoreWriteMs,
} from '../lib/digest-guard.js'
import { ActivityTracker } from '../lib/activity-tracker.js'

/** Fake root agent with the surface DigestGuard + ActivityTracker touch. */
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

/** Minimal page text with the frontmatter the index compiler reads. */
function pageText({ title = 't', salience = 2, summary = '一句话。' } = {}) {
  return `---\ntitle: ${title}\ndate: 2026-01-01\ntype: user\nsalience: ${salience}\n`
    + `summary: ${summary}\nlast_access: 2026-09-23\ntags: []\nsources: []\n---\n\n正文。\n`
}

function writePage(dir, rel, options) {
  const abs = join(dir, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, pageText(options), 'utf8')
  return abs
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

function makeGuard(agent, dir, overrides = {}, tracker) {
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
    tracker,
  })
}

/** A tracker with `agent` attached and one real user message recorded. */
function makeSpokenTracker(agent) {
  const tracker = new ActivityTracker()
  tracker.attach(agent)
  agent.emitInboxInserted({ source: { kind: 'user' } })
  return tracker
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

test('never nudges before the user has spoken (defer gate)', () => {
  const agent = makeAgent()
  const dir = makeStore(10)
  const tracker = new ActivityTracker()
  tracker.attach(agent) // NOT spoken
  const guard = makeGuard(agent, dir, {}, tracker)
  guard.start()
  agent.emitTurnStopped()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 0)
  guard.dispose()
})

test('only the active session nudges (active gate)', () => {
  const agentA = makeAgent({ id: 'root-a' })
  const agentB = makeAgent({ id: 'root-b' })
  const dir = makeStore(10)
  const tracker = new ActivityTracker()
  tracker.attach(agentA)
  tracker.attach(agentB)
  agentA.emitInboxInserted({ source: { kind: 'user' } })
  agentB.emitInboxInserted({ source: { kind: 'user' } }) // B is active

  const guardA = makeGuard(agentA, dir, {}, tracker)
  const guardB = makeGuard(agentB, dir, {}, tracker)
  guardA.start()
  guardB.start()
  agentA.emitTurnStopped()
  agentB.emitTurnStopped()
  assert.equal(agentA.followups.length, 0, 'non-active session must stay quiet')
  assert.equal(agentB.followups.length, 1, 'active session nudges')
  guardA.dispose(); guardB.dispose()
})

test('the digest reminder asks for cross-links (nothing else produces them)', () => {
  const text = buildDigestNudgeMessage(10).content[0].text
  assert.match(text, /相关页链接|[Cc]ross-link/, 'the reminder must ask for page-to-page links')
  // Still a checklist: the ask sits before the closing line.
  assert.ok(text.indexOf('相关页链接') < text.indexOf('完成后继续手头的事'))
})

test('buildDigestNudgeMessage renders the index-drift line only when provided', () => {
  const plain = buildDigestNudgeMessage(10)
  assert.ok(!plain.content[0].text.includes('index 有漂移'))

  const withHint = buildDigestNudgeMessage(10, { indexHint: '另外，记忆 index 有漂移：3 行与页面不一致。' })
  const text = withHint.content[0].text
  assert.ok(text.includes('另外，记忆 index 有漂移：3 行与页面不一致。'))
  // The hint sits before the closing line, so the message still reads as a list.
  assert.ok(text.indexOf('index 有漂移') < text.indexOf('完成后继续手头的事'))

  // An empty/blank hint must not leave a dangling blank line.
  assert.ok(!buildDigestNudgeMessage(10, { indexHint: '   ' }).content[0].text.includes('index 有漂移'))
})

test('buildIndexDriftHint reports drift, missing pages and dangling links', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-memory-drift-'))
  mkdirSync(join(dir, 'user'), { recursive: true })
  writeFileSync(join(dir, 'index.md'), [
    '- [a](user/a.md) — 旧摘要。',
    '- [gone](user/gone.md) — 已删除的页。',
    '',
  ].join('\n'), 'utf8')
  writePage(dir, 'user/a.md', { title: 'a', summary: '新摘要。' }) // drifted
  writePage(dir, 'user/new.md', { title: 'new', summary: 'x。' })  // unlisted

  const hint = buildIndexDriftHint(dir)
  assert.match(hint, /index 有漂移/)
  assert.match(hint, /1 行与页面不一致/)
  assert.match(hint, /1 个新页面未收录/)
  assert.match(hint, /1 个索引链接已失效/)

  // A store with nothing to report produces no hint at all.
  const clean = mkdtempSync(join(tmpdir(), 'dsh-memory-drift-clean-'))
  mkdirSync(join(clean, 'user'), { recursive: true })
  writePage(clean, 'user/a.md', { title: 'a', summary: '一句话。' })
  writeFileSync(join(clean, 'index.md'), '- [a](user/a.md) — 一句话。 `salience:2`\n', 'utf8')
  assert.equal(buildIndexDriftHint(clean), '')
})

test('buildIndexDriftHint never throws on a broken store', () => {
  assert.equal(buildIndexDriftHint(join(tmpdir(), 'definitely-not-a-store-xyz')), '')
})

test('the digest guard attaches the drift hint when it nudges', () => {
  const store = mkdtempSync(join(tmpdir(), 'dsh-memory-guard-drift-'))
  mkdirSync(join(store, 'user'), { recursive: true })
  writeFileSync(join(store, 'log.md'), '# log\n', 'utf8')
  const old = (Date.now() - 300 * 60000) / 1000
  utimesSync(join(store, 'log.md'), old, old)
  writeFileSync(join(store, 'index.md'), '- [a](user/a.md) — 旧摘要。\n', 'utf8')
  utimesSync(join(store, 'index.md'), old, old)
  writePage(store, 'user/a.md', { title: 'a', summary: '新摘要。' })

  const agent = makeAgent()
  const guard = new DigestGuard(agent, {
    readConfig: () => ({ enabled: true, afterMinutes: 120, cooldownMinutes: 0, maxPerSession: 2 }),
    getMemoryDir: () => store,
    logger: { info() {}, warn() {} },
  })
  guard.start()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 1)
  assert.match(agent.followups[0].content[0].text, /index 有漂移/)
  guard.dispose()
})

test('the digest guard omits the hint when the index is in sync', () => {
  const store = mkdtempSync(join(tmpdir(), 'dsh-memory-guard-clean-'))
  mkdirSync(join(store, 'user'), { recursive: true })
  writeFileSync(join(store, 'log.md'), '# log\n', 'utf8')
  const old = (Date.now() - 300 * 60000) / 1000
  utimesSync(join(store, 'log.md'), old, old)
  const page = pageText({ title: 'a', summary: '一句话。' })
  writeFileSync(join(store, 'user/a.md'), page, 'utf8')
  writeFileSync(join(store, 'index.md'), '- [a](user/a.md) — 一句话。 `salience:2`\n', 'utf8')
  utimesSync(join(store, 'index.md'), old, old)

  const agent = makeAgent()
  const guard = new DigestGuard(agent, {
    readConfig: () => ({ enabled: true, afterMinutes: 120, cooldownMinutes: 0, maxPerSession: 2 }),
    getMemoryDir: () => store,
    logger: { info() {}, warn() {} },
  })
  guard.start()
  agent.emitTurnStopped()
  assert.equal(agent.followups.length, 1)
  assert.ok(!agent.followups[0].content[0].text.includes('index 有漂移'))
  guard.dispose()
})
