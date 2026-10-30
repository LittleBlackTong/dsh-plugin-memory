/**
 * A. 发言权仲裁（v0.12.0）：memory 与 heartbeat 共享同一份冷却协议文件。
 *
 * 协议（双方各自实现、零 import，只靠这个 JSON 文件沟通）：
 *   { version: 1, speaker: 'memory' | 'heartbeat', at: <epochMs> }
 *
 * 语义：某个 speaker 刚「开口」过，冷却窗口内另一个 speaker 不抢话；
 * 同一个 speaker 自己可以在窗口内续写（不等于自己跟自己抢）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  PROACTIVE_COOLDOWN_FILENAME,
  claimProactiveLock,
  defaultProactiveCooldownPath,
  readProactiveLock,
} from '../lib/proactive-lock.js'

const NOW = 1_700_000_000_000

function makeLockPath(subdir) {
  const dir = mkdtempSync(join(tmpdir(), 'memory-lock-'))
  const path = subdir ? join(dir, subdir, 'proactive-cooldown.json') : join(dir, 'proactive-cooldown.json')
  return { dir, path }
}

function seed(path, value) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), 'utf8')
}

test('claim writes the shared protocol file atomically', () => {
  const { dir, path } = makeLockPath()
  try {
    const result = claimProactiveLock({ path, speaker: 'memory', cooldownSeconds: 180, now: NOW })
    assert.deepEqual(result, { ok: true })
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { version: 1, speaker: 'memory', at: NOW })
    assert.deepEqual(readProactiveLock(path), { version: 1, speaker: 'memory', at: NOW })
    // Atomic write: tmp file renamed away, no debris left next to the lock.
    assert.deepEqual(readdirSync(dir), ['proactive-cooldown.json'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('claim creates the parent directory (<dshHome> may not exist yet)', () => {
  const { dir, path } = makeLockPath('nested/dsh-home')
  try {
    assert.deepEqual(claimProactiveLock({ path, now: NOW }), { ok: true })
    assert.equal(readProactiveLock(path)?.speaker, 'memory')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a fresh heartbeat lock defers memory (deferredBy heartbeat)', () => {
  const { dir, path } = makeLockPath()
  try {
    seed(path, { version: 1, speaker: 'heartbeat', at: NOW - 60_000 })
    const result = claimProactiveLock({ path, speaker: 'memory', cooldownSeconds: 180, now: NOW })
    assert.equal(result.ok, false)
    assert.equal(result.deferredBy, 'heartbeat')
    assert.deepEqual(readProactiveLock(path), { version: 1, speaker: 'heartbeat', at: NOW - 60_000 },
      'a rejected claim never overwrites the holder')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an expired heartbeat lock is claimable and memory takes over', () => {
  const { dir, path } = makeLockPath()
  try {
    seed(path, { version: 1, speaker: 'heartbeat', at: NOW - 181_000 })
    assert.deepEqual(claimProactiveLock({ path, speaker: 'memory', cooldownSeconds: 180, now: NOW }), { ok: true })
    assert.deepEqual(readProactiveLock(path), { version: 1, speaker: 'memory', at: NOW })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the boundary belongs to the cooled-down side (at == now - cooldown*1000 is free)', () => {
  const { dir, path } = makeLockPath()
  try {
    seed(path, { version: 1, speaker: 'heartbeat', at: NOW - 180_000 })
    assert.deepEqual(claimProactiveLock({ path, speaker: 'memory', cooldownSeconds: 180, now: NOW }), { ok: true })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a corrupt lock file counts as no lock (never throws)', () => {
  for (const broken of ['{oops', '[]', 'null', '"heartbeat"', '{"version":1,"speaker":"heartbeat","at":"yesterday"}']) {
    const { dir, path } = makeLockPath()
    try {
      writeFileSync(path, broken, 'utf8')
      assert.equal(readProactiveLock(path), undefined, `bad lock should read as undefined: ${broken}`)
      assert.deepEqual(claimProactiveLock({ path, speaker: 'memory', cooldownSeconds: 180, now: NOW }), { ok: true },
        `bad lock should be claimable: ${broken}`)
      assert.deepEqual(readProactiveLock(path), { version: 1, speaker: 'memory', at: NOW })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('cooldownSeconds=0 disables arbitration entirely (config escape hatch)', () => {
  const { dir, path } = makeLockPath()
  try {
    seed(path, { version: 1, speaker: 'heartbeat', at: NOW })
    assert.equal(claimProactiveLock({ path, speaker: 'memory', cooldownSeconds: 0, now: NOW }).ok, true)
    assert.deepEqual(readProactiveLock(path), { version: 1, speaker: 'heartbeat', at: NOW },
      'when arbitration is off there is nothing to write')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the same speaker may re-claim inside its own cooldown', () => {
  const { dir, path } = makeLockPath()
  try {
    seed(path, { version: 1, speaker: 'memory', at: NOW - 1_000 })
    assert.deepEqual(claimProactiveLock({ path, speaker: 'memory', cooldownSeconds: 180, now: NOW }), { ok: true })
    assert.deepEqual(readProactiveLock(path), { version: 1, speaker: 'memory', at: NOW })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('defaultProactiveCooldownPath honours DSH_HOME and falls back to ~/.dsh', () => {
  const { dir } = makeLockPath()
  const previous = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = dir
    assert.equal(defaultProactiveCooldownPath(), join(dir, PROACTIVE_COOLDOWN_FILENAME))
    delete process.env.DSH_HOME
    assert.ok(defaultProactiveCooldownPath().endsWith(join('.dsh', PROACTIVE_COOLDOWN_FILENAME)))
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(dir, { recursive: true, force: true })
  }
})
