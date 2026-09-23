import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  INDEX_LINE_MAX,
  INDEX_SUMMARY_MAX,
  applyIndex,
  clampSummary,
  declaredSummary,
  indexIssues,
  parseIndexPage,
  planIndex,
  renderIndexLine,
  syncDeclaredSummaries,
} from '../lib/index-page.js'
import { today } from '../lib/pages.js'

function page({ title = 't', salience = 2, summary = undefined, body = '正文。' } = {}) {
  const lines = ['---', `title: ${title}`, 'date: 2026-01-01', 'type: user']
  if (salience !== null) lines.push(`salience: ${salience}`)
  // Omit the key entirely for `null` (no declaration) or a falsy value — an
  // empty `summary:` is just a declare-nothing page with extra noise.
  if (summary !== null && summary !== undefined && summary !== '') lines.push(`summary: ${summary}`)
  lines.push(`last_access: ${today()}`, 'tags: []', 'sources: []', '---', '', body, '')
  return lines.join('\n')
}

function makeStore(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'memory-index-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }
  return dir
}

test('parseIndexPage keeps the funnel, sections, ordering and raw lines', () => {
  const text = [
    '# Memory Index',
    '',
    '> intro one',
    '> intro two',
    '',
    '## user（关于你）',
    '',
    '- [profile](user/profile.md) — 档案。 `salience:1`',
    '- [prefs](user/preferences.md) — 偏好。',
    '',
    '## 元记忆',
    '',
    '- [SOUL.md](SOUL.md) — 人格。',
    '',
  ].join('\n')
  const parsed = parseIndexPage(text)
  assert.equal(parsed.title, '# Memory Index')
  assert.deepEqual(parsed.intro, ['', '> intro one', '> intro two', ''])
  assert.deepEqual(parsed.sections.map((s) => s.name), ['user（关于你）', '元记忆'])
  assert.deepEqual(parsed.sections[0].items.map((i) => i.target), ['user/profile.md', 'user/preferences.md'])
  assert.equal(parsed.sections[0].items[0].raw, '- [profile](user/profile.md) — 档案。 `salience:1`')
  assert.equal(parsed.sections[1].items[0].target, 'SOUL.md')
})

test('clampSummary flattens whitespace and never exceeds the cap', () => {
  assert.equal(clampSummary('  a\n  b  '), 'a b')
  const long = '字'.repeat(200)
  const clamped = clampSummary(long)
  assert.ok(clamped.length <= INDEX_SUMMARY_MAX, `got ${clamped.length}`)
  assert.ok(clamped.endsWith('…'))
})

test('declaredSummary is declaration-only — an undeclared page yields nothing', () => {
  assert.equal(declaredSummary({ summary: '一句话。' }), '一句话。')
  assert.equal(declaredSummary({}), '')
  assert.equal(declaredSummary({ summary: '   ' }), '')
  // The body is never mined for a fallback: derived prose measured worse.
  assert.equal(declaredSummary({ title: 'x' }), '')
})

test('renderIndexLine omits the summary and badge when absent', () => {
  assert.equal(renderIndexLine({ target: 'a.md', title: 'A', salience: 1, summary: '说明。' }),
    '- [A](a.md) — 说明。 `salience:1`')
  assert.equal(renderIndexLine({ target: 'a.md', title: 'A', salience: undefined, summary: '' }),
    '- [A](a.md)')
  assert.equal(renderIndexLine({ target: 'a.md', title: '', salience: 2, summary: '' }),
    '- [a.md](a.md) `salience:2`')
})

