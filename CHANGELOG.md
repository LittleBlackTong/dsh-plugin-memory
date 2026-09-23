# Changelog

所有记录跟随 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格；版本号与 `package.json` 保持一致。

## [0.7.0] - 2026-09-23

### Added（boot 预算按文件分配 + last_access 自动戳记 + 记忆健康看板）

- **boot 预算不再平摊**（`lib/boot.js`）：旧规则是 `总预算 / 文件数` 平均分给每个文件，于是 `index.md` 一长大，**它的尾部就先被截掉**——agent 连「有这一页」都看不到，更谈不上 drill 进去。现在按文件分配：显式配额（新增 `bootFileBudgets`）→ 其余文件均分且以实际大小封顶 → 余额补回「仍有内容未注入」的文件（`index.md` 优先，其余按体积降序，单个文件最多补到均分额度的两倍）。每个文件都小于均分额度时，结果与旧规则逐字节一致。`bootMaxChars` 默认值同时从 `6000` 提到 `12000`——6000 全量塞不下「人格 + schema + 目录」，默认值偏小正是它被截断的原因之一。
- **`last_access` 自动戳记**（新增 `lib/pages.js`）：`MEMORY.md` 的衰减规则依赖 `last_access`，但它一直是个没人写的字段——模板里有、规则里提到、代码里没有，所以每个页面都原地变老、衰减表形同虚设。现在会话收到第一条真实用户消息时，插件把 boot 块**实际注入到的页面**（boot 文件 + `index.md` 引用到的分类页）戳成当天：每会话一次、按天幂等、只改 `last_access` 一行、无 frontmatter 的页面不碰、`trackPageAccess: false` 可关。
- **CLI**：新增 `dsh-memory touch [pages...]`（不带参数 = 全部页面），`search` 新增 `--touch`；`status` 增加陈旧页统计（>90 天未访问 / 缺 `last_access`）与最老戳记。
- **`index.md` 定位为路由表**：脚手架模板、嵌入式 `memory` 技能与 `MEMORY.md` 模板同步写入「一行一页、摘要 ≤ 80 字、不写状态流水」的纪律——它会被完整注入，膨胀的代价是挤掉人格与其他记忆。
- **记忆健康看板**（新增 `lib/insights.js` + `lib/client.js` 看板卡片 + `GET /api/memory/insights`）：设置页「记忆 Memory」区块下方新增**只读**看板——记忆页 / index 路由 / 记忆字数、健康分（孤儿页、缺 frontmatter、陈旧页、失效链接加权）、访问新鲜度条形图（今天 / ≤7 / ≤30 / ≤90 / >90 天 / 从未戳记）、四项体检结论、陈旧页候选、最近 5 条动态。数据每次请求实时统计，**不缓存、不落盘、不写记忆库**；体检口径与 `dsh-memory lint` 同源，二者不会互相打脸；字数按**字符**而非字节计（中文按字节会虚高约 3 倍）。

- **index 声明式编译**（新增 `lib/index-page.js` + CLI `dsh-memory index [--check|--write|--sync-frontmatter]`）：索引纪律原来只在文档里，实测 85% 的行超标（中位 191 字符、最长 2000+）。现在索引行是**页面 `summary:` 的投影**——编译器绝不自己编话（曾实现"从首句推导摘要"，实测把铺垫当要点，已删除该路径）。重写只改行内容、保留分节与顺序、幂等；根元文件永不重写；无 `##` 的扁平索引也能解析。`lint` 增加超长行 / 未声明 summary 检查，与 `index --check` 分工不重复。
- **digest 提醒附带索引漂移**：会话空闲触发 digest 提醒时，插件顺带跑一次索引检查，把「N 行与页面不一致 / N 个新页未收录 / N 个链接失效」写进提醒正文，`dsh-memory index --write` 即可修复。只在真要提醒时才扫描，不增加空闲开销。

### Fixed

