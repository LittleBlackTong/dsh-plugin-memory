# 记忆面板 · 时间轴视图设计

> Status: draft（待阿周 review）
> 日期：2026-11-16
> 关联：dsh-plugin-memory（当前 0.19.5）、图谱面板（GraphCard/GraphView）
> 原型：`/tmp/memory-timeline-mockup/index.html`（v3：单线、缩放联动、双主题、标签自适应；不在仓库内）

## 1. 目标

在记忆面板（设置 → 记忆）里新增 **时间轴** 视图，与现有 **图谱** 视图通过 tab 切换。时间轴把 `log.md` 的事件按时间轴展示成「地铁线路」：单条主线、多色站点、可拖动/滚轮缩放、缩放自动联动 日/周/月/年 刻度、节点不拥挤时显示事件描述、深浅色主题自适应。

**已确认的交互**（阿周 2026-11-16）：
1. 单线（一条主线 + 多色站点），不做多车道。
2. 缩放自动联动粒度（不手动切换日/周/月/年）。
3. 默认只显示关键事件；勾选「显示全部事件」再显示笔记/过程类。
4. 单击站点弹详情卡；**双击站点打开对应记忆文件**（复用图谱节点的侧栏打开逻辑）。
5. 初始视口停在**最近一周**（最新事件在右端）。
6. 深色/浅色两套主题（跟随 DSH 主题）。

## 2. 非目标（YAGNI）

- 不做多车道（按类型分线）。
- 不做虚拟化/分页（首版 300 条量级直接渲染；超过 ~1000 条再评估）。
- 不新增记忆存储格式：时间轴数据全部从现有 `log.md` 与页面 frontmatter 派生。
- 不承诺每条事件都能打开页面：log 标题是自由文本，匹配不到时双击打开 `log.md`（见 §4.3）。

## 3. 数据层（Host）

### 3.1 新只读路由

`GET /api/memory/timeline`（与 `/api/memory/graph` 同风格，`webServer` 注册、`ctx.inject(['webServer'])`）：

```json
{
  "events": [
    { "date": "2026-11-12", "kind": "fix", "group": "fix", "title": "dsh-plugin-memory 0.19.5（健壮性加固…）", "path": "projects/active/dsh-plugin-memory.md" }
  ],
  "stats": { "events": 295, "first": "2026-08-18", "last": "2026-11-12", "pages": 56 }
}
```

- `date`：`log.md` 中 `## [YYYY-MM-DD]` 的日期。
- `kind`：条目里的 kind（fix/feat/publish/decision/note/task/…，全量保留）。
- `title`：`|` 之后的标题文本。
- `group`：客户端使用的 5 类映射（fix/feat/publish/decision/other），host 侧提供以保证两端一致。
- `path`：可选；见 §4.3 的匹配规则；匹配不到省略该字段。
- `stats`：统计（事件数、起止日期、页面数），供面板顶部展示。

### 3.2 解析规则

- 只解析 `log.md` 的 `## [date] kind | title` 行（当前 295 条；忽略其他行）。
- 过滤无效日期（非法日期跳过，不报错）。
- **不缓存**：每次请求重读 `log.md`（文件小、与图谱同样轻量）；后续若日志增长再考虑 mtime 缓存。
- 解析失败（文件缺失/不可读）→ 返回空数组 + 200（只读、不抛错）。

### 3.3 事件 → 页面匹配（双击打开用）

按优先级匹配，匹配不到就 `path` 缺失：
1. 标题包含某页面标题（frontmatter `title`）或文件名（不含 `.md`）→ 该页面路径。
2. 标题包含 `projects/active/<name>`、`user/<name>` 之类的相对路径片段 → 直接对应。
3. 都不中：不提供 `path`。

双击行为（客户端）：
- 有 `path`：走现有 `openInSidebar`/`openNode` 同一套逻辑（`dsh-resource://file/session/<sid>/<rel>`；工作区外回退系统文件管理器）。
- 无 `path`：在侧栏打开 `log.md`（整个文件），并提示「该事件没有对应页面，已打开 log.md」。

## 4. 客户端视图

### 4.1 结构（复用 GraphCard 的数据流）

```
MemorySection
└─ MemoryPanelCard（新，包 GraphCard 与 TimelineCard）
   ├─ tab 栏：图谱 | 时间轴
   ├─ GraphCard（现有，原样保留；切到图谱时才轮询 graph）
   └─ TimelineCard（新）
      ├─ 顶部统计行（事件数 / 跨度 / 当前粒度）
      ├─ toolbar（缩放联动提示、缩放按钮、回到今天、显示全部开关、图例）
      ├─ stage（时间轴轨道：轴线、刻度、站点、标签）
      └─ 详情卡（单击站点显示日期 + 类型 + 标题）
```

- tab 状态只在内存中（默认「时间轴」还是「图谱」？——建议**保持图谱为默认**，与现状一致；时间轴是增强）。
- 切到图 tab 时才加载 graph；时间轴 tab 打开时拉 `/api/memory/timeline` 并按固定间隔（如 15s）轮询刷新。
- `TimelineCard` 复用 `GraphCard` 的刷新失败静默策略（保留上一次数据）。

### 4.2 时间轴渲染（纯函数拆分，便于单测）

**坐标模型**：线性时间轴。`x = (t - minT) / DAY * pxPerDay + offset`。

