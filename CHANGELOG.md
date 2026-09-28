# Changelog

所有记录跟随 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格；版本号与 `package.json` 保持一致。

## [0.9.0] - 2026-09-28

### Added

- **设置侧栏专属标记（大脑 + 节点）**：官方 `settings.section` 槽**只投影 `id` / `order` / `label`**，没有 icon 字段可传；设置 shell 的 `navIcon(id)` 只认一小撮白名单 id（account / models / agent-presets / plugins / archived-sessions），其余一律回落到它自己的齿轮——所以本插件（以及所有第三方区块）此前都挂着齿轮。现在挂载后**按 label 认出自己那一行**，给它打标记、藏掉齿轮，再用 `mask-image` 画专属标记；`MutationObserver` 跟随语言切换与重挂载重新认领，`ctx.effect` 负责摘干净。**只碰我们自己那一行**，不触摸任何 shell 结构。纯判定逻辑在 `lib/settings-nav-icon.js`（含单测），客户端半按项目既有约定内联一份等价实现（同 `graph-drag`）。⚠️ **官方哪天给 `settings.section` 长出 `icon` 字段，这段即可删除**——dsh-market、dsh-better-sidebar、dsh-skill-mcp-panel 用的是同一招。
  - **图形不是手搓的**：轮廓取自 **Lucide 的 `brain`（MIT）左半球**，程序化等比缩放到这张 16×16 网格。实测教训：手绘贝塞尔试了四版，脑回起伏在 16px 下全糊成一个 C 或一朵云；换成专业几何才读得出脑叶。
- **设置区块底部新增「反馈 / 提 issue」入口**：按钮样式（带边框与底色、`padding: 8px 16px`），指向本仓库的 issue 新建页，`target="_blank"` + `rel="noopener noreferrer"`（DSH Desktop 会把外部 HTTPS 交给系统浏览器打开，不携带内嵌会话或 token）。

### Changed

- **侧栏区块名 `记忆 Memory` → `Memory`**（只保留英文）。注意这个字符串**同时是图标认领的匹配键**——显示文案与匹配键必须是同一个，否则语言切换后行与标记会对不上。

### Tests

- 新增 `test/settings-nav-icon.test.mjs`（**9 项**）：label 精确匹配（trim 后全等，非子串）、空 label 谁都不认领、CSS 生成（藏齿轮 + mask + currentColor 跟随主题）、标记 SVG 规格（`viewBox 0 0 16 16` / `stroke-width 1.3` / round cap+join / 纯黑因 mask 只读 alpha）、图形元素计数（1 闭合轮廓 + 3 引出线 + 5 节点）。
- 全量 **173/173 通过**。

## [0.8.1] - 2026-09-28

### Fixed（DSH session format v4 兼容）

- **修复注入消息被 v4 拒绝导致的运行失败**：`recall-nudge` 与 `digest-guard` 生成的消息 source 从 `{ kind: 'plugin', plugin: 'memory' }` 改为 **`{ kind: 'plugin:memory' }`**。
  - **症状**：`SessionFormatError: format v4 message requires a producer-owned source kind`。它被 `dsh-agent-loop` 当作非 LLM 错误包成 `{ message, code: 'UNKNOWN' }`，界面上显示为 `... source kind UNKNOWN`——**`UNKNOWN` 是错误码，不是 kind 值**。
  - **原因**：session format **v4**（官方 DeepSeek Harness **0.1.7+**）的原生准入 `source()` 明确拒绝 `kind === "plugin"` 这一 v3 时代的 wrapper，要求 producer-owned kind；第三方插件的形态是 `plugin:<name>`（`producerKind()` 的兜底分支）。
  - **兼容性门槛（重要）**：v4 校验与 v3 的 `SOURCE_KINDS` 白名单**互斥**——v3 白名单里只有 `plugin`，没有 `plugin:memory`，所以**无法同时兼容两版**。**本版起要求 DSH session format v4（官方 0.1.7+）**；旧版 DSH 请停留在 0.8.0。
  - **历史 session 不受影响**：v3→v4 迁移的 `rewritePluginSource()` 会自动把旧 wrapper 转换成新格式，只有**新注入**的消息需要改。

### Tests

- `test/recall-nudge.test.mjs` / `test/digest-guard.test.mjs` 的 source 断言改为 `deepEqual(source, { kind: 'plugin:memory' })`——顺带卡住「不得再带 `plugin` 字段」。
- 先写测试并确认其失败（`actual: {kind:'plugin',plugin:'memory'}` vs `expected: {kind:'plugin:memory'}`）后才改实现。
- 单测 **32/32 通过**。全量 151 项中 3 项失败（`insights-route` / `page-access` / `plugin-metadata`）为既有的 `@deepseek-ai/schemastery` 依赖缺失，已用 `git stash` 基线对比确认**与本次改动无关**。

## [0.8.0] - 2026-09-24

### Added（checkup 报告 + 注入瘦身 + 日志修复）

