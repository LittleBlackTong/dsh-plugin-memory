import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import plugin, {
  Config,
  SETTINGS_NAMESPACE,
  SettingsSchema,
  apply,
  inject,
  name,
} from '../lib/index.js'

/** Build a fake Cordis ctx. When `settings` is provided, `ctx.inject` fires synchronously. */
function makeFakeCtx({ settings } = {}) {
  const calls = [] // every systemPrompt.context / skills.register call
  const disposed = []
  const effects = []
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
    logger: { info() {} },
    inject: () => {},
    effect(fn) {
      effects.push(fn)
      const cleanup = fn()
      return () => cleanup?.()
    },
  }
  if (settings !== undefined) {
    ctx.inject = (deps, cb) => cb({
      settings,
      effect(fn) {
        effects.push(fn)
        const cleanup = fn()
        return () => cleanup?.()
      },
    })
  }
  return { ctx, calls, disposed }
}

/** Fake settings service: base + user layer, watch fires on set(). */
function makeFakeSettings() {
  let user = {}
  const listeners = []
  const scope = {
    get: () => user,
    watch(cb) {
      listeners.push(cb)
      return () => {}
    },
  }
  return {
    scope,
    registrations: [],
    register(ns, schema, options) {
      this.registrations.push({ ns, schema, options })
      return scope
    },
    set(patch) {
      user = { ...user, ...patch }
      for (const cb of listeners) cb()
    },
  }
}

const CFG = { memoryDir: '/tmp/dsh-plugin-memory-test', scaffold: false }

test('default export retains Cordis metadata after DSH unwraps it', () => {
  assert.equal(typeof plugin, 'function')
  assert.equal(plugin, apply)
  assert.equal(plugin.name, name)
  assert.deepEqual(plugin.inject, inject)
  assert.equal(plugin.Config, Config)
  assert.equal(SETTINGS_NAMESPACE, 'memory')
  assert.equal(typeof SettingsSchema, 'function')
})

test('works without a settings service (config-only fallback)', () => {
  const { ctx, calls, disposed } = makeFakeCtx()
  const dispose = plugin(ctx, CFG)
  assert.deepEqual(calls.map(([service]) => service), ['systemPrompt', 'skills'])
  assert.deepEqual(disposed, [])
  dispose()
  assert.deepEqual(disposed, ['systemPrompt', 'skills'])
})

test('registers the settings namespace with the composition config as base', () => {
  const settings = makeFakeSettings()
  const { ctx } = makeFakeCtx({ settings })
  const dispose = plugin(ctx, { ...CFG, memoryDir: '/tmp/base-dir', autoInject: false })
  assert.equal(settings.registrations.length, 1)
  const { ns, options } = settings.registrations[0]
  assert.equal(ns, 'memory')
  assert.deepEqual(options.base, {
    enabled: true,
    memoryDir: '/tmp/base-dir',
    autoInject: false,
    registerSkill: true,
  })
  dispose()
})

test('hot edit: enabled=false tears both registrations down, re-enable restores them', () => {
  const settings = makeFakeSettings()
  const { ctx, calls, disposed } = makeFakeCtx({ settings })
  const dispose = plugin(ctx, CFG)
  assert.deepEqual(calls.map(([service]) => service), ['systemPrompt', 'skills'])

  settings.set({ enabled: false })
  assert.deepEqual(disposed, ['systemPrompt', 'skills'])
  assert.equal(calls.length, 2) // nothing re-registered

  settings.set({ enabled: true })
  assert.deepEqual(calls.map(([service]) => service), [
    'systemPrompt',
    'skills',
    'systemPrompt',
    'skills',
  ])

  dispose()
  assert.deepEqual(disposed, ['systemPrompt', 'skills', 'systemPrompt', 'skills'])
})

test('hot edit: memoryDir re-registers boot + skill against the new directory', () => {
  const settings = makeFakeSettings()
  const { ctx, calls } = makeFakeCtx({ settings })
  const dispose = plugin(ctx, CFG)

  const otherDir = mkdtempSync(join(tmpdir(), 'dsh-memory-other-'))
  writeFileSync(join(otherDir, 'SOUL.md'), '# soul\n')
  settings.set({ memoryDir: otherDir })

  const bootCall = calls.filter(([service]) => service === 'systemPrompt').at(-1)[1]
  const skillCall = calls.filter(([service]) => service === 'skills').at(-1)[1]
  assert.ok(bootCall.text().includes(otherDir))
  assert.deepEqual(skillCall.resourceBase, { kind: 'directory', path: otherDir })
  dispose()
})

test('sub-switches: autoInject/registerSkill toggle independently', () => {
  const settings = makeFakeSettings()
  const { ctx, calls } = makeFakeCtx({ settings })
  const dispose = plugin(ctx, CFG)

  settings.set({ autoInject: false })
  assert.deepEqual(calls.map(([service]) => service), [
    'systemPrompt', 'skills', // initial
    'skills', // boot torn down, skill re-registered
  ])

  settings.set({ registerSkill: false })
  // skill torn down; boot stays off because autoInject is still false
  assert.deepEqual(calls.map(([service]) => service), [
    'systemPrompt', 'skills',
    'skills',
  ])

  settings.set({ autoInject: true, registerSkill: true })
  assert.deepEqual(calls.map(([service]) => service), [
    'systemPrompt', 'skills',
    'skills',
    'systemPrompt', 'skills', // both restored
  ])
  dispose()
})

test('user-layer settings win over composition config', () => {
  const settings = makeFakeSettings()
  settings.set({ enabled: false, autoInject: false })
  const { ctx, calls } = makeFakeCtx({ settings })
  const dispose = plugin(ctx, CFG)
  assert.deepEqual(calls, []) // fully disabled at startup
  dispose()
})
