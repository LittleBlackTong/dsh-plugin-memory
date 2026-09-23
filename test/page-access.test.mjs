import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import plugin from '../lib/index.js'
import { today } from '../lib/pages.js'

/**
 * Fake Cordis ctx that actually dispatches events, plus a root agent wired the
 * way the plugin expects one (ctx.effect/on, status, inbox, followup).
 */
function makeFakeCtx() {
  const listeners = new Map()
  const calls = []
  const ctx = {
    systemPrompt: {
      context(value) {
        calls.push(['systemPrompt', value])
        return () => {}
      },
    },
    skills: {
      register(value) {
        calls.push(['skills', value])
        return () => {}
      },
    },
    logger: { info() {}, warn() {} },
    on(event, handler) {
      const set = listeners.get(event) ?? new Set()
      set.add(handler)
      listeners.set(event, set)
      return () => set.delete(handler)
    },
    emit(event, payload) {
      for (const handler of listeners.get(event) ?? []) handler(payload)
    },
    inject() {},
    effect(fn) {
      // Cordis runs the callback immediately and treats its return value as
      // the cleanup; deferring it would silently skip every registration.
      const cleanup = fn()
      return () => cleanup?.()
    },
  }
  const agents = []
  const makeAgent = (id) => {
    const agent = {
      id,
      status: 'idle',
      inbox: { nextStep: [] },
      followup() {},
      ctx: {
        on: ctx.on,
        // Same Cordis semantics as the root ctx: run now, return the cleanup.
        effect(fn) {
          const cleanup = fn()
          return () => cleanup?.()
        },
      },
    }
    agents.push(agent)
    return agent
  }
  // The tracker uses `agents.get(id)` as a liveness check when electing the
  // active session, so a live agent must be findable there.
  const registry = {
    roots: () => agents,
    get: (id) => agents.find((a) => a.id === id),
  }
  ctx.agents = registry
  return { ctx, calls, makeAgent }
}

const CFG_BASE = {
  scaffold: false,
  autoCommit: false,
  digestNudgeEnabled: false,
  recallEnabled: false,
}

function makeStore(files) {
  const dir = mkdtempSync(join(tmpdir(), 'memory-access-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }
  return dir
}

function page(lastAccess) {
  return `---\ntitle: t\ndate: 2026-01-01\ntype: user\nsalience: 2\nlast_access: ${lastAccess}\ntags: []\nsources: []\n---\n\nbody\n`
}

test('first real user message stamps last_access on the pages the boot block loaded', () => {
  const dir = makeStore({
    'SOUL.md': '# soul\n',
    'MEMORY.md': '# memory\n',
    'index.md': '# Memory Index\n\n- [p](user/profile.md) — 用户档案\n',
    'user/profile.md': page('2020-01-01'),
    'user/preferences.md': page('2020-01-01'),
  })
  const { ctx, makeAgent } = makeFakeCtx()
  const dispose = plugin(ctx, {
    ...CFG_BASE,
    memoryDir: dir,
    configFile: join(dir, 'memory.json'),
  })
  const agent = makeAgent('root-1')
  ctx.emit('agent/created', { agent })

  // Nothing is stamped until the session's first real user message (gate 1).
  assert.match(readFileSync(join(dir, 'user/profile.md'), 'utf8'), /last_access: 2020-01-01/)
  ctx.emit('agent/inbox/inserted', { agent, message: { source: { kind: 'system' } } })
  assert.match(readFileSync(join(dir, 'user/profile.md'), 'utf8'), /last_access: 2020-01-01/)

  ctx.emit('agent/inbox/inserted', { agent, message: { source: { kind: 'user' } } })
  // profile is linked from index.md (injected), so it counts as loaded…
  assert.match(readFileSync(join(dir, 'user/profile.md'), 'utf8'), new RegExp(`last_access: ${today()}`))
  // …while a page nobody referenced is left to age.
  assert.match(readFileSync(join(dir, 'user/preferences.md'), 'utf8'), /last_access: 2020-01-01/)

  dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('the stamp runs once per session, not once per message', () => {
  const dir = makeStore({
    'SOUL.md': '# soul\n',
    'index.md': '# Memory Index\n\n- [p](user/profile.md) — 用户档案\n',
    'user/profile.md': page('2020-01-01'),
  })
  const { ctx, makeAgent } = makeFakeCtx()
  const dispose = plugin(ctx, {
    ...CFG_BASE,
    memoryDir: dir,
    configFile: join(dir, 'memory.json'),
  })
  const agent = makeAgent('root-1')
  ctx.emit('agent/created', { agent })
  ctx.emit('agent/inbox/inserted', { agent, message: { source: { kind: 'user' } } })
  // A second turn rewrites the page back to the old date by hand: the plugin
  // must not stamp again (otherwise every message would churn git history).
  writeFileSync(join(dir, 'user/profile.md'), page('2020-01-01'), 'utf8')
  ctx.emit('agent/inbox/inserted', { agent, message: { source: { kind: 'user' } } })
  assert.match(readFileSync(join(dir, 'user/profile.md'), 'utf8'), /last_access: 2020-01-01/)
  dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('trackPageAccess: false disables the automatic stamping', () => {
  const dir = makeStore({
    'SOUL.md': '# soul\n',
    'index.md': '# Memory Index\n\n- [p](user/profile.md) — 用户档案\n',
    'user/profile.md': page('2020-01-01'),
  })
  const { ctx, makeAgent } = makeFakeCtx()
  const dispose = plugin(ctx, {
    ...CFG_BASE,
    memoryDir: dir,
    trackPageAccess: false,
    configFile: join(dir, 'memory.json'),
  })
  const agent = makeAgent('root-1')
  ctx.emit('agent/created', { agent })
  ctx.emit('agent/inbox/inserted', { agent, message: { source: { kind: 'user' } } })
  assert.match(readFileSync(join(dir, 'user/profile.md'), 'utf8'), /last_access: 2020-01-01/)
  dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('bootFileBudgets flows from composition config into the rendered block', () => {
  const dir = makeStore({
    'SOUL.md': 'S'.repeat(3000),
    'MEMORY.md': 'M'.repeat(3000),
    'index.md': 'I'.repeat(3000),
  })
  const { ctx, calls } = makeFakeCtx()
  const dispose = plugin(ctx, {
    ...CFG_BASE,
    memoryDir: dir,
    bootMaxChars: 4000,
    bootFileBudgets: { 'index.md': 3000 },
    configFile: join(dir, 'memory.json'),
  })
  const boot = calls.find(([service]) => service === 'systemPrompt')[1]
  const block = boot.text()
  // index got its explicit 3000-char budget, so its whole body is present.
  assert.ok(block.includes('IIII'), 'index.md was injected')
  assert.ok(block.includes('III'), 'index body present')
  const indexSection = block.slice(block.indexOf('### index.md'))
  assert.ok(indexSection.includes('I'.repeat(500)), 'index is not squeezed into a tiny share')
  dispose()
  rmSync(dir, { recursive: true, force: true })
})
