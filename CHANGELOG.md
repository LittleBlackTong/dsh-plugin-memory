# Changelog

所有记录跟随 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格；版本号与 `package.json` 保持一致。

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
