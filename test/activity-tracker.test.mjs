import assert from 'node:assert/strict'
import test from 'node:test'
import { ActivityTracker } from '../lib/activity-tracker.js'

/** Fake agent with the inbox surface the tracker needs. */
function makeAgent(id) {
  const listeners = new Map()
  const agent = {
    id,
    ctx: {
      on(event, cb) {
        listeners.set(event, cb)
        return () => listeners.delete(event)
      },
    },
  }
  agent.emitInboxInserted = (message) => listeners.get('agent/inbox/inserted')?.({ message })
  return agent
}

test('hasUserSpoken is false until a real user message (plugin messages don\'t count)', () => {
  const tracker = new ActivityTracker()
  const a = makeAgent('a')
  tracker.attach(a)
  assert.equal(tracker.hasUserSpoken('a'), false)
  a.emitInboxInserted({ source: { kind: 'plugin', plugin: 'heartbeat' } })
  assert.equal(tracker.hasUserSpoken('a'), false)
  a.emitInboxInserted({ source: { kind: 'user' } })
  assert.equal(tracker.hasUserSpoken('a'), true)
  tracker.dispose()
})

test('isActive: the most recent user message wins', () => {
  const tracker = new ActivityTracker()
  const a = makeAgent('a')
  const b = makeAgent('b')
  tracker.attach(a)
  tracker.attach(b)
  assert.equal(tracker.isActive('a'), false)
  assert.equal(tracker.isActive('b'), false)
  a.emitInboxInserted({ source: { kind: 'user' } })
  assert.equal(tracker.isActive('a'), true)
  assert.equal(tracker.isActive('b'), false)
  b.emitInboxInserted({ source: { kind: 'user' } })
  assert.equal(tracker.isActive('a'), false)
  assert.equal(tracker.isActive('b'), true)
  tracker.dispose()
})

test('shouldInject folds both gates and honors the toggles', () => {
  const tracker = new ActivityTracker()
  const a = makeAgent('a')
  tracker.attach(a)
  // never spoken → blocked by the defer gate
  assert.equal(tracker.shouldInject('a', { deferUntilUserSpeaks: true, activeSessionOnly: true }), false)
  // both toggles off → inject unconditionally
  assert.equal(tracker.shouldInject('a', { deferUntilUserSpeaks: false, activeSessionOnly: false }), true)
  a.emitInboxInserted({ source: { kind: 'user' } })
  assert.equal(tracker.shouldInject('a', { deferUntilUserSpeaks: true, activeSessionOnly: true }), true)
  tracker.dispose()
})

test('isActive skips agents the registry no longer holds', () => {
  const live = makeAgent('live')
  const dead = makeAgent('dead')
  const registry = new Map([[live.id, live]])
  const tracker = new ActivityTracker({ agents: { get: (id) => registry.get(id) } })
  tracker.attach(live)
  tracker.attach(dead)
  live.emitInboxInserted({ source: { kind: 'user' } })
  dead.emitInboxInserted({ source: { kind: 'user' } }) // newer, but dead
  assert.equal(tracker.isActive('dead'), false)
  assert.equal(tracker.isActive('live'), true)
  tracker.dispose()
})

test('detach stops tracking and removes state', () => {
  const tracker = new ActivityTracker()
  const a = makeAgent('a')
  tracker.attach(a)
  a.emitInboxInserted({ source: { kind: 'user' } })
  assert.equal(tracker.hasUserSpoken('a'), true)
  tracker.detach('a')
  assert.equal(tracker.hasUserSpoken('a'), false)
  tracker.dispose()
})

test('attach is idempotent per agent identity', () => {
  const tracker = new ActivityTracker()
  const a = makeAgent('a')
  tracker.attach(a)
  tracker.attach(a)
  a.emitInboxInserted({ source: { kind: 'user' } })
  assert.equal(tracker.hasUserSpoken('a'), true)
  tracker.dispose()
})