- **`dsh-memory checkup [--boot=N]`**（新增 `lib/checkup.js`）：把 lint / status / insights / graph 四个读者合成一份报告——体量、新鲜度条形图、连接度、四项一致性检查，末尾是**按优先级排序的行动清单**。设计动机：四个数字是诊断，"最该做的三件事"才是产品。有活干时退出码非 0。`lonely` 的判据是"除 index 行外没有任何关系"（索引是目录，不算关系）。
- **补链建议分级 strong/weak**：默认只报告有内容信号的建议（共享主题 tag / 标题词），"仅同类型或同桶标签"降级为 weak，需显式请求才返回——否则每个 skill 页都会"应该"连到每个 skill 页。
- **boot 注入瘦身 23%**（9240 → 7118 字符 ≈ 6160 → 4745 token）：`MEMORY.md` 3464 → 1415 字符（与按需加载的 `memory` 技能重叠的 9 个主题交给技能，本文件只留库自己的 schema）；动态条数 5 → 3；索引标签按语义截断而非数到第 N 个字符。
- **修复 `log.md` 读错端**：`renderBootBlock` 用 `readCapped` 取文件**头**，而 log 是 append-only —— 100 KB 的日志意味着每次会话注入的都是**最旧**的 5 条动态。新增 `readTailCapped()` 从尾部按字符读取。影响所有已发布版本。

### Added（互链机制 + 补链建议）

- **互链升级为默认动作**（`skills/memory.md` / `lib/scaffold.js` / `lib/digest-guard.js`）：remember 流程、MEMORY 模板工作流、digest 收尾指令三处都要求「给这次碰过的页面各补 1–3 条相关页链接」。动机是实测数据：一个真实记忆库 29 页里只有 1 条真互链，而图谱、跨页综合、探索全都建立在这层关系上——`index.md` 只是目录。
- **`dsh-memory query`**：结构化检索——先按 frontmatter 过滤（`--tag` / `--type` / `--salience` / `--hot` / `--stale`，可组合），再在结果集内匹配正文关键词。原来的 `search` 只能逐行 `includes`，而 agent 的真实需求通常是"所有带 #memory-plugin 的决策"，不是"含某个词的行"。数据层是新增的 `listPagesWithMeta()`（与看板共用"什么算一页"的口径）。
- **`dsh-memory graph [--suggest]`**（新增 `suggestLinks()` + 路由 `?suggest=1`）：报告关系构成与孤立页；`--suggest` 对「只有索引入口」的页面给出「该引用谁」，按共享主题 tag（3 分）、标题词重合（2 分）、共享桶标签（1 分）、同类型（1 分）打分并输出理由。规则刻意保守：**同类型 + 桶标签本身不足以构成建议**（否则每个 skill 页都"应该"连到每个 skill 页）；完全无标签的页面降级为弱建议但会说明理由。只报告、不写入。

## [0.7.0] - 2026-09-23

### Added（boot 预算按文件分配 + last_access 自动戳记 + 记忆健康看板）

- **boot 预算不再平摊**（`lib/boot.js`）：旧规则是 `总预算 / 文件数` 平均分给每个文件，于是 `index.md` 一长大，**它的尾部就先被截掉**——agent 连「有这一页」都看不到，更谈不上 drill 进去。现在按文件分配：显式配额（新增 `bootFileBudgets`）→ 其余文件均分且以实际大小封顶 → 余额补回「仍有内容未注入」的文件（`index.md` 优先，其余按体积降序，单个文件最多补到均分额度的两倍）。每个文件都小于均分额度时，结果与旧规则逐字节一致。`bootMaxChars` 默认值同时从 `6000` 提到 `12000`——6000 全量塞不下「人格 + schema + 目录」，默认值偏小正是它被截断的原因之一。
- **`last_access` 自动戳记**（新增 `lib/pages.js`）：`MEMORY.md` 的衰减规则依赖 `last_access`，但它一直是个没人写的字段——模板里有、规则里提到、代码里没有，所以每个页面都原地变老、衰减表形同虚设。现在会话收到第一条真实用户消息时，插件把 boot 块**实际注入到的页面**（boot 文件 + `index.md` 引用到的分类页）戳成当天：每会话一次、按天幂等、只改 `last_access` 一行、无 frontmatter 的页面不碰、`trackPageAccess: false` 可关。
- **CLI**：新增 `dsh-memory touch [pages...]`（不带参数 = 全部页面），`search` 新增 `--touch`；`status` 增加陈旧页统计（>90 天未访问 / 缺 `last_access`）与最老戳记。
- **`index.md` 定位为路由表**：脚手架模板、嵌入式 `memory` 技能与 `MEMORY.md` 模板同步写入「一行一页、摘要 ≤ 80 字、不写状态流水」的纪律——它会被完整注入，膨胀的代价是挤掉人格与其他记忆。
- **记忆健康看板**（新增 `lib/insights.js` + `lib/client.js` 看板卡片 + `GET /api/memory/insights`）：设置页「记忆 Memory」区块下方新增**只读**看板——记忆页 / index 路由 / 记忆字数、健康分（孤儿页、缺 frontmatter、陈旧页、失效链接加权）、访问新鲜度条形图（今天 / ≤7 / ≤30 / ≤90 / >90 天 / 从未戳记）、四项体检结论、陈旧页候选、最近 5 条动态。数据每次请求实时统计，**不缓存、不落盘、不写记忆库**；体检口径与 `dsh-memory lint` 同源，二者不会互相打脸；字数按**字符**而非字节计（中文按字节会虚高约 3 倍）。

