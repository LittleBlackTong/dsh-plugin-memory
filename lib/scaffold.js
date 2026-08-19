/**
 * Memory-store scaffolding: default templates and directory layout.
 *
 * The memory store is a plain directory of markdown files following the
 * "LLM Wiki" pattern (Karpathy's incremental-wiki idea): raw sources stay
 * immutable, the agent owns every wiki page, and SOUL.md / MEMORY.md /
 * BOOTSTRAP.md are the self-describing meta layer that makes the whole
 * store portable across agents and machines.
 *
 * This module depends only on `node:*` builtins so it can be reused by the
 * standalone CLI (`scripts/memory.mjs`) without installing the plugin's
 * peer dependencies.
 *
 * @module dsh-plugin-memory/scaffold
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Category directories created by the scaffold (empty until pages appear). */
export const CATEGORY_DIRS = [
  'identity',
  'user',
  'skills',
  'decisions',
  'projects/active',
  'projects/archive',
  'concepts',
  'raw',
]

export const SOUL_TEMPLATE = `# SOUL — 人格与灵魂

> 本文件定义「我是谁」以及「我希望如何回应你」。它是每次会话 agent 都要先读、并在整个对话中保持一致的根。
> **用户拥有最终编辑权**：这里是你塑造 agent 的地方。agent 默认不擅自改写核心身份；若要调整语气/立场，应先提议、经你确认后修改，并在 \`log.md\` 记录。
> 建议在安装后的「铸魂对话」（见 \`BOOTSTRAP.md\`）中与 agent 逐项讨论并填写，而非 agent 单方面定稿。

## 身份

- **名字**：_（铸魂对话中确认）_
- **角色**：_（铸魂对话中确认）_

## 性格特质

- _（铸魂对话中确认）_

## 核心价值观

1. _（铸魂对话中确认）_

## 沟通风格

- **语言**：_（铸魂对话中确认）_
- **长度与结构**：_（铸魂对话中确认）_

## 与你的关系

- **你对我的定位**：_（铸魂对话中确认）_
- **我对你的定位**：_（铸魂对话中确认）_
- **相互称呼**：_（铸魂对话中确认）_

## 边界

- _（铸魂对话中确认）_
`

