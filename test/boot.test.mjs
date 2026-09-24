import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  renderBootBlock,
  needsSoulBootstrap,
  readBootstrapStatus,
  readTailCapped,
  SOUL_DIRECTIVE,
} from '../lib/boot.js'

const SOUL_TEMPLATE = `# SOUL — 人格与灵魂

## 身份

- **名字**：_（铸魂对话中确认）_
`

const SOUL_FILLED = `# SOUL — 人格与灵魂

## 身份

- **名字**：小蓝。
`

const BOOTSTRAP_PENDING = `---
status: pending
---

# BOOTSTRAP — 灵魂定义与身份确认

- [ ] 名字与称呼
`

const BOOTSTRAP_COMPLETE = `---
status: complete
---

# BOOTSTRAP — 灵魂定义与身份确认

- [x] 名字与称呼
`

const INDEX = `# Memory Index\n\n_（暂无）_\n`

/** Build a throwaway store with the given files (name -> content). */
function makeStore(files) {
  const dir = mkdtempSync(join(tmpdir(), 'memory-boot-'))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text, 'utf8')
  return dir
}

test('fresh scaffold (pending + placeholder SOUL) renders the soul directive', () => {
  const dir = makeStore({
    'SOUL.md': SOUL_TEMPLATE,
    'MEMORY.md': '# MEMORY\n',
    'index.md': INDEX,
    'BOOTSTRAP.md': BOOTSTRAP_PENDING,
  })
  try {
    assert.equal(needsSoulBootstrap(dir), true)
    const block = renderBootBlock(dir)
    // First-person onboarding narration, OpenClaw-init style.
    assert.match(block, /我的首要任务是确认我是谁/)
    assert.match(block, /我叫什么名字/)
    assert.match(block, /我该怎么称呼你/)
    // The directive sits ahead of the store files.
    assert.ok(block.indexOf(SOUL_DIRECTIVE) < block.indexOf('### SOUL.md'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('souled store (complete + filled SOUL) hides the directive', () => {
  const dir = makeStore({
    'SOUL.md': SOUL_FILLED,
    'MEMORY.md': '# MEMORY\n',
    'index.md': INDEX,
    'BOOTSTRAP.md': BOOTSTRAP_COMPLETE,
  })
  try {
    assert.equal(needsSoulBootstrap(dir), false)
    const block = renderBootBlock(dir)
    assert.ok(!block.includes('我的首要任务是确认我是谁'))
    assert.ok(!block.includes(SOUL_DIRECTIVE))
    assert.match(block, /小蓝/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('old store without BOOTSTRAP.md: placeholder SOUL still triggers, filled SOUL does not', () => {
  const pending = makeStore({ 'SOUL.md': SOUL_TEMPLATE, 'index.md': INDEX })
  const filled = makeStore({ 'SOUL.md': SOUL_FILLED, 'index.md': INDEX })
  try {
    assert.equal(readBootstrapStatus(pending), 'pending')
    assert.equal(needsSoulBootstrap(pending), true)
    assert.equal(needsSoulBootstrap(filled), false)
    assert.ok(!renderBootBlock(filled).includes(SOUL_DIRECTIVE))
  } finally {
    rmSync(pending, { recursive: true, force: true })
    rmSync(filled, { recursive: true, force: true })
  }
})

test('missing store: everything reads as needing a soul', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-boot-empty-'))
  try {
    assert.equal(needsSoulBootstrap(dir), true)
    // No injectable files at all → boot block stays empty.
    assert.equal(renderBootBlock(dir), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readTailCapped returns the END of a file, not the head', () => {
  const dir = makeStore({})
  try {
    const path = join(dir, 'log.md')
    writeFileSync(path, 'OLDEST\n' + 'x'.repeat(500) + '\nNEWEST\n', 'utf8')
    const tail = readTailCapped(path, 20)
    assert.ok(tail.includes('NEWEST'), 'the tail must carry the newest content')
    assert.ok(!tail.includes('OLDEST'), 'the head must be dropped, not the tail')
    // Shorter than the cap: the whole file comes back.
    assert.ok(readTailCapped(path, 10_000).includes('OLDEST'))
    assert.equal(readTailCapped(join(dir, 'missing.md'), 100), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the boot block shows the NEWEST log entries, not the oldest', () => {
  const dir = makeStore({ 'SOUL.md': SOUL_FILLED, 'index.md': INDEX, 'BOOTSTRAP.md': BOOTSTRAP_COMPLETE })
  try {
    // A long history, exactly like a real append-only log.md.
    const lines = ['# Memory Log', '']
    for (let i = 0; i < 200; i += 1) lines.push(`## [2026-0${i % 9 + 1}-01] kind | 历史条目 ${i}`, '')
    lines.push('## [2026-09-23] release | 最新的一条', '')
    writeFileSync(join(dir, 'log.md'), lines.join('\n'), 'utf8')

    const block = renderBootBlock(dir)
    assert.match(block, /最新的一条/, 'the newest entry must be injected')
    assert.ok(!block.includes('历史条目 0\n'), 'the oldest entry must not be injected')
    // And the headline budget stays small: this block is sent on every request.
    const section = block.slice(block.indexOf('### 最近动态'))
    assert.ok(section.length < 700, `recent-activity section is ${section.length} chars`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
