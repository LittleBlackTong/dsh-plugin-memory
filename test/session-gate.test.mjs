import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SessionGate,
  defaultSessionStatePath,
  expandHome,
  matchesWorkspace,
} from '../lib/session-gate.js'

const CFG = { globalEnabled: true, disabledWorkspaces: [] }

function makeGate(now = () => Date.now()) {
  const dir = mkdtempSync(join(tmpdir(), 'memory-sessions-'))
  return { dir, gate: new SessionGate({ path: join(dir, 'sessions.json'), now }) }
}

test('defaults to enabled when no override and no workspace rule exist', () => {
  const { dir, gate } = makeGate()
  try {
    assert.equal(gate.effectiveEnabled('s1', '/Users/x/work', CFG), true)
    assert.equal(gate.effectiveEnabled('s1', undefined, CFG), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a session override turns memory off and back on', () => {
  const { dir, gate } = makeGate()
  try {
    gate.setOverride('s1', false)
    assert.equal(gate.effectiveEnabled('s1', '/Users/x/work', CFG), false)
    assert.equal(gate.effectiveEnabled('s2', '/Users/x/work', CFG), true, 'other sessions are untouched')
    gate.setOverride('s1', true)
    assert.equal(gate.effectiveEnabled('s1', '/Users/x/work', CFG), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a disabled workspace turns new sessions off by default', () => {
  const { dir, gate } = makeGate()
  try {
    const cfg = { ...CFG, disabledWorkspaces: [join(homedir(), 'work')] }
    assert.equal(gate.effectiveEnabled('fresh', join(homedir(), 'work', 'repo'), cfg), false)
    assert.equal(gate.effectiveEnabled('fresh', join(homedir(), 'work2'), cfg), true, 'path boundary, not prefix')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a session override wins over the workspace default', () => {
  const { dir, gate } = makeGate()
  try {
    const cfg = { ...CFG, disabledWorkspaces: [join(homedir(), 'work')] }
    gate.setOverride('fresh', true)
    assert.equal(gate.effectiveEnabled('fresh', join(homedir(), 'work', 'repo'), cfg), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the global switch wins over everything', () => {
  const { dir, gate } = makeGate()
  try {
    gate.setOverride('s1', true)
    assert.equal(gate.effectiveEnabled('s1', '/Users/x/work', { ...CFG, globalEnabled: false }), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('workspace matching normalises ~, trailing separators and boundaries', () => {
  assert.equal(matchesWorkspace('/Users/x/work', ['/Users/x/work']), true)
  assert.equal(matchesWorkspace('/Users/x/work/', ['/Users/x/work/']), true)
  assert.equal(matchesWorkspace('/Users/x/work2', ['/Users/x/work']), false)
  assert.equal(matchesWorkspace('/Users/x/work/2', ['/Users/x/work']), true)
  assert.equal(matchesWorkspace(join(homedir(), 'proj'), ['~/proj']), true)
  assert.equal(matchesWorkspace('/Users/x/work', []), false)
  assert.equal(matchesWorkspace('/Users/x/work', undefined), false)
  assert.equal(matchesWorkspace(undefined, ['/Users/x/work']), false)
  assert.equal(expandHome('~'), homedir())
  assert.equal(expandHome('~/proj'), join(homedir(), 'proj'))
  assert.equal(expandHome('/abs'), '/abs')
})

test('stale overrides expire and are pruned', () => {
  let clock = 1_000_000_000
  const { dir, gate } = makeGate(() => clock)
  try {
    gate.setOverride('old', false)
    clock += 8 * 24 * 60 * 60 * 1000 // 8 days later, past the 7-day TTL
    assert.equal(gate.effectiveEnabled('old', '/Users/x/work', CFG), true, 'expired override stops applying')
    const state = JSON.parse(readFileSync(join(dir, 'sessions.json'), 'utf8'))
    assert.equal(state.sessions.old, undefined, 'expired entry is pruned on read')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('overrides survive a reload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-sessions-'))
  try {
    const path = join(dir, 'sessions.json')
    const first = new SessionGate({ path })
    first.setOverride('s1', false)
    const second = new SessionGate({ path })
    assert.equal(second.effectiveEnabled('s1', '/Users/x/work', CFG), false)
    assert.equal(second.effectiveEnabled('s2', '/Users/x/work', CFG), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a corrupt state file is ignored instead of throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-sessions-'))
  try {
    const path = join(dir, 'sessions.json')
    writeFileSync(path, '{ not json', 'utf8')
    const gate = new SessionGate({ path })
    assert.equal(gate.effectiveEnabled('s1', '/Users/x/work', CFG), true)
    gate.setOverride('s1', false) // must still work after a corrupt load
    assert.equal(gate.effectiveEnabled('s1', '/Users/x/work', CFG), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('toggle flips the session and reports the new state', () => {
  const { dir, gate } = makeGate()
  try {
    assert.equal(gate.toggle('s1'), false, 'first toggle turns memory off')
    assert.equal(gate.toggle('s1'), true, 'second toggle turns it back on')
    assert.equal(gate.toggle('s1', false), false, 'explicit value wins over flip')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('default state path lives under DSH_HOME (or ~/.dsh)', () => {
  const previous = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = '/tmp/dsh-home-test'
    assert.equal(defaultSessionStatePath(), '/tmp/dsh-home-test/memory-sessions.json')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

test('matchesWorkspace compares case-insensitively on Windows only', () => {
  assert.equal(matchesWorkspace('/Users/X/Work', ['/users/x/work'], { platform: 'win32' }), true)
  assert.equal(matchesWorkspace('/Users/X/Work2', ['/users/x/work'], { platform: 'win32' }), false)
  assert.equal(matchesWorkspace('/Users/X/Work', ['/users/x/work']), false, 'POSIX stays case-sensitive')
})
