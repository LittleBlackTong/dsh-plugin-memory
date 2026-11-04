import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import plugin, { SESSION_ROUTE_PATH } from '../lib/index.js'

/** A tiny boot store: enough for renderBootBlock to produce a block. */
function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'memory-session-store-'))
  writeFileSync(join(dir, 'SOUL.md'), 'SOUL-BODY\n', 'utf8')
  writeFileSync(join(dir, 'MEMORY.md'), 'MEMORY-BODY\n', 'utf8')
  writeFileSync(join(dir, 'index.md'), '# Memory Index\n\n- [p](x.md) — page.\n', 'utf8')
  return dir
}

/**
 * Fake Cordis ctx: dispatches events, records optional injections, and wires
 * root agents the way the plugin expects (id, session.header.cwd, ctx.effect).
 */
function makeCtx() {
  const listeners = new Map()
  const calls = []
  const injects = []
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
    effect(fn) {
      const cleanup = fn()
      return () => cleanup?.()
    },
    inject(deps, callback) {
      injects.push({ deps, callback })
    },
  }
  const agents = []
  const makeAgent = (id, cwd) => {
    const agent = {
      id,
      status: 'idle',
      inbox: { nextStep: [] },
      followup() {},
      session: { header: { cwd } },
      ctx: {
        on: ctx.on,
        effect(fn) {
          const cleanup = fn()
          return () => cleanup?.()
        },
      },
    }
    agents.push(agent)
    return agent
  }
  ctx.agents = {
    roots: () => agents,
    get: (id) => agents.find((agent) => agent.id === id),
  }
  return { ctx, calls, injects, makeAgent }
}

function bootTextOf(calls) {
  const entry = calls.find(([service]) => service === 'systemPrompt')
  assert.ok(entry !== undefined, 'boot registration missing')
  return (context) => entry[1].text(context)
}

function makeCommandPlane(ctx, injects) {
  let registered
  const injected = injects.find((entry) => entry.deps[0] === 'commands')
  assert.ok(injected !== undefined, 'commands injection missing')
  injected.callback({
    commands: {
      register(definition) {
        registered = definition
        return () => {}
      },
    },
    effect: ctx.effect,
  })
  assert.ok(registered !== undefined, 'command not registered')
  return registered
}

function makeWebPlane(ctx, injects) {
  const routes = new Map()
  const injected = injects.find((entry) => entry.deps[0] === 'webServer')
  assert.ok(injected !== undefined, 'webServer injection missing')
  injected.callback({
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
    effect: ctx.effect,
  })
  return routes
}

function routeCall(route, method, url, body) {
  return new Promise((resolve) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
    req.method = method
    req.url = url
    let status = 0
    let payload = ''
    route.handler(req, {
      writeHead(nextStatus) {
        status = nextStatus
      },
      end(chunk) {
        payload += chunk ?? ''
        resolve({ status, body: payload })
      },
    })
  })
}

const BASE_CONFIG = (memoryDir) => ({
  memoryDir,
  // Isolate from the developer's real ~/.dsh/memory.json: a non-existent
  // config file makes the store use exactly the composition defaults below.
  configFile: join(memoryDir, 'memory.json'),
  scaffold: false,
  autoCommit: false,
  digestNudgeEnabled: false,
  deferUntilUserSpeaks: false,
  activeSessionOnly: false,
})

test('a fresh session injects the boot block by default', () => {
  const store = makeStore()
  try {
    const { ctx, calls, injects, makeAgent } = makeCtx()
    const dispose = plugin(ctx, BASE_CONFIG(store))
    const agent = makeAgent('s1', '/Users/x/work')
    ctx.emit('agent/created', { agent })
    const block = bootTextOf(calls)({ agent })
    assert.ok(block.includes('SOUL-BODY'), `block was: ${block.slice(0, 120)}`)
    dispose()
  } finally {
    rmSync(store, { recursive: true, force: true })
  }
})

test('/memory off hides the block for that session only; /memory on restores it', () => {
  const store = makeStore()
  try {
    const { ctx, calls, injects, makeAgent } = makeCtx()
    const dispose = plugin(ctx, BASE_CONFIG(store))
    const command = makeCommandPlane(ctx, injects)
    const a = makeAgent('s1', '/Users/x/work')
    const b = makeAgent('s2', '/Users/x/work')
    ctx.emit('agent/created', { agent: a })
    ctx.emit('agent/created', { agent: b })
    const text = bootTextOf(calls)

    assert.ok(text({ agent: a }).includes('SOUL-BODY'))
    const result = command.handler({ agent: a, rawInput: 'off' })
    assert.equal(result.kind, 'success')
    assert.equal(text({ agent: a }), '', 'muted session gets nothing')
    assert.ok(text({ agent: b }).includes('SOUL-BODY'), 'other sessions are untouched')

    command.handler({ agent: a, rawInput: 'on' })
    assert.ok(text({ agent: a }).includes('SOUL-BODY'), 'turning it back on restores the block')
    dispose()
  } finally {
    rmSync(store, { recursive: true, force: true })
  }
})

