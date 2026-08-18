import assert from 'node:assert/strict'
import test from 'node:test'

import plugin, {
  Config,
  apply,
  inject,
  name,
} from '../lib/index.js'

test('default export retains Cordis metadata after DSH unwraps it', () => {
  assert.equal(typeof plugin, 'function')
  assert.equal(plugin, apply)
  assert.equal(plugin.name, name)
  assert.deepEqual(plugin.inject, inject)
  assert.equal(plugin.Config, Config)
})

test('default export remains directly callable', () => {
  const registrations = []
  const ctx = {
    systemPrompt: {
      context(value) {
        registrations.push(['systemPrompt', value])
        return () => {}
      },
    },
    skills: {
      register(value) {
        registrations.push(['skills', value])
        return () => {}
      },
    },
    logger: { info() {} },
  }

  const dispose = plugin(ctx, {
    memoryDir: '/tmp/dsh-plugin-memory-test',
    scaffold: false,
  })

  assert.equal(typeof dispose, 'function')
  assert.deepEqual(registrations.map(([service]) => service), [
    'systemPrompt',
    'skills',
  ])
  dispose()
})
