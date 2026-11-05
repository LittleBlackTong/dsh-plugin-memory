import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveMemoryFile, revealFile } from '../lib/reveal.js'

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'memory-reveal-'))
  writeFileSync(join(dir, 'index.md'), '# Index\n', 'utf8')
  mkdirSync(join(dir, 'projects', 'active'), { recursive: true })
  writeFileSync(join(dir, 'projects', 'active', 'demo.md'), '# Demo\n', 'utf8')
  return dir
}

test('resolveMemoryFile accepts a page inside the store', () => {
  const dir = makeStore()
  try {
    assert.equal(resolveMemoryFile(dir, 'projects/active/demo.md'), join(dir, 'projects', 'active', 'demo.md'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('resolveMemoryFile rejects escapes, missing files and directories', () => {
  const dir = makeStore()
  try {
    assert.throws(() => resolveMemoryFile(dir, '../outside.md'))
    assert.throws(() => resolveMemoryFile(dir, 'missing.md'))
    assert.throws(() => resolveMemoryFile(dir, 'projects'))
    assert.throws(() => resolveMemoryFile(dir, ''))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const okExec = (calls) => (cmd, args, cb) => {
  calls.push([cmd, args])
  cb(null)
}

test('revealFile runs the platform command that selects the file', async () => {
  const dir = makeStore()
  try {
    const calls = []
    const target = join(dir, 'projects', 'active', 'demo.md')

    assert.equal((await revealFile(dir, 'projects/active/demo.md', { execFile: okExec(calls), platform: 'darwin' })).ok, true)
    assert.deepEqual(calls.at(-1), ['open', ['-R', target]])

    await revealFile(dir, 'projects/active/demo.md', { execFile: okExec(calls), platform: 'win32' })
    assert.deepEqual(calls.at(-1), ['explorer', ['/select,', target]])

    await revealFile(dir, 'projects/active/demo.md', { execFile: okExec(calls), platform: 'linux' })
    assert.deepEqual(calls.at(-1), ['xdg-open', [dir + '/projects/active']])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('revealFile refuses to run anything for an escaping id', async () => {
  const dir = makeStore()
  try {
    const calls = []
    await assert.rejects(
      () => revealFile(dir, '../../etc/passwd', { execFile: okExec(calls) }),
      (error) => error.code === 'invalid-id',
    )
    assert.deepEqual(calls, [], 'no command may run for an invalid id')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('revealFile reports a failed command instead of pretending success', async () => {
  const dir = makeStore()
  try {
    const failing = (cmd, args, cb) => cb(new Error('Operation not permitted'))
    await assert.rejects(
      () => revealFile(dir, 'projects/active/demo.md', { execFile: failing, platform: 'darwin' }),
      (error) => error.code === 'exec-failed' && /Operation not permitted/.test(error.message),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('revealFile treats explorer exit code 1 as a success on Windows', async () => {
  const dir = makeStore()
  try {
    const explorerQuirk = (cmd, args, cb) => {
      const error = new Error('explorer exited with code 1')
      error.code = 1
      cb(error)
    }
    const result = await revealFile(dir, 'projects/active/demo.md', { execFile: explorerQuirk, platform: 'win32' })
    assert.equal(result.ok, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
