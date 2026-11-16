import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildTimeline, groupOf, isNoiseKind, NOISE_KINDS } from '../lib/timeline.js'

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-memory-timeline-'))
  writeFileSync(join(dir, 'log.md'), [
    '# Memory Log',
    '',
    '## [2026-11-10] fix | dsh-plugin-memory 0.19.4（双向兼容老版本）',
    '## [2026-11-12] publish | 商店分支重建到最新 upstream',
    '## [2026-11-12] note | 无新增的普通日志',
    '## [bad-date] fix | 非法日期应被跳过',
    '## [2026-11-09] task | 一个过程性任务',
    'some prose that must not become an event',
  ].join('\n'))
  mkdirSync(join(dir, 'projects', 'active'), { recursive: true })
  writeFileSync(join(dir, 'projects', 'active', 'dsh-plugin-memory.md'), [
    '---',
    'title: dsh-plugin-memory 插件本体',
    'date: 2026-10-12',
    '---',
    '',
    '# dsh-plugin-memory 插件本体',
  ].join('\n'))
  writeFileSync(join(dir, 'index.md'), '- placeholder\n')
  mkdirSync(join(dir, 'raw'), { recursive: true })
  writeFileSync(join(dir, 'raw', 'evidence.md'), '---\ntitle: evidence\n---\n')
  return dir
}

test('buildTimeline parses log headings into events, sorted by date', () => {
  const { events, stats } = buildTimeline(fixture())
  assert.deepEqual(events.map((e) => [e.date, e.kind, e.group]), [
    ['2026-11-09', 'task', 'other'],
    ['2026-11-10', 'fix', 'fix'],
    ['2026-11-12', 'publish', 'publish'],
    ['2026-11-12', 'note', 'other'],
  ])
  assert.equal(stats.events, 4)
  assert.equal(stats.first, '2026-11-09')
  assert.equal(stats.last, '2026-11-12')
  assert.ok(stats.pages >= 1)
})

test('buildTimeline matches an event to a page by its title', () => {
  const { events } = buildTimeline(fixture())
  const fix = events.find((e) => e.kind === 'fix')
  assert.equal(fix.path, 'projects/active/dsh-plugin-memory.md')
  const task = events.find((e) => e.kind === 'task')
  assert.equal(task.path, undefined, 'no page title match means no path')
  assert.equal(task.title, '一个过程性任务')
})

test('buildTimeline tolerates a missing log and a missing memory dir', () => {
  const empty = mkdtempSync(join(tmpdir(), 'dsh-memory-empty-'))
  assert.deepEqual(buildTimeline(empty), { events: [], stats: { events: 0, pages: 0 } })
  const missing = join(empty, 'does-not-exist')
  assert.deepEqual(buildTimeline(missing), { events: [], stats: { events: 0, pages: 0 } })
})

test('buildTimeline ignores pages inside raw/ and malformed headings', () => {
  const dir = fixture()
  writeFileSync(join(dir, 'raw', 'evidence.md'), '## [2026-11-11] fix | raw heading must stay out\n')
  const { events } = buildTimeline(dir)
  assert.ok(!events.some((e) => e.title.includes('raw heading')))
  assert.ok(!events.some((e) => e.date === 'bad-date'))
})

test('group mapping covers the log kinds and falls back to other', () => {
  assert.equal(groupOf('fix'), 'fix')
  assert.equal(groupOf('bugfix'), 'fix')
  assert.equal(groupOf('release'), 'publish')
  assert.equal(groupOf('design'), 'decision')
  assert.equal(groupOf('task'), 'other')
  assert.equal(groupOf('unknown-kind'), 'other')
})

test('noise classification separates process noise from key events', () => {
  assert.equal(isNoiseKind('note'), true)
  assert.equal(isNoiseKind('digest'), true)
  assert.equal(isNoiseKind('fix'), false)
  assert.equal(isNoiseKind('publish'), false)
  assert.equal(NOISE_KINDS.has('task'), true)
  assert.equal(NOISE_KINDS.has('fix'), false)
})
