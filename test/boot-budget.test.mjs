import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allocateBootBudget, renderBootBlock } from '../lib/boot.js'

/** Throwaway store whose boot files hold exactly `sizes[file]` characters. */
function makeStore(sizes) {
  const dir = mkdtempSync(join(tmpdir(), 'memory-budget-'))
  for (const [name, size] of Object.entries(sizes)) {
    writeFileSync(join(dir, name), 'x'.repeat(size), 'utf8')
  }
  return dir
}

test('small index: the allocation never exceeds the block budget', () => {
  const dir = makeStore({ 'SOUL.md': 5000, 'MEMORY.md': 5000, 'index.md': 500 })
  try {
    const caps = allocateBootBudget(dir, { files: ['SOUL.md', 'MEMORY.md', 'index.md'], total: 6000 })
    const sum = [...caps.values()].reduce((a, b) => a + b, 0)
    assert.ok(sum <= 6000, `allocated ${sum} > 6000`)
    assert.equal(caps.get('index.md'), 500) // clamped to its real size
    assert.ok(caps.get('SOUL.md') >= 2000, 'a long file keeps at least its even share')
    assert.ok(caps.get('MEMORY.md') >= 2000, 'a long file keeps at least its even share')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('large index: index takes its share first, and is not clamped to an even split', () => {
  const dir = makeStore({ 'SOUL.md': 20000, 'MEMORY.md': 20000, 'index.md': 20000 })
  try {
    const caps = allocateBootBudget(dir, { files: ['SOUL.md', 'MEMORY.md', 'index.md'], total: 6000 })
    assert.equal(caps.get('index.md'), 2000) // its even share, taken first
    assert.equal(caps.get('SOUL.md'), 2000)
    assert.equal(caps.get('MEMORY.md'), 2000)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('index gets its own larger budget instead of being capped at the even split', () => {
  const dir = makeStore({ 'SOUL.md': 20000, 'MEMORY.md': 20000, 'index.md': 12000 })
  try {
    const caps = allocateBootBudget(dir, {
      files: ['SOUL.md', 'MEMORY.md', 'index.md'],
      total: 6000,
      perFile: { 'index.md': 3500 },
    })
    assert.equal(caps.get('index.md'), 3500) // explicit cap, not the 2000 even share
    assert.ok(caps.get('SOUL.md') >= 1000, `SOUL got ${caps.get('SOUL.md')}`)
    assert.ok(caps.get('MEMORY.md') >= 1000, `MEMORY got ${caps.get('MEMORY.md')}`)
    const sum = [...caps.values()].reduce((a, b) => a + b, 0)
    assert.ok(sum <= 6000, `allocated ${sum} > 6000 (explicit budgets still respect the total)`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('slack from a small file flows to the files that are actually large', () => {
  const dir = makeStore({ 'SOUL.md': 100, 'MEMORY.md': 20000, 'index.md': 500 })
  try {
    const caps = allocateBootBudget(dir, { files: ['SOUL.md', 'MEMORY.md', 'index.md'], total: 6000 })
    // index (500) + SOUL (100) leave ~5400 in the pool; MEMORY spends it up to
    // its ceiling of twice the even share (4000), which is where the rest of
    // the budget stays unspent rather than letting one file swallow the block.
    assert.equal(caps.get('SOUL.md'), 100)
    assert.equal(caps.get('index.md'), 500)
    assert.equal(caps.get('MEMORY.md'), 4000)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('missing files get zero, and their unused share is redistributed', () => {
  const dir = makeStore({ 'SOUL.md': 3000 })
  try {
    const caps = allocateBootBudget(dir, { files: ['SOUL.md', 'MEMORY.md', 'index.md'], total: 6000 })
    assert.equal(caps.get('MEMORY.md'), 0)
    assert.equal(caps.get('index.md'), 0)
    assert.equal(caps.get('SOUL.md'), 3000) // what the file actually holds
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('total budget is never exceeded by the allocation', () => {
  const dir = makeStore({ 'SOUL.md': 9000, 'MEMORY.md': 9000, 'index.md': 1000 })
  try {
    const caps = allocateBootBudget(dir, {
      files: ['SOUL.md', 'MEMORY.md', 'index.md'],
      total: 6000,
      perFile: { 'index.md': 400 },
    })
    const sum = [...caps.values()].reduce((a, b) => a + b, 0)
    assert.ok(sum <= 6000, `allocated ${sum} > 6000`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('renderBootBlock keeps the tail of a large index.md (the bug this fixes)', () => {
  const head = '# Memory Index\n\n' + '- [a](user/a.md) — page a.\n'.repeat(100)
  const tail = '\n- [TAIL-MARKER](projects/last.md) — the last page in the directory.\n'
  const indexText = head + tail
  const dir = makeStore({})
  try {
    writeFileSync(join(dir, 'SOUL.md'), 'SOUL-BODY\n', 'utf8')
    writeFileSync(join(dir, 'MEMORY.md'), 'MEMORY-BODY\n', 'utf8')
    writeFileSync(join(dir, 'index.md'), indexText, 'utf8')
    // index.md alone is ~2.5k — past the flat 2000-char share the old rule
    // gave every file. Redistribution hands it the whole file, so the last
    // entry in the directory survives instead of falling off the cliff.
    const block = renderBootBlock(dir, { bootMaxChars: 5000 })
    assert.ok(indexText.length > 2000, `fixture must exceed the flat share (${indexText.length})`)
    assert.ok(block.includes('TAIL-MARKER'), 'the last index entry must survive injection')
    assert.ok(block.includes('SOUL-BODY'))
    assert.ok(block.includes('MEMORY-BODY'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('renderBootBlock still caps the block at the total budget', () => {
  const dir = makeStore({})
  try {
    writeFileSync(join(dir, 'SOUL.md'), 'S'.repeat(4000), 'utf8')
    writeFileSync(join(dir, 'MEMORY.md'), 'M'.repeat(4000), 'utf8')
    writeFileSync(join(dir, 'index.md'), 'I'.repeat(4000), 'utf8')
    const block = renderBootBlock(dir, { bootMaxChars: 1200 })
    assert.ok(block.length <= 1200 + 600, `block is ${block.length} chars`)
    assert.match(block, /boot 块超出预算/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('boot.js stays dependency-free (node: builtins only)', () => {
  const source = readFileSync(new URL('../lib/boot.js', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/^import\s+.*?from\s+'([^']+)'/gm)].map((m) => m[1])
  assert.ok(imports.length > 0)
  for (const specifier of imports) {
    assert.ok(specifier.startsWith('node:'), `unexpected dependency: ${specifier}`)
  }
})
