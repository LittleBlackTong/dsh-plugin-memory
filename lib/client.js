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
      return React.createElement(SectionBoundary, null, React.createElement(MemoryForm))
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

    function MemoryForm() {
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
            React.createElement('div', { style: labelStyle }, '注册 memory 技能'),
            React.createElement('div', { style: subStyle }, '让 agent 获得 remember / recall / consolidate / forget 操作协议'),
          ),
          React.createElement(Toggle, {
            checked: value.registerSkill !== false,
            disabled,
            onChange: (next) => apply({ registerSkill: next }),
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
