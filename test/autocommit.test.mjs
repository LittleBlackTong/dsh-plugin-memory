import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { AutoCommitter, gitAvailable, latestMtimeMs, walkFiles } from '../lib/autocommit.js'

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

function commitCount(dir) {
  return Number(git(dir, 'rev-list', '--count', 'HEAD').trim())
}

const TMP = mkdtempSync(join(tmpdir(), 'dsh-memory-autocommit-'))

test('walkFiles skips .git but lists everything else', () => {
  const dir = mkdtempSync(join(TMP, 'walk-'))
  writeFileSync(join(dir, 'a.md'), 'a')
  const files = walkFiles(dir)
  assert.ok(files.includes(join(dir, 'a.md')))
  assert.ok(!files.some((f) => f.includes('.git')))
  assert.ok(latestMtimeMs(dir) > 0)
})

test('auto-commits dirty changes after the quiet period', async () => {
  const dir = mkdtempSync(join(TMP, 'repo-'))
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'test')
  writeFileSync(join(dir, 'a.md'), '# a\n')

  const committer = new AutoCommitter(dir, { quietSeconds: 1, intervalSeconds: 3600 })
  committer.start()
  assert.equal(commitCount(dir), 1, 'pre-existing dirty state flushed at start')

  writeFileSync(join(dir, 'b.md'), '# b\n')
  committer.check() // notices the change, starts the quiet window
  await new Promise((resolve) => setTimeout(resolve, 1100))
  committer.check() // quiet window elapsed → commit
  assert.equal(commitCount(dir), 2, 'new change committed after quiet period')

  committer.check()
  assert.equal(commitCount(dir), 2, 'no change → no new commit')
  committer.dispose()
})

test('no-op (and no throw) when the store is not a git repository', () => {
  const dir = mkdtempSync(join(TMP, 'notgit-'))
  writeFileSync(join(dir, 'a.md'), 'a')
  const committer = new AutoCommitter(dir, { quietSeconds: 1, intervalSeconds: 3600 })
  committer.start()
  assert.equal(commitCountIfAny(dir), 0)
  committer.check()
  committer.dispose()
})

test('dispose stops the poll loop', () => {
  const dir = mkdtempSync(join(TMP, 'dispose-'))
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'test')
  const committer = new AutoCommitter(dir, { quietSeconds: 1, intervalSeconds: 60 })
  committer.start()
  committer.dispose()
  assert.equal(committer.timer, undefined)
})

test('gitAvailable returns a boolean', () => {
  assert.equal(typeof gitAvailable(), 'boolean')
})

/** commit count, or 0 when `dir` has no git repo at all. */
function commitCountIfAny(dir) {
  try {
    return commitCount(dir)
  } catch {
    return 0
  }
}
