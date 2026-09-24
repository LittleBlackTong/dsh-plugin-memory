/**
 * Memory graph: turn the store's *relationships* into nodes and edges.
 *
 * The graph DSH renders from markdown alone is a star: `index.md` links to every
 * page and pages link back to almost nothing (measured on a real store: 29 pages,
 * 1 page-to-page link). That shape is true but uninformative — it says "the index
 * lists everything", not "these memories belong together".
 *
 * This module recovers the relationships the store already encodes but nobody
 * drew:
 *
 * - `link`   — an explicit markdown link between two pages (the strongest signal);
 * - `tag`    — pages sharing a frontmatter tag (`#dsh`, `#plugin`, …);
 * - `type`   — pages of the same kind (all `projects`, all `skills`), a weak
 *              grouping edge that is off by default.
 *
 * Read-only and dependency-free: it derives everything from frontmatter and
 * bodies, never writes, and degrades to an empty graph instead of throwing.
 *
 * @module dsh-plugin-memory/graph
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, normalize } from 'node:path'
import { listPagePaths } from './pages.js'
import { parseFrontmatter } from './insights.js'
import { layoutGraph, typeColor } from './graph-layout.js'

/** Edge kinds, strongest first; the client decides which to draw. */
export const EDGE_KINDS = ['link', 'tag', 'type']

/** Root meta files are not memory pages, but they anchor the graph visibly. */
const META_FILES = ['SOUL.md', 'MEMORY.md', 'index.md', 'log.md']

/** Tokens so generic they connect everything and therefore explain nothing. */
const STOP_TAGS = new Set([
  'project', 'projects', 'skill', 'skills', 'decision', 'decisions',
  'concept', 'concepts', 'user', 'identity', 'fact',
])

/**
 * Words that name a *bucket* rather than a topic. They are still evidence of
 * shared intent (a page tagged `#skill` is a skill record), just weak evidence:
 * alone they should not draw an edge, together or beside a topic tag they make
 * a reasonable suggestion. `STOP_TAGS` above is the stronger form — pure type
 * words that carry no intent at all.
 */
const WEAK_TAGS = new Set([
  'skill', 'skills', 'project', 'projects', 'decision', 'decisions',
  'concept', 'concepts', 'fact', 'user', 'identity', 'meta',
])


