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

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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
 * Render the boot memory block injected at session start.
 *
 * Reads SOUL.md / MEMORY.md / index.md (configurable) capped to a total
 * budget, plus the most recent log entries for cross-session continuity.
 *
 * @param {string} memoryDir absolute path of the memory store
 * @param {{ bootFiles?: string[], bootMaxChars?: number }} options
 * @returns {string} the model-facing boot block; '' when the store is empty
 */
export function renderBootBlock(memoryDir, options = {}) {
  const bootFiles = options.bootFiles && options.bootFiles.length > 0
    ? options.bootFiles
    : ['SOUL.md', 'MEMORY.md', 'index.md']
  const total = Math.max(512, options.bootMaxChars ?? 6000)
  const perFile = Math.max(256, Math.floor(total / bootFiles.length))

  const sections = []
  let injected = 0
  for (const fileName of bootFiles) {
    const path = join(memoryDir, fileName)
    const text = readCapped(path, perFile)
    if (text === undefined || text.trim() === '') continue
    sections.push(`### ${fileName}\n\n${text}`)
    injected += Math.min(text.length, perFile)
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

  let result = `${header}\n\n${body}`
  if (result.length > total) {
    result = result.slice(0, total) + '\n\n…（boot 块超出预算，已截断）'
  }
  return result
}
