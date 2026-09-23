import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildMemoryGraph } from '../lib/graph.js'

function page({ title = 't', type = 'user', salience = 2, tags = [], body = '正文。' } = {}) {
  const tagLine = tags.length > 0 ? `tags: [${tags.join(', ')}]` : 'tags: []'
  return `---\ntitle: ${title}\ndate: 2026-01-01\ntype: ${type}\nsalience: ${salience}\n`
    + `last_access: 2026-09-23\n${tagLine}\nsources: []\n---\n\n${body}\n`
}

function makeStore(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'memory-graph-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }
  return dir
}

test('index.md links become their own edge kind, from the routing table', () => {
  const dir = makeStore({
    'index.md': '- [a](user/a.md) — 甲\n- [b](skills/b.md) — 乙\n',
    'user/a.md': page({ title: '甲' }),
    'skills/b.md': page({ title: '乙' }),
  })
  try {
    const graph = buildMemoryGraph(dir)
    const indexEdges = graph.edges.filter((e) => e.kind === 'index')
    assert.equal(indexEdges.length, 2)
    assert.equal(graph.stats.indexLinks, 2)
    assert.equal(graph.stats.links, 0, 'index rows are not page-to-page links')
    const indexNode = graph.nodes.find((n) => n.id === 'index.md')
    assert.equal(indexNode.degree, 2, 'the routing table must not float alone')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('nodes carry frontmatter metadata and root meta files are marked as hubs', () => {
  const dir = makeStore({
    'index.md': '- [a](user/a.md)\n',
    'SOUL.md': '# soul\n',
    'user/a.md': page({ title: '甲', type: 'user', salience: 1, tags: ['dsh'] }),
    'skills/b.md': page({ title: '乙', type: 'skill', tags: ['dsh'] }),
  })
  try {
    const graph = buildMemoryGraph(dir)
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    assert.equal(byId.get('user/a.md').label, '甲')
    assert.equal(byId.get('user/a.md').type, 'user')
    assert.equal(byId.get('user/a.md').salience, 1)
    assert.deepEqual(byId.get('user/a.md').tags, ['dsh'])
    assert.equal(byId.get('user/a.md').kind, 'page')
    assert.equal(byId.get('SOUL.md').kind, 'meta')
    assert.equal(byId.get('SOUL.md').hub, true)
    assert.equal(graph.stats.pages, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('explicit page-to-page links become the strongest edges', () => {
  const dir = makeStore({
    'user/a.md': page({ title: '甲', body: '见 [乙](../skills/b.md) 与 [不存在](../skills/ghost.md)。' }),
    'skills/b.md': page({ title: '乙', body: '回到 [甲](../user/a.md)。' }),
  })
  try {
    const graph = buildMemoryGraph(dir)
    const links = graph.edges.filter((e) => e.kind === 'link')
    // a→b and b→a collapse into one undirected edge; the dangling link is dropped.
    assert.equal(links.length, 1)
    assert.equal(links[0].weight, 1)
    assert.deepEqual([links[0].source, links[0].target].sort(), ['skills/b.md', 'user/a.md'])
    assert.equal(graph.stats.links, 2) // both directed links resolved and seen
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('shared tags produce one labelled edge per tag, chained through an anchor', () => {
  const dir = makeStore({
    'user/a.md': page({ title: '甲', tags: ['dsh', 'plugin'] }),
    'skills/b.md': page({ title: '乙', tags: ['dsh'] }),
    'skills/c.md': page({ title: '丙', tags: ['dsh'] }),
    'concepts/d.md': page({ title: '丁', tags: ['plugin'] }),
  })
  try {
    const graph = buildMemoryGraph(dir)
    const tagEdges = graph.edges.filter((e) => e.kind === 'tag')
    // #dsh: a→b, a→c ; #plugin: a→d  → 3 edges, never a clique
    assert.equal(tagEdges.length, 3)
    assert.ok(tagEdges.every((e) => typeof e.label === 'string' && e.label.length > 0))
    assert.equal(graph.stats.tagEdges, 3)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('generic container tags are ignored so they cannot connect everything', () => {
  const dir = makeStore({
    'user/a.md': page({ title: '甲', tags: ['project', 'skills', 'dsh'] }),
    'user/b.md': page({ title: '乙', tags: ['project', 'skills', 'dsh'] }),
  })
  try {
    const graph = buildMemoryGraph(dir)
    // Only #dsh survives; the two container tags add nothing.
    assert.equal(graph.edges.filter((e) => e.kind === 'tag').length, 1)
    assert.equal(graph.edges[0].label, 'dsh')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('same-type edges are opt-in and chained', () => {
  const dir = makeStore({
    'skills/a.md': page({ title: 'A', type: 'skill' }),
    'skills/b.md': page({ title: 'B', type: 'skill' }),
    'skills/c.md': page({ title: 'C', type: 'skill' }),
  })
  try {
    assert.equal(buildMemoryGraph(dir).edges.length, 0)
    const withTypes = buildMemoryGraph(dir, { includeTypeEdges: true })
    assert.equal(withTypes.edges.filter((e) => e.kind === 'type').length, 2)
    assert.equal(withTypes.stats.typeEdges, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('degrees and isolated pages are reported for the picture', () => {
  const dir = makeStore({
    'user/a.md': page({ title: '甲', tags: ['dsh'] }),
    'skills/b.md': page({ title: '乙', tags: ['dsh'] }),
    'user/lonely.md': page({ title: '孤', tags: [] }),
  })
  try {
    const graph = buildMemoryGraph(dir)
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    assert.equal(byId.get('user/a.md').degree, 1)
    assert.equal(byId.get('user/lonely.md').degree, 0)
    assert.deepEqual(graph.stats.isolated, ['user/lonely.md'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an empty or missing store yields an empty graph instead of throwing', () => {
  const empty = buildMemoryGraph(join(tmpdir(), 'memory-graph-missing-xyz'))
  assert.deepEqual(empty.nodes, [])
  assert.deepEqual(empty.edges, [])
  assert.equal(empty.stats.pages, 0)
})

test('graph.js only depends on node builtins and sibling modules', () => {
  const source = readFileSync(new URL('../lib/graph.js', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/^import\s+.*?from\s+'([^']+)'/gm)].map((m) => m[1])
  assert.ok(imports.length > 0)
  for (const specifier of imports) {
    assert.ok(specifier.startsWith('node:') || specifier.startsWith('./'), `unexpected dependency: ${specifier}`)
  }
})