/** Stable-ish id for a node: the store-relative path. */
const nodeId = (path) => path.replace(/^\.\//, '')

/**
 * Resolve a markdown link target to a node id. Links in a memory page are
 * usually *relative to that page* (`../skills/foo.md`), so anchor them before
 * normalising — otherwise every cross-folder link silently disappears.
 * @param {string} fromId the linking page's id
 * @param {string} target the raw href
 * @returns {string} candidate node id
 */
function resolveLink(fromId, target) {
  const clean = target.trim().replace(/^<|>$/g, '')
  if (clean.startsWith('/')) return nodeId(clean)
  return normalize(join(dirname(fromId), clean)).split('\\').join('/')
}

/** Parse `tags: [a, b]` (frontmatter is flat in this store by convention). */
function parseTags(frontmatter) {
  const raw = frontmatter.tags
  if (typeof raw !== 'string') return []
  const inner = /^\[(.*)\]$/.exec(raw.trim())
  const body = inner ? inner[1] : raw
  return body
    .split(',')
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter((tag) => tag.length > 0)
}

/** The first sentence of the body, used as hover text when nothing else fits. */
function bodyPreview(text) {
  const body = text.replace(/^---[\s\S]*?\n---\n?/, '')
  for (const line of body.split('\n')) {
    const clean = line.trim()
    if (clean.length === 0 || clean.startsWith('#') || clean.startsWith('>')) continue
    return clean.replace(/[*`[\]]/g, '').slice(0, 120)
  }
  return ''
}

/**
 * Build the memory graph.
 *
 * @param {string} memoryDir absolute path of the memory store
 * @param {{ includeMeta?: boolean, includeTypeEdges?: boolean, stopTags?: Set<string> }} [options]
 * @returns {{
 *   nodes: Array<{ id: string, label: string, kind: string, type: string, tags: string[],
 *                  degree: number, salience?: number, lastAccess?: string, preview: string, hub: boolean }>,
 *   edges: Array<{ source: string, target: string, kind: string, weight: number, label?: string }>,
 *   stats: { pages: number, links: number, tagEdges: number, typeEdges: number, isolated: string[] },
 * }}
 */
export function buildMemoryGraph(memoryDir, options = {}) {
  const stopTags = options.stopTags ?? STOP_TAGS
  const paths = listPagePaths(memoryDir)
  const nodes = []
  const edges = []
  const byId = new Map()

  for (const rel of paths) {
    const id = nodeId(rel)
    let text = ''
    try {
      text = readFileSync(join(memoryDir, rel), 'utf8')
    } catch {
      continue
    }
    const fm = parseFrontmatter(text)
    const salience = Number(fm.salience)
    const node = {
      id,
      label: fm.title || basename(rel, '.md'),
      kind: 'page',
      type: fm.type || 'unknown',
      tags: parseTags(fm),
      salience: [1, 2, 3].includes(salience) ? salience : undefined,
      lastAccess: typeof fm.last_access === 'string' ? fm.last_access : undefined,
      preview: bodyPreview(text),
      degree: 0,
      hub: false,
    }
    nodes.push(node)
    byId.set(id, node)
  }

  if (options.includeMeta !== false) {
    for (const name of META_FILES) {
      if (!existsSync(join(memoryDir, name))) continue
      const node = {
        id: name,
        label: name.replace(/\.md$/, ''),
        kind: 'meta',
        type: 'meta',
        tags: [],
        preview: '',
        degree: 0,
        hub: true,
      }
      nodes.push(node)
      byId.set(name, node)
    }
  }

  const seen = new Set()
  const addEdge = (source, target, kind, weight, label) => {
    if (!byId.has(source) || !byId.has(target) || source === target) return
    const [a, b] = source < target ? [source, target] : [target, source]
    const key = `${kind}:${a}|${b}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ source: a, target: b, kind, weight, ...(label ? { label } : {}) })
    byId.get(a).degree += 1
    byId.get(b).degree += 1
  }

  // 1. explicit links, from every node — root meta files included. index.md is
  //    the routing table: 33 links to every page in the store. A previous
  //    version skipped meta files entirely, which left the index node floating
  //    alone in the picture while it is in fact the busiest node in the store.
  let links = 0
  let indexLinks = 0
  for (const node of [...nodes]) {
    let text = ''
    try {
      text = readFileSync(join(memoryDir, node.id), 'utf8')
    } catch {
      continue
    }
    for (const match of text.matchAll(/\]\(([^)]+\.md)\)/g)) {
      const target = resolveLink(node.id, match[1])
      if (target === node.id || !byId.has(target)) continue
      // The routing table's own rows are their own kind of relationship: an
      // index→page edge means "listed here", not "these two belong together".
      const fromMeta = node.kind === 'meta'
      addEdge(node.id, target, fromMeta ? 'index' : 'link', fromMeta ? 0.4 : 1)
      if (fromMeta) indexLinks += 1
      else links += 1
    }
  }

  // 2. shared tags — one edge per tag, labelled with it, weight = how many pages
  const tagGroups = new Map()
  for (const node of nodes) {
    if (node.kind !== 'page') continue
    for (const tag of node.tags) {
      if (stopTags.has(tag)) continue
      if (!tagGroups.has(tag)) tagGroups.set(tag, [])
      tagGroups.get(tag).push(node.id)
    }
  }
  let tagEdges = 0
  for (const [tag, members] of tagGroups) {
    if (members.length < 2) continue
    // Keep dense tags readable: a tag shared by 20 pages becomes a chain through
    // the first member rather than 190 edges.
    const anchor = members[0]
    for (const member of members.slice(1)) {
      addEdge(anchor, member, 'tag', 1, tag)
      tagEdges += 1
    }
  }

  // 3. same-type edges (off by default: weak, and can overwhelm the picture)
  let typeEdges = 0
  if (options.includeTypeEdges) {
    const typeGroups = new Map()
    for (const node of nodes) {
      if (node.kind !== 'page') continue
      const key = node.type
      if (!typeGroups.has(key)) typeGroups.set(key, [])
      typeGroups.get(key).push(node.id)
    }
    for (const [type, members] of typeGroups) {
      for (let i = 1; i < members.length; i += 1) {
        addEdge(members[i - 1], members[i], 'type', 0.5, type)
        typeEdges += 1
      }
    }
  }

  // Layout is computed here (once, server-side) rather than in the browser half:
  // the client bundle cannot import local modules, and shipping coordinates keeps
  // both sides from drifting apart.
  const { positions, radius } = layoutGraph(nodes, edges)
  for (const node of nodes) {
    const p = positions.get(node.id)
    if (p !== undefined) {
      node.x = Math.round(p.x * 10) / 10
      node.y = Math.round(p.y * 10) / 10
    }
    node.r = Math.round(radius(node.id) * 10) / 10 + (node.hub ? 4 : 0)
    node.color = typeColor(node.type)
    // Effective tags exclude container words (skill/project/user…): two pages
    // "sharing" a type word are not related, they are just the same kind.
    node.tagSet = new Set(node.tags.filter((tag) => !stopTags.has(tag)))
    node.weakTags = new Set(node.tags.filter((tag) => WEAK_TAGS.has(tag)))
  }

  // Suggested links: inference, not fact. Only meaningful for pages that have
  // no real relationship yet — a page already connected by a tag or an explicit
  // link does not need to be told who its neighbours are.
  const suggestions = options.includeSuggestions
    ? suggestLinks({ nodes, edges })
    : []

  const isolated = nodes.filter((node) => node.degree === 0 && node.kind === 'page').map((node) => node.id)
  return {
    nodes,
    edges,
    suggestions,
    stats: {
      pages: nodes.filter((node) => node.kind === 'page').length,
      links,
      indexLinks,
      tagEdges,
      typeEdges,
      isolated,
    },
  }
}