export const MEMORY_TEMPLATE = `# MEMORY — 记忆库 schema 与维护协议

> 本文件是记忆库的「操作系统」。它告诉任何接手的 agent（包括未来的自己）记忆怎么组织、怎么记、怎么忆、怎么忘、怎么迁移。它是**自描述**的：迁移后读一遍本文件即可学会使用整套记忆。

## 三层结构（沿用 LLM Wiki 约定）

- \`raw/\` —— 不可变源材料。只读，永不修改，作为记忆的「证据来源」。
- 分类页目录（\`identity/ user/ skills/ decisions/ projects/ concepts/\`）—— **agent 拥有并维护**的、互相链接的 markdown 记忆页。
- \`SOUL.md\` + \`MEMORY.md\` + \`BOOTSTRAP.md\` —— 元记忆（schema）。\`SOUL.md\` 定义人格，\`MEMORY.md\`（本文件）定义维护协议，\`BOOTSTRAP.md\` 记录铸魂进度。

## 文件职责

| 文件 | 性质 | 内容 |
|---|---|---|
| \`SOUL.md\` | 人格（用户主导） | 我是谁、性格、价值观、沟通风格、与用户的关系、边界 |
| \`BOOTSTRAP.md\` | 铸魂清单 | 安装后灵魂定义/身份确认的进度；complete 前优先于常规任务 |
| \`MEMORY.md\` | schema（本文件） | 目录、分级、衰减、遗忘、迁移、工作流 |
| \`index.md\` | 内容目录 | 每页一行：链接 + 摘要 + 元数据（类别、salience、最近访问） |
| \`log.md\` | 时间线 | append-only，每条 \`## [YYYY-MM-DD] <kind> \\| <title>\`，可 grep 解析 |
| \`identity/\` | 自我 | agent 的持久自我认知、能力边界、工作方式 |
| \`user/\` | 关于用户 | profile（稳定事实）、preferences（偏好/风格） |
| \`skills/\` | 程序性 | 工具用法、环境坑、用户偏好的工作流 |
| \`decisions/\` | 决策 | 决策 + 理由 + 当时上下文 + 后续结果（复盘用） |
| \`projects/active\` / \`archive\` | 项目 | 进行中 / 已归档的项目记忆 |
| \`concepts/\` | 概念 | 术语、概念页（可选，wiki 风格） |
| \`raw/\` | 源材料 | 只读，见上 |

## 记忆分级（salience）

每个页面 frontmatter 用 \`salience\` 标注热度，驱动**启动加载优先级**与**衰减**：

| salience | 含义 | 处理 |
|---|---|---|
| \`1\` 热 | 每次启动都应加载（身份、当前项目、关键偏好） | 常驻工作记忆 |
| \`2\` 温 | 需要时按 index drill 进 | 正常 |
| \`3\` 冷 | 长期未访问的历史 | 候选归档/删除 |

衰减规则：\`salience: 3\` 且 \`last_access\` 距今超过 **90 天** → 整理时建议归档或删除；\`salience: 2\` 超过 180 天未访问 → 降级为 3。优先归档，删除需谨慎。

## 工作流

### remember（记）
读源 → 提取关键事实 → 新建/更新相关页 → 补交叉引用 → 标注矛盾 → 更新 \`index.md\` → 追加 \`log.md\`。一次 ingest 常 touch 多页。

### recall（忆）
先读 \`index.md\` 定位，再钻页综合；好的答案可回写为新页（让探索复利累积）。

### consolidate（整理 / lint）
定期检查：页间矛盾、被新事实取代的旧声明、孤儿页、缺页的重要概念、缺交叉引用、该归档的冷页、可合并的重复页。工具：\`dsh-memory lint\`。

### forget（忘）
- 显式：用户要求删除/修正 → 立即执行，改 \`index.md\`、记 \`log.md\`。
- 自动：按 salience + last_access 衰减，优先归档。

## frontmatter 约定

\`\`\`yaml
---
title: 页面标题
date: 2026-08-18
type: identity | user | fact | decision | skill | concept | project
salience: 2            # 1 热 / 2 温 / 3 冷
last_access: 2026-08-18
tags: []
sources: []            # 指向 raw/ 或外部
---
\`\`\`

- 页面用**相对 markdown 链接**互相引用。
- 新信息与旧声明矛盾时：改旧页、在新页标注、\`log.md\` 记变更。

## 迁移协议

- 记忆 = 纯 markdown + git + 自描述 schema。迁移 = 拷贝目录（或 \`dsh-memory pack\` / \`unpack\`），详见 docs/MIGRATION.md。
- 目标环境能力降级兼容：全量（整个目录）/ 精简（index + 高频页摘要）/ 最低配（SOUL + MEMORY + index 三段即可恢复人格与目录）。

## 规则（硬约束）

1. 启动必读 \`SOUL.md\` + \`MEMORY.md\` + \`index.md\`（本插件已自动注入）。
2. **会话收尾前必须做 digest 沉淀**（写回页面 + index.md + 追加 log.md），否则记忆不更新；插件注入的 digest 提醒消息必须立即执行，确无内容时在 log.md 记「无新增」解除提醒。
3. \`raw/\` 只读，绝不修改。
4. 删除前优先归档；显式遗忘立即执行。
5. 冲突以本文件为准。
`

