import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { needsSoulBootstrap, renderBootBlock } from '../lib/boot.js'
import {
  DEFAULT_SOUL_PROFILE,
  filterBootstrapPlaceholders,
  hasManagedSoulProfile,
  markBootstrapComplete,
  readSoulProfile,
  writeSoulProfile,
} from '../lib/soul.js'

const SOUL_TEMPLATE = `# SOUL — 人格与灵魂

## 身份

- **名字**：_（铸魂对话中确认）_
- **角色**：_（铸魂对话中确认）_

## 性格特质

- _（铸魂对话中确认）_
`

function makeStore(soul = SOUL_TEMPLATE, bootstrap) {
  const dir = mkdtempSync(join(tmpdir(), 'memory-soul-'))
  if (soul !== undefined) writeFileSync(join(dir, 'SOUL.md'), soul, 'utf8')
  if (bootstrap !== undefined) writeFileSync(join(dir, 'BOOTSTRAP.md'), bootstrap, 'utf8')
  return dir
}

test('readSoulProfile: template store reports managed=false with generic defaults', () => {
  const dir = makeStore()
  try {
    const profile = readSoulProfile(dir)
    assert.equal(profile.managed, false)
    assert.equal(profile.agentName, DEFAULT_SOUL_PROFILE.agentName)
    assert.equal(profile.userName, DEFAULT_SOUL_PROFILE.userName)
    assert.equal(profile.summary, DEFAULT_SOUL_PROFILE.summary)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readSoulProfile: a managed block parses back verbatim', () => {
  const dir = makeStore()
  try {
    writeSoulProfile(dir, { agentName: '小蓝', userName: '阿周', summary: '外松内紧，事实优先。' })
    const profile = readSoulProfile(dir)
    assert.equal(profile.managed, true)
    assert.equal(profile.agentName, '小蓝')
    assert.equal(profile.userName, '阿周')
    assert.equal(profile.summary, '外松内紧，事实优先。')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writeSoulProfile: inserts the managed block and preserves the rest of SOUL.md', () => {
  const dir = makeStore()
  try {
    writeSoulProfile(dir, { agentName: '小蓝', userName: '阿周', summary: '先结论后细节。' })
    const text = readFileSync(join(dir, 'SOUL.md'), 'utf8')
    assert.match(text, /dsh-memory:soul:start/)
    assert.match(text, /dsh-memory:soul:end/)
    assert.match(text, /## 身份/, 'the original template sections survive')
    assert.match(text, /名字/, 'the original name line survives')
    assert.equal((text.match(/dsh-memory:soul:start/g) ?? []).length, 1, 'inserted once')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writeSoulProfile: a second save replaces the block instead of duplicating it', () => {
  const dir = makeStore()
  try {
    writeSoulProfile(dir, { agentName: '小蓝', userName: '阿周', summary: 'v1' })
    writeSoulProfile(dir, { agentName: '小蓝', userName: '老板', summary: 'v2' })
    const text = readFileSync(join(dir, 'SOUL.md'), 'utf8')
    assert.equal((text.match(/dsh-memory:soul:start/g) ?? []).length, 1)
    assert.match(text, /老板/)
    assert.doesNotMatch(text, /阿周/)
    assert.match(text, /v2/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writeSoulProfile: rejects empty names and over-long text', () => {
  const dir = makeStore()
  try {
    assert.throws(() => writeSoulProfile(dir, { agentName: '  ', userName: '你', summary: 'x' }))
    assert.throws(() => writeSoulProfile(dir, { agentName: 'a'.repeat(65), userName: '你', summary: 'x' }))
    assert.throws(() => writeSoulProfile(dir, { agentName: 'a', userName: '你', summary: 'x'.repeat(2001) }))
    assert.equal(readFileSync(join(dir, 'SOUL.md'), 'utf8'), SOUL_TEMPLATE, 'nothing was written on error')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('hasManagedSoulProfile: true only when all three fields are set', () => {
  const dir = makeStore()
  try {
    assert.equal(hasManagedSoulProfile(dir), false)
    writeSoulProfile(dir, { agentName: '小蓝', userName: '你', summary: '一句话。' })
    assert.equal(hasManagedSoulProfile(dir), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('markBootstrapComplete: flips status in place and reports whether it changed', () => {
  const dir = makeStore(SOUL_TEMPLATE, '---\nstatus: pending\n---\n\n# BOOTSTRAP\n')
  try {
    assert.equal(markBootstrapComplete(dir), true)
    assert.match(readFileSync(join(dir, 'BOOTSTRAP.md'), 'utf8'), /^status: complete$/m)
    assert.equal(markBootstrapComplete(dir), false, 'already complete is a no-op')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('markBootstrapComplete: missing BOOTSTRAP.md is a no-op', () => {
  const dir = makeStore()
  try {
    assert.equal(markBootstrapComplete(dir), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('filterBootstrapPlaceholders drops placeholder lines for the boot block', () => {
  const filtered = filterBootstrapPlaceholders(SOUL_TEMPLATE)
  assert.doesNotMatch(filtered, /铸魂对话中确认/)
  assert.match(filtered, /## 身份/, 'section headings stay')
  assert.match(filtered, /## 性格特质/)
})

test('a saved profile stops the forging directive and filters placeholders from the injected copy', () => {
  const dir = makeStore(SOUL_TEMPLATE, '---\nstatus: pending\n---\n\n# BOOTSTRAP\n')
  try {
    assert.equal(needsSoulBootstrap(dir), true, 'a template-only store still needs forging')
    writeSoulProfile(dir, { agentName: '小蓝', userName: '阿周', summary: '外松内紧，事实优先。' })
    assert.equal(needsSoulBootstrap(dir), false, 'the managed profile counts as a basic soul')
    const block = renderBootBlock(dir, { bootMaxChars: 12000 })
    assert.ok(block.includes('小蓝'))
    assert.ok(!block.includes('铸魂阶段'), 'no forging directive once the profile exists')
    assert.ok(!block.includes('铸魂对话中确认'), 'placeholders are filtered from the injected copy')
    assert.ok(readFileSync(join(dir, 'SOUL.md'), 'utf8').includes('铸魂对话中确认'), 'the file itself keeps them')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('saving the profile leaves unrelated hand-written soul content alone', () => {
  const dir = makeStore('# SOUL — 人格与灵魂\n\n## 手写补充\n\n- 我喜欢简洁。\n')
  try {
    writeSoulProfile(dir, { agentName: '助手', userName: '你', summary: '通用。' })
    const text = readFileSync(join(dir, 'SOUL.md'), 'utf8')
    assert.match(text, /我喜欢简洁/)
    assert.match(text, /dsh-memory:soul:start/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the generic default persona is a readable multi-line example', () => {
  assert.ok(DEFAULT_SOUL_PROFILE.summary.includes('\n'), 'defaults teach by example, not one line')
  assert.ok(DEFAULT_SOUL_PROFILE.summary.split('\n').length >= 3)
})

test('a multi-line persona description round-trips through the managed block', () => {
  const dir = makeStore()
  try {
    const summary = '第一行：直接、诚实。\n第二行：先结论后细节。\n第三行：不确定就明说。'
    writeSoulProfile(dir, { agentName: '小蓝', userName: '阿周', summary })
    const profile = readSoulProfile(dir)
    assert.equal(profile.summary, summary)
    assert.equal(profile.managed, true)
    const text = readFileSync(join(dir, 'SOUL.md'), 'utf8')
    assert.match(text, /^  第二行：/m, 'continuation lines are indented by two spaces')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a legacy chat-forged SOUL echoes the names it already states', () => {
  const dir = makeStore(`# SOUL — 人格与灵魂

## 身份

- **名字**：小蓝。
- **角色**：阿周的日常开发助手 + 伙伴。

## 与你的关系

- **相互称呼**：阿周 ↔ 小蓝。
`)
  try {
    const profile = readSoulProfile(dir)
    assert.equal(profile.managed, false, 'no managed block yet')
    assert.equal(profile.agentName, '小蓝')
    assert.equal(profile.userName, '阿周')
    assert.match(profile.summary, /日常开发助手/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a CRLF SOUL.md parses normally and keeps CRLF on write-back', () => {
  const dir = makeStore('# SOUL\r\n\r\n- **名字**：小助手。\r\n- **相互称呼**：老板 ↔ 小助手。\r\n')
  try {
    const profile = readSoulProfile(dir)
    assert.equal(profile.agentName, '小助手')
    assert.equal(profile.userName, '老板')
    writeSoulProfile(dir, { agentName: '小助手', userName: '老板', summary: 'CRLF 保留' })
    const updated = readFileSync(join(dir, 'SOUL.md'), 'utf8')
    assert.ok(updated.includes('\r\n'), 'the file keeps its CRLF style')
    assert.doesNotMatch(updated, /[^\r]\n/, 'no bare LF may be introduced')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
