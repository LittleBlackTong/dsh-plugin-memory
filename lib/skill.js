/**
 * Embedded runtime skill definition.
 *
 * The plugin registers the `memory` skill through `ctx.skills.register()`,
 * so the operating protocol (remember / recall / consolidate / forget +
 * bootstrap) ships with the plugin and does not depend on a filesystem
 * skill file. Project-level skills (e.g. `<project>/.dsh/skills/memory`)
 * still outrank this runtime registration, so a user can override the
 * protocol locally.
 *
 * The instruction body lives in `skills/memory.md` next to this package.
 *
 * @module dsh-plugin-memory/skill
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const MEMORY_SKILL_NAME = 'memory'

export const MEMORY_SKILL_DESCRIPTION =
  '长期记忆技能：按指引读写记忆库（SOUL.md 人格、MEMORY.md 协议、index.md 目录、log.md 时间线），执行 remember / recall / consolidate / forget，会话收尾做 digest 沉淀；记忆为可迁移的 markdown。'

export const MEMORY_SKILL_WHEN_TO_USE =
  '每次会话开始（boot recall，配合插件自动注入的 boot 块）、用户说"记住/忘掉/你还记得"、学到关于用户或自身的持久事实/偏好/决策、会话收尾 digest 沉淀、用户要求 lint / 导出 / 迁移 / 打包记忆时。'

let cached = undefined

/**
 * Read the instruction body shipped with the package.
 * @returns {string} skill instruction markdown
 */
export function memorySkillContent() {
  if (cached !== undefined) return cached
  const url = new URL('../skills/memory.md', import.meta.url)
  try {
    cached = readFileSync(fileURLToPath(url), 'utf8')
  } catch {
    cached = ''
  }
  return cached
}
