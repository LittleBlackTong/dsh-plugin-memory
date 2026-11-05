/**
 * Soul profile: the three fields the Settings panel can edit without a
 * conversation — who the agent is called, what to call the user, and a short
 * baseline persona. They live in a **managed block** inside `SOUL.md`, so the
 * rest of the user's hand-written soul file is never touched.
 *
 * Why a managed block instead of rewriting the template placeholders:
 * `SOUL.md` is user-owned prose. Matching template lines is brittle (users edit
 * it), while a fenced block is idempotent, visible, and trivially migratable.
 *
 * The block is the source of truth for "basic soul is done": once all three
 * fields are set, the boot block stops nagging for soul-forging even if the
 * template's `_（铸魂对话中确认）_` placeholders are still lying around (those
 * lines are filtered out of the injected copy, not out of the file).
 *
 * Pure Node builtins; no host packages.
 *
 * @module dsh-plugin-memory/soul
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeNewlines } from './paths.js'

/** Opening marker of the managed block. */
export const SOUL_PROFILE_START = '<!-- dsh-memory:soul:start -->'

/** Closing marker of the managed block. */
export const SOUL_PROFILE_END = '<!-- dsh-memory:soul:end -->'

/**
 * Generic defaults for a brand-new user: no names, no assumptions. The panel
 * pre-fills these so saving is one click, and they read naturally ("你") rather
 * than pretending the agent already has a specific identity.
 */
export const DEFAULT_SOUL_PROFILE = Object.freeze({
  agentName: '助手',
  userName: '你',
  summary: [
    '直接、诚实、先结论后细节；不确定时明说，绝不编造。',
    '语气可以轻松，偶尔自嘲，但事实、数字、结论一字不掺水。',
    '主动指出风险与替代方案，最终决定权留给你。',
  ].join('\n'),
})

/** Max characters for either name. */
export const SOUL_NAME_MAX = 64

/** Max characters for the baseline persona description. */
export const SOUL_SUMMARY_MAX = 2000

const PLACEHOLDER = '（铸魂对话中确认）'

const trim = (value) => (typeof value === 'string' ? value.trim() : '')

/** Extract the managed block body, or `undefined` when absent/malformed. */
function extractBlock(text) {
  const start = text.indexOf(SOUL_PROFILE_START)
  if (start === -1) return undefined
  const end = text.indexOf(SOUL_PROFILE_END, start)
  if (end === -1) return undefined
  return text.slice(start + SOUL_PROFILE_START.length, end)
}

/**
 * Read one `- **label**：value` field from the block body. The persona field
 * may wrap onto continuation lines indented by two spaces (markdown list
 * continuation), so a multi-line description survives the round trip.
 */
function blockField(block, label) {
  const prefix = `- **${label}**：`
  const lines = block.split('\n')
  const start = lines.findIndex((line) => line.startsWith(prefix))
  if (start === -1) return ''
  const out = [lines[start].slice(prefix.length).trim()]
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.startsWith('  ')) break
    out.push(line.slice(2).trimEnd())
  }
  return out.filter((line) => line.length > 0).join('\n').trim()
}

/**
 * Echo the profile a legacy SOUL.md already states (forged in chat, no managed
 * block). Common shapes from this plugin's own template and conversations:
 *   - **名字**：小助手。
 *   - **角色**：……
 *   - **相互称呼**：老板 ↔ 小助手。
 * Values that are still placeholders are ignored.
 */
function readLegacySoul(text) {
  const clean = (value) => {
    if (typeof value !== 'string') return ''
    const trimmed = value.trim().replace(/[。．.，,；;]+$/u, '').trim()
    if (trimmed.length === 0 || trimmed.includes(PLACEHOLDER)) return ''
    return trimmed
  }
  const lineValue = (label) => {
    const match = new RegExp(`^- \\*\\*${label}\\*\\*：(.*)$`, 'm').exec(text)
    return clean(match ? match[1] : '')
  }
  const name = lineValue('名字')
  const role = lineValue('角色')
  const mutual = lineValue('相互称呼')
  let userName = ''
  if (mutual.length > 0) {
    const parts = mutual.split(/\s*(?:↔|<->|⇄)\s*/u).map((part) => part.trim()).filter(Boolean)
    userName = parts.length >= 2 ? parts[0] : mutual
  }
  return {
    agentName: name || DEFAULT_SOUL_PROFILE.agentName,
    userName: userName || DEFAULT_SOUL_PROFILE.userName,
    summary: (role || DEFAULT_SOUL_PROFILE.summary).slice(0, SOUL_SUMMARY_MAX),
  }
}

/**
 * Read the soul profile.
 *
 * With a managed block, the block wins. Without one (a store forged in chat),
 * the fields the SOUL already states are echoed back so the panel never claims
 * "not forged yet" for a user who has a soul. A truly empty/placeholder store
 * falls back to the generic defaults.
 *
 * @param {string} memoryDir
 * @returns {{ agentName: string, userName: string, summary: string, managed: boolean }}
 */
