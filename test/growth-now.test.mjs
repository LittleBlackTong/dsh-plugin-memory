/**
 * Manual growth recap ("review now") — host side.
 *
 * The settings panel's button posts `{action:'growth-now'}` to
 * `/api/memory/control`; the route reaches the live RecallNudge and asks it to
 * deliver one weekly recap immediately. Manual means the weekly cadence is not
 * required and the per-session recall cap is not consulted — but the plugin
 * must be enabled, the agent idle, growth material must exist, and the shared
 * speech-floor lock (dsh-plugin-heartbeat) still wins.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import plugin, { CONTROL_ROUTE_PATH, CONFIG_ROUTE_PATH } from '../lib/index.js'
import { RecallNudge } from '../lib/recall-nudge.js'
import { today } from '../lib/pages.js'

const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/** A store with two recent log entries and one page, enough to recap. */
function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'memory-growth-now-'))
  mkdirSync(join(dir, 'user'), { recursive: true })
  writeFileSync(join(dir, 'index.md'), '- [a](user/a.md) — a\n', 'utf8')
  writeFileSync(
    join(dir, 'user', 'a.md'),
    `---\ntitle: a\ndate: ${today()}\ntype: user\nsalience: 1\nlast_access: ${today()}\ntags: []\nsources: []\n---\n\nbody\n`,
    'utf8',
  )
  writeFileSync(join(dir, 'log.md'), [
    '# Memory Log',
    '',
    `## [${today()}] remember | 阿周喜欢先给结论`,
    '',
    `## [${today()}] decision | 发布前必须全量测试全绿`,
    '',
  ].join('\n'), 'utf8')
  return dir
}

function makeNudge({ storeDir, config = {}, growth = {}, claimLock, status = 'idle' } = {}) {
  const followups = []
  const agent = {
    id: 'agent-1',
    status,
    followup: (message) => followups.push(message),
    ctx: { on: () => () => {} },
  }
  const nudge = new RecallNudge(agent, {
    readConfig: () => ({
      enabled: true,
      minMinutes: 5,
      maxMinutes: 10,
      maxPerSession: 3,
      proactiveCooldownSeconds: 180,
      ...config,
    }),
    readGrowthConfig: () => ({
      enabled: true,
      intervalDays: 7,
      language: 'zh',
      ...growth,
    }),
    getMemoryDir: () => storeDir,
    agents: { get: (id) => (id === agent.id ? agent : undefined) },
    claimLock: claimLock ?? (() => ({ ok: true })),
    logger: { info() {}, warn() {} },
  })
  return { nudge, agent, followups }
}

