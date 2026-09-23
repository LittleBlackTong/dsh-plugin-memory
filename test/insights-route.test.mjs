import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import plugin, { CONFIG_ROUTE_PATH, INSIGHTS_ROUTE_PATH } from '../lib/index.js'
import { today } from '../lib/pages.js'

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
  const webCtx = {
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
    effect: () => () => {},
  }
  return { webCtx, routes }
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

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'memory-insights-ep-'))
  mkdirSync(join(dir, 'user'), { recursive: true })
  writeFileSync(join(dir, 'index.md'), '- [a](user/a.md) — a\n', 'utf8')
  writeFileSync(
    join(dir, 'user', 'a.md'),
    `---\ntitle: a\ndate: 2026-01-01\ntype: user\nsalience: 1\nlast_access: ${today()}\ntags: []\nsources: []\n---\n\nbody\n`,
    'utf8',
  )
  return dir
}

test('registers a read-only insights route alongside the config route', async () => {
  const dir = makeStore()
  const cfgDir = mkdtempSync(join(tmpdir(), 'memory-insights-cfg-'))
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

    assert.equal(routes.has(CONFIG_ROUTE_PATH), true)
    assert.equal(routes.has(INSIGHTS_ROUTE_PATH), true)
    assert.equal(INSIGHTS_ROUTE_PATH, '/api/memory/insights')

    const ok = await routeCall(routes.get(INSIGHTS_ROUTE_PATH), 'GET')
    assert.equal(ok.status, 200)
    const payload = JSON.parse(ok.body)
    assert.equal(payload.overview.pages, 1)
    assert.equal(payload.overview.indexEntries, 1)
    assert.equal(payload.health.checks.length, 4)
    assert.equal(payload.store, dir)

    const rejected = await routeCall(routes.get(INSIGHTS_ROUTE_PATH), 'POST', '{}')
    assert.equal(rejected.status, 405)
  } finally {
    dispose()
    rmSync(dir, { recursive: true, force: true })
    rmSync(cfgDir, { recursive: true, force: true })
  }
})

test('the insights route follows a hot memoryDir change', async () => {
  const first = makeStore()
  const second = makeStore()
  const cfgDir = mkdtempSync(join(tmpdir(), 'memory-insights-cfg2-'))
  const { ctx, injects } = makeFakeCtx()
  const dispose = plugin(ctx, {
    memoryDir: first,
    scaffold: false,
    autoCommit: false,
    configFile: join(cfgDir, 'memory.json'),
  })
  try {
    const { webCtx, routes } = makeWebCtx()
    injects.find((entry) => entry.deps[0] === 'webServer').callback(webCtx)
    const configRoute = routes.get(CONFIG_ROUTE_PATH)

    let payload = JSON.parse((await routeCall(routes.get(INSIGHTS_ROUTE_PATH), 'GET')).body)
    assert.equal(payload.store, first)

    await routeCall(configRoute, 'POST', JSON.stringify({ memoryDir: second }))
    payload = JSON.parse((await routeCall(routes.get(INSIGHTS_ROUTE_PATH), 'GET')).body)
    assert.equal(payload.store, second)
  } finally {
    dispose()
    rmSync(first, { recursive: true, force: true })
    rmSync(second, { recursive: true, force: true })
    rmSync(cfgDir, { recursive: true, force: true })
  }
})