- **`lint` 在刚 `init` 的记忆库上误报**：脚手架 `log.md` 模板里的占位行 `## [YYYY-MM-DD] install | ...` 会被自己的 lint 规则判为「malformed entry」。占位行改为引用块（`> ## [...]`），lint 只认真正的 `## ` 行。

### Tests

- 87/87 全过（新增 `boot-budget` / `pages` / `page-access` / `cli` / `insights` / `insights-route` 六套：预算分配与截断行为、引用提取与戳记语义、插件端「首条用户消息 → 戳记」链路与 `trackPageAccess: false`、CLI 新建库自检与帮助文本、看板数据层（分布/新鲜度/体检/只读性）、看板路由（GET 200 / POST 405 / 跟随 memoryDir 热改））。

## [0.6.0] - 2026-09-09

### Added（两道礼貌闸门：提问后才注入 + 只注入激活会话）

- **`deferUntilUserSpeaks`**（默认开）：会话收到第一条真实用户消息（`source.kind === 'user'`）前，boot 块、主动追忆、digest 提醒一律不注入——杜绝「开了会话啥也没问就自动蹦提示词」。
- **`activeSessionOnly`**（默认开）：只对「最近收到用户消息的 live root agent」注入，后台 / 未展开会话不再被追忆或 digest 提醒打扰。
- 新增 `lib/activity-tracker.js`：per-agent 状态表（`hasUserSpoken` + 最近用户消息次序），三个注入点共用同一 `shouldInject` 谓词，口径一致。

### Fixed

- 主动追忆首拍立即开火：`nextRecallAt` 初始值为 0 → 第一次 idle 检查就触发。改为「首个满足条件的空闲时刻先 arm 间隔，再等一个随机间隔后才开口」。

### Tests

- 54/54 全过（新增 activity-tracker 套件：hasUserSpoken / isActive / shouldInject / 去重 / 注册表跳过死亡 agent；recall / digest 各补 defer + active 两个闸门用例，并更新首拍 arm 语义用例）。

## [0.5.2] - 2026-08-31

### Changed

- **适配 DSH 0.1.2-alpha.1**：`@deepseek-ai/dsh-skill` / `@deepseek-ai/dsh-system-prompt` 的 peerDependencies 从 `^0.1.0-rc.6` 放宽到 `^0.1.2-alpha.1`（`^0.1.0-rc.6` 无法匹配 prerelease 的新版宿主）。
- 移除 `dsh.client.inject` 里已废弃的 `@deepseek-ai/dsh-client-runtime`（新版宿主已合并进 `dsh-client-modules`，且本插件客户端半只依赖 `react` 平台种子模块）。

## [0.5.1] - 2026-08-24

### Changed

- 包内新增 `CHANGELOG.md` 并纳入 npm 发布文件（`files` 加 `CHANGELOG.md`），随发布携带版本说明。

## [0.5.0] - 2026-08-23

### Added（拟人化：主动追忆 recall-nudge）

- **主动追忆**：对话空下来时，agent 以第一人称主动提起一件**真实记得**的、关于你或你们之间的事——偏好、往事、未了的决定、最近的进展，像老友自然想起那样。纯对话、不写库、**绝不编造**，只从 `log.md` 最近条目取真实引子。
- **双触发**：`turn-stopping`（聊完一句立即检查）+ **30s 轮询定时器**（纯空闲也能到点开口）。
- **随机间隔**：每次追忆后在 `[最短, 最长]` 分钟内随机取下一个时间点，节奏不机械。
- **新增配置（全部进设置面板，热改即生效）**：

  | 配置项 | 默认 | 含义 |
  |---|---|---|
  | `recallEnabled` | `true` | 主动追忆总开关 |
  | `recallIntervalMinMinutes` | `30` | 随机间隔下限（分钟） |
  | `recallIntervalMaxMinutes` | `240` | 随机间隔上限（分钟） |
  | `recallMaxPerSession` | `3` | 每会话最多追忆次数 |

