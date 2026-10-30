/**
 * v0.13.0 control channel: `POST /api/memory/control` with
 * `{ action: 'growth-now' }` delivers one growth recap immediately.
 *
 * The route is the only way to trigger a recap from the Settings panel, so it
 * has to behave like the automatic growth path: same arbitration lock, same
 * "only speak with content" rule, same failure degradation — but it must keep
 * working when `recallEnabled=false` (the weekly recap is not the recall
 * cadence). Unknown actions are a client bug and are rejected with 400.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

import plugin, { CONFIG_ROUTE_PATH, CONTROL_ROUTE_PATH } from '../lib/index.js'

// Keep the shared proactive lock (and anything else DSH_HOME-relative) inside
// the test's own directory instead of the developer's ~/.dsh.
const DSH_HOME = mkdtempSync(join(tmpdir(), 'memory-control-dsh-'))
process.env.DSH_HOME = DSH_HOME
test.after(() => rmSync(DSH_HOME, { recursive: true, force: true }))

/** Fake Cordis ctx that dispatches events and hands out live root agents. */
function makeFakeCtx() {
  const listeners = new Map()
  const calls = []
  const agents = []
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
    inject(deps, callback) {
      injects.push({ deps, callback })
    },
    effect(fn) {
      const cleanup = fn()
      return () => cleanup?.()
    },
    agents: {
      roots: () => agents,
      get: (id) => agents.find((agent) => agent.id === id),
    },
  }
  const makeAgent = (id) => {
    const agent = {
      id,
      status: 'idle',
      inbox: { nextStep: [] },
      followups: [],
      followup(message) {
        this.followups.push(message)
      },
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
  return { ctx, calls, injects, makeAgent }
}

function makeWebCtx() {
  const routes = new Map()
  return {
    routes,
    webCtx: {
      webServer: {
        register(route) {
          routes.set(route.path, route)
          return () => routes.delete(route.path)
        },
      },
      effect: () => () => {},
    },
  }
}

async function routeCall(route, method, body) {
  const res = {
    status: 0,
    body: '',
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body ?? ''
    },
  }
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)])
  req.method = method
  await route.handler(req, res)
  return { status: res.status, body: res.body }
}

const parse = (result) => JSON.parse(result.body)

/** Store with one log entry dated today, so a recap always has material. */
function makeStore({ withLog = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'memory-control-'))
  if (withLog) {
    const date = new Date()
    const pad = (value) => String(value).padStart(2, '0')
    const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    writeFileSync(join(dir, 'log.md'), `## [${stamp}] release | 立即回顾测试条目\n`, 'utf8')
  }
  return dir
}

/**
 * Mount the plugin on a fake ctx and expose the routes plus the agent factory.
 * `recallEnabled` is the composition-time switch (default on).
 */
function mount({ memoryDir, recallEnabled = true, pluginConfig = {} } = {}) {
  const dir = memoryDir ?? makeStore()
  const cfgDir = mkdtempSync(join(tmpdir(), 'memory-control-cfg-'))
  const { ctx, calls, injects, makeAgent } = makeFakeCtx()
  const dispose = plugin(ctx, {
    memoryDir: dir,
    scaffold: false,
    autoCommit: false,
    digestNudgeEnabled: false,
    recallEnabled,
    configFile: join(cfgDir, 'memory.json'),
    ...pluginConfig,
  })
  const { routes, webCtx } = makeWebCtx()
  injects.find((entry) => entry.deps[0] === 'webServer').callback(webCtx)
  const cleanup = () => {
    dispose()
    rmSync(dir, { recursive: true, force: true })
    rmSync(cfgDir, { recursive: true, force: true })
  }
  return { dir, ctx, calls, routes, makeAgent, cleanup }
}

/** Create the root agent and let the user speak once, so the session is live. */
function liveSession({ ctx, makeAgent }) {
  const agent = makeAgent('root-1')
  ctx.emit('agent/created', { agent })
  ctx.emit('agent/inbox/inserted', { agent, message: { source: { kind: 'user' } } })
  return agent
}

test('registers the control route and rejects anything but a JSON POST', async () => {
  const { routes, cleanup } = mount()
  try {
    assert.equal(CONTROL_ROUTE_PATH, '/api/memory/control')
    assert.equal(routes.has(CONFIG_ROUTE_PATH), true)
    assert.equal(routes.has(CONTROL_ROUTE_PATH), true)
    const route = routes.get(CONTROL_ROUTE_PATH)

    const get = await routeCall(route, 'GET')
    assert.equal(get.status, 405)

    const badBody = await routeCall(route, 'POST', 'not-json')
    assert.equal(badBody.status, 400)
    assert.ok(parse(badBody).error.includes('JSON'))

    const unknown = await routeCall(route, 'POST', JSON.stringify({ action: 'grow-now' }))
    assert.equal(unknown.status, 400)
    assert.match(parse(unknown).error, /unknown action/)
    assert.ok(parse(unknown).error.includes('grow-now'))
  } finally {
    cleanup()
  }
})