- **index 声明式编译**（新增 `lib/index-page.js` + CLI `dsh-memory index [--check|--write|--sync-frontmatter]`）：索引纪律原来只在文档里，实测 85% 的行超标（中位 191 字符、最长 2000+）。现在索引行是**页面 `summary:` 的投影**——编译器绝不自己编话（曾实现"从首句推导摘要"，实测把铺垫当要点，已删除该路径）。重写只改行内容、保留分节与顺序、幂等；根元文件永不重写；无 `##` 的扁平索引也能解析。`lint` 增加超长行 / 未声明 summary 检查，与 `index --check` 分工不重复。
- **digest 提醒附带索引漂移**：会话空闲触发 digest 提醒时，插件顺带跑一次索引检查，把「N 行与页面不一致 / N 个新页未收录 / N 个链接失效」写进提醒正文，`dsh-memory index --write` 即可修复。只在真要提醒时才扫描，不增加空闲开销。

- **记忆图谱**（新增 `lib/graph.js` + `lib/graph-layout.js` + `GET /api/memory/graph` + 面板 SVG 卡片）：从 markdown 渲染的图是**星形**（index 连所有页，页间几乎不互链——实测 29 页只有 1 条页间链接），它说明"索引列了所有页"，不说明"哪些记忆属于一起"。本功能补上页面已经编码、却没人画出来的关系：显式页间链接（解析相对路径，如 `../skills/x.md`）、共享 tag（忽略 `project`/`skill` 这类通用容器 tag；同一 tag 的稠密组走锚点链而不是全连接）。布局在服务端算一次（`layoutGraph`，确定性、无随机、无依赖），客户端只画；`?types=1` 可追加同类型弱边。
- **图谱交互**（新增 `lib/graph-drag.js`）：可拖动节点——按住即 1:1 跟手（拖动期间暂停 CSS 过渡），直接邻居按距离轻微跟随，松手后带缓动滑回原布局；首次渲染从中心绽开；尊重 `prefers-reduced-motion`。拖动数学是**纯函数模块**（`applyDrag` / `releasePositions` / `clampToBox` / `neighbourLean`），因为浏览器半无法 import 本地模块，客户端内联一份 12 行等价实现，并由测试断言两者行为一致。**客户端半首次有了测试**：用 Node `vm` 加载 `client.js`（只注入 `react` stub），真跑 `GraphView` 的元素树，断言"每节点一组、每边一线、边端点跟随实时位置、空图渲染 null"。

- **图谱缩放与平移 + 自动刷新**（新增 `lib/graph-view.js`）：滚轮以光标为中心缩放（0.4×–2.5×，监听器非 passive，否则设置页会跟着滚）、拖空白处平移、`重置视图`；节点拖动在缩放后依然落在光标下（屏幕→图坐标转换走同一份数学）。图谱每 25 秒轮询一次，记忆变更在面板开着时自己出现（副标题显示更新时间），失败时保留上一张图。视图数学是纯函数模块（`zoomAt`/`panBy`/`toGraphPoint`/`isZoomed`），客户端内联等价实现并由测试断言一致——**该测试当场抓到两份实现的分歧**：客户端写死 `w/4`、模块写 `w×0.4`，最紧视口差 84px。

### Fixed

- **图谱把 `index.md` 画成了孤岛**：链接遍历只处理"记忆页"，整段跳过了元文件——而 `index.md` 恰恰是全库最大的边集（33 条链接到每一页）。结果是在图上 index 度数为 0，看起来跟谁都没关系（阿周实机截图发现）。现在每个节点都参与链接解析，且索引路由是**独立的边类型**（`index`，灰色虚线、权重更低），所以它既是背景总线、又不会把页面之间的真实关系淹没。修复后：index 度数 0 → **32**，孤立页 6 → **0**。

- **图谱悬停高亮从未生效**：悬停样式是 `g:not(.lit)`，但没有任何代码给 `<g>` 加过 `lit` 类 —— 悬停会变暗**所有**节点，包括被悬停那个。现在按邻居关系给组加类。
- **图谱拖动的指针捕获可能抛错**：`setPointerCapture` 在合成事件/边界情况下会抛，一旦抛出整个拖动就死掉。现在包了 try/catch —— 捕获只是优化，丢掉它拖动依然成立（坐标本身已被画布夹取）。
- **`clampToBox` 把无穷大当成 NaN**：`±Infinity` 是合法方向（应夹到边界），只有 `NaN` 才该回退。修正并补测试。
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
