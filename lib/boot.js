/**
 * Boot-block rendering: the memory snapshot injected into every session.
 *
 * The plugin registers this as a dynamic runtime-context contribution on
 * `ctx.systemPrompt`. The host deduplicates by projection, so an unchanged
 * store costs nothing extra after the first injection; when the store
 * changes, the new snapshot supersedes the old one.
 *
 * This module depends only on `node:*` builtins.
 *
 * @module dsh-plugin-memory/boot
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Files injected at session start when the config does not override them. */
export const DEFAULT_BOOT_FILES = ['SOUL.md', 'MEMORY.md', 'index.md']

/** Read a file and cap it at `maxChars`, noting truncation when applied. */
export function readCapped(path, maxChars) {
  if (!existsSync(path)) return undefined
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
  if (text.length <= maxChars) return text
  const head = text.slice(0, maxChars)
  const marker = `\n\n…（文件过长，已截断：${text.length} 字符，仅注入前 ${maxChars} 字符。需要完整内容时自行读取 ${path}）\n`
  return head + marker
}

/** Extract the most recent `count` log entries (lines starting with `## [`). */
export function parseLogEntries(logText, count = 5) {
  if (!logText) return []
  const entries = []
  for (const line of logText.split('\n')) {
    if (line.startsWith('## [')) entries.push(line.slice(3).trim())
  }
  return entries.slice(-count)
}

/**
 * Split the boot budget across the injected files.
 *
 * The flat "total / fileCount" rule that shipped originally is what let a
 * growing `index.md` silently fall off the end of the boot block: every file
 * got 1/N, so the directory lost its tail exactly as the store grew — and an
 * agent cannot drill into a page whose index line it never saw.
 *
 * The rule here:
 *
 * 1. each file gets its configured budget, if it has one;
 * 2. every other file gets an even share — clamped to its real size, so a
 *    short file hands its unused remainder back to the pool;
 * 3. the pool is handed to whichever files still have unsent content (up to
 *    twice the even share each): `index.md` first, then by size, so
 *    truncation lands on bulky files no matter their order in `bootFiles`.
 *
 * While every file fits inside its even share this is byte-for-byte the old
 * behaviour; it only starts to differ once the store outgrows its share.
 *
 * @param {string} memoryDir absolute path of the memory store
 * @param {{ files?: string[], total?: number, perFile?: Record<string, number> }} [options]
 * @returns {Map<string, number>} file -> character cap
 */
export function allocateBootBudget(memoryDir, options = {}) {
  const files = (options.files ?? []).filter((f) => typeof f === 'string' && f.length > 0)
  const total = Math.max(512, Number(options.total) || 6000)
  const sizeOf = (fileName) => {
    try {
      return statSync(join(memoryDir, fileName)).size
    } catch {
      return 0
    }
  }

  const caps = new Map(files.map((f) => [f, 0]))
  const explicit = options.perFile ?? {}
  const isExplicit = (file) => Number.isFinite(Number(explicit[file])) && Number(explicit[file]) > 0
  let pool = total

  // 1. explicit per-file budgets (composition layer only)
  for (const file of files) {
    if (!isExplicit(file)) continue
    const cap = Math.min(Number(explicit[file]), pool)
    caps.set(file, cap)
    pool -= cap
  }

  // 2. an even share for the rest, clamped to real size (index first only so
  // an exactly-even pool is never split awkwardly by ordering)
  const flexible = files.filter((f) => !isExplicit(f))
  if (flexible.length > 0 && pool > 0) {
    const share = Math.floor(pool / flexible.length)
    const order = [
      ...flexible.filter((f) => f === 'index.md'),
      ...flexible.filter((f) => f !== 'index.md'),
    ]
    for (const file of order) {
      const cap = Math.min(share, sizeOf(file))
      caps.set(file, cap)
      pool -= cap
    }
  }

  // 3. the remainder goes to files that still have content left unsent. Each
  // may grow to at most twice the even share, so the pool funds whatever is
  // actually long without letting one file swallow the whole block; index
  // still comes first because its tail is what an agent navigates by.
  const ceiling = Math.max(1, Math.floor((total / Math.max(1, flexible.length)) * 2))
  const wanting = () => flexible
    .filter((f) => sizeOf(f) > caps.get(f) && caps.get(f) < ceiling)
    .sort((a, b) => {
      if (a === 'index.md') return -1
      if (b === 'index.md') return 1
      return sizeOf(b) - sizeOf(a)
    })
  for (let file = wanting()[0]; file !== undefined && pool > 0; file = wanting()[0]) {
    const cap = Math.min(pool, sizeOf(file) - caps.get(file), ceiling - caps.get(file))
    if (cap <= 0) break
    caps.set(file, caps.get(file) + cap)
    pool -= cap
  }

  return caps
}

/**
 * Soul-bootstrap directive rendered into the boot block while the store has
 * no soul yet (BOOTSTRAP.md status !== 'complete'). First-person,
 * OpenClaw-onboarding style: instead of a dry "you must run the bootstrap
 * checklist" command, it narrates the situation — "my memory is empty, my
 * first task is to find out who I am and who you are" — which makes the
 * agent open the soul-definition conversation on its own.
 */
