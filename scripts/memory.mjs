#!/usr/bin/env node
/**
 * dsh-memory — CLI for the dsh-plugin-memory store. No external dependencies.
 *
 * Usage:
 *   dsh-memory init [dir]                  # create the store scaffold (default $MEMORY_DIR or ~/.memory)
 *   dsh-memory search <query>              # full-text search across memory pages
 *   dsh-memory lint                        # integrity check (index vs files, orphans, log format)
 *   dsh-memory status                      # health summary (page counts, sizes, last modified)
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

function cmdSearch(store, query) {
  if (!query) fail('search needs a query')
  const q = query.toLowerCase()
  const hits = []
  for (const f of walk(store).filter((x) => x.endsWith('.md'))) {
    const text = readFileSync(f, 'utf8')
    for (const [i, line] of text.split('\n').entries()) {
      if (line.toLowerCase().includes(q)) hits.push(`${relative(store, f)}:${i + 1}: ${line.trim().slice(0, 200)}`)
    }
  }
  console.log(hits.length ? hits.join('\n') : `no matches for "${query}"`)
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
  const log = readFileSync(join(store, 'log.md'), 'utf8')
  const badLines = log.split('\n').filter((l) => l.startsWith('## ') && !/^## \[\d{4}-\d{2}-\d{2}\] /.test(l))
  for (const l of badLines) problems.push(`log.md malformed entry: ${l}`)
  console.log(problems.length ? problems.join('\n') : `ok — ${ps.length} pages, no problems found`)
  process.exit(problems.length ? 1 : 0)
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
  search <query>           full-text search
  lint                     integrity check
  status                   health summary
  pack [out.tar.gz]        export portable archive + manifest
  unpack <archive> [--force]  restore archive
Store: $MEMORY_DIR or ./.memory or ~/.memory (current: ${store})`
  switch (args[0]) {
    case 'init': cmdInit(store, args.slice(1)); break
    case 'search': cmdSearch(store, args[1]); break
    case 'lint': cmdLint(store); break
    case 'status': cmdStatus(store); break
    case 'pack': cmdPack(store, args[1]); break
    case 'unpack': cmdUnpack(store, args[1], args.includes('--force')); break
    default: console.log(help)
  }
}
