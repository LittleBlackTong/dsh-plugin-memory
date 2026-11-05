import { test } from 'node:test'
import assert from 'node:assert/strict'

import { expandPath, normalizeNewlines } from '../lib/paths.js'

test('expandPath: ~, ~/ and ~\\ all expand to the home directory', () => {
  const home = '/home/tester'
  assert.equal(expandPath('~', { home }), home)
  assert.equal(expandPath('~/project', { home }), '/home/tester/project')
  assert.equal(expandPath('~\\project', { home }), '/home/tester/project')
})

test('expandPath: Windows %VAR% and POSIX $HOME style variables', () => {
  const env = { USERPROFILE: 'C:\\Users\\tester', HOME: '/home/tester', DSH_HOME: '/tmp/dsh' }
  assert.equal(expandPath('%USERPROFILE%\\memory', { env, home: '/home/tester' }), 'C:\\Users\\tester\\memory')
  assert.equal(expandPath('$HOME/memory', { env, home: '/home/tester' }), '/home/tester/memory')
  assert.equal(expandPath('${DSH_HOME}/memory', { env, home: '/home/tester' }), '/tmp/dsh/memory')
})

test('expandPath: unknown variables and plain paths pass through', () => {
  assert.equal(expandPath('%NOT_SET%\\memory', { env: {} }), '%NOT_SET%\\memory')
  assert.equal(expandPath('C:\\data\\memory', { env: {} }), 'C:\\data\\memory')
  assert.equal(expandPath('  /abs/path  ', { env: {} }), '/abs/path')
})

test('expandPath: empty and non-string values yield undefined', () => {
  assert.equal(expandPath(undefined), undefined)
  assert.equal(expandPath(''), undefined)
  assert.equal(expandPath('   '), undefined)
})

test('normalizeNewlines: CRLF and lone CR become LF', () => {
  assert.equal(normalizeNewlines('a\r\nb\r\n'), 'a\nb\n')
  assert.equal(normalizeNewlines('a\rb'), 'a\nb')
  assert.equal(normalizeNewlines('a\nb'), 'a\nb')
  assert.equal(normalizeNewlines(undefined), '')
  assert.equal(normalizeNewlines(42), '')
})
