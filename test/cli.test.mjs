import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../scripts/memory.mjs', import.meta.url))

/** Run the CLI against a temp store, returning stdout (`throws` to assert failure). */
function run(args, opts = {}) {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, MEMORY_DIR: opts.store ?? '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

test('a freshly initialized store passes its own lint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-cli-'))
  try {
    run(['init', dir])
    const lint = run(['lint'], { store: dir })
    assert.match(lint, /ok — 0 pages/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('help documents the touch subcommand', () => {
  const out = run([])
  assert.match(out, /touch \[pages\.\.\.\]/)
  assert.match(out, /--touch stamps last_access/)
})

test('query filters on frontmatter instead of guessing keywords', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-cli-query-'))
  try {
    run(['init', dir])
    writeFileSync(join(dir, 'user', 'a.md'), [
      '---', 'title: 甲', 'date: 2026-01-01', 'type: user', 'salience: 1',
      'last_access: 2026-09-23', 'tags: [dsh, plugin]', 'sources: []', '---', '', '独特词 ZEBRA', '',
    ].join('\n'), 'utf8')
    writeFileSync(join(dir, 'decisions', 'b.md'), [
      '---', 'title: 乙', 'date: 2026-01-01', 'type: decision', 'salience: 2',
      'last_access: 2026-09-23', 'tags: [dsh]', 'sources: []', '---', '', '另一个词', '',
    ].join('\n'), 'utf8')
    writeFileSync(join(dir, 'index.md'), '- [a](user/a.md)\n- [b](decisions/b.md)\n', 'utf8')

    const byType = run(['query', '--type', 'decision'], { store: dir })
    assert.match(byType, /1\/2 pages \(type=decision\)/)
    assert.match(byType, /decisions\/b\.md/)
    assert.ok(!byType.includes('user/a.md'), 'the filter must exclude other types')

    const byTag = run(['query', '--tag', 'plugin'], { store: dir })
    assert.match(byTag, /1\/2 pages \(#plugin\)/)
    assert.match(byTag, /user\/a\.md/)

    const byText = run(['query', '--tag', 'dsh', 'ZEBRA'], { store: dir })
    assert.match(byText, /1 page\(s\) matched/)
    assert.match(byText, /ZEBRA/)

    const hot = run(['query', '--hot'], { store: dir })
    assert.match(hot, /1\/2 pages \(hot\)/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── doctor (2026-10-16) ────────────────────────────────────────────────────
//
// `doctor` is the one command you run when something feels off: it checks the
// things that actually break in practice (missing scaffold, orphan pages, git
// state, boot budget) and ends with the command that fixes each finding.
// These tests pin the contract, not the wording of every line.

test('doctor reports the scaffold, the page count and the git state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-doctor-'))
  try {
    run(['init', dir])
    const out = run(['doctor'], { store: dir })
    assert.match(out, /记忆库/, 'must name the store it inspected')
    assert.match(out, /脚手架/, 'must check the scaffold files')
    assert.match(out, /页面/, 'must count pages')
    assert.match(out, /git/i, 'must report git state even when there is no repo')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('doctor flags a missing scaffold file instead of crashing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-doctor-broken-'))
  try {
    run(['init', dir])
    rmSync(join(dir, 'index.md'))
    // A missing scaffold is a hard failure, so doctor exits 1 — execFileSync
    // throws on a non-zero status, and the report we want to assert on rides
    // along on the error object.
    let out
    try {
      out = run(['doctor'], { store: dir })
    } catch (error) {
      out = `${error.stdout ?? ''}${error.stderr ?? ''}`
    }
    assert.match(out, /index\.md/, 'must name the missing file')
    assert.match(out, /[✗×]/, 'must mark it as a failure rather than a warning')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('doctor points at the fixing command when pages are missing from the index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-doctor-orphan-'))
  try {
    run(['init', dir])
    writeFileSync(join(dir, 'user', 'orphan.md'), [
      '---', 'title: 孤儿', 'date: 2026-01-01', 'type: user', 'salience: 2',
      'last_access: 2026-01-01', 'tags: [user]', 'sources: []', '---', '', '正文', '',
    ].join('\n'), 'utf8')
    const out = run(['doctor'], { store: dir })
    assert.match(out, /孤儿|orphan/, 'must report orphans')
    assert.match(out, /dsh-memory index/, 'must name the command that repairs the index')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('doctor appears in the CLI help', () => {
  const out = run([])
  assert.match(out, /doctor/, 'the new subcommand must be discoverable')
})
