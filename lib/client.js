/**
 * dsh-plugin-memory 客户端半（零构建）：
 * 在设置面板注册「记忆 Memory」区块 —— 总开关 + 记忆目录 + 两个子开关，
 * 热写 settings。
 *
 * 机制：settings.section 槽（壳提供导航）→ settingsScope 服务绑定
 * `memory` namespace（在 apply 里绑一次，disposer 归插件 fiber）
 * → useSyncExternalStore 渲染快照 → controller.set() 写回 Host
 * （Host 校验 schema，失败自动重读恢复）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-memory',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    let react = require('react')

    const React = react

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

    function makeSection(controller) {
      return function MemorySection() {
        return React.createElement(SectionBoundary, null, React.createElement(MemoryForm, { controller }))
      }
    }

    /** 目录输入：草稿态编辑，blur / Enter 才写回，避免每次按键触发 Host 重排。 */
    function DirInput({ value, loading, disabled, onCommit }) {
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
        disabled: loading || disabled,
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

    function MemoryForm({ controller }) {
      // 类方法作为回调传参时 this 会丢失，必须显式绑定且保持引用稳定
      const subscribe = React.useMemo(() => (listener) => controller.subscribe(listener), [controller])
      const getSnapshot = React.useMemo(() => () => controller.getSnapshot(), [controller])
      const snapshot = React.useSyncExternalStore(subscribe, getSnapshot)
      const value = snapshot.value
      const loading = snapshot.status === 'loading'
      const disabled = !snapshot.writable

      return React.createElement('div', { style: { padding: '8px 0' } },
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, '启用记忆插件'),
            React.createElement('div', { style: subStyle }, '总开关：关闭后不再注入记忆，也不注册 memory 技能'),
          ),
          React.createElement(Toggle, {
            checked: loading ? false : value?.enabled !== false,
            disabled: loading || disabled,
            onChange: (next) => controller.set('enabled', next),
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, '记忆目录'),
            React.createElement('div', { style: subStyle }, '存放 SOUL/MEMORY/index/log 的路径，支持 ~ 开头；修改后立即切换，目录不存在时自动初始化'),
          ),
          React.createElement(DirInput, {
            value: value?.memoryDir,
            loading,
            disabled,
            onCommit: (next) => controller.set('memoryDir', next),
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, '开机注入记忆'),
            React.createElement('div', { style: subStyle }, '每次会话开始把记忆快照注入上下文'),
          ),
          React.createElement(Toggle, {
            checked: loading ? false : value?.autoInject !== false,
            disabled: loading || disabled,
            onChange: (next) => controller.set('autoInject', next),
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, '注册 memory 技能'),
            React.createElement('div', { style: subStyle }, '让 agent 获得 remember / recall / consolidate / forget 操作协议'),
          ),
          React.createElement(Toggle, {
            checked: loading ? false : value?.registerSkill !== false,
            disabled: loading || disabled,
            onChange: (next) => controller.set('registerSkill', next),
          }),
        ),
        React.createElement('div', { style: { padding: '14px 16px', fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary, #888)' } },
          loading
            ? '读取配置中…'
            : `当前：${value?.enabled === false ? '已停用' : `记忆库位于 ${value?.memoryDir ?? '（未配置）'}`}。修改即时生效。`,
        ),
      )
    }

    function apply(ctx) {
      const slots = ctx.slots
      const settingsScope = ctx.get('settingsScope')
      let controller
      let bindError
      try {
        if (settingsScope === undefined) throw new Error('settingsScope 服务不可用')
        controller = settingsScope.bind({ namespace: 'memory' })
      } catch (error) {
        bindError = error instanceof Error ? error.message : String(error)
      }
      slots.inject('settings.section', () => slots.register({
        name: 'settings.section',
        id: 'memory',
        order: 100,
        label: () => '记忆 Memory',
      }, bindError !== undefined ? () => React.createElement(ErrorText, { message: bindError }) : makeSection(controller)))
    }

    exports.apply = apply
    exports.inject = ['slots', 'connection', 'remote']
    return module.exports
  },
})