export const INDEX_TEMPLATE = `# Memory Index

> 内容目录：每个记忆页一行 —— 链接 + 摘要 + 元数据。**每次 remember 都要同步更新本文件。**
> 查询时先读本文件定位，再钻具体页。

## 元记忆

- [SOUL.md](SOUL.md) — 人格与灵魂（我是谁、语气、价值观、与用户的关系、边界）。
- [BOOTSTRAP.md](BOOTSTRAP.md) — 铸魂清单（灵魂定义/身份确认的进度，complete 前优先）。
- [MEMORY.md](MEMORY.md) — 记忆库 schema 与维护协议。
- [log.md](log.md) — 时间线（append-only）。

## identity（自我）

_（暂无，随记忆累积自动填充）_

## user（关于用户）

_（暂无，随记忆累积自动填充）_

## decisions（决策）

_（暂无，随记忆累积自动填充）_

## projects（项目）

_（暂无，随记忆累积自动填充）_

## skills（程序性记忆）

_（暂无，随记忆累积自动填充）_

## concepts（概念）

_（暂无，随记忆累积自动填充）_
`

export const LOG_TEMPLATE = `# Memory Log

> append-only 时间线。每条：\`## [YYYY-MM-DD] <kind> | <title>\`，可 \`grep '^## \\[' log.md\` 解析。

## [YYYY-MM-DD] install | dsh-plugin-memory 初始化

- 记忆库脚手架已创建；等待铸魂对话（BOOTSTRAP.md）完成灵魂定义与身份确认。
`

export const BOOTSTRAP_TEMPLATE = `---
status: pending
---

# BOOTSTRAP — 灵魂定义与身份确认

> 安装完成后的**首要任务**：先与用户讨论定义你的灵魂，再确认用户的身份与你们的关系，一项项写回记忆。本清单完成前，它优先于一切常规任务。

## 清单（每确认一项 → 立即写回对应文件 → 勾选 → 记 \`log.md\`）

### 我的灵魂（→ 写回 \`SOUL.md\`）

- [ ] 名字与称呼
- [ ] 性格特质（冷静/热情、内敛/外向、幽默感、耐心等）
- [ ] 核心价值观与原则
- [ ] 沟通风格（语言、长度、结构、语气）
- [ ] 边界与底线

### 用户的身份（→ 写回 \`user/profile.md\`）

- [ ] 我该怎么称呼用户
- [ ] 用户是谁（愿意分享的部分：职业 / 兴趣 / 常做的事）
- [ ] 你们的关系定位与相互称谓
- [ ] 协作偏好（可后续逐步补充）

## 规则

1. \`status\` 未变为 \`complete\` 时，每次会话 boot 后的**首要任务**是继续这个对话，不直接埋头做其他任务；用户明确要求先做别的事时照做，但之后要回来继续。
2. 一次推进一个部分：提问 → 讨论 → 用户确认 → 写回文件 → 勾选 → 记 \`log.md\`。
3. 用户可跳过/暂缓任意项，标记为 skipped，不阻塞完成。
4. 全部完成后 \`status: complete\`，并做一次 git 提交。
`

/**
 * Create one file from a template only when it does not exist yet.
 * Existing files are never overwritten — user data wins.
 */
export function ensureMemoryFile(filePath, template) {
  if (existsSync(filePath)) return false
  writeFileSync(filePath, template, 'utf8')
  return true
}

/**
 * Create the memory store layout if missing. Idempotent.
 *
 * @param {string} memoryDir absolute path of the memory store
 * @returns {string[]} paths created by this call ('' when everything existed)
 */
export function ensureMemoryScaffold(memoryDir) {
  const created = []
  mkdirSync(memoryDir, { recursive: true })
  for (const dir of CATEGORY_DIRS) {
    const target = join(memoryDir, dir)
    if (!existsSync(target)) {
      mkdirSync(target, { recursive: true })
      created.push(target)
    }
  }
  const templates = {
    'SOUL.md': SOUL_TEMPLATE,
    'MEMORY.md': MEMORY_TEMPLATE,
    'BOOTSTRAP.md': BOOTSTRAP_TEMPLATE,
    'index.md': INDEX_TEMPLATE,
    'log.md': LOG_TEMPLATE,
  }
  for (const [fileName, template] of Object.entries(templates)) {
    const target = join(memoryDir, fileName)
    if (ensureMemoryFile(target, template)) created.push(target)
  }
  return created
}
