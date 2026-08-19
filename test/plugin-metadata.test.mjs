import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import plugin, {
  CONFIG_ROUTE_PATH,
  Config,
  SettingsSchema,
  apply,
  inject,
  name,
} from '../lib/index.js'
import { MemoryConfigStore } from '../lib/config-store.js'

/** Build a fake Cordis ctx; `ctx.inject` records dependency requests. */
function makeFakeCtx() {
  const calls = [] // every systemPrompt.context / skills.register call
  const disposed = []
  const injects = []
  const ctx = {
    systemPrompt: {
      context(value) {
        calls.push(['systemPrompt', value])
        return () => disposed.push('systemPrompt')
      },
    },
    skills: {
      register(value) {
        calls.push(['skills', value])
        return () => disposed.push('skills')
      },
    },
    logger: { info() {}, warn() {} },
    on() {
      return () => {}
    },
    inject(deps, callback) {
      injects.push({ deps, callback })
    },
    effect(fn) {
      const cleanup = fn()
      return () => cleanup?.()
    },
  }
  return { ctx, calls, disposed, injects }
}

function makeFakeRes() {
  return {
    status: 0,
    headers: undefined,
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body) {
      this.body = body ?? ''
    },
  }
}

async function routeCall(route, method, body) {
  const res = makeFakeRes()
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)])
  req.method = method
  await route.handler(req, res)
  return { status: res.status, body: res.body }
}

const TMP = mkdtempSync(join(tmpdir(), 'dsh-plugin-memory-test-'))
const CFG = {
  memoryDir: join(TMP, 'memory-dir'),
  scaffold: false,
  configFile: join(TMP, 'memory.json'),
}

test('default export retains Cordis metadata after DSH unwraps it', () => {
  assert.equal(typeof plugin, 'function')
  assert.equal(plugin, apply)
  assert.equal(plugin.name, name)
  assert.deepEqual(plugin.inject, inject)
  assert.equal(plugin.Config, Config)
  assert.equal(typeof SettingsSchema, 'function')
  assert.equal(CONFIG_ROUTE_PATH, '/api/memory/config')
})

test('works without a webServer (headless): config-only, boot + skill registered', () => {
  const { ctx, calls, disposed, injects } = makeFakeCtx()
  const dispose = plugin(ctx, CFG)
  assert.deepEqual(calls.map(([service]) => service), ['systemPrompt', 'skills'])
  assert.deepEqual(disposed, [])
  assert.deepEqual(injects.map((entry) => entry.deps), [['webServer']])
  dispose()
  assert.deepEqual(disposed, ['systemPrompt', 'skills'])
})

test('registers the config route and GET serves the resolved config', async () => {
  const { ctx, injects } = makeFakeCtx()
  const dispose = plugin(ctx, CFG)

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
  const webInject = injects.find((entry) => entry.deps[0] === 'webServer')
  assert.ok(webInject !== undefined)
  webInject.callback(webCtx)

  assert.equal(routes.has(CONFIG_ROUTE_PATH), true)
  const route = routes.get(CONFIG_ROUTE_PATH)
  assert.equal(route.kind, 'exact')

  const { status, body } = await routeCall(route, 'GET')
  assert.equal(status, 200)
  assert.deepEqual(JSON.parse(body), {
    enabled: true,
    memoryDir: CFG.memoryDir,
    autoInject: true,
    registerSkill: true,
  })
  dispose()
})

test('POST hot-edits: enabled=false tears both registrations down; restore re-registers', async () => {
  const { ctx, calls, disposed, injects } = makeFakeCtx()
  const dispose = plugin(ctx, CFG)

  const routes = new Map()
  injects.find((entry) => entry.deps[0] === 'webServer').callback({
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
    effect: () => () => {},
  })
  const route = routes.get(CONFIG_ROUTE_PATH)
  assert.deepEqual(calls.map(([service]) => service), ['systemPrompt', 'skills'])

  let result = await routeCall(route, 'POST', JSON.stringify({ enabled: false }))
  assert.equal(result.status, 200)
  assert.equal(JSON.parse(result.body).enabled, false)
  assert.deepEqual(disposed, ['systemPrompt', 'skills'])
  assert.equal(calls.length, 2) // nothing re-registered

  result = await routeCall(route, 'POST', JSON.stringify({ enabled: true }))
  assert.equal(result.status, 200)
  assert.deepEqual(calls.map(([service]) => service), [
    'systemPrompt', 'skills', 'systemPrompt', 'skills',
  ])

  dispose()
  assert.deepEqual(disposed, ['systemPrompt', 'skills', 'systemPrompt', 'skills'])
})