test('planIndex: a declared page is in sync, drift is detected, meta files are ignored', () => {
  const dir = makeStore({
    'index.md': [
      '# Memory Index',
      '',
      '## user（关于你）',
      '',
      '- [已同步](user/synced.md) — 声明过的摘要。 `salience:1`',
      '- [漂移](user/drifted.md) — 手写的旧摘要。 `salience:2`',
      '',
      '## 元记忆',
      '',
      '- [SOUL.md](SOUL.md) — 人格。',
      '',
    ].join('\n'),
    'user/synced.md': page({ title: '已同步', salience: 1, summary: '声明过的摘要。' }),
    'user/drifted.md': page({ title: '漂移', summary: '页面里的新摘要。' }),
    'SOUL.md': '# SOUL\n',
  })
  try {
    const plan = planIndex(dir)
    // SOUL.md is a root meta file, not a derived page → never rewritten.
    assert.deepEqual(plan.lines.map((l) => l.target), ['user/synced.md', 'user/drifted.md'])
    const [synced, drifted] = plan.lines
    assert.equal(synced.changed, false)
    assert.equal(synced.source, 'declared')
    assert.equal(drifted.changed, true)
    assert.equal(plan.stale, 1)
    assert.deepEqual(plan.removed, [])
    assert.deepEqual(plan.missing, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planIndex reports unlisted pages and dangling links without touching them', () => {
  const dir = makeStore({
    'index.md': '- [a](user/a.md) — a。\n- [gone](user/gone.md) — gone。\n',
    'user/a.md': page({ summary: 'a。' }),
    'user/new.md': page({ title: 'new', summary: 'new。' }),
  })
  try {
    const plan = planIndex(dir)
    assert.deepEqual(plan.missing, ['user/new.md'])
    assert.deepEqual(plan.removed, ['user/gone.md'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('applyIndex rewrites only the drifted lines and preserves everything else', () => {
  const text = [
    '# Memory Index',
    '',
    '## user（关于你）',
    '',
    '- [漂移](user/drifted.md) — 旧摘要。 `salience:2`',
    '- [稳定](user/stable.md) — 稳定摘要。 `salience:1`',
    '',
    '## 元记忆',
    '',
    '- [SOUL.md](SOUL.md) — 人格。',
    '',
  ].join('\n')
  const dir = makeStore({
    'index.md': text,
    'user/drifted.md': page({ title: '漂移', summary: '新摘要。' }),
    'user/stable.md': page({ title: '稳定', salience: 1, summary: '稳定摘要。' }),
    'SOUL.md': '# SOUL\n',
  })
  try {
    const plan = planIndex(dir)
    const result = applyIndex(dir, plan)
    assert.equal(result.written, 1)
    const after = readFileSync(join(dir, 'index.md'), 'utf8')
    assert.match(after, /- \[漂移\]\(user\/drifted\.md\) — 新摘要。 `salience:2`/)
    assert.match(after, /- \[稳定\]\(user\/stable\.md\) — 稳定摘要。 `salience:1`/)
    assert.match(after, /- \[SOUL\.md\]\(SOUL\.md\) — 人格。/)
    assert.match(after, /^## user（关于你）$/m)
    // idempotent: a second pass finds nothing to do
    assert.equal(applyIndex(dir, planIndex(dir)).written, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('syncDeclaredSummaries imports the summary already written in index.md', () => {
  const dir = makeStore({
    'index.md': [
      '# Memory Index',
      '',
      '## user（关于你）',
      '',
      '- [档案](user/a.md) — 阿周的稳定档案。 `salience:1`',
      '- [空行](user/b.md) `salience:2`',
      '',
    ].join('\n'),
    'user/a.md': page({ title: '档案', salience: 1 }),
    'user/b.md': page({ title: '空行' }),
  })
  try {
    const plan = planIndex(dir)
    const result = syncDeclaredSummaries(dir, plan)
    assert.deepEqual(result.synced, ['user/a.md'])
    assert.ok(result.skipped.includes('user/b.md'))
    const a = readFileSync(join(dir, 'user/a.md'), 'utf8')
    assert.match(a, /^summary: 阿周的稳定档案。$/m)
    // The declaration only ever lands inside the frontmatter block.
    assert.ok(a.indexOf('summary:') < a.indexOf('\n---', 3))
    // …and the index now agrees with the page it just imported from.
    assert.equal(planIndex(dir).stale, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('indexIssues: over-declared summaries and undeclared pages, opt-out respected', () => {
  const long = '很长的摘要'.repeat(40) // 200 chars declared, past the 100 cap
  const dir = makeStore({
    'index.md': [
      `- [长](user/long.md) — ${long.slice(0, 50)} \`salience:2\``,
      '- [短](user/short.md)',
      '',
    ].join('\n'),
    'user/long.md': page({ title: '长', summary: long }),
    'user/short.md': page({ title: '短' }),
  })
  try {
    const issues = indexIssues(dir)
    assert.ok(issues.some((i) => i.kind === 'summary-too-long' && i.target === 'user/long.md'))
    assert.ok(issues.some((i) => i.kind === 'no-summary' && i.target === 'user/short.md'))
    const lintIssues = indexIssues(dir, { includeNoSummary: false })
    assert.ok(lintIssues.some((i) => i.kind === 'summary-too-long'))
    assert.ok(!lintIssues.some((i) => i.kind === 'no-summary'))
    // A line that merely drifted is not lint's business (index --check owns it).
    assert.ok(!issues.some((i) => i.kind === 'stale-line'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a clean index with declared summaries yields no issues', () => {
  const dir = makeStore({
    'index.md': '- [a](user/a.md) — 一句话。 `salience:1`\n',
    'user/a.md': page({ title: 'a', salience: 1, summary: '一句话。' }),
  })
  try {
    assert.deepEqual(indexIssues(dir), [])
    assert.equal(INDEX_LINE_MAX, 132)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
