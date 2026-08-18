# dsh-plugin-memory

> DeepSeek Harness 长期记忆插件：跨会话、可迁移、带「灵魂」的 markdown 记忆库。

**English TL;DR** — A Cordis plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that gives agents a persistent, cross-session, migratable long-term memory: a markdown + git store (inspired by Karpathy's *LLM Wiki* pattern) with a `SOUL.md` persona file, **auto-injected at every session start** via the system-prompt runtime context, plus remember / recall / consolidate / forget workflows and portable CLI tooling.

## 特性

- **开机强制注入**：插件通过 `ctx.systemPrompt.context()` 把记忆 boot 块（`SOUL.md` 人格 + `MEMORY.md` 协议 + `index.md` 目录 + 最近动态）注入每个会话开头。宿主按投影去重：记忆不变就不重复注入，变化时新快照自动取代旧的——这是"新会话必先加载记忆"的**硬保障**，不需要模型碰运气调技能。
- **SOUL.md 铸魂**：安装后首要任务是和用户对话定义灵魂（名字、性格、价值观、语气、边界）、确认身份与关系（`BOOTSTRAP.md` 清单驱动，complete 前优先于常规任务）。
- **复利记忆**：遵循 Karpathy 的 *LLM Wiki* 约定——记忆是"一次编译、持续保鲜"的持久产物，不是每次查询重新 RAG。remember / recall / consolidate / forget 四操作 + salience 三级衰减。
- **可迁移**：记忆本体是纯 markdown + git + 自描述 schema，任何能读 markdown 的 agent 都能接手。`dsh-memory pack/unpack` 打包迁移。
- **内嵌技能**：通过 `ctx.skills.register()` 注册 `memory` 技能（操作协议随插件分发）；项目级 `.dsh/skills/memory` 文件技能仍可覆盖它。
- **零构建**：纯 ESM JavaScript，无编译步骤，`pnpm add` 即用。

## 架构

插件只拥有**工作流**，不拥有**数据格式**：

```
dsh-plugin-memory（本插件）
├── lib/index.js        # Cordis 入口：boot 注入 + 运行时技能注册
├── lib/boot.js         # boot 块渲染（SOUL/MEMORY/index + 最近 log，限额截断）
├── lib/scaffold.js     # 记忆库脚手架（模板只建不覆盖）
├── skills/memory.md    # 内嵌技能的操作协议正文
└── scripts/memory.mjs  # CLI：init/search/lint/status/pack/unpack

记忆库（用户数据，默认 ~/.memory）
├── SOUL.md       # 人格与灵魂（用户主导）
├── BOOTSTRAP.md  # 铸魂清单（complete 前优先）
├── MEMORY.md     # schema 与维护协议（自描述）
├── index.md      # 页面目录    log.md # 时间线（append-only）
├── identity/ user/ skills/ decisions/ projects/{active,archive}/ concepts/
└── raw/          # 不可变源材料
```

## 安装

```sh
pnpm add dsh-plugin-memory
```

在你的 profile 的 `cordis.patch.yml` 中加入：

```yaml
- insert:
    - id: dsh-memory
      name: dsh-plugin-memory
      config:
        memoryDir: '~/.memory'
```

重启 profile（DSH Desktop 重启应用）后生效。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `memoryDir` | `~/.memory` | 记忆库绝对路径（`~` 自动展开） |
| `bootFiles` | `[SOUL.md, MEMORY.md, index.md]` | 开机注入的文件 |
| `bootMaxChars` | `6000` | boot 块总字符预算（防止占用过多上下文） |
| `autoInject` | `true` | 会话开始时注入 boot 块 |
| `registerSkill` | `true` | 注册内嵌 `memory` 技能 |
| `scaffold` | `true` | 记忆库缺失时自动创建模板（只建不覆盖） |

## 首次使用：铸魂

插件安装后，第一次会话里 agent 的首要任务**不是干活**，而是与你对话定义它的灵魂：名字、性格、价值观、语气、边界，以及你的身份与你们的关系。逐项确认并写回 `SOUL.md` / `user/profile.md`，直到 `BOOTSTRAP.md` 的 `status` 变为 `complete`。你可以随时跳过或暂缓。

## 四个操作

- **remember（记）**：把值得持久化的内容蒸馏成页面，同步更新 `index.md`、追加 `log.md`。
- **recall（忆）**：会话开始读 boot 块；查询时先查 `index.md` 再钻页；必要时 `dsh-memory search`。
- **consolidate（整理）**：`dsh-memory lint` 查矛盾、孤儿页、该归档的冷页。
- **forget（忘）**：显式遗忘立即执行；自动衰减按 salience + last_access（冷页优先归档）。

## CLI

```sh
dsh-memory init [dir]                 # 创建记忆库脚手架
dsh-memory search <query>             # 全文检索
dsh-memory lint                       # 完整性体检
dsh-memory status                     # 健康概览
dsh-memory pack [out.tar.gz]          # 打包导出（含 manifest）
dsh-memory unpack <archive> [--force] # 从归档恢复
```

存储定位顺序：`$MEMORY_DIR` → `./.memory`（存在时）→ `~/.memory`。

## 迁移

记忆库是纯 markdown + git：拷贝即迁移。跨机器 / 跨 agent / 能力降级档位见 [docs/MIGRATION.md](docs/MIGRATION.md)。

## 常见问题

**Q：和手写的 `.dsh/skills/memory` 文件技能（skill 版）什么关系？**
skill 版是"软保障"（技能目录只注入简介，正文靠模型主动加载）；本插件是"硬保障"（boot 块随系统提示词运行时上下文自动注入）。两者可共存：文件技能（rank 100）会覆盖插件内嵌技能（rank 250）的协议。如果你之前为了软保障改过系统提示词 persona（如 profile 补丁里的开机指令），装上本插件后建议**移除那段 persona**，避免双份注入。

**Q：boot 块会不会每次请求都重复注入、烧 token？**
不会。运行时上下文按投影去重：内容不变只注入一次；记忆更新后新快照取代旧快照。

**Q：记忆库放在哪里最合适？**
默认 `~/.memory`（全局、跨项目）。需要按项目隔离时，把 `memoryDir` 配到项目内，或让 agent 在项目里维护 `.memory/`。

**Q：可以加密吗？**
记忆含敏感内容时，可把 `memoryDir` 放进加密卷 / 私有仓库。格式不变，插件无感知。

## 开发

```sh
git clone <repo> && cd dsh-plugin-memory
node scripts/memory.mjs --self-test   # 冒烟测试（无需安装依赖）
```

零构建：`lib/` 直接是运行时代码，`lib/types/index.d.ts` 供 TS 消费方使用。`boot.js` / `scaffold.js` 只依赖 `node:*` 内置模块，可独立复用。欢迎 PR（TypeScript 重写、embedding 检索、MCP server 等方向）。

## License

[MIT](LICENSE)
