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

  // 1. explicit page-to-page links (and links into meta files)
  let links = 0
  for (const node of [...nodes]) {
    if (node.kind !== 'page') continue
    let text = ''
    try {
      text = readFileSync(join(memoryDir, node.id), 'utf8')
    } catch {
      continue
    }
    for (const match of text.matchAll(/\]\(([^)]+\.md)\)/g)) {
      const target = resolveLink(node.id, match[1])
      if (target === node.id || !byId.has(target)) continue
      addEdge(node.id, target, 'link', 1)
      links += 1
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
  }

  const isolated = nodes.filter((node) => node.degree === 0 && node.kind === 'page').map((node) => node.id)
  return {
    nodes,
    edges,
    stats: {
      pages: nodes.filter((node) => node.kind === 'page').length,
      links,
      tagEdges,
      typeEdges,
      isolated,
    },
  }
}
