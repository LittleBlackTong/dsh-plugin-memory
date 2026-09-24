#!/usr/bin/env node
/**
 * dsh-memory — CLI for the dsh-plugin-memory store. No external dependencies.
 *
 * Usage:
 *   dsh-memory init [dir]                  # create the store scaffold (default $MEMORY_DIR or ~/.memory)
 *   dsh-memory search <query> [--touch]    # full-text search; --touch stamps last_access on the hits
 *   dsh-memory touch [pages...]            # stamp last_access (all pages when none given)
 *   dsh-memory graph [--suggest]           # relationship report / citation suggestions
 *   dsh-memory index [--check|--write|--sync-frontmatter]
 *                                          # index routing table: drift / rewrite / import summaries
 *   dsh-memory lint                        # integrity check (index vs files, orphans, log format)
 *   dsh-memory status                      # health summary (page counts, sizes, staleness, last modified)
 *   dsh-memory pack [out.tar.gz]           # export a portable archive + manifest
 *   dsh-memory unpack <archive> [--force]  # restore from an archive
 *   dsh-memory --self-test                 # run a temp-dir round-trip test (npm test)
 *
 * Store resolution: $MEMORY_DIR, else ./.memory when it exists, else ~/.memory.
 */
import {
  readdirSync, readFileSync, writeFileSync, existsSync, statSync,
  mkdirSync, cpSync, rmSync,
} from 'node:fs'
import { join, resolve, relative, basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { ensureMemoryScaffold } from '../lib/scaffold.js'
import { touchPages, accessSummary, today } from '../lib/pages.js'
import { planIndex, applyIndex, indexIssues, syncDeclaredSummaries, INDEX_LINE_MAX } from '../lib/index-page.js'
import { buildMemoryGraph, suggestLinks } from '../lib/graph.js'

const META = new Set(['SOUL.md', 'MEMORY.md', 'BOOTSTRAP.md', 'index.md', 'log.md'])

function resolveStore() {
  if (process.env.MEMORY_DIR) return resolve(process.env.MEMORY_DIR)
  const local = resolve('.memory')
  if (existsSync(local)) return local
  return join(homedir(), '.memory')
}

function fail(msg) { console.error('error: ' + msg); process.exit(1) }

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

function pages(store) {
  return walk(store).filter((f) => f.endsWith('.md'))
    .map((f) => relative(store, f))
    .filter((r) => !META.has(basename(r)))
}

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return {}
  const end = text.indexOf('\n---', 3)
  if (end < 0) return {}
  const fm = {}
  for (const line of text.slice(3, end).split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (m) fm[m[1]] = m[2].trim()
  }
  return fm
}

function cmdInit(store, args) {
  if (args[0]) {
    // Explicit dir argument wins over store resolution.
    store = resolve(args[0])
  }
  const created = ensureMemoryScaffold(store)
  console.log(created.length > 0
    ? `initialized ${created.length} entries -> ${store}`
    : `store already present: ${store} (nothing created; existing files never overwritten)`)
}

function cmdSearch(store, query, touch = false) {
  if (!query) fail('search needs a query')
  const q = query.toLowerCase()
  const hits = []
  const hitPages = []
  for (const f of walk(store).filter((x) => x.endsWith('.md'))) {
    const text = readFileSync(f, 'utf8')
    for (const [i, line] of text.split('\n').entries()) {
      if (line.toLowerCase().includes(q)) {
        hits.push(`${relative(store, f)}:${i + 1}: ${line.trim().slice(0, 200)}`)
        const rel = relative(store, f)
        if (!META.has(basename(rel)) && !hitPages.includes(rel)) hitPages.push(rel)
      }
    }
  }
  console.log(hits.length ? hits.join('\n') : `no matches for "${query}"`)
  if (touch && hitPages.length > 0) {
    const stamped = touchPages(store, hitPages)
    console.log(`— last_access ${today()} stamped on ${stamped.length} page(s)`)
  }
}

/**
 * Stamp `last_access` on pages. With no arguments, touch every page — the
 * "I just read through the store" case; with arguments, only the named ones.
 */
function cmdTouch(store, args) {
  const all = pages(store)
  const requested = args.filter((a) => !a.startsWith('-'))
  const targets = requested.length > 0 ? requested : all
  const unknown = requested.filter((p) => !all.includes(p))
  const stamped = touchPages(store, targets)
  console.log(`stamped last_access ${today()} on ${stamped.length}/${targets.length} page(s)`)
  if (unknown.length > 0) console.log(`skipped (not a page): ${unknown.join(', ')}`)
}

/**
 * Index compiler: report drift (default / `--check`) or rewrite the stale lines
 * (`--write`). Only existing entry lines are rewritten — sections, order and
 * unmentioned pages are left for the agent to decide.
 */