### Fixed

- 首版主动追忆只挂 `turn-stopping`，agent 纯空闲（用户静默等待）时永远不触发 → 补 **30s 轮询定时器**解决。

### Tests

- 44/44 全过（新增 recall-nudge 套件：触发/节律/上限/禁用/空素材/纯空闲轮询/随机间隔范围）。

## [0.4.0] - 2026-08-19

### Added

- **铸魂自动引导（soul-bootstrap）**：记忆库为空（`SOUL.md` 缺失、仍含占位符，或 `BOOTSTRAP.md` 状态非 complete）时，boot 块在头部前置**第一人称引导词**（六步清单），由 agent **主动发起**灵魂定义对话，而不是等用户喂消息；complete 后引导词自动消失、零开销；无 BOOTSTRAP 的旧库以 SOUL 是否已填为准。

## [0.3.0] - 2026-08-19

### Added（防懒双保险）

- **digest guard**：per-root-agent 监听 `agent/turn-stopping`，判断「agent 空闲 + `log.md`/`index.md` 超时未写 + 冷却 + 每会话限次」后，用 `agent.followup()` 注入 plugin 源提醒。写回记忆（mtime 刷新）即解除。
- **auto-commit**：轮询 `git status`，dirty 从首次发现起静默 `quiet` 秒后 `git add -A` + commit；启动时先 flush 存量脏数据；无 `.git` 跳过。

### Changed

- CLI `status` 新增报告最近一次 log write（digest 新鲜度）。
- 措辞强化四处：boot header、内嵌技能、scaffold `MEMORY` 模板、`.dsh/skills/memory/SKILL.md`，把 digest 定为**硬义务**。

### Fixed

- auto-commit 接线 bug：`rebuild()` 里 committer 创建条件写错（`memoryDir !== currentMemoryDir`，首次重建恒 false）→ 改为 `committer === undefined || memoryDir !== currentMemoryDir`；新增接线回归测试。

## [0.2.1] - 2026-08-18

### Changed

- **设置面板弃 settings namespace**：web settings wire 有硬编码白名单（`WEB_SETTINGS_NAMESPACES`），插件 namespace 一律 `settings-not-exposed` 拒绝读写 → 改为**自建配置通道**（JSON 配置文件 + `GET/POST /api/memory/config` 路由），写入即热应用。
- **可安装/可上架**：声明 `dsh.bundle` manifest + 仓库根 `cordis.patch.yml`（含 `dsh.bundle.patch`），可通过 `dsh plugin add` / dsh-market 安装；npm tarball 含 `cordis.patch.yml`（市场安装的硬前提）。
- README 安装方式改为以 `dsh plugin add` 为主，删掉「手动 insert」路径（防 manifest 与手写双轨）。

## [0.2.0] - 2026-08-18

### Added

- **设置面板「记忆 Memory」区块**：`enabled` / `memoryDir` / `autoInject` / `registerSkill` 开关与配置，热改即生效（boot 注入、技能注册随修改立即生效）。

## [0.1.1] - 2026-08-18

### Fixed

- 保留 Cordis 元数据挂在默认导出上（`Object.defineProperties(apply, { name, inject, Config })`），避免 loader 元数据丢失。

## [0.1.0] - 2026-08-18

### Added（插件本体）

- Karpathy *LLM Wiki* 式长期记忆：**boot 强制注入**（`systemPrompt.context`）+ **内嵌 memory 技能**（`skills.register`）+ **便携 CLI**（`init` / `search` / `lint` / `status` / `pack` / `unpack`）+ 脚手架模板。
- 记忆库结构：`SOUL.md` / `MEMORY.md` / `BOOTSTRAP.md` + 分类页目录（`identity/ user/ skills/ decisions/ projects/ concepts/`）+ `index.md` + `log.md`，纯 markdown + git，可迁移。
- 仓库链接（repository / bugs / homepage）指向真实 GitHub，README 徽章/安装/路线图完善。