- `pxPerDay`：连续缩放值（初始 54，范围 1.4–240）。
- `scaleFor(pxPerDay)`：`>=30 日`、`>=7 周`、`>=1.6 月`、否则 `年`。
- 刻度：日视图每 ≥7 天、周视图每 2 周（周一起）、月视图每月 1 日、年视图每年 1 月 1 日。
- 站点：按事件日期定位；同日多事件水平 ±9px、上下交错（`j % 2`）。
- 站点尺寸/颜色按 group（fix/feat/publish 13px、decision 14px、other 10px）。
- **标签自适应**：按 x 排序后顺序放置，若标签左边缘与上一个标签右边缘间距 < 8px 则跳过该标签（只留圆点）；标签最多 22 字截断，max-width 200px。
- **初始视口**：最近一周——把 `[maxT - 7d, maxT]` 放进视口右侧：`offset = W - 40 - (maxT - minT)/DAY*pxPerDay` 的基础上，偏移到让 maxT 在右侧 40px 内、且最近 7 天可见（即视口宽度不足 7 天时以 maxT 为准）。
- 「回到今天」：重置到上述初始视口。
- 交互：`pointerdown/move/up` 拖动平移（clamp 到数据范围两端）；`wheel` 缩放（围绕鼠标位置：`offset = mx - (mx - offset) * (newPx/oldPx)`）；缩放后自动重算 scale/刻度/标签。

### 4.3 过滤

- 默认只显示「关键事件」：`group !== 'other'` 或 group === 'other' 但 kind 属于关键集合？——简化：**默认排除过程的 kind**（note/digest/install/uninstall/setup/bootstrap/task/probe/recall/consolidate/ops/schedule/export），其余显示（与原型 v3 一致，约 250 条）。
- 勾选「显示全部事件」→ 全量。
- 过滤在客户端（host 返回全量），统计行显示 `显示 X / 全部 Y`。

### 4.4 主题

- **跟随 DSH 主题**：所有颜色用 DSH 变量 + fallback，例如
  - 文本：`var(--dsw-alias-label-primary, #...)`
  - 次级：`var(--dsw-alias-label-secondary, ...)`
  - 边框：`var(--dsw-alias-border-l2, ...)`
  - 背景：`var(--dsw-alias-bg-layer-1/2, ...)`
- 站点颜色在两套主题下的对比度用 CSS 变量组（亮/暗各一组），参考图谱现有做法。
- 不新增独立主题切换按钮（跟随宿主）；原型里的 ◐ 只用于演示。

### 4.5 打开文件

- 双击站点 → 与图谱节点一致：host 的 `/api/memory/session` / 客户端 `openInSidebar`；失败提示文案复用 `graphSidebarFailed`/`graphSidebarOutside`，新增 `timelineNoPage`（"该事件没有对应页面，已打开 log.md"）。

## 5. 改动清单

| 文件 | 改动 |
|---|---|
| `lib/timeline.js`（新） | 解析 `log.md` → events + stats（纯函数，可单测） |
| `lib/index.js` | 注册 `GET /api/memory/timeline`；导出 `buildTimeline` |
| `lib/client.js` | 新增 `TimelineCard`、tab 容器、标签/刻度/缩放纯函数；复用 `openInSidebar`；新增文案（中英） |
| `lib/types/index.d.ts` | 新 API 类型（TimelineEvent/TimelinePayload） |
| `test/timeline.test.mjs`（新） | host 解析（含异常/空/非法日期）、group 映射、path 匹配 |
| `test/session-ui.test.mjs`（扩） | TimelineCard 渲染（vm + React stub：站点数量、标签自适应阈值、缩放联动 scaleFor、初始视口最近一周） |
| `README.md` / `README.zh.md` | 功能描述加「时间轴视图」 |
| `docs/CONFIGURATION.md` | 无需新增配置项（纯只读视图） |

## 6. 测试计划

- host：解析真实 log 片段（fixture）、空文件、损坏文件、无 `##`、未知 kind、匹配到/匹配不到页面。
- client 纯函数：`scaleFor` 边界（30/7/1.6）、`layout` 刻度生成、标签碰撞（拥挤/不拥挤）、初始视口计算（最近一周）。
- client 渲染：TimelineCard 在 fake React 下渲染（统计行、站点 DOM、详情卡点击）；tab 切换（图谱 ↔ 时间轴）。
- 回归：现有 341 测试全绿 + self-test。

## 7. 风险与边界

1. **log 事件↔页面匹配不保证**：只做标题/路径模糊匹配，匹配不到时双击打开 log.md；文档与 UI 文案明确。
2. **纯文本标题的 XSS**：所有标题经 `escapeHtml`（沿用现有工具），不注入 HTML。
3. **性能**：300–1000 站点直接 DOM 渲染可接受；标签计算 O(n log n)。超 1000 条再考虑 canvas/虚拟化。
4. **时区**：日期按 `YYYY-MM-DD` 解析为 UTC 日（避免本地时区跨日漂移），展示用本地日期字符串（log 本身是本地记录）。
5. **主题变量缺失**（老版本宿主）：全部变量带 fallback，退化到当前深浅色。
6. **rc.2 兼容**：纯增量（新路由 + 新视图），复用已有 `webServer`/`slots`/`openInSidebar` 路径；不触碰 `agents.roots` 等敏感面。

## 8. 待定（review 时确认）

- tab 默认落在「图谱」还是「时间轴」？（建议图谱，保持现状）
- 「显示全部事件」开关默认关（关键事件），确认。
