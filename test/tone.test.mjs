/**
 * B. 语气漂移 + C. 情绪表达层（v0.12.0）。
 *
 * 语气段是 boot block 的一部分（每次会话注入），因此它必须：
 *   - 是「可观察行为」的规则，不是玄学人格描述；
 *   - ≤12 行，计入 boot 字符预算，不能把记忆主体挤掉；
 *   - 关掉 toneGuideEnabled 时整段消失（boot 块回到旧形态）；
 *   - 情绪表达层「只表达不假装」：允许描述观察到的处境，禁止伪造第一人称
 *     内心情绪（「我很焦虑」这类模板）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildToneGuide } from '../lib/tone.js'
import { renderBootBlock } from '../lib/boot.js'

const SOUL_FILLED = '# SOUL — 人格与灵魂\n\n- **名字**：小蓝。\n'
const BOOTSTRAP_COMPLETE = '---\nstatus: complete\n---\n\n# BOOTSTRAP\n'

/** Filled, non-bootstrap store so the block is the plain header + files. */
function makeStore(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'memory-tone-'))
  writeFileSync(join(dir, 'SOUL.md'), SOUL_FILLED, 'utf8')
  writeFileSync(join(dir, 'MEMORY.md'), '# MEMORY\n', 'utf8')
  writeFileSync(join(dir, 'index.md'), '# INDEX\n', 'utf8')
  writeFileSync(join(dir, 'BOOTSTRAP.md'), BOOTSTRAP_COMPLETE, 'utf8')
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text, 'utf8')
  return dir
}

// ── buildToneGuide ─────────────────────────────────────────────────────────

test('zh tone guide: title, ≤12 lines, every observable context rule', () => {
  const guide = buildToneGuide({ intensity: 'low', language: 'zh' })
  assert.ok(guide.startsWith('## 语气（按语境微调）'))
  assert.ok(guide.split('\n').length <= 12, `tone guide is ${guide.split('\n').length} lines`)
  for (const needle of ['赶工', '深夜', '23:00', '坏消息', '里程碑', '闲聊']) {
    assert.ok(guide.includes(needle), `missing context rule: ${needle}`)
  }
  // 可观察行为：先结论 / 短句，而不是「要真诚」这类无法执行的形容词。
  assert.match(guide, /先结论|短句/)
  // 红线：任何强度都不降低事实准确性、不越 SOUL 边界。
  assert.match(guide, /事实/)
  assert.match(guide, /SOUL/)
})

test('toneIntensity changes the guide: low vs medium vs off', () => {
  const low = buildToneGuide({ intensity: 'low', language: 'zh' })
  const medium = buildToneGuide({ intensity: 'medium', language: 'zh' })
  const off = buildToneGuide({ intensity: 'off', language: 'zh' })
  assert.notEqual(low, medium, 'intensity must be observable in the injected text')
  assert.ok(low.includes('low'))
  assert.ok(medium.includes('medium'))
  assert.match(medium, /事实优先|事实/)
  assert.equal(off, '', 'toneIntensity=off ships a pure engineering voice (no section)')
})

test('defaults: language zh, intensity low; unknown intensity falls back to low', () => {
  const fallback = buildToneGuide({ intensity: 'low', language: 'zh' })
  assert.equal(buildToneGuide(), fallback)
  assert.equal(buildToneGuide({ intensity: 'BOGUS' }), fallback)
  assert.equal(buildToneGuide({ intensity: undefined }), fallback)
})

// ── C. 情绪表达层：只表达不假装 ────────────────────────────────────────────

test('emotion layer: only expression, never fabricated first-person feelings', () => {
  const guide = buildToneGuide({ intensity: 'low', language: 'zh' })
  // 允许的第一人称表达：描述观察到的事 + 对对方的关心。
  assert.match(guide, /只表达|不假装/)
  assert.match(guide, /看你连着加班|担心你硬扛/)
  // 三类且仅三类场合。
  for (const needle of ['风险', '里程碑', '3 天', '没联系']) {
    assert.ok(guide.includes(needle), `missing emotion occasion: ${needle}`)
  }
  // 禁止伪造主观感受模板。
  for (const banned of ['我很焦虑', '我很', '我感到', '我觉得']) {
    assert.ok(!guide.includes(banned), `fabricated first-person emotion leaked: ${banned}`)
  }
})

