import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  accessSummary,
  extractReferencedPages,
  listPagePaths,
  readLastAccess,
  today,
  touchPageFile,
  touchPages,
} from '../lib/pages.js'

const DAY = 86400000

/** `YYYY-MM-DD` for `daysAgo` days before now. */
function daysAgo(days) {
  const d = new Date(Date.now() - days * DAY)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A frontmatter page whose body is its path, so content assertions are easy. */
function page(lastAccess) {
  return `---\ntitle: t\ndate: 2026-01-01\ntype: user\nsalience: 2\nlast_access: ${lastAccess}\ntags: []\nsources: []\n---\n\nbody\n`
}

function writePage(dir, rel, content) {
  const abs = join(dir, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content, 'utf8')
  return abs
}

function makeStore(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'memory-pages-'))
  for (const [rel, content] of Object.entries(files)) writePage(dir, rel, content)
  return dir
}

test('listPagePaths walks category dirs only and normalises separators', () => {
  const dir = makeStore({
    'user/profile.md': page(today()),
    'projects/active/deep/page.md': page(today()),
    'concepts/idea.md': page(today()),
    'raw/source.md': page(today()), // raw/ is source material, not a page
    'index.md': '# index\n', // meta file at the root
    'SOUL.md': '# soul\n',
  })
  try {
    const paths = listPagePaths(dir)
    assert.deepEqual(paths.sort(), ['concepts/idea.md', 'projects/active/deep/page.md', 'user/profile.md'])
    for (const p of paths) assert.ok(!p.includes('\\'), 'uses forward slashes on every platform')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('extractReferencedPages finds bare, backticked and linked references once each', () => {
  const dir = makeStore({
    'user/profile.md': page(today()),
    'decisions/foo.md': page(today()),
    'projects/active/bar.md': page(today()),
  })
  try {
    const text = [
      '### index.md',
      '- [profile](user/profile.md) — 用户档案',
      'see `decisions/foo.md` for the rationale',
      'and projects/active/bar.md too',
      'user/profile.md appears again',
      'SOUL.md and MEMORY.md are meta, not pages',
      'a placeholder like xxx.md must not match',
      'some/path/that/does/not/exist.md',
    ].join('\n')
    assert.deepEqual(extractReferencedPages(text, dir), [
      'user/profile.md',
      'decisions/foo.md',
      'projects/active/bar.md',
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('extractReferencedPages is a no-op for empty text and empty stores', () => {
  const dir = makeStore({})
  try {
    assert.deepEqual(extractReferencedPages('', dir), [])
    assert.deepEqual(extractReferencedPages('user/profile.md', dir), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('touchPageFile rewrites only the last_access line, and only when it changes', () => {
  const dir = makeStore({ 'user/profile.md': page('2020-01-01') })
  try {
    const abs = join(dir, 'user/profile.md')
    const before = readFileSync(abs, 'utf8')
    assert.equal(touchPageFile(abs, '2020-01-01'), false, 'same date → no write')
    assert.equal(readFileSync(abs, 'utf8'), before)
    assert.equal(touchPageFile(abs, '2031-05-06'), true)
    const after = readFileSync(abs, 'utf8')
    assert.match(after, /^last_access: 2031-05-06$/m)
    assert.equal(after.replace('2031-05-06', '2020-01-01'), before, 'every other byte is untouched')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('touchPages leaves pages without frontmatter alone rather than inventing one', () => {
  const dir = makeStore({
    'user/no-frontmatter.md': '# just a body\n',
    'user/has-frontmatter.md': page('2020-01-01'),
  })
  try {
    const touched = touchPages(dir, ['user/no-frontmatter.md', 'user/has-frontmatter.md'], { date: '2031-01-01' })
    assert.deepEqual(touched, ['user/has-frontmatter.md'])
    assert.equal(readFileSync(join(dir, 'user/no-frontmatter.md'), 'utf8'), '# just a body\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('touchPages ignores paths that escape the store or are not pages', () => {
  const dir = makeStore({ 'user/profile.md': page('2020-01-01'), 'raw/source.md': page('2020-01-01') })
  try {
    const touched = touchPages(dir, [
      '../../etc/passwd',
      'raw/source.md',
      'SOUL.md',
      'user/ghost.md',
      'user/profile.md',
    ], { date: '2031-01-01' })
    assert.deepEqual(touched, ['user/profile.md'])
    assert.equal(readFileSync(join(dir, 'raw/source.md'), 'utf8'), page('2020-01-01'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('accessSummary counts unstamped and stale pages, and reports the oldest stamp', () => {
  const dir = makeStore({
    'user/fresh.md': page(today()),
    'user/old.md': page(daysAgo(200)),
    'user/edge.md': page(daysAgo(120)),
    'user/no-stamp.md': '---\ntitle: t\ndate: 2026-01-01\ntype: user\nsalience: 2\ntags: []\nsources: []\n---\n\nbody\n',
  })
  try {
    const summary = accessSummary(dir, { staleDays: 90 })
    assert.equal(summary.total, 4)
    assert.equal(summary.missing, 1)
    assert.deepEqual(summary.stale.sort(), ['user/edge.md', 'user/no-stamp.md', 'user/old.md'])
    assert.deepEqual(summary.oldest, { path: 'user/old.md', lastAccess: daysAgo(200) })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readLastAccess reads the frontmatter field and tolerates its absence', () => {
  assert.equal(readLastAccess(page('2026-03-04')), '2026-03-04')
  assert.equal(readLastAccess('---\ntitle: t\ndate: 2026-01-01\nsalience: 2\n---\n'), undefined)
})

test('pages.js stays dependency-free (node: builtins only)', () => {
  const source = readFileSync(new URL('../lib/pages.js', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/^import\s+.*?from\s+'([^']+)'/gm)].map((m) => m[1])
  assert.ok(imports.length > 0)
  for (const specifier of imports) {
    assert.ok(specifier.startsWith('node:'), `unexpected dependency: ${specifier}`)
  }
})