function cmdIndex(store, args) {
  const plan = planIndex(store)
  const write = args.includes('--write')
  const check = args.includes('--check')
  const sync = args.includes('--sync-frontmatter') || args.includes('--sync')
  const overlong = plan.lines.filter((l) => l.current.length > INDEX_LINE_MAX).length
  const stale = plan.lines.filter((l) => l.changed)
  const noSummary = plan.lines.filter((l) => l.summary.length === 0)

  if (sync) {
    // One-shot migration: whatever summary already lives in the index moves into
    // the page's frontmatter, after which the index is pure projection.
    const result = syncDeclaredSummaries(store, plan)
    console.log(`index: synced ${result.synced.length} summary declaration(s) into frontmatter`
      + (result.skipped.length > 0 ? `, skipped ${result.skipped.length}` : ''))
    for (const path of result.skipped.slice(0, 5)) console.log(`  · skipped (no index summary to import): ${path}`)
    return
  }

  if (write) {
    const result = applyIndex(store, plan)
    console.log(`index: rewrote ${result.written}/${plan.lines.length} line(s) `
      + `(${result.bytesBefore} → ${result.bytesAfter} bytes)`)
    if (plan.missing.length > 0) {
      console.log(`index: ${plan.missing.length} page(s) not listed — add them by hand (section + order are editorial):`)
      for (const path of plan.missing) console.log(`  + ${path}`)
    }
    if (plan.removed.length > 0) {
      console.log(`index: ${plan.removed.length} stale link(s) — decide whether to delete the line: ${plan.removed.join(', ')}`)
    }
    if (noSummary.length > 0) {
      console.log(`index: ${noSummary.length} page(s) declare no summary — the line shows the title only; `
        + 'add `summary:` to the page frontmatter and re-run')
    }
    return
  }

  if (check) {
    console.log(`index: ${stale.length} stale / ${overlong} over-cap / ${noSummary.length} undeclared-summary `
      + `of ${plan.lines.length} line(s)`)
    for (const line of plan.lines) console.log(`  ${line.changed ? '~' : '·'} ${line.target}`)
    for (const path of plan.missing) console.log(`  + missing from index: ${path}`)
    for (const path of plan.removed) console.log(`  - stale link: ${path}`)
    if (stale.length > 0 || plan.missing.length > 0 || plan.removed.length > 0) process.exit(1)
    return
  }

  if (stale.length > 0) {
    console.log(`index: ${stale.length} of ${plan.lines.length} line(s) need a rewrite`
      + (overlong > 0 ? `, ${overlong} over the ${INDEX_LINE_MAX}-char cap` : ''))
    for (const line of stale.slice(0, 10)) console.log(`  ~ ${line.target}`)
    if (stale.length > 10) console.log(`  … ${stale.length - 10} more`)
    console.log('run `dsh-memory index --write` to rewrite them (sections and order are preserved)')
  } else if (plan.lines.length > 0) {
    console.log(`index: ${plan.lines.length} line(s) in sync with their pages`)
  }
  if (noSummary.length > 0) {
    console.log(`index: ${noSummary.length} page(s) declare no summary (line shows title only): `
      + noSummary.slice(0, 5).map((l) => l.target).join(', ') + (noSummary.length > 5 ? ' …' : ''))
    console.log('  hint: `dsh-memory index --sync-frontmatter` imports the summary already written in index.md')
  }
  for (const path of plan.missing) console.log(`  + missing from index (add by hand): ${path}`)
  for (const path of plan.removed) console.log(`  - stale link (decide by hand): ${path}`)
}

