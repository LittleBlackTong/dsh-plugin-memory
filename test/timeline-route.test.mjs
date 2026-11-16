import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import plugin, { TIMELINE_ROUTE_PATH } from '../lib/index.js'

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

async function routeCall(route, method) {
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
  const req = Readable.from([])
  req.method = method
  await route.handler(req, res)
  return { status: res.status, body: res.body }
}

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'memory-timeline-ep-'))
  mkdirSync(join(dir, 'projects', 'active'), { recursive: true })
  writeFileSync(join(dir, 'projects', 'active', 'dsh-plugin-memory.md'), [
    '---',
    'title: dsh-plugin-memory 插件本体',
    'date: 2026-10-12',
    '---',
    '',
    '# 本体',
  ].join('\n'), 'utf8')
  writeFileSync(join(dir, 'log.md'), [
    '# Memory Log',
    '',
    '## [2026-11-10] fix | dsh-plugin-memory 修复侧栏',
    '## [2026-11-12] publish | 商店分支重建',
    '## [2026-11-12] note | 无新增',
  ].join('\n'), 'utf8')
  return dir
}

function applyWithWebServer(memoryDir) {
  const cfgDir = mkdtempSync(join(tmpdir(), 'memory-timeline-cfg-'))
  const { ctx, injects } = makeFakeCtx()
  const dispose = plugin(ctx, {
    memoryDir,
    scaffold: false,
    autoCommit: false,
    configFile: join(cfgDir, 'memory.json'),
  })
  const { webCtx, routes } = makeWebCtx()
  injects.find((entry) => entry.deps[0] === 'webServer').callback(webCtx)
  return { dispose, routes }
}

test('registers the read-only timeline route and serves parsed events', async () => {
  const dir = makeStore()
  const { dispose, routes } = applyWithWebServer(dir)
  try {
    assert.equal(routes.has(TIMELINE_ROUTE_PATH), true)
    assert.equal(TIMELINE_ROUTE_PATH, '/api/memory/timeline')
    const response = await routeCall(routes.get(TIMELINE_ROUTE_PATH), 'GET')
    assert.equal(response.status, 200)
    const payload = JSON.parse(response.body)
    assert.equal(payload.stats.events, 3)
    assert.equal(payload.stats.first, '2026-11-10')
    assert.equal(payload.stats.last, '2026-11-12')
    const fix = payload.events.find((event) => event.kind === 'fix')
    assert.equal(fix.group, 'fix')
    assert.equal(fix.path, 'projects/active/dsh-plugin-memory.md')
    const note = payload.events.find((event) => event.kind === 'note')
    assert.equal(note.path, undefined)
  } finally {
    dispose()
  }
})

test('rejects non-GET methods with 405', async () => {
  const dir = makeStore()
  const { dispose, routes } = applyWithWebServer(dir)
  try {
    const response = await routeCall(routes.get(TIMELINE_ROUTE_PATH), 'POST')
    assert.equal(response.status, 405)
  } finally {
    dispose()
  }
})

test('serves an empty payload when the log is missing (never fails)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-timeline-empty-'))
  const { dispose, routes } = applyWithWebServer(dir)
  try {
    const response = await routeCall(routes.get(TIMELINE_ROUTE_PATH), 'GET')
    assert.equal(response.status, 200)
    assert.deepEqual(JSON.parse(response.body), { events: [], stats: { events: 0, pages: 0 } })
  } finally {
    dispose()
  }
})
