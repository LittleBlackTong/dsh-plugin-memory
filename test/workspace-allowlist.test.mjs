import assert from 'node:assert/strict'
import test from 'node:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isWorkspaceAllowed } from '../lib/workspace-allowlist.js'

const home = (...parts) => join(homedir(), ...parts)

test('an empty allowlist means "no restriction" (backward compatible)', () => {
  assert.equal(isWorkspaceAllowed('/tmp/anything', [], []), true)
  assert.equal(isWorkspaceAllowed(undefined, [], []), true)
  assert.equal(isWorkspaceAllowed('/tmp/anything', undefined, undefined), true)
})

test('a session inside an allowlisted root is allowed', () => {
  assert.equal(isWorkspaceAllowed('/Users/x/work/repo', ['/Users/x/work'], []), true)
  // the root itself counts as inside
  assert.equal(isWorkspaceAllowed('/Users/x/work', ['/Users/x/work'], []), true)
})

test('a session outside every root is rejected', () => {
  assert.equal(isWorkspaceAllowed('/tmp/junk', ['/Users/x/work'], []), false)
})

test('entries match on path boundaries, not string prefixes', () => {
  assert.equal(isWorkspaceAllowed('/Users/x/work2', ['/Users/x/work'], []), false)
  assert.equal(isWorkspaceAllowed('/Users/x/work/2', ['/Users/x/work'], []), true)
})

test('trailing separators and redundant segments are normalised away', () => {
  assert.equal(isWorkspaceAllowed('/Users/x/work/repo', ['/Users/x/work/'], []), true)
  assert.equal(isWorkspaceAllowed('/Users/x/work/./repo/../repo', ['/Users/x//work'], []), true)
})

test('`~` is expanded in allowlist entries', () => {
  assert.equal(isWorkspaceAllowed(home('dafeiyu', 'qq-bridge'), ['~/dafeiyu'], []), true)
  assert.equal(isWorkspaceAllowed(home('dafeiyu2'), ['~/dafeiyu'], []), false)
})

test('workspaceExclude wins over the allowlist', () => {
  const allow = ['~/']
  assert.equal(isWorkspaceAllowed(home('dafeiyu', 'qq-bridge'), allow, ['~/dafeiyu']), false)
  assert.equal(isWorkspaceAllowed(home('memory'), allow, ['~/dafeiyu']), true)
})

test('a missing cwd is rejected once an allowlist is configured', () => {
  assert.equal(isWorkspaceAllowed(undefined, ['/Users/x/work'], []), false)
  assert.equal(isWorkspaceAllowed('', ['/Users/x/work'], []), false)
  assert.equal(isWorkspaceAllowed('   ', ['/Users/x/work'], []), false)
})

test('blank and non-string entries are ignored, not treated as "allow everything"', () => {
  const roots = ['', '   ', null, undefined, 42]
  // no usable root => falls back to "no restriction"
  assert.equal(isWorkspaceAllowed('/tmp/junk', roots, []), true)
  // a usable root next to junk still gates
  assert.equal(isWorkspaceAllowed('/tmp/junk', [...roots, '/Users/x/work'], []), false)
})
