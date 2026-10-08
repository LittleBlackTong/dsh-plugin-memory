import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../scripts/memory.mjs', import.meta.url))

/** Run the CLI against a temp store and return stdout+stderr with the exit code. */
function run(args, store) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, MEMORY_DIR: store ?? '' },
  })
  return { out: `${r.stdout ?? ''}${r.stderr ?? ''}`, status: r.status }
}

/**
 * Windows regression: `pages()` used to return backslash paths (`user\a.md`)
 * while `index.md` links use forward slashes, so every page was reported as an
 * orphan. The check below is separator-agnostic: it simply must not report an
 * orphan for a page that the index does link.
 */
test('lint does not report orphans when the index links the page', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-lint-sep-'))
  try {
    assert.equal(run(['init', dir], '').status, 0)
    writeFileSync(join(dir, 'user', 'a.md'), [
      '---', 'title: 甲', 'date: 2026-01-01', 'type: user', 'salience: 1',
      'last_access: 2026-01-01', 'tags: [user]', 'sources: []', '---', '', 'тело страницы', '',
    ].join('\n'), 'utf8')
    writeFileSync(join(dir, 'index.md'), [
      '# Memory Index', '', '## user（关于用户）', '', '- [a](user/a.md) — 摘要 `salience:1`', '',
    ].join('\n'), 'utf8')

    const lint = run(['lint'], dir)
    assert.ok(
      !/orphan page/.test(lint.out),
      `lint must not report orphans for indexed pages, got:\n${lint.out}`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
