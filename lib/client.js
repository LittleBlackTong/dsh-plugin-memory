/**
 * dsh-plugin-memory 客户端半（零构建）：
 * 在设置面板注册「记忆 Memory」区块 —— 总开关 + 记忆目录 + 两个子开关。
 *
 * 数据通道：settings wire 只服务硬编码白名单（memory 不在其中），
 * 因此本区块直连插件自建的 HTTP 路由（/api/memory/config）：
 * GET 读配置、POST 部分更新，Host 校验并立即热应用。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-memory',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    let react = require('react')

    const React = react
    const CONFIG_URL = '/api/memory/config'
    const INSIGHTS_URL = '/api/memory/insights'
    const GRAPH_URL = '/api/memory/graph'
    /** Poll while the panel is open, so memory edits show up without a reload. */
    const GRAPH_REFRESH_MS = 25000

    const rowStyle = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      padding: '14px 16px',
      borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2))',
    }
    const labelStyle = { fontSize: '14px', lineHeight: '22px' }
    const subStyle = { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary, #999)' }
    const errorStyle = { padding: '0 16px 8px', fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary, #e5484d)' }
    const inputStyle = {
      width: '240px',
      padding: '6px 8px',
      fontSize: '14px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))',
      background: 'var(--dsw-alias-bg-layer-1, transparent)',
      color: 'var(--dsw-alias-label-primary, inherit)',
    }

    function Toggle({ checked, disabled, onChange }) {
      return React.createElement('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked,
        disabled,
        onClick: () => onChange(!checked),
        style: {
          position: 'relative',
          width: '40px',
          height: '22px',
          borderRadius: '11px',
          border: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          background: checked ? 'var(--dsw-alias-brand-primary, #4c8bf5)' : 'var(--dsw-alias-label-secondary, #666)',
          opacity: disabled ? 0.5 : 1,
          transition: 'background 0.15s',
          flexShrink: 0,
        },
      }, React.createElement('span', {
        style: {
          position: 'absolute',
          top: '2px',
          left: checked ? '20px' : '2px',
          width: '18px',
          height: '18px',
          borderRadius: '9px',
          background: '#fff',
          transition: 'left 0.15s',
        },
      }))
    }

    function ErrorText({ message }) {
      return React.createElement('div', { style: { padding: '14px 16px', fontSize: '13px', lineHeight: '20px', color: 'var(--dsw-alias-state-error-primary, #e5484d)' } },
        '记忆设置页加载失败：', message)
    }

    /** 渲染期兜底：任何异常都以文案形式显示，绝不空白。 */
    class SectionBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: undefined }
      }
      static getDerivedStateFromError(error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
      render() {
        if (this.state.error !== undefined) return React.createElement(ErrorText, { message: this.state.error })
        return this.props.children
      }
    }

    function MemorySection() {
      // `gen` bumps after every successful config write so the read-only health
      // card re-mounts and re-reads the store (e.g. after a memoryDir switch).
      const [gen, setGen] = React.useState(0)
      return React.createElement(SectionBoundary, null,
        React.createElement(MemoryForm, { onSaved: () => setGen((value) => value + 1) }),
        React.createElement(SectionBoundary, { key: gen },
          React.createElement(InsightsCard),
        ),
        React.createElement(SectionBoundary, { key: `graph-${gen}` },
          React.createElement(GraphCard),
        ),
      )
    }

    // ---------------- 记忆健康看板 ----------------

    const cardStyle = {
      margin: '4px 16px 16px',
      padding: '14px 16px',
      border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2))',
      borderRadius: '10px',
      background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.05))',
    }
    const cardTitleStyle = { fontSize: '13px', fontWeight: '600', marginBottom: '2px' }
    const cardSubStyle = { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary, #999)', marginBottom: '12px' }
    const metricRowStyle = { display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }
    const metricBoxStyle = {
      flex: '1 1 72px',
      minWidth: '72px',
      padding: '8px 10px',
      borderRadius: '8px',
      background: 'var(--dsw-alias-bg-layer-1, transparent)',
      border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.15))',
    }
    const metricValueStyle = { fontSize: '18px', lineHeight: '24px', fontWeight: '600' }
    const metricLabelStyle = { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-secondary, #999)' }
    const sectionLabelStyle = { fontSize: '12px', fontWeight: '600', margin: '12px 0 6px', color: 'var(--dsw-alias-label-secondary, #999)' }

    const scoreColor = (score) =>
      score >= 85 ? 'var(--dsw-alias-state-success-primary, #30a46c)'
        : score >= 60 ? 'var(--dsw-alias-state-warning-primary, #f5a623)'
          : 'var(--dsw-alias-state-error-primary, #e5484d)'
    const checkColor = (ok) =>
      ok ? 'var(--dsw-alias-state-success-primary, #30a46c)' : 'var(--dsw-alias-state-warning-primary, #f5a623)'
    const barColor = (key) =>
      key === 'stale' ? 'var(--dsw-alias-state-error-primary, #e5484d)'
        : key === 'quarter' ? 'var(--dsw-alias-state-warning-primary, #f5a623)'
          : 'var(--dsw-alias-brand-primary, #4c8bf5)'

    /** 一行标签 + 细横条 + 计数。 */
    function Bar({ label, count, total, color }) {
      const ratio = total > 0 ? Math.max(0, Math.min(1, count / total)) : 0
      return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' } },
        React.createElement('div', { style: { width: '68px', flexShrink: 0, fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #999)' } }, label),
        React.createElement('div', { style: { flex: 1, height: '6px', borderRadius: '3px', background: 'var(--dsw-alias-border-l1, rgba(128,128,128,0.18))', overflow: 'hidden' } },
          React.createElement('div', { style: { width: `${Math.round(ratio * 100)}%`, height: '100%', borderRadius: '3px', background: color } }),
        ),
        React.createElement('div', { style: { width: '22px', flexShrink: 0, textAlign: 'right', fontSize: '12px', fontVariantNumeric: 'tabular-nums' } }, String(count)),
      )
    }

    /** 记忆健康看板：只读，数据来自 /api/memory/insights，打开面板时拉取一次。 */
    function InsightsCard() {
      const [data, setData] = React.useState(undefined)
      const [status, setStatus] = React.useState('loading')

      React.useEffect(() => {
        let alive = true
        fetch(INSIGHTS_URL)
          .then(async (response) => {
            if (!response.ok) throw new Error(`GET ${response.status}`)
            return response.json()
          })
          .then((value) => {
            if (!alive) return
            setData(value)
            setStatus('ready')
          })
          .catch(() => {
            if (alive) setStatus('failed')
          })
        return () => {
          alive = false
        }
      }, [])

      if (status === 'loading') {
        return React.createElement('div', { style: { ...cardStyle, fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #888)' } }, '正在统计记忆库…')
      }
      // 看板是附加信息：拿不到就静默隐藏，绝不影响设置页可用。
      if (status === 'failed' || data === undefined) return null

      const overview = data.overview ?? {}
      const pages = overview.pages ?? 0
      const health = data.health ?? { score: 0, checks: [] }
      const buckets = (data.freshness && data.freshness.buckets) || []
      const stale = data.stalePages ?? []
      const recent = data.recent ?? []
      const formatDays = (days) => (days === null || days === undefined ? '从未戳记' : `${days} 天未访问`)

      return React.createElement('div', { style: cardStyle },
        React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' } },
          React.createElement('div', { style: cardTitleStyle }, '记忆健康'),
          React.createElement('div', { style: { fontSize: '20px', lineHeight: '26px', fontWeight: '700', color: scoreColor(health.score) } },
            `${health.score}`,
            React.createElement('span', { style: { fontSize: '11px', fontWeight: '400', color: 'var(--dsw-alias-label-secondary, #999)' } }, ' / 100'),
          ),
        ),
        React.createElement('div', { style: cardSubStyle }, '只读统计：页数、访问新鲜度、体检结论与最近动态。'),

        React.createElement('div', { style: metricRowStyle },
          React.createElement('div', { style: metricBoxStyle },
            React.createElement('div', { style: metricValueStyle }, String(pages)),
            React.createElement('div', { style: metricLabelStyle }, '记忆页'),
          ),
          React.createElement('div', { style: metricBoxStyle },
            React.createElement('div', { style: metricValueStyle }, String(overview.indexEntries ?? 0)),
            React.createElement('div', { style: metricLabelStyle }, 'index 路由'),
          ),
          React.createElement('div', { style: metricBoxStyle },
            React.createElement('div', { style: metricValueStyle }, `~${overview.chars ?? 0}`),
            React.createElement('div', { style: metricLabelStyle }, '记忆字数'),
          ),
        ),

        React.createElement('div', { style: sectionLabelStyle }, '访问新鲜度'),
        ...buckets.map((bucket) =>
          React.createElement(Bar, {
            key: bucket.key,
            label: bucket.label,
            count: bucket.count,
            total: pages,
            color: barColor(bucket.key),
          })),
        (data.freshness && data.freshness.never > 0)
          ? React.createElement(Bar, { label: '从未', count: data.freshness.never, total: pages, color: 'var(--dsw-alias-label-secondary, #888)' })
          : null,

        React.createElement('div', { style: sectionLabelStyle }, '体检'),
        ...health.checks.map((check) =>
          React.createElement('div', { key: check.id, style: { display: 'flex', gap: '8px', alignItems: 'baseline', marginBottom: '4px' } },
            React.createElement('span', { style: { color: checkColor(check.ok), fontSize: '12px', width: '14px', flexShrink: 0 } }, check.ok ? '✓' : '!'),
            React.createElement('span', { style: { fontSize: '12px', lineHeight: '18px' } },
              check.label,
              React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary, #999)' } }, ` · ${check.detail}`),
            ),
          )),

        stale.length > 0
          ? React.createElement('div', null,
            React.createElement('div', { style: sectionLabelStyle }, `陈旧候选（前 ${stale.length}）`),
            ...stale.map((page) =>
              React.createElement('div', { key: page.path, style: { fontSize: '12px', lineHeight: '18px', display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '3px' } },
                React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, page.title || page.path),
                React.createElement('span', { style: { color: 'var(--dsw-alias-state-warning-primary, #f5a623)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' } }, formatDays(page.daysSinceAccess)),
              )),
          )
          : null,

        recent.length > 0
          ? React.createElement('div', null,
            React.createElement('div', { style: sectionLabelStyle }, '最近动态'),
            ...recent.map((line, index) =>
              React.createElement('div', {
                key: `${index}-${line}`,
                style: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary, #999)', marginBottom: '3px' },
              }, `· ${line}`)),
          )
          : null,
      )
    }

    /** 目录输入：草稿态编辑，blur / Enter 才写回，避免每次按键触发 Host 重排。 */
    function DirInput({ value, disabled, onCommit }) {
      const [draft, setDraft] = React.useState(undefined)
      const shown = draft !== undefined ? draft : (value ?? '')
      const commit = () => {
        if (draft === undefined) return
        const trimmed = draft.trim()
        if (trimmed.length > 0 && trimmed !== value) onCommit(trimmed)
        setDraft(undefined)
      }
      return React.createElement('input', {
        type: 'text',
        placeholder: '~/.memory',
        disabled,
        value: shown,
        onChange: (event) => setDraft(event.target.value),
        onBlur: commit,
        onKeyDown: (event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') setDraft(undefined)
        },
        style: inputStyle,
      })
    }

    /** 数字输入：草稿态编辑，blur / Enter 才写回（分钟/次数）。 */
    function NumberInput({ value, disabled, onCommit, placeholder }) {
      const [draft, setDraft] = React.useState(undefined)
      const shown = draft !== undefined ? draft : (value ?? '')
      const commit = () => {
        if (draft === undefined) return
        const parsed = Number(draft)
        if (Number.isFinite(parsed) && parsed !== value) onCommit(parsed)
        setDraft(undefined)
      }
      return React.createElement('input', {
        type: 'number',
        placeholder,
        disabled,
        value: shown,
        onChange: (event) => setDraft(event.target.value),
        onBlur: commit,
        onKeyDown: (event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') setDraft(undefined)
        },
        style: { ...inputStyle, width: '120px' },
      })
    }

    function MemoryForm({ onSaved }) {
      const [config, setConfig] = React.useState(undefined)
      const [status, setStatus] = React.useState('loading')
      const [error, setError] = React.useState(undefined)
      const [saving, setSaving] = React.useState(false)

      React.useEffect(() => {
        let alive = true
        fetch(CONFIG_URL)
          .then(async (response) => {
            if (!response.ok) throw new Error(`GET ${response.status}`)
            return response.json()
          })
          .then((value) => {
            if (!alive) return
            setConfig(value)
            setStatus('ready')
          })
          .catch((err) => {
            if (!alive) return
            setStatus('failed')
            setError(err instanceof Error ? err.message : String(err))
          })
        return () => {
          alive = false
        }
      }, [])

      const apply = (patch) => {
        setSaving(true)
        setError(undefined)
        fetch(CONFIG_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
          .then(async (response) => {
            const body = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(body.error ?? `POST ${response.status}`)
            setConfig(body)
            onSaved?.()
          })
          .catch((err) => {
            setError(err instanceof Error ? err.message : String(err))
          })
          .finally(() => setSaving(false))
      }

      if (status === 'loading') {
        return React.createElement('div', { style: { padding: '14px 16px', fontSize: '13px', color: 'var(--dsw-alias-label-secondary, #888)' } }, '读取配置中…')
      }
      if (status === 'failed') return React.createElement(ErrorText, { message: error ?? 'unknown' })

      const value = config ?? {}
      const disabled = saving

      return React.createElement('div', { style: { padding: '8px 0' } },
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, '启用记忆插件'),
            React.createElement('div', { style: subStyle }, '总开关：关闭后不再注入记忆，也不注册 memory 技能'),
          ),
          React.createElement(Toggle, {
            checked: value.enabled !== false,
            disabled,
            onChange: (next) => apply({ enabled: next }),
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, '记忆目录'),
            React.createElement('div', { style: subStyle }, '存放 SOUL/MEMORY/index/log 的路径，支持 ~ 开头；修改后立即切换，目录不存在时自动初始化'),
          ),
          React.createElement(DirInput, {
            value: value.memoryDir,
            disabled,
            onCommit: (next) => apply({ memoryDir: next }),
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, '开机注入记忆'),
            React.createElement('div', { style: subStyle }, '每次会话开始把记忆快照注入上下文'),
          ),
          React.createElement(Toggle, {
            checked: value.autoInject !== false,
            disabled,
            onChange: (next) => apply({ autoInject: next }),
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, '提问后才注入'),
            React.createElement('div', { style: subStyle }, '开启后，新会话在你发出第一条消息前不会注入任何记忆 / 追忆 / digest 提醒'),
          ),
          React.createElement(Toggle, {
            checked: value.deferUntilUserSpeaks !== false,
            disabled,
            onChange: (next) => apply({ deferUntilUserSpeaks: next }),
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, '仅当前激活会话注入'),
            React.createElement('div', { style: subStyle }, '开启后，只有最近收到你消息的会话才会注入记忆（后台会话不打扰）'),
          ),
          React.createElement(Toggle, {
            checked: value.activeSessionOnly !== false,
            disabled,
            onChange: (next) => apply({ activeSessionOnly: next }),
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, '注册 memory 技能'),
            React.createElement('div', { style: subStyle }, '让 agent 获得 remember / recall / consolidate / forget 操作协议'),
          ),
          React.createElement(Toggle, {
            checked: value.registerSkill !== false,
            disabled,
            onChange: (next) => apply({ registerSkill: next }),
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, '主动追忆'),
            React.createElement('div', { style: subStyle }, '对话空闲时，以第一人称主动提起一件关于你的往事（拟人化），可随时关闭'),
          ),
          React.createElement(Toggle, {
            checked: value.recallEnabled !== false,
            disabled,
            onChange: (next) => apply({ recallEnabled: next }),
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, '追忆间隔（分钟）'),
            React.createElement('div', { style: subStyle }, '每次随机在最短 ~ 最长之间取一个间隔，避免固定节奏'),
          ),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            React.createElement(NumberInput, {
              value: value.recallIntervalMinMinutes,
              disabled,
              placeholder: '30',
              onCommit: (next) => apply({ recallIntervalMinMinutes: next }),
            }),
            React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary, #999)' } }, '~'),
            React.createElement(NumberInput, {
              value: value.recallIntervalMaxMinutes,
              disabled,
              placeholder: '240',
              onCommit: (next) => apply({ recallIntervalMaxMinutes: next }),
            }),
          ),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, '每会话追忆次数'),
            React.createElement('div', { style: subStyle }, '一个会话内最多主动追忆几次，避免打扰'),
          ),
          React.createElement(NumberInput, {
            value: value.recallMaxPerSession,
            disabled,
            placeholder: '3',
            onCommit: (next) => apply({ recallMaxPerSession: next }),
          }),
        ),
        error !== undefined ? React.createElement('div', { style: errorStyle }, '保存失败：', error) : null,
        React.createElement('div', { style: { padding: '14px 16px', fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary, #888)' } },
          `当前：${value.enabled === false ? '已停用' : `记忆库位于 ${value.memoryDir ?? '（未配置）'}`}。修改即时生效。`,
        ),
      )
    }

    // ---------------- 记忆图谱 ----------------
    //
    // index.md 渲染出的图是星形：它只说明"索引列了所有页"，不说明"哪些记忆
    // 属于一起"。这里改成画索引画不出来的关系：页间显式链接 + 共享 tag。

    const GRAPH_W = 560
    const GRAPH_H = 340

    // Inlined from lib/graph-drag.js: the client bundle can only require platform
    // seeds, so the drag maths lives here in a 12-line form. The canonical
    // implementation (with its tests) is the module; this mirrors it.
    const clampToBox = (value, min, max) => (Number.isNaN(value) ? min : Math.min(Math.max(value, min), max))
    function applyDrag(base, draggedId, target, edges, options) {
      const width = (options && options.width) || GRAPH_W
      const height = (options && options.height) || GRAPH_H
      const out = new Map(base)
      const start = base.get(draggedId)
      if (start === undefined) return out
      const x = clampToBox(target?.x, 0, width)
      const y = clampToBox(target?.y, 0, height)
      out.set(draggedId, { x, y })
      const dx = x - start.x
      const dy = y - start.y
      const distance = Math.max(1, Math.hypot(dx, dy))
      const ux = dx / distance
      const uy = dy / distance
      const pull = Math.max(0.3, Math.min(1, 1 / (1 + distance / 80)))
      const lean = (pull * 6 * 12) / (12 + distance)
      const neighbours = new Set()
      for (const edge of edges ?? []) {
        if (edge?.source === draggedId) neighbours.add(edge.target)
        else if (edge?.target === draggedId) neighbours.add(edge.source)
      }
      for (const id of neighbours) {
        const base0 = base.get(id)
        if (base0 === undefined) continue
        out.set(id, {
          x: clampToBox(base0.x + ux * lean, 0, width),
          y: clampToBox(base0.y + uy * lean, 0, height),
        })
      }
      return out
    }
    const releasePositions = (base) => new Map(base)

    // Inlined from lib/graph-view.js for the same reason: the client bundle can
    // only require platform seeds. A test asserts both copies agree.
    const DEFAULT_VIEW = { x: 0, y: 0, w: GRAPH_W, h: GRAPH_H }
    const MIN_VIEW_SCALE = 0.4
    const MAX_VIEW_SCALE = 2.5
    const isZoomedView = (v) => v.w < GRAPH_W - 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1
    function zoomAt(view, fx, fy, factor) {
      const nextW = Math.min(GRAPH_W * MAX_VIEW_SCALE, Math.max(GRAPH_W * MIN_VIEW_SCALE, view.w * factor))
      const k = nextW / view.w
      return {
        x: fx - (fx - view.x) * k,
        y: fy - (fy - view.y) * k,
        w: nextW,
        h: GRAPH_H * (nextW / GRAPH_W),
      }
    }
    const resetViewState = () => ({ x: 0, y: 0, w: GRAPH_W, h: GRAPH_H })
    function panBy(start, dxPx, dyPx, scale) {
      return {
        x: start.x - dxPx * scale.scaleX,
        y: start.y - dyPx * scale.scaleY,
        w: start.w,
        h: start.h,
      }
    }
    function toGraphPointIn(view, rect, clientX, clientY) {
      if (rect === undefined || rect.width === 0 || rect.height === 0) return { x: clientX, y: clientY }
      return {
        x: view.x + ((clientX - rect.left) / rect.width) * view.w,
        y: view.y + ((clientY - rect.top) / rect.height) * view.h,
      }
    }

    /** 图谱的过渡/入场样式：拖动时不要过渡，松手后要滑回去。 */
    function ensureGraphStyles() {
      if (typeof document === 'undefined' || document.getElementById('dsh-memory-graph-style') !== null) return
      const style = document.createElement('style')
      style.id = 'dsh-memory-graph-style'
      style.textContent = [
        '#dsh-memory-graph-style + * {}',
        '.dsh-memory-graph-svg g { transition: transform .18s cubic-bezier(.2,.8,.2,1); }',
        '.dsh-memory-graph-svg.anim-off g { transition: none; }',
        '.dsh-memory-graph-svg.dragging g { transition: none; }',
        '.dsh-memory-graph-svg.entering g { transform: scale(.08); opacity: 0; }',
        '.dsh-memory-graph-svg.graph-drop g { transition: transform .32s cubic-bezier(.2,.9,.2,1.05); }',
        '.dsh-memory-graph-svg circle, .dsh-memory-graph-svg text { transition: opacity .12s; }',
        '.dsh-memory-graph-svg.hovering g:not(.lit) circle,' +
          '.dsh-memory-graph-svg.hovering g:not(.lit) text { opacity: .18; }',
      ].join('\n')
      document.head.appendChild(style)
    }

    /**
     * 图谱视图：拿到 nodes/edges 就画（纯渲染，无副作用）。拖动与悬停是它
     * 自己维护的临时状态；`memo` 隔断父级重渲染带来的 hooks 调用。
     */
    const GraphView = React.memo(function GraphView({ graph, fetchedAt }) {
      const [hover, setHover] = React.useState(undefined)
      const [dragPositions, setDragPositions] = React.useState(undefined)
      const [dragging, setDragging] = React.useState(false)
      const [dropAnim, setDropAnim] = React.useState(false)
      const svgRef = React.useRef(null)
      const dragRef = React.useRef(undefined)
      const [view, setView] = React.useState({ x: 0, y: 0, w: GRAPH_W, h: GRAPH_H })
      const [zoomed, setZoomed] = React.useState(false)
      const panRef = React.useRef(undefined)
      const viewRef = React.useRef({ x: 0, y: 0, w: GRAPH_W, h: GRAPH_H })
      const firstPaint = React.useRef(true)
      React.useEffect(() => { viewRef.current = view }, [view])
      const basePositions = React.useMemo(() => {
        const map = new Map()
        for (const node of graph.nodes ?? []) map.set(node.id, { x: node.x, y: node.y })
        return map
      }, [graph])

      // Bloom in from the centre, once, unless reduced motion is asked. Graph
      // refreshes must not replay it (memory edits can arrive every few seconds).
      React.useEffect(() => {
        const el = svgRef.current
        if (el === null) return undefined
        if (!firstPaint.current) return undefined
        firstPaint.current = false
        const reduced = typeof window !== 'undefined'
          && typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches
        if (reduced) {
          el.classList.remove('anim-off')
          return undefined
        }
        el.classList.add('anim-off')
        el.classList.add('entering')
        const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16)
        raf(() => {
          el.classList.remove('anim-off')
          el.classList.remove('entering')
        })
        return () => { el.classList.remove('anim-off', 'entering') }
      }, [graph])

      const nodes = graph.nodes ?? []
      const edges = graph.edges ?? []
      const stats = graph.stats ?? {}
      if (nodes.length === 0) return null

      const byId = new Map(nodes.map((node) => [node.id, node]))
      const neighbours = new Map()
      for (const e of edges) {
        if (!neighbours.has(e.source)) neighbours.set(e.source, new Set())
        if (!neighbours.has(e.target)) neighbours.set(e.target, new Set())
        neighbours.get(e.source).add(e.target)
        neighbours.get(e.target).add(e.source)
      }
      const lit = (id) => hover === undefined || hover === id || (neighbours.get(hover)?.has(id) ?? false)
      const litEdge = (e) => hover === undefined || e.source === hover || e.target === hover
      const posOf = (node) => dragPositions?.get(node.id) ?? node

      /** Pointer position in graph coordinates, honouring the current zoom. */
      const toGraphPoint = (event) => {
        const el = svgRef.current
        const rect = el?.getBoundingClientRect?.()
        if (rect === undefined || rect.width === 0 || rect.height === 0) {
          return { x: event.clientX, y: event.clientY }
        }
        return toGraphPointIn(viewRef.current, rect, event.clientX, event.clientY)
      }

      /** Zoom about a graph point so it stays under the cursor. */
      const applyView = (next) => {
        viewRef.current = next
        setView(next)
        setZoomed(isZoomedView(next))
      }
      const zoomBy = (fx, fy, factor) => applyView(zoomAt(viewRef.current, fx, fy, factor))
      const resetView = () => applyView(resetViewState())

      // Wheel zoom is registered by hand instead of via onWheel so it can be
      // non-passive: otherwise preventDefault is ignored and the settings page
      // scrolls while the user is trying to zoom.
      React.useEffect(() => {
        const el = svgRef.current
        if (el === null || typeof el.addEventListener !== 'function') return undefined
        const onWheel = (event) => {
          event.preventDefault()
          const p = toGraphPointIn(viewRef.current, el.getBoundingClientRect(), event.clientX, event.clientY)
          zoomBy(p.x, p.y, event.deltaY < 0 ? 1 / 1.15 : 1.15)
        }
        el.addEventListener('wheel', onWheel, { passive: false })
        return () => el.removeEventListener('wheel', onWheel)
      }, [])

      /** Drag empty canvas to pan. */
      const panStart = (event) => {
        if (dragRef.current !== undefined) return
        if (event.button !== undefined && event.button !== 0) return
        const v = viewRef.current
        const rect = event.currentTarget?.getBoundingClientRect?.()
        if (rect === undefined) return
        event.preventDefault?.()
        panRef.current = {
          clientX: event.clientX,
          clientY: event.clientY,
          view: v,
          scaleX: v.w / rect.width,
          scaleY: v.h / rect.height,
        }
      }
      const panMove = (event) => {
        const pan = panRef.current
        if (pan === undefined) return
        event.preventDefault?.()
        applyView(panBy(pan.view, event.clientX - pan.clientX, event.clientY - pan.clientY,
          { scaleX: pan.scaleX, scaleY: pan.scaleY }))
      }
      const panEnd = () => { panRef.current = undefined }

      const endDrag = () => {
        if (dragRef.current === undefined) return
        dragRef.current = undefined
        setDragging(false)
        setDragPositions(undefined) // CSS transition glides everything back
        setDropAnim(false)
      }

      const handlePointerDown = (event, node) => {
        if (event.button !== undefined && event.button !== 0) return
        event.preventDefault?.()
        dragRef.current = { id: node.id, pointerId: event.pointerId }
        try {
          event.currentTarget?.setPointerCapture?.(event.pointerId)
        } catch {
          // Capture is an optimisation; without it the element's own
          // pointermove events still drive the drag.
        }
        setDragging(true)
        setDragPositions(applyDrag(basePositions, node.id, toGraphPoint(event), edges,
          { width: GRAPH_W, height: GRAPH_H }))
      }

      const handlePointerMove = (event) => {
        const drag = dragRef.current
        if (drag === undefined) return
        event.preventDefault?.()
        setDragPositions(applyDrag(basePositions, drag.id, toGraphPoint(event), edges,
          { width: GRAPH_W, height: GRAPH_H }))
      }

      const handlePointerUp = (event) => {
        const drag = dragRef.current
        if (drag === undefined) return
        try {
          event.currentTarget?.releasePointerCapture?.(drag.pointerId)
        } catch {
          // Already released, or never captured.
        }
        setDropAnim(true)
        setTimeout(endDrag, 60)
      }

      /** One node = one <g>, so a drag transform moves dot and label together. */
      const renderNode = (node) => {
        const p = posOf(node)
        const dx = p.x - node.x
        const dy = p.y - node.y
        const tip = `${node.label}\n${node.type}`
          + `${node.salience ? ` · salience:${node.salience}` : ''}`
          + `${node.tags && node.tags.length > 0 ? `\n#${node.tags.join(' #')}` : ''}`
          + `\n${node.degree ?? 0} 条关系`
        const showLabel = node.hub || (node.degree ?? 0) >= 2
        const label = String(node.label).length > 16 ? `${String(node.label).slice(0, 15)}…` : String(node.label)
        return React.createElement('g', {
          key: node.id,
          transform: `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`,
          className: lit(node.id) ? 'lit' : undefined,
          style: { cursor: 'grab' },
          onPointerDown: (event) => { event.stopPropagation?.(); handlePointerDown(event, node) },
          onPointerMove: handlePointerMove,
          onPointerUp: handlePointerUp,
          onPointerCancel: handlePointerUp,
          onMouseEnter: () => setHover(node.id),
          onMouseLeave: () => setHover(undefined),
        },
          React.createElement('circle', {
            cx: node.x, cy: node.y, r: node.r,
            fill: node.color,
            fillOpacity: lit(node.id) ? 0.95 : 0.2,
            stroke: 'var(--dsw-alias-bg-layer-2, #22252a)',
            strokeWidth: node.hub ? 2 : 1,
          }, React.createElement('title', null, tip)),
          showLabel
            ? React.createElement('text', {
              x: node.x + node.r + 4,
              y: node.y + 3.5,
              fontSize: node.hub ? 11 : 10,
              fontWeight: node.hub ? 600 : 400,
              fill: 'var(--dsw-alias-label-secondary, #999)',
              fillOpacity: lit(node.id) ? 1 : 0.25,
              style: { userSelect: 'none' },
            }, label)
            : null,
        )
      }

      const svgClass = ['dsh-memory-graph-svg', dragging ? 'dragging' : '', dropAnim ? 'graph-drop' : '']
        .filter(Boolean).join(' ')
      const svg = React.createElement('svg', {
        ref: svgRef,
        viewBox: `${view.x} ${view.y} ${view.w} ${view.h}`,
        width: '100%',
        className: svgClass,
        style: {
          display: 'block',
          borderRadius: '8px',
          background: 'var(--dsw-alias-bg-layer-1, transparent)',
          touchAction: 'none',
          cursor: zoomed ? 'grab' : 'default',
        },
        role: 'img',
        'aria-label': '记忆图谱',
        onPointerDown: panStart,
        onPointerMove: panMove,
        onPointerUp: panEnd,
        onPointerLeave: panEnd,
      },
        edges.map((e, index) => {
          const a = byId.get(e.source)
          const b = byId.get(e.target)
          if (a === undefined || b === undefined) return null
          const pa = posOf(a)
          const pb = posOf(b)
          return React.createElement('line', {
            key: `e${index}`,
            x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y,
            stroke: e.kind === 'link'
              ? 'var(--dsw-alias-brand-primary, #4c8bf5)'
              : e.kind === 'index'
                ? 'var(--dsw-alias-label-secondary, #8b8f96)'
                : 'var(--dsw-alias-border-l2, rgba(128,128,128,0.45))',
            strokeWidth: e.kind === 'link' ? 1.4 : 0.7,
            strokeDasharray: e.kind === 'index' ? '2 3' : undefined,
            strokeOpacity: litEdge(e) ? (e.kind === 'index' ? 0.5 : 0.9) : (e.kind === 'index' ? 0.08 : 0.12),
          })
        }),
        nodes.map(renderNode),
      )

      const colourOf = (type) => (nodes.find((n) => n.type === type)?.color) ?? '#8b8f96'
      const chips = [...new Set(nodes.map((n) => n.type))]
        .filter((type) => type !== 'unknown')
        .map((type) => React.createElement('span', {
          key: type,
          style: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #999)', marginRight: '10px' },
        },
          React.createElement('span', { style: { width: '7px', height: '7px', borderRadius: '4px', background: colourOf(type), display: 'inline-block' } }),
          type,
        ))

      const isolated = stats.isolated ?? []
      return React.createElement('div', { style: cardStyle },
        React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' } },
          React.createElement('div', { style: cardTitleStyle }, '记忆图谱'),
          zoomed
            ? React.createElement('button', {
              type: 'button',
              onClick: resetView,
              style: {
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '6px',
                cursor: 'pointer',
                border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))',
                background: 'transparent',
                color: 'var(--dsw-alias-label-secondary, #999)',
              },
            }, '重置视图')
            : null,
        ),
        React.createElement('div', { style: cardSubStyle },
          `${stats.pages ?? nodes.length} 页 · ${stats.links ?? 0} 条页间互链 · ${stats.tagEdges ?? 0} 条共享 tag`
          + `${stats.indexLinks ? ` · ${stats.indexLinks} 条索引路由（虚线）` : ''}`
          + `${isolated.length > 0 ? ` · ${isolated.length} 页暂时孤立` : ''}`
          + `${fetchedAt instanceof Date ? ` · 更新于 ${fetchedAt.toLocaleTimeString()}` : ''}`,
        ),
        svg,
        React.createElement('div', { style: { marginTop: '8px' } }, ...chips),
        ((stats.links ?? 0) === 0 || isolated.length > 0)
          ? React.createElement('div', { style: { fontSize: '11px', lineHeight: '17px', color: 'var(--dsw-alias-label-secondary, #888)', marginTop: '6px' } },
            (stats.links ?? 0) === 0
              ? '页面之间还没有互相引用——图谱目前只靠共享 tag 连接。写下"见 [某页](path)"会让关系变实。'
              : `这 ${isolated.length} 页还没和别的记忆连上：${isolated.slice(0, 3).map((id) => id.replace(/\.md$/, '')).join('、')}${isolated.length > 3 ? ' 等' : ''}`,
          )
          : null,
        React.createElement('div', { style: { fontSize: '11px', lineHeight: '17px', color: 'var(--dsw-alias-label-secondary, #888)', marginTop: '6px' } },
          React.createElement('span', { style: { color: 'var(--dsw-alias-brand-primary, #4c8bf5)' } }, '━ 页间互链'),
          ' · ',
          React.createElement('span', { style: { color: '#8b8f96' } }, '┄ 索引路由'),
          ' · ',
          '细线＝共享 tag。滚轮缩放 · 拖空白处平移 · 拖节点整理视图 · 悬停高亮关系；只读、实时。',
        ),
      )
    })

    /** 记忆图谱卡片：负责取数（含轮询）与生命周期，渲染交给 GraphView。 */
    function GraphCard() {
      const [graph, setGraph] = React.useState(undefined)
      const [status, setStatus] = React.useState('loading')
      const [fetchedAt, setFetchedAt] = React.useState(undefined)
      ensureGraphStyles()

      // First load, then keep polling while the panel is open: the graph is a
      // live projection of the store, so a memory written mid-session should
      // appear without closing the panel. Refresh failures are silent — the
      // previous graph stays on screen rather than blanking out.
      React.useEffect(() => {
        let alive = true
        const tick = () => {
          fetch(GRAPH_URL)
            .then(async (response) => {
              if (!response.ok) throw new Error(`GET ${response.status}`)
              return response.json()
            })
            .then((value) => {
              if (!alive) return
              setGraph(value)
              setFetchedAt(new Date())
              setStatus('ready')
            })
            .catch(() => {
              if (alive && status !== 'ready') setStatus('failed')
            })
        }
        tick()
        const timer = setInterval(tick, GRAPH_REFRESH_MS)
        return () => { alive = false; clearInterval(timer) }
      }, [])

      if (status === 'loading') {
        return React.createElement('div', { style: { ...cardStyle, fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #888)' } }, '正在构建记忆图谱…')
      }
      if (status === 'failed' || graph === undefined) return null
      return React.createElement(GraphView, { graph, fetchedAt })
    }

    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'memory',
        order: 100,
        label: () => '记忆 Memory',
      }, MemorySection))
    }

    exports.apply = apply
    exports.inject = ['slots']
    // Test seam: the browser half cannot be imported by Node, so the pure
    // helpers and the component itself are exposed for a vm-based harness.
    // Underscore-prefixed and additive: the host only reads `apply`/`inject`.
    exports.__test = {
      GraphCard,
      GraphView,
      applyDrag,
      releasePositions,
      clampToBox,
      GRAPH_REFRESH_MS,
      zoomAt,
      panBy,
      toGraphPointIn,
      isZoomedView,
      resetViewState,
      MIN_VIEW_SCALE,
      MAX_VIEW_SCALE,
      GRAPH_W,
      GRAPH_H,
    }
    return module.exports
  },
})