test('growth-now without a live session reports no-session with 200', async () => {
  const { routes, cleanup } = mount()
  try {
    const result = await routeCall(routes.get(CONTROL_ROUTE_PATH), 'POST', JSON.stringify({ action: 'growth-now' }))
    assert.equal(result.status, 200)
    assert.deepEqual(parse(result), { ok: true, delivered: false, reason: 'no-session' })
  } finally {
    cleanup()
  }
})

test('growth-now delivers a growth recap to the active session', async () => {
  const mounted = mount()
  const { routes, dir, cleanup } = mounted
  try {
    const agent = liveSession(mounted)
    const result = await routeCall(routes.get(CONTROL_ROUTE_PATH), 'POST', JSON.stringify({ action: 'growth-now' }))
    assert.equal(result.status, 200)
    assert.deepEqual(parse(result), { ok: true, delivered: true })

    assert.equal(agent.followups.length, 1)
    const message = agent.followups[0]
    assert.ok(message.id.startsWith('memory-growth-'))
    assert.deepEqual(message.source, { kind: 'plugin:memory' })
    assert.ok(message.content[0].text.includes('立即回顾测试条目'))
    assert.equal(existsSync(join(dir, '.growth-recap.json')), true, 'the delivery is recorded as this week')
    const state = JSON.parse(readFileSync(join(dir, '.growth-recap.json'), 'utf8'))
    assert.ok(Math.abs(state.lastAt - Date.now()) < 60_000)
  } finally {
    cleanup()
  }
})

test('growth-now keeps working when proactive recall is disabled (0.13.0 semantics)', async () => {
  const mounted = mount({ recallEnabled: false })
  const { routes, cleanup } = mounted
  try {
    // The store layer agrees: recall off, growth recap on.
    const configRoute = routes.get(CONFIG_ROUTE_PATH)
    const patched = await routeCall(configRoute, 'POST', JSON.stringify({ recallEnabled: false, growthRecapEnabled: true }))
    assert.equal(patched.status, 200)
    assert.equal(parse(patched).recallEnabled, false)

    const agent = liveSession(mounted)
    const result = await routeCall(routes.get(CONTROL_ROUTE_PATH), 'POST', JSON.stringify({ action: 'growth-now' }))
    assert.equal(result.status, 200)
    assert.deepEqual(parse(result), { ok: true, delivered: true })
    assert.equal(agent.followups.length, 1)
    assert.ok(agent.followups[0].id.startsWith('memory-growth-'))
  } finally {
    cleanup()
  }
})

test('growth-now respects the shared floor lock: heartbeat speaking yields a deferred result', async () => {
  const mounted = mount()
  const { routes, dir, cleanup } = mounted
  writeFileSync(
    join(DSH_HOME, 'proactive-cooldown.json'),
    `${JSON.stringify({ version: 1, speaker: 'heartbeat', at: Date.now() })}\n`,
    'utf8',
  )
  try {
    const agent = liveSession(mounted)
    const result = await routeCall(routes.get(CONTROL_ROUTE_PATH), 'POST', JSON.stringify({ action: 'growth-now' }))
    assert.equal(result.status, 200)
    assert.deepEqual(parse(result), { ok: true, delivered: false, reason: 'deferred' })
    assert.equal(agent.followups.length, 0, 'losing the floor means no followup')
    assert.equal(existsSync(join(dir, '.growth-recap.json')), false, 'a deferred recap is not recorded as delivered')
  } finally {
    rmSync(join(DSH_HOME, 'proactive-cooldown.json'), { force: true })
    cleanup()
  }
})

test('growth-now reports no-content instead of speaking into an empty store', async () => {
  const mounted = mount({ memoryDir: makeStore({ withLog: false }) })
  const { routes, cleanup } = mounted
  try {
    const agent = liveSession(mounted)
    const result = await routeCall(routes.get(CONTROL_ROUTE_PATH), 'POST', JSON.stringify({ action: 'growth-now' }))
    assert.equal(result.status, 200)
    assert.deepEqual(parse(result), { ok: true, delivered: false, reason: 'no-content' })
    assert.equal(agent.followups.length, 0)
  } finally {
    cleanup()
  }
})

test('growth-now respects growthRecapEnabled=false from the settings store', async () => {
  const mounted = mount()
  const { routes, cleanup } = mounted
  try {
    await routeCall(routes.get(CONFIG_ROUTE_PATH), 'POST', JSON.stringify({ growthRecapEnabled: false }))
    const agent = liveSession(mounted)
    const result = await routeCall(routes.get(CONTROL_ROUTE_PATH), 'POST', JSON.stringify({ action: 'growth-now' }))
    assert.equal(result.status, 200)
    assert.deepEqual(parse(result), { ok: true, delivered: false, reason: 'growth-disabled' })
    assert.equal(agent.followups.length, 0)
  } finally {
    cleanup()
  }
})