test('forceGrowthRecap delivers one first-person recap and stamps the state file', () => {
  const dir = makeStore()
  try {
    const { nudge, followups } = makeNudge({ storeDir: dir })
    const result = nudge.forceGrowthRecap()
    assert.deepEqual(result, { delivered: true, reason: 'delivered' })
    assert.equal(followups.length, 1)
    const message = followups[0]
    assert.equal(message.source.kind, 'plugin:memory')
    assert.equal(message.role, 'user')
    assert.match(message.content[0].text, /成长回顾/)
    // The weekly state file is stamped, so the automatic cadence will not
    // repeat the same recap right after a manual one.
    assert.ok(readFileSync(join(dir, '.growth-recap.json'), 'utf8').includes('lastAt'))
    // And a second manual call still works (manual ignores the cadence) but
    // never invents a message when nothing changed? It re-delivers by design.
    assert.equal(nudge.forceGrowthRecap().delivered, true)
    // A manual recap pushes the automatic cadence forward (no back-to-back
    // proactive messages), while the per-session cap is intentionally bypassed.
    assert.ok(nudge.nextRecallAt > Date.now(), 'the automatic cadence moved forward')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('forceGrowthRecap declines with a reason instead of throwing', () => {
  const dir = makeStore()
  try {
    const disabled = makeNudge({ storeDir: dir, config: { enabled: false } })
    assert.deepEqual(disabled.nudge.forceGrowthRecap(), { delivered: false, reason: 'disabled' })
    assert.equal(disabled.followups.length, 0)

    const growthOff = makeNudge({ storeDir: dir, growth: { enabled: false } })
    assert.deepEqual(growthOff.nudge.forceGrowthRecap(), { delivered: false, reason: 'growth-disabled' })

    const busy = makeNudge({ storeDir: dir, status: 'running' })
    assert.deepEqual(busy.nudge.forceGrowthRecap(), { delivered: false, reason: 'busy' })

    const deferred = makeNudge({ storeDir: dir, claimLock: () => ({ ok: false, deferredBy: 'heartbeat' }) })
    assert.deepEqual(deferred.nudge.forceGrowthRecap(), { delivered: false, reason: 'deferred', deferredBy: 'heartbeat' })
    assert.equal(deferred.followups.length, 0)

    const gone = makeNudge({ storeDir: dir })
    gone.nudge.agents = { get: () => undefined }
    assert.deepEqual(gone.nudge.forceGrowthRecap(), { delivered: false, reason: 'agent-gone' })

    const emptyDir = mkdtempSync(join(tmpdir(), 'memory-growth-empty-'))
    try {
      const empty = makeNudge({ storeDir: emptyDir })
      assert.deepEqual(empty.nudge.forceGrowthRecap(), { delivered: false, reason: 'no-content' })
    } finally {
      rmSync(emptyDir, { recursive: true, force: true })
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── the control route ──────────────────────────────────────────────────────

function makeFakeCtx() {
  const injects = []
  const ctx = {
    systemPrompt: { context: () => () => {} },
    skills: { register: () => () => {} },
    logger: { info() {}, warn() {} },
    on: () => () => {},
    inject(deps, callback) {
      injects.push({ deps, callback })
    },
    effect(fn) {
      const cleanup = fn()
      return () => cleanup?.()
    },
  }
  return { ctx, injects }
}

function makeWebCtx() {
  const routes = new Map()
  return {
    webCtx: {
      webServer: {
        register(route) {
          routes.set(route.path, route)
          return () => routes.delete(route.path)
        },
      },
      effect: () => () => {},
    },
    routes,
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

test('the control route answers growth-now with a structured result', async () => {
  const dir = makeStore()
  const cfgDir = mkdtempSync(join(tmpdir(), 'memory-growth-now-cfg-'))
  const { ctx, injects } = makeFakeCtx()
  const dispose = plugin(ctx, {
    memoryDir: dir,
    scaffold: false,
    autoCommit: false,
    configFile: join(cfgDir, 'memory.json'),
  })
  try {
    const { webCtx, routes } = makeWebCtx()
    injects.find((entry) => entry.deps[0] === 'webServer').callback(webCtx)
    assert.equal(routes.has(CONTROL_ROUTE_PATH), true)
    assert.equal(CONTROL_ROUTE_PATH, '/api/memory/control')

    // No live root agent in this fake context: a valid request still returns a
    // structured "nothing delivered" instead of an error.
    const noAgent = await routeCall(routes.get(CONTROL_ROUTE_PATH), 'POST', JSON.stringify({ action: 'growth-now' }))
    assert.equal(noAgent.status, 200)
    assert.deepEqual(JSON.parse(noAgent.body), { ok: true, delivered: false, reason: 'no-session' })

    const unknown = await routeCall(routes.get(CONTROL_ROUTE_PATH), 'POST', JSON.stringify({ action: 'nope' }))
    assert.equal(unknown.status, 400)
    assert.match(JSON.parse(unknown.body).error, /unknown action/)

    const badBody = await routeCall(routes.get(CONTROL_ROUTE_PATH), 'POST', '{not json')
    assert.equal(badBody.status, 400)

    const wrongMethod = await routeCall(routes.get(CONTROL_ROUTE_PATH), 'GET')
    assert.equal(wrongMethod.status, 405)

    // The config route is still there; the control route rides beside it.
    assert.equal(routes.has(CONFIG_ROUTE_PATH), true)
  } finally {
    dispose()
    rmSync(dir, { recursive: true, force: true })
    rmSync(cfgDir, { recursive: true, force: true })
  }
})

test('the package declares the DSH engine range the plugin actually needs', () => {
  // memory 0.11+ hard-depends on the host locale service and 0.12+ on session
  // projections, so the compat gate (engines.dsh) must be able to reject older
  // hosts instead of shipping a half-mounted client.
  assert.equal(PKG.engines?.dsh, '^0.2.1-rc.5')
  assert.equal(PKG.engines?.node, '>=18')
})