function cmdLint(store) {
  const problems = []
  const index = readFileSync(join(store, 'index.md'), 'utf8')
  const linked = [...index.matchAll(/\]\(([^)]+\.md)\)/g)].map((m) => m[1]).filter((p) => !p.startsWith('http'))
  for (const p of linked) {
    if (!existsSync(join(store, p))) problems.push(`index.md links to missing page: ${p}`)
  }
  const ps = pages(store)
  const inIndex = new Set(linked.map((p) => p.replace(/^\.\//, '')))
  for (const p of ps) {
    if (!inIndex.has(p)) problems.push(`orphan page not in index.md: ${p}`)
  }
  for (const p of ps) {
    const fm = parseFrontmatter(readFileSync(join(store, p), 'utf8'))
    for (const k of ['title', 'date', 'type', 'salience']) {
      if (!(k in fm)) problems.push(`${p}: missing frontmatter "${k}"`)
    }
    if (fm.salience && !['1', '2', '3'].includes(fm.salience)) {
      problems.push(`${p}: salience must be 1|2|3, got "${fm.salience}"`)
    }
  }
  // Routing-table discipline: a line that has drifted from its page, or grown
  // past the cap, is a lint failure — not a style preference. The index is
  // injected whole, so an overgrown line costs every session context.
  for (const issue of indexIssues(store, { includeNoSummary: false })) {
    if (issue.kind === 'missing' || issue.kind === 'removed') continue // already reported above
    problems.push(issue.detail)
  }
  const log = readFileSync(join(store, 'log.md'), 'utf8')
  // Quoted example lines (`> ## [...]`) are documentation, not entries.
  const badLines = log.split('\n')
    .filter((l) => l.startsWith('## ') && !/^## \[\d{4}-\d{2}-\d{2}\] /.test(l))
  for (const l of badLines) problems.push(`log.md malformed entry: ${l}`)
  console.log(problems.length ? problems.join('\n') : `ok — ${ps.length} pages, no problems found`)
  process.exit(problems.length ? 1 : 0)
}

/**
 * Relationship report: what the graph looks like, and (with `--suggest`) who
 * each under-connected page should probably cite. Suggestion only — the write
 * stays with the agent, per the project's "no automatic rewrites" rule.
 */
function cmdGraph(store, args) {
  const graph = buildMemoryGraph(store, { includeSuggestions: args.includes('--suggest') })
  const { stats } = graph
  console.log(`graph: ${stats.pages} 页 · ${stats.links} 条页间互链 · ${stats.tagEdges} 条共享 tag · ${stats.indexLinks} 条索引路由`)
  if (stats.isolated.length > 0) {
    console.log(`孤立页（连索引之外没有任何关系）：${stats.isolated.length} 个`)
    for (const path of stats.isolated) console.log(`  · ${path}`)
  }
  if (!args.includes('--suggest')) {
    console.log('用 `dsh-memory graph --suggest` 查看"这页该连谁"的建议（只报告，不写入）')
    return
  }
  const suggestions = graph.suggestions ?? []
  if (suggestions.length === 0) {
    console.log('没有需要补链的页面 —— 每页都已经有内容层面的关系了')
    return
  }
  console.log('')
  console.log('补链建议（只提示，请自己确认后写进页面）：')
  for (const entry of suggestions) {
    console.log(`  ${entry.page}`)
    for (const candidate of entry.candidates) {
      console.log(`     → ${candidate.target}   [${candidate.reason}]`)
    }
  }
  console.log('')
  console.log('写进页面示例：在正文里加 `见 [某页](../path.md)`，图谱与探索都会用到这条边。')
}

function cmdStatus(store) {
  const ps = pages(store)
  const bytes = ps.map((p) => statSync(join(store, p)).size).reduce((a, b) => a + b, 0)
  const byType = {}
  for (const p of ps) {
    const t = parseFrontmatter(readFileSync(join(store, p), 'utf8')).type || 'unknown'
    byType[t] = (byType[t] || 0) + 1
  }
  const last = walk(store).map((f) => statSync(f).mtimeMs).sort((a, b) => b - a)[0]
  const logPath = join(store, 'log.md')
  const logMtime = existsSync(logPath) ? statSync(logPath).mtimeMs : 0
  console.log(`store: ${store}`)
  console.log(`pages: ${ps.length}`)
  console.log(`total page bytes: ${bytes}`)
  console.log(`by type: ${JSON.stringify(byType)}`)
  console.log(`last modified: ${last ? new Date(last).toISOString() : 'n/a'}`)
  console.log(`last log write: ${logMtime ? `${new Date(logMtime).toISOString()} (${Math.round((Date.now() - logMtime) / 60000)} min ago)` : 'n/a'}`)
  const access = accessSummary(store)
  const oldest = access.oldest ? `${access.oldest.lastAccess} (${access.oldest.path})` : 'n/a'
  console.log(`stale pages (>90d or unstamped): ${access.stale.length}/${access.total}${access.missing > 0 ? ` (${access.missing} missing last_access)` : ''}`)
  console.log(`oldest last_access: ${oldest}`)
}

function manifestFor(storePath) {
  const files = walk(storePath).sort().map((f) => ({
    path: relative(storePath, f),
    sha256: createHash('sha256').update(readFileSync(f)).digest('hex'),
    bytes: statSync(f).size,
  }))
  return {
    exported_at: new Date().toISOString(),
    source: storePath,
    file_count: files.length,
    files,
  }
}

function cmdPack(store, outArg) {
  const out = resolve(outArg || join(process.cwd(), `memory-${Date.now()}.tar.gz`))
  const staging = join(tmpdir(), `memory-pack-${Date.now()}`)
  mkdirSync(staging, { recursive: true })
  const dst = join(staging, 'memory')
  cpSync(store, dst, { recursive: true, filter: (src) => basename(src) !== '.git' })
  const manifest = manifestFor(dst)
  writeFileSync(join(staging, 'memory-manifest.json'), JSON.stringify(manifest, null, 2))
  execFileSync('tar', ['-czf', out, '-C', staging, '.'], { stdio: 'inherit' })
  rmSync(staging, { recursive: true, force: true })
  console.log(`packed ${manifest.file_count} files -> ${out}`)
}

function cmdUnpack(store, archiveArg, force) {
  if (!archiveArg) fail('unpack needs an archive path')
  const archive = resolve(archiveArg)
  if (!existsSync(archive)) fail(`archive not found: ${archive}`)
  if (walk(store).length > 0 && !force) {
    fail(`store is not empty (${walk(store).length} files). use --force to overwrite.`)
  }
  const staging = join(tmpdir(), `memory-unpack-${Date.now()}`)
  mkdirSync(staging, { recursive: true })
  execFileSync('tar', ['-xzf', archive, '-C', staging], { stdio: 'inherit' })
  const src = join(staging, 'memory')
  if (!existsSync(src)) fail('archive has no memory/ root (wrong archive?)')
  rmSync(store, { recursive: true, force: true })
  cpSync(src, store, { recursive: true })
  rmSync(staging, { recursive: true, force: true })
  console.log(`restored ${walk(store).length} files -> ${store}`)
}

function selfTest() {
  const dir = join(tmpdir(), `memory-self-test-${Date.now()}`)
  const store = join(dir, 'memory')
  const failures = []
  const check = (label, ok) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
    if (!ok) failures.push(label)
  }
  try {
    cmdInit(store, [])
    check('init creates scaffold', existsSync(join(store, 'SOUL.md')) && existsSync(join(store, 'index.md')))
    const created = ensureMemoryScaffold(store)
    check('init is idempotent', created.length === 0)
    writeFileSync(join(store, 'user', 'profile.md'),
      '---\ntitle: 用户档案\ndate: 2026-08-18\ntype: user\nsalience: 1\nlast_access: 2026-08-18\ntags: []\nsources: []\n---\n\n# 用户档案\n\n测试页。\n')
    check('lint passes on valid page', (() => {
      try {
        const index = readFileSync(join(store, 'index.md'), 'utf8') + '\n- [user/profile.md](user/profile.md) — 测试页。 `salience:1`\n'
        writeFileSync(join(store, 'index.md'), index)
        return true
      } catch { return false }
    })())
    const archive = join(dir, 'pack.tar.gz')
    cmdPack(store, archive)
    check('pack writes archive', existsSync(archive))
    const restore = join(dir, 'restore')
    mkdirSync(restore, { recursive: true })
    const savedEnv = process.env.MEMORY_DIR
    process.env.MEMORY_DIR = join(restore, '.memory')
    cmdUnpack(resolveStore(), archive, true)
    check('unpack restores files', existsSync(join(restore, '.memory', 'SOUL.md')) && existsSync(join(restore, '.memory', 'user', 'profile.md')))
    if (savedEnv === undefined) delete process.env.MEMORY_DIR
    else process.env.MEMORY_DIR = savedEnv
    rmSync(dir, { recursive: true, force: true })
  } catch (error) {
    check(`no exception (${error?.message ?? error})`, false)
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(failures.length === 0 ? 'self-test: PASS' : `self-test: ${failures.length} failure(s)`)
  process.exit(failures.length === 0 ? 0 : 1)
}

// ---------------- main ----------------

const args = process.argv.slice(2)
const store = resolveStore()

if (args[0] === '--self-test') {
  selfTest()
} else {
  const help = `dsh-memory — long-term memory CLI
  init [dir]               create the store scaffold
  search <query> [--touch] full-text search (--touch stamps last_access on hits)
  touch [pages...]         stamp last_access (all pages when none given)
  graph [--suggest]        relationship report / "who should this page cite" 
  index [--check|--write|--sync-frontmatter]
                           index routing table: report drift / rewrite / import summaries
  lint                     integrity check
  status                   health summary
  pack [out.tar.gz]        export portable archive + manifest
  unpack <archive> [--force]  restore archive
Store: $MEMORY_DIR or ./.memory or ~/.memory (current: ${store})`
  switch (args[0]) {
    case 'init': cmdInit(store, args.slice(1)); break
    case 'search': cmdSearch(store, args[1], args.includes('--touch')); break
    case 'touch': cmdTouch(store, args.slice(1)); break
    case 'graph': cmdGraph(store, args.slice(1)); break
    case 'index': cmdIndex(store, args.slice(1)); break
    case 'lint': cmdLint(store); break
    case 'status': cmdStatus(store); break
    case 'pack': cmdPack(store, args[1]); break
    case 'unpack': cmdUnpack(store, args[1], args.includes('--force')); break
    default: console.log(help)
  }
}
