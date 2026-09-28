/**
 * 记忆插件的设置侧栏标记（导航图标）。
 *
 * 为什么需要这个模块：官方 `settings.section` 槽**只投影 id / order / label**，
 * 没有 icon 字段可传；设置 shell 的 `navIcon(id)` 只认一小撮白名单 id
 * （account / models / agent-presets / plugins / archived-sessions），其余一律
 * 回落到它自己的齿轮。所以注册方拿不到图标位。
 *
 * 做法（与 dsh-market 的 `settings-nav-icon.ts`、dsh-better-sidebar、
 * dsh-skill-mcp-panel 同款）：挂载后按 **label 文本**认出自己那一行，给它打一个
 * 标记属性，再注入样式把 shell 的齿轮藏掉、用 mask 画我们自己的标记。
 * MutationObserver 跟着语言切换/重挂载重新认领；调用方的 disposer 负责摘干净。
 *
 * 范围刻意收窄：**只碰我们自己那一行**，不触摸任何 shell 结构。
 * 官方哪天给 `settings.section` 长出 `icon` 字段，本模块即可删除。
 */

/** 设置面板的 nav 行：shell 把每个 `settings.section` 渲染成 `<nav>` 里的一个 button。 */
export const NAV_ROW_SELECTOR = '[role="dialog"] nav button'

/** 认领标记。样式只挂在带此属性的行上，绝不波及别人。 */
export const NAV_ICON_ATTR = 'data-dsh-memory-nav-icon'

/**
 * 本区块的 label。
 *
 * 它同时是**显示文案**和**认领时的匹配键**——两者必须是同一个字符串，
 * 否则语言切换后行与标记会对不上。
 */
export const MEMORY_SECTION_LABEL = 'Memory'

/**
 * 标记的绘图元素：一个闭合的大脑半球轮廓 + 三条从脑缘引出的线 + 五个节点
 * （三条线各带一个，另有顶部、底部两个游离点）。
 *
 * 顺序有意义：`BRAIN_CIRCUIT_PATHS[0]` 是那个闭合轮廓。
 * 坐标按 16×16 网格手绘，与官方设置图标同一套规格。
 */
export const BRAIN_CIRCUIT_PATHS = [
  {
    kind: 'path',
    d: 'M7.3 3.71C7.302 3.057 6.95 2.454 6.38 2.134 5.81 1.815 5.112 1.83 4.556 2.172 3.999 2.515 3.672 3.132 3.702 3.785 2.987 3.969 2.397 4.471 2.101 5.147 1.805 5.823 1.836 6.597 2.186 7.247 1.57 7.747 1.241 8.521 1.308 9.312 1.375 10.102 1.829 10.81 2.52 11.2 2.405 12.087 2.793 12.963 3.526 13.475 4.259 13.987 5.216 14.049 6.008 13.636 6.801 13.224 7.299 12.404 7.3 11.51Z',
  },
  { kind: 'circle', cx: 9.1, cy: 2.4, r: 0.85 },
  { kind: 'path', d: 'M7.5 5.4 10.6 4.2' },
  { kind: 'circle', cx: 11.8, cy: 3.7, r: 1 },
  { kind: 'path', d: 'M7.5 7.5H10.5' },
  { kind: 'circle', cx: 11.5, cy: 7.5, r: 0.85 },
  { kind: 'path', d: 'M7.5 9.6 10.5 10.8' },
  { kind: 'circle', cx: 11.5, cy: 11.3, r: 0.85 },
  { kind: 'circle', cx: 9.1, cy: 13.2, r: 0.85 },
]

/** 与官方 `ICON_MEDIUM_STROKE` 一致，保证与相邻区块图标视觉重量相同。 */
export const ICON_MEDIUM_STROKE = 1.3

/**
 * 标记的 SVG 源码。
 *
 * 描边用纯黑是**故意的**：mask 只读 alpha，可见颜色来自承载元素的
 * `background-color: currentColor`，所以深浅主题都能跟随。
 *
 * @returns {string} 一个 16×16 的 outline SVG。
 */
export function brainCircuitSvg() {
  const shapes = BRAIN_CIRCUIT_PATHS
    .map((p) => (p.kind === 'circle'
      ? `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}"/>`
      : `<path d="${p.d}"/>`))
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="${ICON_MEDIUM_STROKE}" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`
}

/**
 * 标记的 CSS `mask-image` URL。运行时编码，不手写转义。
 *
 * @param {string} [svg] 覆盖默认标记（测试用）。
 * @returns {string} `data:image/svg+xml,...` URL。
 */
export function brainCircuitMaskUrl(svg = brainCircuitSvg()) {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/**
 * 这一行是不是我们自己那一行。
 *
 * 这是本功能**唯一的判断**，所以刻意做成纯函数、精确匹配（trim 之后）：
 * 认错行就会把别人的图标盖掉，因此不做子串匹配。空 label 谁都不匹配——
 * 语言尚未就绪时不能把整个 nav 都认领了。
 *
 * @param {string | null | undefined} rowText 该行的可见文本。
 * @param {string | null | undefined} wantedLabel 期望的区块 label。
 * @returns {boolean} 是否为我们的行。
 */
export function isOwnNavRow(rowText, wantedLabel) {
  const wanted = String(wantedLabel ?? '').trim()
  if (wanted.length === 0) return false
  return String(rowText ?? '').trim() === wanted
}

/**
 * 认领行的样式表：藏掉 shell 的齿轮，用 mask 画出我们的标记。
 *
 * @param {string} maskUrl 由 {@link brainCircuitMaskUrl} 产出的 URL。
 * @returns {string} 可直接塞进 `<style>` 的 CSS。
 */
export function navIconCss(maskUrl) {
  return [
    `[${NAV_ICON_ATTR}] > svg { display: none; }`,
    `[${NAV_ICON_ATTR}]::before {`,
    `  content: '';`,
    `  flex: none;`,
    `  width: 16px;`,
    `  height: 16px;`,
    `  background-color: currentColor;`,
    `  -webkit-mask-image: url("${maskUrl}");`,
    `  mask-image: url("${maskUrl}");`,
    `  -webkit-mask-repeat: no-repeat;`,
    `  mask-repeat: no-repeat;`,
    `  -webkit-mask-position: center;`,
    `  mask-position: center;`,
    `  -webkit-mask-size: contain;`,
    `  mask-size: contain;`,
    `}`,
  ].join('\n')
}
