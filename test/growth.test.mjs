/**
 * D. 成长可见（v0.12.0）：把「这周我记住了什么」变成一句能说出口的第一人称回顾。
 *
 * 数据来源只有记忆库本身：log.md 的最近条目 + 页面文件 mtime。状态文件
 * `<store>/.growth-recap.json` 记录上次回顾时间，决定本周回顾是否到期。
 */
import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  GROWTH_STATE_FILENAME,
  collectGrowth,
  growthRecapDue,
  readGrowthState,
  renderGrowthRecap,
  writeGrowthState,
} from '../lib/growth.js'

const DAY = 24 * 60 * 60 * 1000

/** `YYYY-MM-DD` for `epochMs` (local time, matching log.md entries). */
function day(epochMs) {
  const date = new Date(epochMs)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function makeStore() {
  return mkdtempSync(join(tmpdir(), 'memory-growth-'))
}

function writeLog(dir, lines) {
  writeFileSync(join(dir, 'log.md'), ['# Memory Log', '', ...lines, ''].join('\n'), 'utf8')
}

function writePage(dir, rel, text = '# page\n') {
  const abs = join(dir, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, text, 'utf8')
  return abs
}

// ── collectGrowth ──────────────────────────────────────────────────────────

test('collectGrowth: recent log entries only, newest first, kinds and titles parsed', () => {
  const dir = makeStore()
  const now = Date.now()
  const today = day(now)
  const yesterday = day(now - DAY)
  const old = day(now - 30 * DAY)
  try {
    writeLog(dir, [
      `## [${old}] project | 很久以前的事`,
      `## [${yesterday}] decision | 选定了配置通道`,
      `## [${today}] release | 记忆 v0.12.0 发布`,
      '## not a real entry',
    ])
    const growth = collectGrowth({ storeDir: dir, sinceDays: 7, max: 5, now })
    assert.equal(growth.entries.length, 2)
    assert.deepEqual(growth.entries[0], { title: '记忆 v0.12.0 发布', date: today, kind: 'release' })
    assert.deepEqual(growth.entries[1], { title: '选定了配置通道', date: yesterday, kind: 'decision' })
    assert.equal(growth.pagesChanged, 0)
    assert.equal(growth.newPages, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('collectGrowth: max caps the headline count', () => {
  const dir = makeStore()
  const now = Date.now()
  try {
    writeLog(dir, Array.from({ length: 9 }, (_, index) =>
      `## [${day(now - index * 1000)}] note | 第 ${index} 条`))
    const growth = collectGrowth({ storeDir: dir, sinceDays: 7, max: 3, now })
    assert.equal(growth.entries.length, 3)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('collectGrowth: a page created this week counts as both changed and new', () => {
  const dir = makeStore()
  const now = Date.now()
  try {
    writePage(dir, 'user/a.md')
    writePage(dir, 'projects/b.md')
    const cold = writePage(dir, 'concepts/c.md')
    const old = new Date(now - 30 * DAY)
    utimesSync(cold, old, old)

    const growth = collectGrowth({ storeDir: dir, sinceDays: 7, max: 5, now })
    assert.equal(growth.pagesChanged, 2, 'two pages were written this week')
    assert.equal(growth.newPages, 2, 'both of them are brand new files')
    assert.ok(statSync(join(dir, 'user/a.md')).birthtimeMs > now - 7 * DAY)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('collectGrowth: an old page rewritten this week is changed, not new', () => {
  const dir = makeStore()
  try {
    writePage(dir, 'projects/b.md')
    // Simulate a week later: the file's birthtime is outside the window, its
    // mtime was bumped inside it (an edit to an older memory page).
    const simNow = Date.now() + 10 * DAY
    const inWindow = new Date(Date.now() + 5 * DAY)
    utimesSync(join(dir, 'projects/b.md'), inWindow, inWindow)

    const growth = collectGrowth({ storeDir: dir, sinceDays: 7, max: 5, now: simNow })
    assert.equal(growth.pagesChanged, 1)
    assert.equal(growth.newPages, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('collectGrowth: missing / corrupt store degrades to an empty recap, never throws', () => {
  const dir = makeStore()
  try {
    assert.deepEqual(collectGrowth({ storeDir: join(dir, 'nope') }), { entries: [], pagesChanged: 0, newPages: 0 })
    writeFileSync(join(dir, 'log.md'), 'not a log at all', 'utf8')
    assert.deepEqual(collectGrowth({ storeDir: dir }).entries, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── renderGrowthRecap ──────────────────────────────────────────────────────

test('renderGrowthRecap: first-person zh recap, ≤5 sentences', () => {
  const recap = renderGrowthRecap({
    entries: [
      { title: '记忆 v0.12.0 发布', date: day(Date.now()), kind: 'release' },
      { title: '小蓝的追忆节奏调慢了', date: day(Date.now()), kind: 'decision' },
    ],
    pagesChanged: 4,
    newPages: 2,
    language: 'zh',
  })
  assert.match(recap, /我/)
  assert.match(recap, /这周我记住了 2 件/)
  assert.match(recap, /记忆 v0\.12\.0 发布/)
  assert.match(recap, /改了 4 页/)
  assert.match(recap, /2 页是新写的/)
  const sentences = recap.split(/[。！？]/).filter((part) => part.trim().length > 0)
  assert.ok(sentences.length <= 5, `recap has ${sentences.length} sentences`)
})

test('renderGrowthRecap: omits empty halves instead of printing zeros', () => {
  const pagesOnly = renderGrowthRecap({ entries: [], pagesChanged: 3, newPages: 0 })
  assert.ok(!pagesOnly.includes('记住了'))
  assert.match(pagesOnly, /3 页/)

  const entriesOnly = renderGrowthRecap({ entries: [{ title: '一件事', date: '2026-10-01', kind: 'note' }], pagesChanged: 0 })
  assert.match(entriesOnly, /记住了 1 件/)
  assert.ok(!entriesOnly.includes('改了 0 页'))

  assert.equal(renderGrowthRecap({ entries: [], pagesChanged: 0 }), '')
})

test('renderGrowthRecap: English variant has no Chinese copy', () => {
  const recap = renderGrowthRecap({
    entries: [{ title: 'v0.12.0 shipped', date: '2026-10-30', kind: 'release' }],
    pagesChanged: 2,
    newPages: 1,
    language: 'en',
  })
  assert.match(recap, /This week/)
  assert.match(recap, /2 memory pages/)
  assert.match(recap, /1 new/)
  assert.ok(!/[\u4e00-\u9fff]/.test(recap))
})

// ── state file / due check ─────────────────────────────────────────────────

test('growth state file: write then read, and due only after the interval', () => {
  const dir = makeStore()
  const statePath = join(dir, GROWTH_STATE_FILENAME)
  const now = 1_700_000_000_000
  try {
    assert.equal(readGrowthState(statePath), undefined)
    assert.equal(growthRecapDue({ statePath, intervalDays: 7, now }), true, 'no state = first recap is due')

    writeGrowthState(statePath, now)
    assert.deepEqual(readGrowthState(statePath), { version: 1, lastAt: now })
    assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')), { version: 1, lastAt: now })
    assert.equal(growthRecapDue({ statePath, intervalDays: 7, now: now + 6 * DAY }), false)
    assert.equal(growthRecapDue({ statePath, intervalDays: 7, now: now + 7 * DAY }), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('growth state: corrupt file is treated as "never recapped" (due, not silent forever)', () => {
  const dir = makeStore()
  const statePath = join(dir, GROWTH_STATE_FILENAME)
  try {
    writeFileSync(statePath, '{oops', 'utf8')
    assert.equal(readGrowthState(statePath), undefined)
    assert.equal(growthRecapDue({ statePath, intervalDays: 7, now: Date.now() }), true)

    writeFileSync(statePath, JSON.stringify({ version: 1, lastAt: 'yesterday' }), 'utf8')
    assert.equal(growthRecapDue({ statePath, intervalDays: 7, now: Date.now() }), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writeGrowthState creates the store dir if needed and stays atomic', () => {
  const dir = makeStore()
  try {
    const statePath = join(dir, '.growth-recap.json')
    writeGrowthState(statePath, 123)
    assert.equal(readFileSync(statePath, 'utf8').includes('"lastAt":123'), true)
    assert.equal(readGrowthState(join(dir, 'nested', '.growth-recap.json')), undefined)
    writeGrowthState(join(dir, 'nested', '.growth-recap.json'), 456)
    assert.equal(readGrowthState(join(dir, 'nested', '.growth-recap.json')).lastAt, 456)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