export function readSoulProfile(memoryDir) {
  let text = ''
  try {
    text = normalizeNewlines(readFileSync(join(memoryDir, 'SOUL.md'), 'utf8'))
  } catch {
    text = ''
  }
  const block = extractBlock(text)
  if (block === undefined) {
    return { ...readLegacySoul(text), managed: false }
  }
  const agentName = blockField(block, '我的名字')
  const userName = blockField(block, '你的称呼')
  const summary = blockField(block, '基础灵魂描述')
  return {
    agentName: agentName || DEFAULT_SOUL_PROFILE.agentName,
    userName: userName || DEFAULT_SOUL_PROFILE.userName,
    summary: summary || DEFAULT_SOUL_PROFILE.summary,
    managed: agentName.length > 0 && userName.length > 0 && summary.length > 0,
  }
}

/**
 * Whether the basic soul has been set from the Settings panel.
 * @param {string} memoryDir
 * @returns {boolean}
 */
export function hasManagedSoulProfile(memoryDir) {
  return readSoulProfile(memoryDir).managed === true
}

/** Render the managed block. Multi-line descriptions use two-space
 * continuation lines so the block stays valid markdown and round-trips. */
function renderBlock({ agentName, userName, summary }) {
  const summaryMarkdown = String(summary)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join('\n')
  return `${SOUL_PROFILE_START}
## 人格基础（设置页维护，可手改）

- **我的名字**：${agentName}
- **你的称呼**：${userName}
- **基础灵魂描述**：${summaryMarkdown}
${SOUL_PROFILE_END}`
}

/**
 * Insert the block after the title line (never before frontmatter), or replace
 * an existing one. Everything else in the file is preserved verbatim.
 */
function replaceOrInsert(text, block) {
  const start = text.indexOf(SOUL_PROFILE_START)
  if (start !== -1) {
    const end = text.indexOf(SOUL_PROFILE_END, start)
    if (end !== -1) {
      return text.slice(0, start) + block + text.slice(end + SOUL_PROFILE_END.length)
    }
  }
  const lines = text.split('\n')
  let insertAt = 0
  if (lines[0]?.trim() === '---') {
    // Skip the YAML frontmatter if present.
    const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
    insertAt = endIndex === -1 ? 0 : endIndex + 1
  }
  const titleIndex = lines.findIndex((line, index) => index >= insertAt && line.startsWith('# '))
  if (titleIndex !== -1) insertAt = titleIndex + 1
  const before = lines.slice(0, insertAt).join('\n')
  const after = lines.slice(insertAt).join('\n')
  return `${before}\n\n${block}\n${after.startsWith('\n') ? '' : '\n'}${after}`
}

/**
 * Write the soul profile into the managed block (atomic).
 *
 * @param {string} memoryDir
 * @param {{ agentName?: string, userName?: string, summary?: string }} profile
 * @returns {{ agentName: string, userName: string, summary: string, managed: true }}
 */
export function writeSoulProfile(memoryDir, profile = {}) {
  const agentName = trim(profile.agentName)
  const userName = trim(profile.userName)
  const summary = trim(profile.summary)
  if (agentName.length === 0) throw new Error('agentName must be a non-empty string')
  if (agentName.length > SOUL_NAME_MAX) throw new Error(`agentName must be at most ${SOUL_NAME_MAX} characters`)
  if (userName.length > SOUL_NAME_MAX) throw new Error(`userName must be at most ${SOUL_NAME_MAX} characters`)
  if (summary.length === 0) throw new Error('summary must be a non-empty string')
  if (summary.length > SOUL_SUMMARY_MAX) throw new Error(`summary must be at most ${SOUL_SUMMARY_MAX} characters`)

  const path = join(memoryDir, 'SOUL.md')
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throw new Error('SOUL.md not found (run the memory scaffold first)')
  }
  // Parse normalised; keep the file's own newline style on write-back so a
  // Windows CRLF file is not half-converted to LF.
  const crlf = raw.includes('\r\n')
  const updated = replaceOrInsert(normalizeNewlines(raw), renderBlock({ agentName, userName, summary }))
  const output = crlf ? updated.replace(/\n/g, '\r\n') : updated
  const tmp = `${path}.tmp`
  writeFileSync(tmp, output, 'utf8')
  renameSync(tmp, path)
  return { agentName, userName, summary, managed: true }
}

/**
 * Flip `status: pending` to `status: complete` in BOOTSTRAP.md.
 *
 * @param {string} memoryDir
 * @returns {boolean} whether the file changed
 */
export function markBootstrapComplete(memoryDir) {
  const path = join(memoryDir, 'BOOTSTRAP.md')
  if (!existsSync(path)) return false
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return false
  }
  const crlf = raw.includes('\r\n')
  const text = normalizeNewlines(raw)
  if (/^status:\s*complete\s*$/m.test(text)) return false
  const updated = /^status:\s*\S+/m.test(text)
    ? text.replace(/^status:\s*\S+/m, 'status: complete')
    : `---\nstatus: complete\n---\n\n${text}`
  const output = crlf ? updated.replace(/\n/g, '\r\n') : updated
  const tmp = `${path}.tmp`
  writeFileSync(tmp, output, 'utf8')
  renameSync(tmp, path)
  return true
}

/**
 * Remove `_（铸魂对话中确认）_` placeholder lines from the **injected** copy of
 * SOUL.md. The file itself keeps them (the user or a later conversation may
 * still fill the detailed sections in).
 *
 * @param {string} text
 * @returns {string}
 */
export function filterBootstrapPlaceholders(text) {
  if (typeof text !== 'string' || text.length === 0) return text
  return text.split('\n').filter((line) => !line.includes(PLACEHOLDER)).join('\n')
}
