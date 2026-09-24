import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatCheckup, hasWork, runCheckup } from '../lib/checkup.js'
import { today } from '../lib/pages.js'

const DAY = 86400000
const daysAgo = (n) => {
  const d = new Date(Date.now() - n * DAY)
  const pad = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function page({ title = 't', type = 'user', salience = 2, tags = ['dsh'], lastAccess = today(), summary = '一句话。' } = {}) {
  const lines = ['---', `title: ${title}`, 'date: 2026-01-01', `type: ${type}`]
  if (salience !== null) lines.push(`salience: ${salience}`)
  if (lastAccess !== null) lines.push(`last_access: ${lastAccess}`)
  if (tags !== null) lines.push(`tags: [${tags.join(', ')}]`)
  if (summary !== null) lines.push(`summary: ${summary}`)
  lines.push('sources: []', '---', '', '正文。', '')
  return lines.join('\n')
}

function makeStore(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'memory-checkup-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }
  return dir
}

test('a healthy store reports no work to do', () => {
  const dir = makeStore({
    'index.md': '- [a](user/a.md) — 一句话。 `salience:1`\n- [b](user/b.md) — 一句话。 `salience:1`\n',
    'log.md': '# Memory Log\n',
    'user/a.md': page({ title: 'a', salience: 1 }),
    'user/b.md': page({ title: 'b', salience: 1 }),
  })
  try {
    const report = runCheckup(dir)
    assert.equal(report.size.pages, 2)
    assert.deepEqual(report.actions, [], `unexpected actions: ${JSON.stringify(report.actions)}`)
    assert.equal(hasWork(report), false)
    assert.equal(report.integrity.checks.every((c) => c.ok), true)
    assert.match(formatCheckup(report), /没有需要处理的问题/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the report measures the index in characters, not bytes', () => {
  const dir = makeStore({
    'index.md': '- [中文页](user/a.md) — 摘要。 `salience:1`\n',
    'user/a.md': page({ title: '中文页', salience: 1 }),
  })
  try {
    const report = runCheckup(dir, { bootMaxChars: 100 })
    const raw = readFileSync(join(dir, 'index.md'), 'utf8')
    assert.equal(report.size.indexChars, raw.length, 'indexChars must be a character count')
    // 100-char budget with a ~40-char index must not look over budget.
    assert.ok(report.size.indexShare <= 1)
    assert.ok(!report.actions.some((a) => a.includes('boot 预算')), 'a small index is not over budget')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('drift, missing summaries and stale pages each become an action', () => {
  const dir = makeStore({
    'index.md': [
      '- [旧摘要](user/drifted.md) — 这是过期的摘要。 `salience:1`',
      '- [无摘要](user/bare.md)',
      '',
    ].join('\n'),
    'user/drifted.md': page({ title: '漂移', salience: 1, lastAccess: daysAgo(200) }),
    'user/bare.md': page({ title: '无摘要', salience: 1, summary: null }),
  })
  try {
    const report = runCheckup(dir)
    const joined = report.actions.join('\n')
    assert.match(joined, /index --write/, 'drift must suggest the compiler')
    assert.match(joined, /未声明 summary/)
    assert.match(joined, /超过 90 天未访问/)
    // Ordering: fixing the index comes before tidying stale pages.
    assert.ok(joined.indexOf('index --write') < joined.indexOf('未访问'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pages connected only by their index row are surfaced as lonely', () => {
  const dir = makeStore({
    'index.md': '- [a](user/a.md) — 一句话。 `salience:2`\n- [b](user/b.md) — 一句话。 `salience:2`\n',
    'user/a.md': page({ title: '甲', tags: ['alpha'] }),
    'user/b.md': page({ title: '乙', tags: ['beta'] }),
  })
  try {
    const report = runCheckup(dir)
    // An index row is not a relationship, so both pages are "index-only".
    assert.equal(report.links.pageLinks, 0)
    assert.equal(report.links.indexLinks, 2)
    assert.equal(report.links.lonely, 2, 'both pages are connected only through index.md')
    assert.match(formatCheckup(report), /只有索引入口/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a large index share is called out against the boot budget', () => {
  const dir = makeStore({
    'index.md': `- [a](user/a.md) — ${'很长'.repeat(60)} \`salience:1\`\n`,
    'user/a.md': page({ title: 'a', salience: 1, summary: '很长'.repeat(60) }),
  })
  try {
    const report = runCheckup(dir, { bootMaxChars: 200 })
    assert.ok(report.size.indexShare > 0.4)
    assert.ok(report.actions.some((a) => a.includes('boot 预算')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an empty store does not throw and reports nothing to do', () => {
  const report = runCheckup(join(tmpdir(), 'memory-checkup-missing-xyz'))
  assert.equal(report.size.pages, 0)
  assert.equal(report.links.lonely, 0)
  assert.deepEqual(report.actions, [])
  assert.match(formatCheckup(report), /记忆库体检/)
})

test('formatCheckup renders the freshness bars within a bounded width', () => {
  const dir = makeStore({
    'index.md': '- [a](user/a.md) — 一句话。 `salience:1`\n',
    'user/a.md': page({ title: 'a', salience: 1 }),
  })
  try {
    const text = formatCheckup(runCheckup(dir))
    for (const line of text.split('\n')) {
      assert.ok(line.length < 200, `line too long: ${line}`)
    }
    assert.match(text, /█/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
