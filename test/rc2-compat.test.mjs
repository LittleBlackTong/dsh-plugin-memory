import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import plugin from '../lib/index.js'

/**
 * DSH 0.2.2-rc.2 host shape: `ctx.agents` exposes `list()` and has no
 * `roots()`; `agent/created` is a *serial* event whose listener failures
 * reject the agent registration (which made every session unusable).
 */
function makeRc2Ctx() {
  const listeners = new Map()
  const effects = []
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-memory-rc2-'))
  const ctx = {
    systemPrompt: { context: () => () => {} },
    skills: { register: () => () => {} },
    logger: { info() {}, warn() {} },
    on(event, callback) {
      listeners.set(event, callback)
      return () => listeners.delete(event)
    },
    inject() {},
    effect(fn) {
      const cleanup = fn()
      effects.push(cleanup)
      return () => cleanup?.()
    },
    agents: { list: () => [], get: () => undefined },
  }
  return { ctx, listeners, tmp }
}

function makeAgent() {
  return {
    id: 'session-rc2',
    session: { header: { cwd: '/tmp' } },
    ctx: { effect: (fn) => { const cleanup = fn(); return () => cleanup?.() } },
  }
}

for (const shape of ['rc2-list-only', 'legacy-roots']) {
  test(`host with agents.${shape} loads and survives agent/created`, () => {
    const { ctx, listeners, tmp } = makeRc2Ctx()
    if (shape === 'legacy-roots') {
      ctx.agents = { roots: () => [], get: () => undefined }
    }
    const dispose = plugin(ctx, {
      memoryDir: join(tmp, 'memory'),
      scaffold: false,
      configFile: join(tmp, 'memory.json'),
    })
    const created = listeners.get('agent/created')
    assert.equal(typeof created, 'function', 'the plugin subscribes to agent/created')
    assert.doesNotThrow(() => created({ agent: makeAgent() }))
    assert.doesNotThrow(() => created({}), 'a malformed payload must not throw either')
    dispose()
  })
}

test('a registry where roots() throws does not break agent/created (rc.1 edge)', () => {
  const { ctx, listeners, tmp } = makeRc2Ctx()
  ctx.agents = {
    roots() { throw new Error('no roots on this host') },
    list() { throw new Error('list also unavailable') },
    get: () => undefined,
  }
  const dispose = plugin(ctx, {
    memoryDir: join(tmp, 'memory'),
    scaffold: false,
    configFile: join(tmp, 'memory.json'),
  })
  const created = listeners.get('agent/created')
  assert.doesNotThrow(() => created({ agent: makeAgent() }))
  dispose()
})
