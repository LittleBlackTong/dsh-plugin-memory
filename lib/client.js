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
    return module.exports
  },
})