test('emotion layer disappears with the whole tone section when turned off', () => {
  assert.equal(buildToneGuide({ intensity: 'off', language: 'zh' }), '')
})

test('en tone guide is English, still bounded and context-aware', () => {
  const guide = buildToneGuide({ intensity: 'low', language: 'en' })
  assert.ok(guide.startsWith('## Tone (adapt to context)'))
  assert.ok(!/[\u4e00-\u9fff]/.test(guide), 'the English guide carries no Chinese copy')
  assert.ok(guide.split('\n').length <= 12)
  for (const needle of ['deep night', 'bad news', 'milestone', 'small talk', 'facts']) {
    assert.ok(guide.toLowerCase().includes(needle.toLowerCase()), `missing en context rule: ${needle}`)
  }
  assert.equal(buildToneGuide({ intensity: 'off', language: 'en' }), '')
})

// ── boot injection ─────────────────────────────────────────────────────────

test('boot block injects the tone section after SOUL and before MEMORY', () => {
  const dir = makeStore()
  try {
    const guide = buildToneGuide({ intensity: 'low', language: 'zh' })
    const block = renderBootBlock(dir, { toneGuide: guide })
    assert.ok(block.includes(guide))
    assert.ok(block.indexOf('### SOUL.md') < block.indexOf('## 语气（按语境微调）'),
      'tone follows the soul file: persona first, then how to speak')
    assert.ok(block.indexOf('## 语气（按语境微调）') < block.indexOf('### MEMORY.md'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('no toneGuide option = byte-for-byte the old block (off means absent)', () => {
  const dir = makeStore()
  try {
    assert.ok(!renderBootBlock(dir).includes('## 语气'))
    assert.ok(!renderBootBlock(dir, { toneGuide: '' }).includes('## 语气'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the tone section is charged to the boot budget (memory body pays for it)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-tone-budget-'))
  try {
    writeFileSync(join(dir, 'SOUL.md'), 'A'.repeat(8000), 'utf8')
    writeFileSync(join(dir, 'MEMORY.md'), 'B'.repeat(8000), 'utf8')
    writeFileSync(join(dir, 'index.md'), 'I'.repeat(10), 'utf8')
    writeFileSync(join(dir, 'BOOTSTRAP.md'), BOOTSTRAP_COMPLETE, 'utf8')

    const withoutTone = renderBootBlock(dir, { bootMaxChars: 12000 })
    const withTone = renderBootBlock(dir, {
      bootMaxChars: 12000,
      toneGuide: buildToneGuide({ intensity: 'medium', language: 'zh' }),
    })
    const countA = (text) => (text.match(/A/g) ?? []).length
    assert.ok(countA(withoutTone) > 7000, `SOUL should get most of the budget (${countA(withoutTone)})`)
    assert.ok(countA(withTone) < countA(withoutTone),
      `the tone section must reduce the file allocation (${countA(withTone)} vs ${countA(withoutTone)})`)
    assert.ok(withTone.includes('## 语气'), 'the tone section itself must survive injection')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('tone.js and proactive-lock.js stay dependency-free (node: builtins only)', async () => {
  for (const file of ['tone.js', 'proactive-lock.js', 'growth.js']) {
    const source = await import('node:fs').then(({ readFileSync }) =>
      readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8'))
    const imports = [...source.matchAll(/^import\s+.*?from\s+'([^']+)'/gm)].map((match) => match[1])
    for (const specifier of imports) {
      // node:* builtins only; relative siblings (e.g. ./pages.js) stay inside
      // this plugin, which is what the zero-cross-plugin-import rule allows.
      assert.ok(specifier.startsWith('node:') || specifier.startsWith('./'),
        `${file}: unexpected dependency ${specifier}`)
    }
  }
})
