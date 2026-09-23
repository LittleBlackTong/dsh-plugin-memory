import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
