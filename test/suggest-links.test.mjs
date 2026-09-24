import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildMemoryGraph, suggestLinks } from '../lib/graph.js'

function page({ title = 't', type = 'user', tags = [] } = {}) {
  return `---\ntitle: ${title}\ndate: 2026-01-01\ntype: ${type}\nsalience: 2\n`
    + `last_access: 2026-09-23\ntags: [${tags.join(', ')}]\nsources: []\n---\n\n正文。\n`
}

function makeStore(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'memory-suggest-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }
  return dir
}

test('a page already related by a tag gets no suggestion', () => {
  const dir = makeStore({
    'skills/a.md': page({ title: 'A', type: 'skill', tags: ['macos', 'ocr'] }),
    'skills/b.md': page({ title: 'B', type: 'skill', tags: ['macos', 'launchd'] }),
  })
  try {
    const graph = buildMemoryGraph(dir, { includeSuggestions: true })
    // The shared #macos tag already draws an edge — nothing left to suggest.
    assert.equal(graph.edges.filter((e) => e.kind === 'tag').length, 1)
    assert.deepEqual(graph.suggestions, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Graph-shaped input with an explicit topology: suggestion scoring is a pure
 * function of nodes + edges, and auto-deriving edges here would hide exactly
 * the distinction under test (a shared tag *is* a real edge).
 */
function fakeGraph(pages, edges = []) {
  return {
    nodes: pages.map((p) => ({
      id: p.id,
      kind: 'page',
      label: p.title,
      type: p.type ?? 'skill',
      tags: p.tags ?? [],
      tagSet: new Set(p.tags ?? []),
      weakTags: new Set(),
      degree: p.degree ?? 0,
    })),
    edges,
  }
}

test('a page with no real relationship is told who it should cite', () => {
  // A and B are alone (no edges at all); C shares a topic with A.
  const graph = fakeGraph([
    { id: 'skills/a.md', title: 'A', tags: ['ocr'] },
    { id: 'skills/b.md', title: 'B', tags: [] },
    { id: 'skills/c.md', title: 'C', tags: ['ocr', 'vision'] },
  ])
  const suggestions = suggestLinks(graph)
  const a = suggestions.find((entry) => entry.page === 'skills/a.md')
  assert.deepEqual(a.candidates.map((c) => c.target), ['skills/c.md'], 'A shares #ocr with C')
  // B has no tags at all: only a weak same-kind guess is possible, which is
  // hidden unless explicitly requested.
  const strong = suggestLinks(graph)
  assert.ok(!strong.some((entry) => entry.page === 'skills/b.md'), 'weak-only advice is not a finding')
  const withWeak = suggestLinks(graph, { strengths: ['strong', 'weak'] })
  const b = withWeak.find((entry) => entry.page === 'skills/b.md')
  assert.equal(b.candidates[0].strength, 'weak')
  assert.equal(b.candidates[0].reason, '同类型')

  // Once the link exists, the advice disappears: the edge is the real thing.
  const linked = fakeGraph(
    [
      { id: 'skills/a.md', title: 'A', tags: ['ocr'] },
      { id: 'skills/c.md', title: 'C', tags: ['ocr'] },
    ],
    [{ source: 'skills/a.md', target: 'skills/c.md', kind: 'link', weight: 1 }],
  )
  assert.deepEqual(suggestLinks(linked), [], 'an existing link is not suggested again')
})

test('bucket tags and same-type alone never justify a suggestion', () => {
  const dir = makeStore({
    // Same type, same bucket tag, but no shared topic and no shared title word.
    'skills/a.md': page({ title: '甲', type: 'skill', tags: ['skill'] }),
    'skills/b.md': page({ title: '乙', type: 'skill', tags: ['skill'] }),
  })
  try {
    const graph = buildMemoryGraph(dir)
    // Default: findings only. Two skill pages sharing nothing but their bucket
    // tag are a weak guess, not something to report.
    assert.deepEqual(suggestLinks(graph), [], 'bucket tag + same type is not a finding')
    const withWeak = suggestLinks(graph, { strengths: ['strong', 'weak'] })
    assert.ok(withWeak.length > 0, 'but it is available when explicitly requested')
    assert.equal(withWeak[0].candidates[0].strength, 'weak')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a bucket tag plus a shared title word does justify one', () => {
  const dir = makeStore({
    'skills/macos-a.md': page({ title: 'macos autostart', type: 'skill', tags: ['skill'] }),
    'skills/macos-b.md': page({ title: 'macos ocr', type: 'skill', tags: ['skill'] }),
  })
  try {
    const suggestions = suggestLinks(buildMemoryGraph(dir))
    assert.equal(suggestions.length, 2)
    assert.deepEqual(suggestions[0].candidates[0].sharedTags, ['skill'])
    assert.ok(suggestions[0].candidates[0].score >= 3)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('suggestions are ranked, capped and explainable', () => {
  const graph = fakeGraph([
    { id: 'user/lonely.md', title: '孤', type: 'user', tags: [] },
    { id: 'user/strong.md', title: '强', type: 'user', tags: ['alpha', 'beta', 'gamma'] },
    { id: 'user/medium.md', title: '中', type: 'user', tags: ['alpha', 'beta'] },
    { id: 'user/other.md', title: '别', type: 'user', tags: ['alpha'] },
  ])
  // `user/lonely.md` has no tags, so only weak advice is possible for it.
  const suggestions = suggestLinks(graph, { limit: 2, strengths: ['strong', 'weak'] })
  const lonely = suggestions.find((entry) => entry.page === 'user/lonely.md')
  assert.ok(lonely !== undefined, 'a page with no real edges must be reported')
  assert.equal(lonely.candidates.length, 2, 'limit must cap the candidate list')
  // With no tags of its own the page falls back to weak signals, and says so.
  assert.equal(lonely.candidates[0].reason, '同类型')
  for (const candidate of lonely.candidates) assert.ok(candidate.score > 0)
})

test('a topic-less page is matched on the weakest signal, with a reason', () => {
  const graph = fakeGraph([
    { id: 'skills/alone.md', title: '孤', type: 'skill', tags: [] },
    { id: 'skills/peer.md', title: '伴', type: 'skill', tags: ['dsh'] },
  ])
  const suggestions = suggestLinks(graph, { strengths: ['strong', 'weak'] })
  const alone = suggestions.find((entry) => entry.page === 'skills/alone.md')
  assert.ok(alone !== undefined, 'a page with no tags is exactly the one needing advice')
  assert.equal(alone.candidates[0].target, 'skills/peer.md')
  assert.equal(alone.candidates[0].reason, '同类型')
})

test('suggestions are empty for a well-connected store', () => {
  const dir = makeStore({
    'skills/a.md': page({ title: 'A', type: 'skill', tags: ['dsh'] }),
    'skills/b.md': page({ title: 'B', type: 'skill', tags: ['dsh'] }),
  })
  try {
    const graph = buildMemoryGraph(dir, { includeSuggestions: true })
    assert.deepEqual(suggestLinks(graph), [])
    assert.deepEqual(graph.suggestions, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('suggestLinks tolerates empty and malformed graphs', () => {
  assert.deepEqual(suggestLinks({ nodes: [], edges: [] }), [])
  assert.deepEqual(suggestLinks({}), [])
  const lonely = [{ id: 'a.md', kind: 'page', label: 'A', type: 'user', tags: [], degree: 0 }]
  assert.deepEqual(suggestLinks({ nodes: lonely, edges: [] }), [])
})
