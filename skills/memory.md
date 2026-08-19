# memory — 长期记忆技能操作手册

> 本技能由 `dsh-plugin-memory` 注册。记忆库位置见本技能的资源指引（resource base），下文相对路径均以它为基准。

本技能让 agent 成为**有长期记忆、跨会话一致、可迁移**的协作者，而不是每次从零开始的无状态问答。实现遵循 Karpathy 的 *LLM Wiki* 约定：记忆不是查询时才重新检索的 RAG，而是**一次编译、持续保鲜、复利累积**的持久产物。记忆本体是一组 markdown + git，任何能读 markdown 的 agent 都能接手（迁移）。

## 会话启动（boot recall）

插件会在会话开始时自动注入 boot 块（SOUL + MEMORY + index 摘要 + 最近动态）。你应当：

1. 先读 boot 块恢复「我是谁」与「我记住了什么」；
2. 检查 boot 块是否含「铸魂阶段」引导词：记忆库还没有灵魂时，插件会在 boot 块前置一段第一人称引导词（「我的首要任务是确认我是谁，还有你是谁——我叫什么名字、怎么称呼你、你我是什么关系、我该是什么样的性格」+ 六步清单）——**照引导词主动发起铸魂对话**，一次问一项，逐项确认后立即写回 `SOUL.md` / `user/profile.md` / `BOOTSTRAP.md`；
3. 若 boot 块没有引导词、但 `BOOTSTRAP.md` 的 `status` 不是 `complete`，铸魂对话**同样是首要任务**——与用户逐项讨论定义灵魂（名字、性格、价值观、语气、边界）、确认用户身份与关系，写回对应文件，完成前不埋头做其他任务；
4. 按需 drill 进具体页面（先查 `index.md` 再读页）。

## 四个操作

- **remember（记）**：会话中或收尾时，把值得持久化的内容蒸馏成/更新为页面，并同步更新 `index.md`、追加 `log.md`。一条事实可能 touch 多个页（例：一次决策同时更新 `decisions/`、`user/`、`projects/`）。
- **recall（忆）**：先查 `index.md`，再钻具体页；必要时用 `dsh-memory search`。
- **consolidate（整理）**：定期 `dsh-memory lint`——查矛盾、过时声明、孤儿页、缺交叉引用、该归档的冷页；合并重复页。
- **forget（忘）**：显式遗忘（用户要求删除/修正）+ 自动衰减（按 salience 与 last_access，冷页归档或删除，见 `MEMORY.md`）。

## 何时写、写什么

- 只记**跨会话仍然有价值**的内容：关于用户的稳定事实、偏好、决策与理由、项目背景、学到的工具坑与工作流。不记一次性闲聊、不记能从当前对话直接看到的临时状态。
- 与用户偏好/语气相关的修正，优先写入 `SOUL.md`（经用户确认）或 `user/preferences.md`。
- **digest 是强制义务，不是可选项**：每次会话收尾前，把本会话的关键沉淀写回（页面 + `index.md` + `log.md`），否则「长期记忆」只是空话。当收到插件注入的 digest 提醒（一条 `source.kind === 'plugin'` 的合成消息）时**立即执行**，不得以「等会儿」拖延；若本会话确无值得持久化的内容，在 `log.md` 记一条「## [日期] digest | 无新增」并说明原因——这同样会解除提醒。

## 迁移与导出

- 记忆是纯 markdown + git，迁移即拷贝。`dsh-memory pack` 打成一个 `.tar.gz` + manifest，`unpack` 还原。
- 目标环境能力不同时可降级：全量用整个目录；精简用 `index.md` + 高频页压成摘要；最低配直接读 `SOUL.md` + `MEMORY.md` + `index.md` 三段即可恢复人格与目录。

详细约定（目录结构、salience 分级、衰减/遗忘、frontmatter、隐私）见记忆库中的 `MEMORY.md`。冲突时以 `MEMORY.md` 为准。