test('a workspace in disabledWorkspaces starts muted, and /memory on overrides it', () => {
  const store = makeStore()
  try {
    const { ctx, calls, injects, makeAgent } = makeCtx()
    const disabled = '/Users/x/no-memory-project'
    const dispose = plugin(ctx, { ...BASE_CONFIG(store), disabledWorkspaces: [disabled] })
    const command = makeCommandPlane(ctx, injects)
    const muted = makeAgent('s1', join(disabled, 'repo'))
    const normal = makeAgent('s2', '/Users/x/other')
    ctx.emit('agent/created', { agent: muted })
    ctx.emit('agent/created', { agent: normal })
    const text = bootTextOf(calls)

    assert.equal(text({ agent: muted }), '', 'workspace default mutes new sessions')
    assert.ok(text({ agent: normal }).includes('SOUL-BODY'))
    command.handler({ agent: muted, rawInput: 'on' })
    assert.ok(text({ agent: muted }).includes('SOUL-BODY'), 'explicit session override wins')
    dispose()
  } finally {
    rmSync(store, { recursive: true, force: true })
  }
})

test('/memory status reports the effective state', () => {
  const store = makeStore()
  try {
    const { ctx, calls, injects, makeAgent } = makeCtx()
    const dispose = plugin(ctx, BASE_CONFIG(store))
    const command = makeCommandPlane(ctx, injects)
    const agent = makeAgent('s1', '/Users/x/work')
    ctx.emit('agent/created', { agent })

    const on = command.handler({ agent, rawInput: '' })
    assert.match(on.text, /Memory is ON/)
    command.handler({ agent, rawInput: 'off' })
    const off = command.handler({ agent, rawInput: 'status' })
    assert.match(off.text, /Memory is OFF/)
    dispose()
  } finally {
    rmSync(store, { recursive: true, force: true })
  }
})

test('the session route reads and toggles the gate', async () => {
  const store = makeStore()
  try {
    const { ctx, calls, injects, makeAgent } = makeCtx()
    const dispose = plugin(ctx, BASE_CONFIG(store))
    const routes = makeWebPlane(ctx, injects)
    const route = routes.get(SESSION_ROUTE_PATH)
    assert.ok(route !== undefined, 'session route is registered')
    const agent = makeAgent('s1', '/Users/x/work')
    ctx.emit('agent/created', { agent })
    const text = bootTextOf(calls)

    const initial = await routeCall(route, 'GET', '/api/memory/session?sessionId=s1')
    assert.equal(initial.status, 200)
    assert.equal(JSON.parse(initial.body).effective, true)

    const off = await routeCall(route, 'POST', '/api/memory/session', { action: 'off', sessionId: 's1' })
    assert.equal(off.status, 200)
    assert.equal(JSON.parse(off.body).effective, false)
    assert.equal(text({ agent }), '', 'the route mutates the same gate the boot block reads')

    const toggle = await routeCall(route, 'POST', '/api/memory/session', { action: 'toggle', sessionId: 's1' })
    assert.equal(JSON.parse(toggle.body).effective, true)

    const unknown = await routeCall(route, 'POST', '/api/memory/session', { action: 'nope', sessionId: 's1' })
    assert.equal(unknown.status, 400)
    dispose()
  } finally {
    rmSync(store, { recursive: true, force: true })
  }
})

test('the session route falls back to the active session, or says no-session', async () => {
  const store = makeStore()
  try {
    const { ctx, injects, makeAgent } = makeCtx()
    const dispose = plugin(ctx, BASE_CONFIG(store))
    const routes = makeWebPlane(ctx, injects)
    const route = routes.get(SESSION_ROUTE_PATH)

    const none = await routeCall(route, 'GET', '/api/memory/session')
    assert.equal(none.status, 200)
    assert.equal(JSON.parse(none.body).ok, false)
    assert.equal(JSON.parse(none.body).reason, 'no-session')

    const agent = makeAgent('s1', '/Users/x/work')
    ctx.emit('agent/created', { agent })
    // A real user message marks the session active (the tracker's proxy for
    // "the user is looking at this one").
    ctx.emit('agent/inbox/inserted', { agent, message: { source: { kind: 'user' } } })
    const active = await routeCall(route, 'GET', '/api/memory/session')
    assert.equal(JSON.parse(active.body).ok, true)
    assert.equal(JSON.parse(active.body).sessionId, 's1')
    dispose()
  } finally {
    rmSync(store, { recursive: true, force: true })
  }
})
