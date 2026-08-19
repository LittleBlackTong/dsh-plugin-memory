import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderBootBlock, needsSoulBootstrap, readBootstrapStatus, SOUL_DIRECTIVE } from '../lib/boot.js'

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
