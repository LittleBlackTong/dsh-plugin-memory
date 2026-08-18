# 记忆迁移指南

记忆的价值在于**不被锁死在某个环境里**。dsh-plugin-memory 的记忆库是纯 markdown + git + 自描述 schema（`SOUL.md` / `MEMORY.md` / `BOOTSTRAP.md`），任何能读 markdown 的 agent 都能接手。本指南覆盖三种迁移场景。

## 原则

1. **数据是主角，插件是配角**：迁移对象是记忆库目录，不是插件配置。
2. **自描述 schema 是交接文档**：新 agent 读一遍 `SOUL.md` + `MEMORY.md` 就学会了这套记忆怎么用。
3. **降级兼容**：目标环境能力越弱，注入的档位越低（见下），但格式不变。

## 场景一：同一台机器，换 agent / 换前端

```sh
# 直接拷贝
cp -R ~/.memory ~/.memory.bak

# 或打包
dsh-memory pack memory-backup.tar.gz

# 在新环境还原（目标为空时）
MEMORY_DIR=/new/location/.memory dsh-memory unpack memory-backup.tar.gz
```

新环境只需安装 dsh-plugin-memory 并把 `memoryDir` 指到新位置。agent 读 boot 块 + `MEMORY.md` 即可接手。

## 场景二：跨机器

```sh
# 机器 A
dsh-memory pack memory.tar.gz
scp memory.tar.gz user@machine-b:/tmp/

# 机器 B
MEMORY_DIR=~/.memory dsh-memory unpack /tmp/memory.tar.gz
```

归档内自带 `memory-manifest.json`（导出时间、每个文件的 sha256 与字节数），可用于校验完整性：

```sh
tar -xzf memory.tar.gz -O memory-manifest.json | python3 -m json.tool
```

## 场景三：git 仓库方式（推荐长期使用）

```sh
cd ~/.memory
git init && git add -A && git commit -m "memory snapshot"
git remote add origin git@github.com:you/memory-private.git
git push -u origin main
```

新机器上 `git clone` 即完成迁移，还附带完整版本历史（记忆的每一次变更都可回滚、可 diff）。

> 注意：记忆可能涉及隐私，请使用**私有仓库**；`dsh-memory pack` 默认排除 `.git` 目录。

## 能力降级档位

目标环境不一定安装了本插件。按目标能力选档：

| 档位 | 适用环境 | 做法 |
|---|---|---|
| **全量** | 装了 dsh-plugin-memory 的 DSH | 整个目录 + `memoryDir` 配置，boot 自动注入 |
| **标准** | 任意能读文件的 agent（Claude Code / Codex / OpenCode…） | 拷贝目录，把 `SKILL.md` 级协议（见 `skills/memory.md`）放到目标环境的技能目录，boot 手动读 `SOUL.md` + `MEMORY.md` + `index.md` |
| **精简** | 只有 system prompt 的环境 | 把 `index.md` + 高频页压成一段摘要，贴进 system prompt |
| **最低配** | 只有一小段 prompt 的环境 | 只贴 `SOUL.md` + `index.md` 摘要——人格与目录恢复了，记忆就"活了"大半 |

## 迁移后检查清单

- [ ] `SOUL.md` / `MEMORY.md` / `index.md` / `log.md` 四个核心文件完整
- [ ] `index.md` 里的链接在新位置全部可解析（`dsh-memory lint`）
- [ ] `log.md` 条目仍可 `grep '^## \['` 解析
- [ ] frontmatter 字段名与 `MEMORY.md` 约定一致
- [ ] 新环境的首个会话能正确回答"你是谁 / 我是谁 / 我们什么关系"

## 反迁移（备份/回滚）

`dsh-memory pack` 随时做快照；git 仓库可用 `git checkout <commit>` 回滚记忆到任意历史版本。
