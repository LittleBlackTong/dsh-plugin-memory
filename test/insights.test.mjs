import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectInsights, readRecentLog } from '../lib/insights.js'
import { today } from '../lib/pages.js'

const DAY = 86400000

function daysAgo(days) {
  const d = new Date(Date.now() - days * DAY)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function page({ title = 't', type = 'user', salience = 2, lastAccess = today(), body = '正文' } = {}) {
  const lines = ['---', `title: ${title}`, 'date: 2026-01-01', `type: ${type}`]
  if (salience !== null) lines.push(`salience: ${salience}`)
  if (lastAccess !== null) lines.push(`last_access: ${lastAccess}`)
  lines.push('tags: []', 'sources: []', '---', '', body, '')
  return lines.join('\n')
}

function makeStore(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'memory-insights-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }
  return dir
}

test('a missing store yields a zeroed, healthy payload instead of throwing', () => {
  const dir = join(tmpdir(), `memory-insights-missing-${Date.now()}`)
  const insights = collectInsights(dir)
  assert.equal(insights.overview.pages, 0)
  assert.equal(insights.overview.bytes, 0)
  assert.equal(insights.health.score, 100)
  assert.equal(insights.stalePages.length, 0)
  assert.deepEqual(insights.recent, [])
})

test('overview, distributions and freshness buckets are derived from the store', () => {
  const dir = makeStore({
    'index.md': [
      '# Memory Index',
      '- [a](user/fresh.md) — a',
      '- [b](user/old.md) — b',
      '- [c](skills/never.md) — c',
      '',
    ].join('\n'),
    'log.md': [
      '# Memory Log',
      '## [2026-09-20] project | 第一件事',
      '## [2026-09-23] feature | 第二件事',
      '',
    ].join('\n'),
    'user/fresh.md': page({ type: 'user', lastAccess: today() }),
    'user/old.md': page({ type: 'user', salience: 3, lastAccess: daysAgo(200) }),
    'skills/never.md': page({ type: 'skill', salience: 1, lastAccess: null }),
  })
  try {
    const insights = collectInsights(dir)
    assert.equal(insights.overview.pages, 3)
    assert.equal(insights.overview.indexEntries, 3)
    assert.ok(insights.overview.bytes > 0)
    assert.ok(insights.overview.chars > 0)
    assert.equal(insights.overview.neverAccessed, 1)

    const byType = Object.fromEntries(insights.byType.map((t) => [t.type, t.count]))
    assert.deepEqual(byType, { user: 2, skill: 1 })
    // Additive, locale-neutral alias for clients that translate labels themselves.
    assert.deepEqual(insights.typeCounts, insights.byType, 'typeCounts mirrors byType row for row')
    assert.deepEqual(insights.typeCounts.map((t) => t.type), ['user', 'skill'])
    assert.ok(insights.typeCounts.every((t) => typeof t.label === 'string' && t.label.length > 0),
      'the Chinese display label stays on every row for CLI / older consumers')
    const bySalience = Object.fromEntries(insights.bySalience.map((s) => [s.level, s.count]))
    assert.deepEqual(bySalience, { 1: 1, 2: 1, 3: 1 })

    const buckets = Object.fromEntries(insights.freshness.buckets.map((b) => [b.key, b.count]))
    assert.equal(buckets.today, 1)
    assert.equal(buckets.stale, 1)
    assert.equal(insights.freshness.never, 1)

    // Newest log entry first, so the panel reads top-down.
    assert.deepEqual(insights.recent, ['[2026-09-23] feature | 第二件事', '[2026-09-20] project | 第一件事'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stalePages lists the oldest access first and marks never-accessed pages', () => {
  const dir = makeStore({
    'user/ancient.md': page({ lastAccess: daysAgo(400) }),
    'user/edge.md': page({ lastAccess: daysAgo(120) }),
    'user/fresh.md': page({ lastAccess: today() }),
    'user/never.md': page({ lastAccess: null }),
  })
  try {
    const { stalePages } = collectInsights(dir)
    const paths = stalePages.map((p) => p.path)
    // A page that was never stamped sorts as the most stale, ahead of a 400-day page.
    assert.deepEqual(paths.slice(0, 2), ['user/never.md', 'user/ancient.md'])
    assert.ok(paths.includes('user/edge.md'))
    assert.ok(!paths.includes('user/fresh.md'))
    assert.equal(stalePages.find((p) => p.path === 'user/never.md').daysSinceAccess, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('health checks mirror lint: broken index links and orphans fail, clean store passes', () => {
  const clean = makeStore({
    'index.md': '- [a](user/a.md) — a\n',
    'user/a.md': page(),
  })
  const messy = makeStore({
    'index.md': '- [a](user/a.md) — a\n- [gone](user/missing.md) — gone\n',
    'user/a.md': page({ salience: null, type: null }),
    'user/orphan.md': page({ lastAccess: daysAgo(200) }),
  })
  try {
    const cleanResult = collectInsights(clean)
    assert.equal(cleanResult.health.checks.every((c) => c.ok), true, 'clean store passes every check')
    assert.equal(cleanResult.health.checks.find((c) => c.id === 'index').detail, '1 条路由全部有效')
    // Locale-neutral `data` rides alongside the Chinese strings (additive).
    assert.deepEqual(cleanResult.health.checks.find((c) => c.id === 'index').data, { routes: 1, missing: 0 })
    assert.deepEqual(cleanResult.health.checks.find((c) => c.id === 'orphans').data, { count: 0, sample: [] })
    assert.deepEqual(cleanResult.health.checks.find((c) => c.id === 'frontmatter').data, { missingSalience: 0, missingType: 0 })
    assert.deepEqual(cleanResult.health.checks.find((c) => c.id === 'freshness').data, { atRisk: 0 })

    const messyResult = collectInsights(messy)
    assert.equal(messyResult.health.checks.find((c) => c.id === 'index').ok, false)
    assert.equal(messyResult.health.checks.find((c) => c.id === 'orphans').ok, false)
    assert.equal(messyResult.health.checks.find((c) => c.id === 'frontmatter').ok, false)
    assert.equal(messyResult.health.checks.find((c) => c.id === 'freshness').ok, false)
    assert.ok(messyResult.health.score < cleanResult.health.score)
    assert.ok(messyResult.health.score >= 0 && messyResult.health.score <= 100)
    const messyIndex = messyResult.health.checks.find((c) => c.id === 'index')
    assert.deepEqual(messyIndex.data, { routes: 2, missing: 1 })
    assert.equal(messyIndex.detail, '1 条指向不存在的页', 'the Chinese detail stays verbatim for CLI consumers')
    assert.deepEqual(messyResult.health.checks.find((c) => c.id === 'orphans').data, { count: 1, sample: ['user/orphan.md'] })
    assert.deepEqual(messyResult.health.checks.find((c) => c.id === 'frontmatter').data, { missingSalience: 1, missingType: 0 })
    assert.deepEqual(messyResult.health.checks.find((c) => c.id === 'freshness').data, { atRisk: 1 })
  } finally {
    rmSync(clean, { recursive: true, force: true })
    rmSync(messy, { recursive: true, force: true })
  }
})

test('collecting insights is read-only (no file in the store is modified)', () => {
  const dir = makeStore({
    'index.md': '- [a](user/a.md) — a\n',
    'user/a.md': page({ lastAccess: daysAgo(30) }),
  })
  try {
    const before = readFileSync(join(dir, 'user/a.md'), 'utf8')
    collectInsights(dir)
    collectInsights(dir)
    assert.equal(readFileSync(join(dir, 'user/a.md'), 'utf8'), before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readRecentLog tolerates a missing log and caps the number of headlines', () => {
  const dir = makeStore({})
  assert.deepEqual(readRecentLog(dir, 3), [])
  const lines = ['# Memory Log']
  for (let i = 1; i <= 10; i += 1) lines.push(`## [2026-09-${String(i).padStart(2, '0')}] kind | 事件${i}`)
  writeFileSync(join(dir, 'log.md'), lines.join('\n') + '\n', 'utf8')
  const recent = readRecentLog(dir, 3)
  assert.equal(recent.length, 3)
  assert.match(recent[0], /事件10$/)
  assert.match(recent[2], /事件8$/)
  rmSync(dir, { recursive: true, force: true })
})

test('insights.js stays dependency-free (node: builtins + local modules only)', () => {
  const source = readFileSync(new URL('../lib/insights.js', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/^import\s+.*?from\s+'([^']+)'/gm)].map((m) => m[1])
  assert.ok(imports.length > 0)
  for (const specifier of imports) {
    assert.ok(specifier.startsWith('node:') || specifier.startsWith('./'), `unexpected dependency: ${specifier}`)
  }
})