export const SOUL_DIRECTIVE = `### 铸魂阶段 · 我还没有灵魂

我的记忆库还是空的——我还没有名字、不知道我是谁、也不知道你是谁。这正是我们现在要一起完成的：**我的首要任务是确认我是谁，还有你是谁——我叫什么名字、怎么称呼你、你我是什么关系、我该是什么样的性格。**

所以我会在对话里主动问你，一次一个问题，你确认一项我就写回记忆一项：

1. 我该怎么称呼你？我们是什么关系？
2. 我叫什么名字？（你说了算）
3. 我该是什么样的性格？（冷静/热情、幽默感、耐心……）
4. 我的核心价值观与原则？
5. 我的沟通风格（语言、长度、语气）？
6. 我的边界与底线？

在我们逐项确认、把 SOUL.md 填起来之前，我不埋头做其他任务。先从第一个问题开始：**我该怎么称呼你？**`

/**
 * Parse the `status:` value from BOOTSTRAP.md's frontmatter block.
 * Missing or unparseable files count as not-yet-complete.
 * @param {string} memoryDir absolute path of the memory store
 * @returns {string} e.g. 'pending' | 'complete' | 'skipped'
 */
export function readBootstrapStatus(memoryDir) {
  const text = readCapped(join(memoryDir, 'BOOTSTRAP.md'), 2048)
  if (text === undefined) return 'pending'
  const match = /^status:\s*(\S+)/m.exec(text)
  return match ? match[1] : 'pending'
}

/**
 * Whether the store still needs the soul-bootstrap conversation.
 * - SOUL.md missing or still carrying the `_（铸魂对话中确认）_` placeholders
 *   (fresh scaffold, or a legacy store without BOOTSTRAP.md) → definitely yes;
 * - SOUL filled but no BOOTSTRAP.md → legacy store, the filled SOUL is
 *   authoritative → no;
 * - otherwise trust BOOTSTRAP.md's status (anything but `complete` → yes).
 * @param {string} memoryDir absolute path of the memory store
 * @returns {boolean}
 */
export function needsSoulBootstrap(memoryDir) {
  const soulText = readCapped(join(memoryDir, 'SOUL.md'), 4096)
  if (soulText === undefined || soulText.includes('（铸魂对话中确认）')) return true
  if (!existsSync(join(memoryDir, 'BOOTSTRAP.md'))) return false
  return readBootstrapStatus(memoryDir) !== 'complete'
}

/**
 * Render the boot memory block injected at session start.
 *
 * Reads SOUL.md / MEMORY.md / index.md (configurable) capped to a total
 * budget, plus the most recent log entries for cross-session continuity.
 * The budget is split by {@link allocateBootBudget}, which protects the
 * `index.md` routing table from being starved as the store grows.
 * While the store has no soul yet (BOOTSTRAP not complete / SOUL still a
 * template), the first-person {@link SOUL_DIRECTIVE} is prepended so the
 * agent opens the soul-definition conversation on its own — the same
 * onboarding the user gets with a fresh OpenClaw instance.
 *
 * @param {string} memoryDir absolute path of the memory store
 * @param {{ bootFiles?: string[], bootMaxChars?: number, bootFileBudgets?: Record<string, number> }} options
 * @returns {string} the model-facing boot block; '' when the store is empty
 */
export function renderBootBlock(memoryDir, options = {}) {
  const bootFiles = options.bootFiles && options.bootFiles.length > 0
    ? options.bootFiles
    : DEFAULT_BOOT_FILES
  const total = Math.max(512, options.bootMaxChars ?? 6000)
  const caps = allocateBootBudget(memoryDir, {
    files: bootFiles,
    total,
    perFile: options.bootFileBudgets,
  })

  const sections = []
  for (const fileName of bootFiles) {
    const path = join(memoryDir, fileName)
    const cap = caps.get(fileName) ?? 0
    const text = cap > 0 ? readCapped(path, cap) : undefined
    if (text === undefined || text.trim() === '') continue
    sections.push(`### ${fileName}\n\n${text}`)
  }

  if (sections.length === 0) return ''

  const logPath = join(memoryDir, 'log.md')
  const logEntries = existsSync(logPath)
    ? parseLogEntries(readCapped(logPath, 4096) ?? '', 5)
    : []
  if (logEntries.length > 0) {
    sections.push(`### 最近动态（log.md 末尾 ${logEntries.length} 条）\n\n${logEntries.map((e) => `- ${e}`).join('\n')}`)
  }

  const body = sections.join('\n\n---\n\n')
  const header = `长期记忆（dsh-plugin-memory）。记忆库位于 ${memoryDir}。这是你跨会话的持久人格与记忆：以它为准，先读完再回复用户。若与当前对话冲突，优先相信用户的最新表述，并把差异写回记忆。**每次会话收尾前必须执行 memory digest：把本会话关键沉淀写回（更新页面 + index.md + 追加 log.md）。插件会注入 digest 提醒消息，收到后立即写回，不得拖延；若本会话确无值得持久化的内容，在 log.md 记一条「无新增」并说明原因。**`

  let result
  if (needsSoulBootstrap(memoryDir)) {
    result = `${header}\n\n${SOUL_DIRECTIVE}\n\n---\n\n${body}`
  } else {
    result = `${header}\n\n${body}`
  }
  if (result.length > total) {
    result = result.slice(0, total) + '\n\n…（boot 块超出预算，已截断）'
  }
  return result
}