/**
 * Pages that have no real relationship, and who they should probably link to.
 *
 * A page whose only edge is its `index.md` row is connected in the routing
 * sense and alone in the knowledge sense. This scores candidates by shared
 * tags, same type and title overlap, and returns a short, explainable list —
 * the point is to answer "who should this page cite?", which is the one thing
 * the graph cannot infer from links that do not exist yet.
 *
 * Pure inference: nothing is written, and the caller decides whether to act.
 *
 * @param {{ nodes: Array<object>, edges: Array<object> }} graph from {@link buildMemoryGraph}
 * @param {{ limit?: number, minScore?: number }} [options]
 * @returns {Array<{ page: string, title: string, degree: number, candidates: Array<{ target: string, title: string, score: number, sharedTags: string[], sameType: boolean }> }>}
 */
export function suggestLinks({ nodes, edges }, options = {}) {
  const limit = Math.max(1, options.limit ?? 3)
  const minScore = options.minScore ?? 3
  // Default to findings only: a shared topic tag or title word.
  const strengths = options.strengths ?? ['strong']
  const pages = (nodes ?? []).filter((node) => node.kind === 'page')
  const byId = new Map(pages.map((node) => [node.id, node]))

  // Real relationships only: index rows do not count as knowing each other.
  const realNeighbours = new Map()
  for (const edge of edges ?? []) {
    if (edge.kind === 'index') continue
    if (!realNeighbours.has(edge.source)) realNeighbours.set(edge.source, new Set())
    if (!realNeighbours.has(edge.target)) realNeighbours.set(edge.target, new Set())
    realNeighbours.get(edge.source).add(edge.target)
    realNeighbours.get(edge.target).add(edge.source)
  }

  const lonely = pages
    .filter((node) => (realNeighbours.get(node.id)?.size ?? 0) === 0)
    .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))

  const out = []
  for (const page of lonely) {
    const mine = page.tagSet ?? new Set(page.tags ?? [])
    const myWords = new Set(
      String(page.label).toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((w) => w.length > 2),
    )
    const scored = []
    for (const other of pages) {
      if (other.id === page.id) continue
      const theirs = other.tagSet ?? new Set(other.tags ?? [])
      const sharedTags = [...mine].filter((tag) => theirs.has(tag))
      const weakTags = [...(page.weakTags ?? [])].filter((tag) => (other.weakTags ?? new Set()).has(tag))
      const sameType = page.type !== 'unknown' && page.type === other.type
      const otherWords = String(other.label).toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((w) => w.length > 2)
      const sharedWords = otherWords.filter((w) => myWords.has(w))
      // Weights: a shared topic tag is worth 3, a shared title word 2, a shared
      // bucket tag 1, being the same kind of page 1. Crucially the last two
      // cannot justify a suggestion by themselves — otherwise every skill page
      // "should" link to every other skill page, which is noise, not signal.
      const content = sharedTags.length * 3 + sharedWords.length * 2
      // A page with no effective tags of its own has no topic to overlap on —
      // and it is exactly the page most in need of a suggestion. For those,
      // fall back to the weakest signals (same kind, shared title word) and let
      // the explanation say so instead of staying silent.
      // Two different kinds of "nothing to match on":
      // - no tags at all: the page is genuinely unlabelled, so the weakest
      //   signal (being the same kind of page) is all we can offer — advice is
      //   still more useful than silence;
      // - only bucket tags (`#skill`): the author did label it, they just did
      //   not say with what. Suggesting every other skill page would be noise,
      //   so this case still requires a shared title word or topic tag.
      const hasContent = sharedTags.length > 0 || sharedWords.length > 0
      const hasWeak = weakTags.length > 0
      const sameKindOnly = sameType && !hasContent && !hasWeak
      // A shared bucket tag is not a topic, but two pages of the same kind
      // *and* the same bucket ("both are skill records") are still worth
      // linking — that is how a `skills/` set becomes navigable. Without any
      // tags at all we fall back to same-kind alone, remembering the store
      // rarely has more than one distinct type per folder.
      const unlabelled = mine.size === 0 && (page.weakTags?.size ?? 0) === 0 && (page.tags?.length ?? 0) === 0
      const score = content + weakTags.length + (sameType ? 1 : 0)
      const qualifies = hasContent
        ? score >= minScore
        : (hasWeak && sameType) || sameKindOnly || unlabelled
          ? score >= minScore - 2
          : false
      if (qualifies) {
        // Strength, not just score: a suggestion backed by a shared topic is
        // worth writing into the page; "you are both skill pages" is a maybe.
        // The CLI/dashboard filter on this so weak inferences never masquerade
        // as findings.
        const strength = hasContent ? 'strong' : 'weak'
        scored.push({ other, score, sharedTags: [...sharedTags, ...weakTags], sameType, sharedWords, strength })
      }
    }
    scored.sort((a, b) => b.score - a.score || String(a.other.id).localeCompare(String(b.other.id)))
    out.push({
      page: page.id,
      title: page.label,
      degree: page.degree ?? 0,
      candidates: scored.slice(0, limit).map((entry) => ({
        target: entry.other.id,
        title: entry.other.label,
        score: entry.score,
        sharedTags: entry.sharedTags,
        sharedWords: entry.sharedWords,
        sameType: entry.sameType,
        strength: entry.strength,
        // Human-readable reason, so the CLI and the panel never guess.
        reason: [
          entry.sharedTags.length > 0 ? `共享 #${entry.sharedTags.join(' #')}` : '',
          entry.sharedWords.length > 0 ? `标题词 ${entry.sharedWords.join('/')}` : '',
          entry.sharedTags.length === 0 && entry.sharedWords.length === 0 && entry.sameType ? '同类型' : '',
        ].filter(Boolean).join(' · ') || '弱信号',
      })),
    })
  }
  return out
    .map((entry) => ({
      ...entry,
      candidates: entry.candidates.filter((candidate) => strengths.includes(candidate.strength)),
    }))
    .filter((entry) => entry.candidates.length > 0)
}