test('POST rejects a bad patch and an empty memoryDir', async () => {
  const { ctx, injects } = makeFakeCtx()
  const dispose = plugin(ctx, CFG)
  const routes = new Map()
  injects.find((entry) => entry.deps[0] === 'webServer').callback({
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
    effect: () => () => {},
  })
  const route = routes.get(CONFIG_ROUTE_PATH)

  let result = await routeCall(route, 'POST', 'not-json')
  assert.equal(result.status, 400)
  assert.ok(JSON.parse(result.body).error.includes('JSON'))

  result = await routeCall(route, 'POST', JSON.stringify({ memoryDir: '   ' }))
  assert.equal(result.status, 400)
  assert.ok(JSON.parse(result.body).error.includes('memoryDir'))

  result = await routeCall(route, 'PUT')
  assert.equal(result.status, 405)
  dispose()
})

test('config file wins over composition base and persists', () => {
  const path = join(TMP, `memory-store-${Date.now()}.json`)
  writeFileSync(path, JSON.stringify({ enabled: false, autoInject: false }))
  const store = new MemoryConfigStore({
    path,
    base: { enabled: true, memoryDir: '/tmp/base-dir', autoInject: true, registerSkill: true },
  })
  assert.equal(store.get().enabled, false)
  assert.equal(store.get().autoInject, false)
  assert.equal(store.get().memoryDir, '/tmp/base-dir') // not in file → base
  assert.equal(store.get().registerSkill, true) // not in file → base

  const next = store.update({ memoryDir: '~/.mem-test' })
  assert.equal(next.memoryDir, '~/.mem-test')
  const persisted = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(persisted.memoryDir, '~/.mem-test')
  assert.equal(persisted.enabled, false)

  const reloaded = new MemoryConfigStore({ path, base: {} })
  assert.equal(reloaded.get().memoryDir, '~/.mem-test')
  assert.equal(reloaded.get().enabled, false)
})

test('store: corrupt file is ignored, watchers fire on update', () => {
  const path = join(TMP, `memory-store-bad-${Date.now()}.json`)
  writeFileSync(path, '{oops')
  const store = new MemoryConfigStore({ path, base: { memoryDir: '/tmp/ok' } })
  assert.equal(store.get().memoryDir, '/tmp/ok')

  const seen = []
  const unwatch = store.watch((config) => seen.push(config.memoryDir))
  store.update({ memoryDir: '/tmp/changed' })
  assert.deepEqual(seen, ['/tmp/changed'])
  unwatch()
  store.update({ memoryDir: '/tmp/changed-2' })
  assert.deepEqual(seen, ['/tmp/changed'])
})

test('wiring: apply() starts the auto-committer and flushes a dirty git store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-memory-wiring-'))
  const cfgDir = mkdtempSync(join(tmpdir(), 'dsh-memory-wiring-cfg-'))
  execFileSync('git', ['-C', dir, 'init', '-q'])
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'test'])
  writeFileSync(join(dir, 'SOUL.md'), '# soul\n')

  const { ctx } = makeFakeCtx()
  const dispose = plugin(ctx, {
    ...CFG,
    memoryDir: dir,
    scaffold: false,
    autoCommit: true,
    configFile: join(cfgDir, 'memory.json'),
  })
  const count = Number(execFileSync(
    'git', ['-C', dir, 'rev-list', '--count', 'HEAD'],
    { encoding: 'utf8' },
  ).trim())
  assert.equal(count, 1, 'pre-existing dirty state committed at startup')
  dispose()
})

test('ships a dsh.bundle manifest so `dsh plugin add` can mount it', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.ok(
    pkg.files?.includes('cordis.patch.yml'),
    'cordis.patch.yml must be in the npm tarball (files whitelist)',
  )
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  assert.ok(patch.includes('id: dsh-memory'))
  assert.ok(patch.includes('name: dsh-plugin-memory'))
})

test('hot edit: memoryDir re-registers boot + skill against the new directory', async () => {
  const { ctx, calls, injects } = makeFakeCtx()
  const dispose = plugin(ctx, CFG)
  const routes = new Map()
  injects.find((entry) => entry.deps[0] === 'webServer').callback({
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
    effect: () => () => {},
  })
  const route = routes.get(CONFIG_ROUTE_PATH)

  const otherDir = mkdtempSync(join(tmpdir(), 'dsh-memory-other-'))
  writeFileSync(join(otherDir, 'SOUL.md'), '# soul\n')
  const result = await routeCall(route, 'POST', JSON.stringify({ memoryDir: otherDir }))
  assert.equal(result.status, 200)

  const bootCall = calls.filter(([service]) => service === 'systemPrompt').at(-1)[1]
  const skillCall = calls.filter(([service]) => service === 'skills').at(-1)[1]
  assert.ok(bootCall.text().includes(otherDir))
  assert.deepEqual(skillCall.resourceBase, { kind: 'directory', path: otherDir })
  dispose()
})
