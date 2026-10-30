/**
 * dsh-plugin-memory 客户端半（零构建）：
 * 在设置面板注册「记忆 / Memory」区块 —— 总开关 + 记忆目录 + 两个子开关。
 *
 * 数据通道：settings wire 只服务硬编码白名单（memory 不在其中），
 * 因此本区块直连插件自建的 HTTP 路由（/api/memory/config）：
 * GET 读配置、POST 部分更新，Host 校验并立即热应用。
 *
 * 文案走 DSH 官方语言层（ctx.locale + `memory` 命名空间，跟随设置 → 通用设置 →
 * 语言）：面板与侧栏 label 都随语言切换，不读 navigator.language，零依赖、零构建。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-memory',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    let react = require('react')

    const React = react
    const CONFIG_URL = '/api/memory/config'
    const CONTROL_URL = '/api/memory/control'
    const INSIGHTS_URL = '/api/memory/insights'
    const GRAPH_URL = '/api/memory/graph'
    /** Poll while the panel is open, so memory edits show up without a reload. */
    const GRAPH_REFRESH_MS = 25000

    /** Dictionary namespace owned by this plugin (registered via ctx.locale). */
    const LOCALE_NS = 'memory'

    /**
     * Language packs; the active language comes from DSH settings
     * (设置 → 通用设置 → 语言). Never guessed from navigator.language.
     *
     * Keys are shared verbatim between `zh` and `en` — a key must exist in both
     * or in neither; `test/client-i18n.test.mjs` enforces the alignment.
     * `{name}` placeholders are filled by {@link fill}, not by the `t` seat, so
     * the panel renders correctly even if the host's `t` does no interpolation.
     */
    const DICTS = {
      zh: {
        sectionLabel: '记忆',
        loading: '读取配置中…',
        loadFailed: '记忆设置页加载失败：',
        unknownError: '未知错误',
        enabled: '启用记忆插件',
        enabledHint: '总开关：关闭后不再注入记忆，也不注册 memory 技能',
        memoryDir: '记忆目录',
        memoryDirHint: '存放 SOUL/MEMORY/index/log 的路径，支持 ~ 开头；修改后立即切换，目录不存在时自动初始化',
        dirPlaceholder: '~/.memory',
        autoInject: '开机注入记忆',
        autoInjectHint: '每次会话开始把记忆快照注入上下文',
        deferUntilUserSpeaks: '提问后才注入',
        deferUntilUserSpeaksHint: '开启后，新会话在你发出第一条消息前不会注入任何记忆 / 追忆 / digest 提醒',
        activeSessionOnly: '仅当前激活会话注入',
        activeSessionOnlyHint: '开启后，只有最近收到你消息的会话才会注入记忆（后台会话不打扰）',
        registerSkill: '注册 memory 技能',
        registerSkillHint: '让 agent 获得 remember / recall / consolidate / forget 操作协议',
        recall: '主动追忆',
        recallHint: '对话空闲时，以第一人称主动提起一件关于你的往事（拟人化），可随时关闭',
        recallInterval: '追忆间隔（分钟）',
        recallIntervalMin: '最短间隔',
        recallIntervalMax: '最长间隔',
        recallIntervalHint: '每次随机在最短 ~ 最长之间取一个间隔，避免固定节奏',
        recallMaxPerSession: '每会话追忆次数',
        recallMaxPerSessionHint: '一个会话内最多主动追忆几次，避免打扰',
        toneGuide: '语气引导',
        toneGuideHint: '按语境微调说话方式（赶工、深夜、坏消息、里程碑），不改变事实、不越 SOUL 边界',
        toneIntensity: '语气强度',
        toneIntensityHint: 'low 仅调味 / medium 更明显 / off 纯工程口吻；任何档位都以事实优先',
        toneLow: 'low（仅调味）',
        toneMedium: 'medium（更明显）',
        toneOff: 'off（纯工程口吻）',
        growthRecap: '每周成长回顾',
        growthRecapHint: '每周在追忆通道里说一次「这周我记住了什么」（第一人称，最多五句，可随时关闭）',
        growthNow: '立即回顾',
        growthNowHint: '手动触发一次成长回顾（尊重发言权仲裁；没有新内容时不发）',
        growthNowRunning: '回顾中…',
        growthNowOk: '已发送成长回顾',
        growthNowDeferred: '另一插件正在说话，稍后再试',
        growthNowBusy: '会话正忙，稍后再试',
        growthNowEmpty: '这一周没有可回顾的新内容',
        growthNowDisabled: '成长回顾已关闭',
        growthNowFailed: '回顾失败：',
        minutesPlaceholder: '30',
        maxMinutesPlaceholder: '240',
        maxPerSessionPlaceholder: '3',
        saveFailed: '保存失败：',
        footerDisabled: '当前：已停用。修改即时生效。',
        footerEnabled: '当前：记忆库位于 {dir}。修改即时生效。',
        unconfigured: '（未配置）',
        feedback: '🐛 反馈 / 提 issue',
        insightsLoading: '正在统计记忆库…',
        insightsTitle: '记忆健康',
        scoreOutOf: ' / 100',
        insightsSub: '只读统计：页数、访问新鲜度、体检结论与最近动态。',
        metricPages: '记忆页',
        metricIndexRoutes: 'index 路由',
        metricChars: '记忆字数',
        freshness: '访问新鲜度',
        bucketToday: '今天',
        bucketWeek: '≤7 天',
        bucketMonth: '≤30 天',
        bucketQuarter: '≤90 天',
        bucketStale: '>90 天',
        bucketNever: '从未',
        checks: '体检',
        checkIndex: 'index 链接完整',
        checkOrphans: '无孤儿页',
        checkFrontmatter: 'frontmatter 完整',
        checkFreshness: '访问新鲜度',
        checkIndexOk: '{routes} 条路由全部有效',
        checkIndexFail: '{count} 条指向不存在的页',
        checkOrphansOk: '每页都在 index 里',
        checkOrphansFail: '{count} 页未收录：{list}{more}',
        checkFrontmatterOk: 'title/type/salience 齐全',
        checkFrontmatterFail: '缺 salience {salience} 页 / 缺 type {type} 页',
        checkFreshnessOk: '没有超过 90 天未访问的页',
        checkFreshnessFail: '{count} 页陈旧或从未戳记',
        neverStamped: '从未戳记',
        daysSinceAccess: '天未访问',
        staleCandidates: '陈旧候选（前 {count}）',
        recent: '最近动态',
        listSeparator: '、',
        graphLoading: '正在构建记忆图谱…',
        graphTitle: '记忆图谱',
        graphResetView: '重置视图',
        graphStats: '{pages} 页 · {links} 条页间互链 · {tagEdges} 条共享 tag',
        graphIndexRoutes: '{count} 条索引路由（虚线）',
        graphIsolated: '{count} 页暂时孤立',
        graphUpdatedAt: '更新于 {time}',
        graphRelations: '{count} 条关系',
        graphNoLinks: '页面之间还没有互相引用——图谱目前只靠共享 tag 连接。写下「见 [某页](path)」会让关系变实。',
        graphIsolatedHint: '这 {count} 页还没和别的记忆连上：{list}{more}',
        graphMore: ' 等',
        legendLinks: '━ 页间互链',
        legendIndexRoutes: '┄ 索引路由',
        graphHint: '细线＝共享 tag。滚轮缩放 · 拖空白处平移 · 拖节点整理视图 · 悬停高亮关系；只读、实时。',
        typeIdentity: '自我',
        typeUser: '关于你',
        typeUserPreference: '偏好',
        typeProject: '项目',
        typeSkill: '程序性',
        typeDecision: '决策',
        typeConcept: '概念',
        typeFact: '事实',
        typeUnknown: '未标注',
      },
      en: {
        sectionLabel: 'Memory',
        loading: 'Loading configuration…',
        loadFailed: 'Failed to load memory settings: ',
        unknownError: 'unknown error',
        enabled: 'Enable memory plugin',
        enabledHint: 'Master switch: when off, no memory is injected and the memory skill is not registered',
        memoryDir: 'Memory directory',
        memoryDirHint: 'Path holding SOUL/MEMORY/index/log; a leading ~ is expanded. Switching applies immediately and scaffolds a missing directory.',
        dirPlaceholder: '~/.memory',
        autoInject: 'Inject memory at session start',
        autoInjectHint: 'Inject the memory snapshot into context when each session starts',
        deferUntilUserSpeaks: 'Inject only after you speak',
        deferUntilUserSpeaksHint: 'When on, a new session injects no memory / recall / digest reminder before your first message',
        activeSessionOnly: 'Inject into the active session only',
        activeSessionOnlyHint: 'When on, only the session that most recently received a message from you gets memory (background sessions are left alone)',
        registerSkill: 'Register the memory skill',
        registerSkillHint: 'Give the agent the remember / recall / consolidate / forget protocol',
        recall: 'Proactive recall',
        recallHint: 'When the conversation is idle, bring up a memory about you in first person (personified); can be turned off anytime',
        recallInterval: 'Recall interval (minutes)',
        recallIntervalMin: 'min interval',
        recallIntervalMax: 'max interval',
        recallIntervalHint: 'A random interval between min and max each time, so the rhythm never feels fixed',
        recallMaxPerSession: 'Recalls per session',
        recallMaxPerSessionHint: 'Maximum proactive recalls in one session, to stay unobtrusive',
        toneGuide: 'Tone guidance',
        toneGuideHint: 'Shift register by context (crunch, late night, bad news, milestones) without changing facts or crossing the SOUL boundary',
        toneIntensity: 'Tone intensity',
        toneIntensityHint: 'low = light seasoning / medium = more visible / off = pure engineering voice; facts always win',
        toneLow: 'low (light seasoning)',
        toneMedium: 'medium (more visible)',
        toneOff: 'off (pure engineering voice)',
        growthRecap: 'Weekly growth recap',
        growthRecapHint: 'Once a week, on the recall channel, say what I kept this week (first person, at most five sentences; can be turned off)',
        growthNow: 'Review now',
        growthNowHint: 'Send one growth recap right away (still respects the speech floor; no new material = no message)',
        growthNowRunning: 'Reviewing…',
        growthNowOk: 'Growth recap sent',
        growthNowDeferred: 'Another plugin holds the floor; try again later',
        growthNowBusy: 'Session busy; try again shortly',
        growthNowEmpty: 'Nothing new to recap this week',
        growthNowDisabled: 'Weekly recap is off',
        growthNowFailed: 'Recap failed: ',
        minutesPlaceholder: '30',
        maxMinutesPlaceholder: '240',
        maxPerSessionPlaceholder: '3',
        saveFailed: 'Save failed: ',
        footerDisabled: 'Current: disabled. Changes apply immediately.',
        footerEnabled: 'Current: memory store at {dir}. Changes apply immediately.',
        unconfigured: '(not configured)',
        feedback: '🐛 Feedback / open an issue',
        insightsLoading: 'Counting the memory store…',
        insightsTitle: 'Memory health',
        scoreOutOf: ' / 100',
        insightsSub: 'Read-only stats: page count, access freshness, health checks and recent activity.',
        metricPages: 'memory pages',
        metricIndexRoutes: 'index routes',
        metricChars: 'memory chars',
        freshness: 'Access freshness',
        bucketToday: 'today',
        bucketWeek: '≤7 days',
        bucketMonth: '≤30 days',
        bucketQuarter: '≤90 days',
        bucketStale: '>90 days',
        bucketNever: 'never',
        checks: 'Health checks',
        checkIndex: 'index links complete',
        checkOrphans: 'no orphan pages',
        checkFrontmatter: 'frontmatter complete',
        checkFreshness: 'access freshness',
        checkIndexOk: '{routes} routes all valid',
        checkIndexFail: '{count} routes point at missing pages',
        checkOrphansOk: 'every page is in the index',
        checkOrphansFail: '{count} pages not in the index: {list}{more}',
        checkFrontmatterOk: 'title/type/salience complete',
        checkFrontmatterFail: 'missing salience on {salience} pages / missing type on {type} pages',
        checkFreshnessOk: 'no page has gone unread for over 90 days',
        checkFreshnessFail: '{count} pages are stale or never stamped',
        neverStamped: 'never stamped',
        daysSinceAccess: 'days since last access',
        staleCandidates: 'Stale candidates (top {count})',
        recent: 'Recent activity',
        listSeparator: ', ',
        graphLoading: 'Building the memory graph…',
        graphTitle: 'Memory graph',
        graphResetView: 'Reset view',
        graphStats: '{pages} pages · {links} page links · {tagEdges} shared tags',
        graphIndexRoutes: '{count} index routes (dashed)',
        graphIsolated: '{count} pages isolated',
        graphUpdatedAt: 'updated {time}',
        graphRelations: '{count} relations',
        graphNoLinks: 'Pages do not reference each other yet — the graph currently connects them only through shared tags. Writing "see [some page](path)" makes the relation real.',
        graphIsolatedHint: 'These {count} pages are not connected to any other memory yet: {list}{more}',
        graphMore: ' and more',
        legendLinks: '━ page links',
        legendIndexRoutes: '┄ index routes',
        graphHint: 'Thin line = shared tag. Wheel to zoom · drag empty space to pan · drag a node to tidy the view · hover to highlight relations; read-only, live.',
        typeIdentity: 'identity',
        typeUser: 'about you',
        typeUserPreference: 'preference',
        typeProject: 'project',
        typeSkill: 'procedural',
        typeDecision: 'decision',
        typeConcept: 'concept',
        typeFact: 'fact',
        typeUnknown: 'untagged',
      },
    }

    /** Fill `{name}` placeholders in a translated template. */
    function fill(template, params) {
      let out = String(template)
      for (const [name, value] of Object.entries(params ?? {})) {
        out = out.split(`{${name}}`).join(String(value))
      }
      return out
    }

    /** Fallback translate for tests or a missing slot `t` seat (default Chinese). */
    function fallbackT(key, params) {
      const template = DICTS.zh[key] ?? key
      return params === undefined ? template : fill(template, params)
    }

    /**
     * The `t` seat travels by React context: MemorySection wraps the whole panel
     * tree once, so every card/input reads the same translation function without
     * drilling props through GraphCard → GraphView → renderNode.
     */
    const LocaleContext = React.createContext(fallbackT)

    /** Translation for one component: a slot-injected `t` prop wins, context is the norm. */
    function useT(props) {
      const contextT = React.useContext(LocaleContext)
      return typeof props?.t === 'function' ? props.t : contextT
    }

    /** Sidebar label in the requested language (zh `记忆` / en `Memory`). */
    function sectionLabel(language) {
      return DICTS[language === 'en' ? 'en' : 'zh'].sectionLabel
    }

    /** Freshness bucket label; unknown keys fall back to the server's own label. */
    function bucketLabel(bucket, t) {
      switch (bucket?.key) {
        case 'today': return t('bucketToday')
        case 'week': return t('bucketWeek')
        case 'month': return t('bucketMonth')
        case 'quarter': return t('bucketQuarter')
        case 'stale': return t('bucketStale')
        default: return bucket?.label ?? ''
      }
    }

    /** Health-check title; unknown ids fall back to the server's own label. */
    function checkLabel(check, t) {
      switch (check?.id) {
        case 'index': return t('checkIndex')
        case 'orphans': return t('checkOrphans')
        case 'frontmatter': return t('checkFrontmatter')
        case 'freshness': return t('checkFreshness')
        default: return check?.label ?? ''
      }
    }

    /**
     * Health-check detail rebuilt from the locale-neutral `data` the host sends
     * (lib/insights.js). An older host payload without `data` keeps its Chinese
     * `detail` verbatim — the panel never renders an empty sentence.
     */
    function checkDetail(check, t) {
      const data = check?.data
      if (data === undefined || data === null) return check?.detail ?? ''
      switch (check?.id) {
        case 'index':
          return check.ok
            ? fill(t('checkIndexOk'), { routes: data.routes })
            : fill(t('checkIndexFail'), { count: data.missing })
        case 'orphans':
          return check.ok
            ? t('checkOrphansOk')
            : fill(t('checkOrphansFail'), {
              count: data.count,
              list: (data.sample ?? []).join(t('listSeparator')),
              more: data.count > 3 ? '…' : '',
            })
        case 'frontmatter':
          return check.ok
            ? t('checkFrontmatterOk')
            : fill(t('checkFrontmatterFail'), { salience: data.missingSalience, type: data.missingType })
        case 'freshness':
          return check.ok
            ? t('checkFreshnessOk')
            : fill(t('checkFreshnessFail'), { count: data.atRisk })
        default:
          return check?.detail ?? ''
      }
    }

    /** Page-type label for the legend/tooltip; unknown types stay as the raw key. */
    function typeLabel(type, t, fallback) {
      switch (type) {
        case 'identity': return t('typeIdentity')
        case 'user': return t('typeUser')
        case 'user-preference': return t('typeUserPreference')
        case 'project': return t('typeProject')
        case 'skill': return t('typeSkill')
        case 'decision': return t('typeDecision')
        case 'concept': return t('typeConcept')
        case 'fact': return t('typeFact')
        case 'unknown': return t('typeUnknown')
        default: return fallback ?? type
      }
    }

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

    function Toggle({ checked, disabled, onChange, label }) {
      return React.createElement('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked,
        'aria-label': label,
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
      const t = useT()
      return React.createElement('div', { role: 'alert', style: { padding: '14px 16px', fontSize: '13px', lineHeight: '20px', color: 'var(--dsw-alias-state-error-primary, #e5484d)' } },
        t('loadFailed'), message)
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

    function MemorySection(props) {
      // `gen` bumps after every successful config write so the read-only health
      // card re-mounts and re-reads the store (e.g. after a memoryDir switch).
      const [gen, setGen] = React.useState(0)
      const t = useT(props)
      return React.createElement(LocaleContext.Provider, { value: t },
        React.createElement(SectionBoundary, null,
          React.createElement(MemoryForm, { onSaved: () => setGen((value) => value + 1) }),
          React.createElement(SectionBoundary, { key: gen },
            React.createElement(InsightsCard),
          ),
          React.createElement(SectionBoundary, { key: `graph-${gen}` },
            React.createElement(GraphCard),
          ),
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
    function InsightsCard(props) {
      const t = useT(props)
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
        return React.createElement('div', { style: { ...cardStyle, fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #888)' } }, t('insightsLoading'))
      }
      // 看板是附加信息：拿不到就静默隐藏，绝不影响设置页可用。
      if (status === 'failed' || data === undefined) return null

      const overview = data.overview ?? {}
      const pages = overview.pages ?? 0
      const health = data.health ?? { score: 0, checks: [] }
      const buckets = (data.freshness && data.freshness.buckets) || []
      const stale = data.stalePages ?? []
      const recent = data.recent ?? []
      const formatDays = (days) => (days === null || days === undefined
        ? t('neverStamped')
        : `${days} ${t('daysSinceAccess')}`)

      return React.createElement('div', { style: cardStyle },
        React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' } },
          React.createElement('div', { style: cardTitleStyle }, t('insightsTitle')),
          React.createElement('div', { style: { fontSize: '20px', lineHeight: '26px', fontWeight: '700', color: scoreColor(health.score) } },
            `${health.score}`,
            React.createElement('span', { style: { fontSize: '11px', fontWeight: '400', color: 'var(--dsw-alias-label-secondary, #999)' } }, t('scoreOutOf')),
          ),
        ),
        React.createElement('div', { style: cardSubStyle }, t('insightsSub')),

        React.createElement('div', { style: metricRowStyle },
          React.createElement('div', { style: metricBoxStyle },
            React.createElement('div', { style: metricValueStyle }, String(pages)),
            React.createElement('div', { style: metricLabelStyle }, t('metricPages')),
          ),
          React.createElement('div', { style: metricBoxStyle },
            React.createElement('div', { style: metricValueStyle }, String(overview.indexEntries ?? 0)),
            React.createElement('div', { style: metricLabelStyle }, t('metricIndexRoutes')),
          ),
          React.createElement('div', { style: metricBoxStyle },
            React.createElement('div', { style: metricValueStyle }, `~${overview.chars ?? 0}`),
            React.createElement('div', { style: metricLabelStyle }, t('metricChars')),
          ),
        ),

        React.createElement('div', { style: sectionLabelStyle }, t('freshness')),
        ...buckets.map((bucket) =>
          React.createElement(Bar, {
            key: bucket.key,
            label: bucketLabel(bucket, t),
            count: bucket.count,
            total: pages,
            color: barColor(bucket.key),
          })),
        (data.freshness && data.freshness.never > 0)
          ? React.createElement(Bar, { label: t('bucketNever'), count: data.freshness.never, total: pages, color: 'var(--dsw-alias-label-secondary, #888)' })
          : null,

        React.createElement('div', { style: sectionLabelStyle }, t('checks')),
        ...health.checks.map((check) =>
          React.createElement('div', { key: check.id, style: { display: 'flex', gap: '8px', alignItems: 'baseline', marginBottom: '4px' } },
            React.createElement('span', { style: { color: checkColor(check.ok), fontSize: '12px', width: '14px', flexShrink: 0 } }, check.ok ? '✓' : '!'),
            React.createElement('span', { style: { fontSize: '12px', lineHeight: '18px' } },
              checkLabel(check, t),
              React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary, #999)' } }, ` · ${checkDetail(check, t)}`),
            ),
          )),

        stale.length > 0
          ? React.createElement('div', null,
            React.createElement('div', { style: sectionLabelStyle }, fill(t('staleCandidates'), { count: stale.length })),
            ...stale.map((page) =>
              React.createElement('div', { key: page.path, style: { fontSize: '12px', lineHeight: '18px', display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '3px' } },
                React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, page.title || page.path),
                React.createElement('span', { style: { color: 'var(--dsw-alias-state-warning-primary, #f5a623)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' } }, formatDays(page.daysSinceAccess)),
              )),
          )
          : null,

        recent.length > 0
          ? React.createElement('div', null,
            React.createElement('div', { style: sectionLabelStyle }, t('recent')),
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
    function DirInput({ value, disabled, onCommit, label }) {
      const t = useT()
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
        placeholder: t('dirPlaceholder'),
        'aria-label': label,
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
    function NumberInput({ value, disabled, onCommit, placeholder, label }) {
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
        'aria-label': label,
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

    /** 下拉选择：语气强度这类枚举配置，改动立即写回。 */
    function SelectInput({ value, disabled, options, onChange, label }) {
      return React.createElement('select', {
        'aria-label': label,
        disabled,
        value: value ?? '',
        onChange: (event) => onChange(event.target.value),
        style: { ...inputStyle, width: '190px', cursor: 'pointer' },
      }, (options ?? []).map((option) =>
        React.createElement('option', { key: option.value, value: option.value }, option.label)))
    }

    function MemoryForm(props) {
      const t = useT(props)
      const { onSaved } = props
      const [config, setConfig] = React.useState(undefined)
      const [status, setStatus] = React.useState('loading')
      const [error, setError] = React.useState(undefined)
      const [saving, setSaving] = React.useState(false)
      const [growthBusy, setGrowthBusy] = React.useState(false)
      const [growthNotice, setGrowthNotice] = React.useState(undefined)

      // Visible keyboard focus for every control in this panel (inline styles
      // cannot express :focus-visible). The tag is removed with the panel.
      React.useEffect(() => {
        if (typeof document === 'undefined') return undefined
        const tag = document.createElement('style')
        tag.setAttribute('data-dsh-memory-focus', '')
        tag.textContent = '[data-dsh-memory-panel] :focus-visible, [data-dsh-memory-panel]:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4c8bf5); outline-offset: 2px; }'
        document.head.appendChild(tag)
        return () => tag.remove()
      }, [])

      React.useEffect(() => {
        if (growthNotice === undefined || typeof setTimeout !== 'function') return undefined
        const timer = setTimeout(() => setGrowthNotice(undefined), 5000)
        return () => clearTimeout(timer)
      }, [growthNotice])

      const reviewNow = () => {
        setGrowthBusy(true)
        setGrowthNotice(undefined)
        fetch(CONTROL_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'growth-now' }),
        })
          .then(async (response) => {
            const body = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(body.error ?? `POST ${response.status}`)
            if (body.delivered === true) { setGrowthNotice(t('growthNowOk')); return }
            const reason = body.reason
            if (reason === 'deferred') { setGrowthNotice(t('growthNowDeferred')); return }
            if (reason === 'no-content') { setGrowthNotice(t('growthNowEmpty')); return }
            if (reason === 'disabled' || reason === 'growth-disabled') { setGrowthNotice(t('growthNowDisabled')); return }
            if (reason === 'busy') { setGrowthNotice(t('growthNowBusy')); return }
            if (reason === 'error' || reason === 'agent-gone' || reason === 'disposed') { setGrowthNotice(t('growthNowFailed')); return }
            setGrowthNotice(t('growthNowEmpty'))
          })
          .catch((err) => {
            setGrowthNotice(`${t('growthNowFailed')}${err instanceof Error ? err.message : String(err)}`)
          })
          .finally(() => setGrowthBusy(false))
      }

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
        return React.createElement('div', { style: { padding: '14px 16px', fontSize: '13px', color: 'var(--dsw-alias-label-secondary, #888)' } }, t('loading'))
      }
      if (status === 'failed') return React.createElement(ErrorText, { message: error ?? t('unknownError') })

      const value = config ?? {}
      const disabled = saving

      return React.createElement('div', { style: { padding: '8px 0' }, 'data-dsh-memory-panel': '' },
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, t('enabled')),
            React.createElement('div', { style: subStyle }, t('enabledHint')),
          ),
          React.createElement(Toggle, {
            label: t('enabled'),
            checked: value.enabled !== false,
            disabled,
            onChange: (next) => apply({ enabled: next }),
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, t('memoryDir')),
            React.createElement('div', { style: subStyle }, t('memoryDirHint')),
          ),
          React.createElement(DirInput, {
            label: t('memoryDir'),
            value: value.memoryDir,
            disabled,
            onCommit: (next) => apply({ memoryDir: next }),
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, t('autoInject')),
            React.createElement('div', { style: subStyle }, t('autoInjectHint')),
          ),
          React.createElement(Toggle, {
            label: t('autoInject'),
            checked: value.autoInject !== false,
            disabled,
            onChange: (next) => apply({ autoInject: next }),
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, t('deferUntilUserSpeaks')),
            React.createElement('div', { style: subStyle }, t('deferUntilUserSpeaksHint')),
          ),
          React.createElement(Toggle, {
            label: t('deferUntilUserSpeaks'),
            checked: value.deferUntilUserSpeaks !== false,
            disabled,
            onChange: (next) => apply({ deferUntilUserSpeaks: next }),
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, t('activeSessionOnly')),
            React.createElement('div', { style: subStyle }, t('activeSessionOnlyHint')),
          ),
          React.createElement(Toggle, {
            label: t('activeSessionOnly'),
            checked: value.activeSessionOnly !== false,
            disabled,
            onChange: (next) => apply({ activeSessionOnly: next }),
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, t('registerSkill')),
            React.createElement('div', { style: subStyle }, t('registerSkillHint')),
          ),
          React.createElement(Toggle, {
            label: t('registerSkill'),
            checked: value.registerSkill !== false,
            disabled,
            onChange: (next) => apply({ registerSkill: next }),
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, t('recall')),
            React.createElement('div', { style: subStyle }, t('recallHint')),
          ),
          React.createElement(Toggle, {
            label: t('recall'),
            checked: value.recallEnabled !== false,
            disabled,
            onChange: (next) => apply({ recallEnabled: next }),
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, t('recallInterval')),
            React.createElement('div', { style: subStyle }, t('recallIntervalHint')),
          ),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            React.createElement(NumberInput, {
              label: t('recallIntervalMin'),
              value: value.recallIntervalMinMinutes,
              disabled,
              placeholder: t('minutesPlaceholder'),
              onCommit: (next) => apply({ recallIntervalMinMinutes: next }),
            }),
            React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary, #999)' } }, '~'),
            React.createElement(NumberInput, {
              label: t('recallIntervalMax'),
              value: value.recallIntervalMaxMinutes,
              disabled,
              placeholder: t('maxMinutesPlaceholder'),
              onCommit: (next) => apply({ recallIntervalMaxMinutes: next }),
            }),
          ),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, t('recallMaxPerSession')),
            React.createElement('div', { style: subStyle }, t('recallMaxPerSessionHint')),
          ),
          React.createElement(NumberInput, {
            label: t('recallMaxPerSession'),
            value: value.recallMaxPerSession,
            disabled,
            placeholder: t('maxPerSessionPlaceholder'),
            onCommit: (next) => apply({ recallMaxPerSession: next }),
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, t('toneGuide')),
            React.createElement('div', { style: subStyle }, t('toneGuideHint')),
          ),
          React.createElement(Toggle, {
            label: t('toneGuide'),
            checked: value.toneGuideEnabled !== false,
            disabled,
            onChange: (next) => apply({ toneGuideEnabled: next }),
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, t('toneIntensity')),
            React.createElement('div', { style: subStyle }, t('toneIntensityHint')),
          ),
          React.createElement(SelectInput, {
            label: t('toneIntensity'),
            value: value.toneIntensity ?? 'low',
            disabled: disabled || value.toneGuideEnabled === false,
            options: [
              { value: 'low', label: t('toneLow') },
              { value: 'medium', label: t('toneMedium') },
              { value: 'off', label: t('toneOff') },
            ],
            onChange: (next) => apply({ toneIntensity: next }),
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, t('growthRecap')),
            React.createElement('div', { style: subStyle }, t('growthRecapHint')),
          ),
          React.createElement(Toggle, {
            label: t('growthRecap'),
            checked: value.growthRecapEnabled !== false,
            disabled,
            onChange: (next) => apply({ growthRecapEnabled: next }),
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, t('growthNow')),
            React.createElement('div', { style: subStyle }, t('growthNowHint')),
          ),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
            growthNotice !== undefined
              ? React.createElement('span', { role: 'status', style: subStyle }, growthNotice)
              : null,
            React.createElement('button', {
              type: 'button',
              role: 'button',
              'aria-label': t('growthNow'),
              disabled: disabled || growthBusy,
              onClick: reviewNow,
              style: {
                padding: '7px 14px',
                fontSize: '13px',
                lineHeight: '18px',
                borderRadius: '6px',
                border: '1px solid var(--dsw-alias-border-l2, #d4d4d8)',
                background: 'var(--dsw-alias-bg-layer-1, #f4f4f5)',
                color: 'var(--dsw-alias-label-primary, #18181b)',
                cursor: disabled || growthBusy ? 'not-allowed' : 'pointer',
                opacity: disabled || growthBusy ? 0.6 : 1,
              },
            }, growthBusy ? t('growthNowRunning') : t('growthNow')),
          ),
        ),
        error !== undefined ? React.createElement('div', { role: 'alert', style: errorStyle }, t('saveFailed'), error) : null,
        React.createElement('div', { style: { padding: '14px 16px', fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary, #888)' } },
          value.enabled === false
            ? t('footerDisabled')
            : fill(t('footerEnabled'), { dir: value.memoryDir ?? t('unconfigured') }),
        ),
        // 反馈入口：做成按钮而不是小字链接，方便一眼看到。
        // 外部 HTTPS 在 DSH Desktop 里由系统浏览器打开（不带内嵌会话或 token）。
        React.createElement('div', { style: { padding: '2px 16px 18px' } },
          React.createElement('a', {
            href: MEMORY_FEEDBACK_URL,
            target: '_blank',
            rel: 'noopener noreferrer',
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: '500',
              lineHeight: '18px',
              borderRadius: '6px',
              border: '1px solid var(--dsw-alias-border-l2, #d4d4d8)',
              background: 'var(--dsw-alias-bg-layer-1, #f4f4f5)',
              color: 'var(--dsw-alias-label-primary, #18181b)',
              textDecoration: 'none',
            },
          }, t('feedback')),
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
    const GraphView = React.memo(function GraphView(props) {
      const { graph, fetchedAt } = props
      const t = useT(props)
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
        const tip = `${node.label}\n${typeLabel(node.type, t)}`
          + `${node.salience ? ` · salience:${node.salience}` : ''}`
          + `${node.tags && node.tags.length > 0 ? `\n#${node.tags.join(' #')}` : ''}`
          + `\n${fill(t('graphRelations'), { count: node.degree ?? 0 })}`
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
        'aria-label': t('graphTitle'),
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
          typeLabel(type, t),
        ))

      const isolated = stats.isolated ?? []
      return React.createElement('div', { style: cardStyle },
        React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' } },
          React.createElement('div', { style: cardTitleStyle }, t('graphTitle')),
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
            }, t('graphResetView'))
            : null,
        ),
        React.createElement('div', { style: cardSubStyle },
          fill(t('graphStats'), { pages: stats.pages ?? nodes.length, links: stats.links ?? 0, tagEdges: stats.tagEdges ?? 0 })
          + (stats.indexLinks ? ` · ${fill(t('graphIndexRoutes'), { count: stats.indexLinks })}` : '')
          + (isolated.length > 0 ? ` · ${fill(t('graphIsolated'), { count: isolated.length })}` : '')
          + (fetchedAt instanceof Date ? ` · ${fill(t('graphUpdatedAt'), { time: fetchedAt.toLocaleTimeString() })}` : ''),
        ),
        svg,
        React.createElement('div', { style: { marginTop: '8px' } }, ...chips),
        ((stats.links ?? 0) === 0 || isolated.length > 0)
          ? React.createElement('div', { style: { fontSize: '11px', lineHeight: '17px', color: 'var(--dsw-alias-label-secondary, #888)', marginTop: '6px' } },
            (stats.links ?? 0) === 0
              ? t('graphNoLinks')
              : fill(t('graphIsolatedHint'), {
                count: isolated.length,
                list: isolated.slice(0, 3).map((id) => id.replace(/\.md$/, '')).join(t('listSeparator')),
                more: isolated.length > 3 ? t('graphMore') : '',
              }),
          )
          : null,
        React.createElement('div', { style: { fontSize: '11px', lineHeight: '17px', color: 'var(--dsw-alias-label-secondary, #888)', marginTop: '6px' } },
          React.createElement('span', { style: { color: 'var(--dsw-alias-brand-primary, #4c8bf5)' } }, t('legendLinks')),
          ' · ',
          React.createElement('span', { style: { color: '#8b8f96' } }, t('legendIndexRoutes')),
          ' · ',
          t('graphHint'),
        ),
      )
    })

    /** 记忆图谱卡片：负责取数（含轮询）与生命周期，渲染交给 GraphView。 */
    function GraphCard(props) {
      const t = useT(props)
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
        return React.createElement('div', { style: { ...cardStyle, fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #888)' } }, t('graphLoading'))
      }
      if (status === 'failed' || graph === undefined) return null
      return React.createElement(GraphView, { graph, fetchedAt })
    }

    // ---------------- 设置侧栏标记（导航图标） ----------------
    //
    // Inlined from lib/settings-nav-icon.js: the client bundle can only require
    // platform seeds, so the claim logic lives here in the same shape. The
    // canonical module (with its tests) is the source of truth; this mirrors it.
    //
    // 官方 settings.section 只投影 id / order / label，没有 icon 可传；设置 shell
    // 的 navIcon(id) 只认一小撮白名单 id，其余一律回落到它自己的齿轮。所以我们
    // 挂载后按 label 认出自己那一行，藏掉齿轮、用 mask 画自己的标记。
    // 官方哪天给 settings.section 长出 icon 字段，这段即可删除。
    const NAV_ROW_SELECTOR = '[role="dialog"] nav button'
    const NAV_ICON_ATTR = 'data-dsh-memory-nav-icon'
    // The label is resolved from DICTS by `sectionLabel(language)`: it is both the
    // displayed text and the claim key, so both must come from that one function.
    const MEMORY_FEEDBACK_URL = 'https://github.com/LittleBlackTong/dsh-plugin-memory/issues/new'
    const ICON_MEDIUM_STROKE = 1.3
    const BRAIN_CIRCUIT_PATHS = [
      { kind: 'path', d: 'M7.3 3.71C7.302 3.057 6.95 2.454 6.38 2.134 5.81 1.815 5.112 1.83 4.556 2.172 3.999 2.515 3.672 3.132 3.702 3.785 2.987 3.969 2.397 4.471 2.101 5.147 1.805 5.823 1.836 6.597 2.186 7.247 1.57 7.747 1.241 8.521 1.308 9.312 1.375 10.102 1.829 10.81 2.52 11.2 2.405 12.087 2.793 12.963 3.526 13.475 4.259 13.987 5.216 14.049 6.008 13.636 6.801 13.224 7.299 12.404 7.3 11.51Z' },
      { kind: 'circle', cx: 9.1, cy: 2.4, r: 0.85 },
      { kind: 'path', d: 'M7.5 5.4 10.6 4.2' },
      { kind: 'circle', cx: 11.8, cy: 3.7, r: 1 },
      { kind: 'path', d: 'M7.5 7.5H10.5' },
      { kind: 'circle', cx: 11.5, cy: 7.5, r: 0.85 },
      { kind: 'path', d: 'M7.5 9.6 10.5 10.8' },
      { kind: 'circle', cx: 11.5, cy: 11.3, r: 0.85 },
      { kind: 'circle', cx: 9.1, cy: 13.2, r: 0.85 },
    ]
    const brainCircuitSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="${ICON_MEDIUM_STROKE}" stroke-linecap="round" stroke-linejoin="round">${BRAIN_CIRCUIT_PATHS.map((p) => (p.kind === 'circle' ? `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}"/>` : `<path d="${p.d}"/>`)).join('')}</svg>`
    const brainCircuitMaskUrl = (svg = brainCircuitSvg()) => `data:image/svg+xml,${encodeURIComponent(svg)}`
    const navIconCss = (maskUrl) => [
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
    const isOwnNavRow = (rowText, wantedLabel) => {
      const wanted = String(wantedLabel == null ? '' : wantedLabel).trim()
      if (wanted.length === 0) return false
      return String(rowText == null ? '' : rowText).trim() === wanted
    }
    /** 认领设置侧栏里我们自己那一行；返回 teardown。 */
    function claimNavIcon(readLabel) {
      const style = document.createElement('style')
      style.textContent = navIconCss(brainCircuitMaskUrl())
      document.head.appendChild(style)
      const sync = () => {
        const rows = document.querySelectorAll(NAV_ROW_SELECTOR)
        const want = readLabel()
        for (const row of rows) {
          if (isOwnNavRow(row.textContent, want)) row.setAttribute(NAV_ICON_ATTR, '')
          else row.removeAttribute(NAV_ICON_ATTR)
        }
      }
      sync()
      // 语言切换 / 面板重挂载后重新认领，保证 label 与标记永不打架。
      const observer = new MutationObserver(sync)
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      return () => {
        observer.disconnect()
        style.remove()
        for (const row of document.querySelectorAll(`[${NAV_ICON_ATTR}]`)) row.removeAttribute(NAV_ICON_ATTR)
      }
    }

    function apply(ctx) {
      // Language packs ride DSH's own locale layer: the panel follows
      // 设置 → 通用设置 → 语言 instead of guessing from navigator.language.
      ctx.effect(() => ctx.locale.register(LOCALE_NS, DICTS), 'memory: dictionaries')
      /** Sidebar label in the active language (zh `记忆` / en `Memory`). */
      const labelOf = () => {
        let active = 'zh'
        try {
          active = ctx.locale.getSnapshot().active === 'en' ? 'en' : 'zh'
        } catch {
          active = 'zh'
        }
        return sectionLabel(active)
      }
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'memory',
        order: 100,
        locale: LOCALE_NS,
        label: labelOf,
      }, MemorySection))
      // 官方 settings.section 没有 icon 字段，侧栏标记只能靠自己认领；
      // 认领键就是当前语言的 label（语言切换后 MutationObserver 会重新对齐）。
      ctx.effect(() => claimNavIcon(labelOf), 'memory: settings nav icon')
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    // Test seam: the browser half cannot be imported by Node, so the pure
    // helpers and the component itself are exposed for a vm-based harness.
    // Underscore-prefixed and additive: the host only reads `apply`/`inject`.
    exports.__test = {
      MemorySection,
      MemoryForm,
      InsightsCard,
      GraphCard,
      GraphView,
      DICTS,
      LOCALE_NS,
      fallbackT,
      fill,
      sectionLabel,
      bucketLabel,
      checkLabel,
      checkDetail,
      typeLabel,
      useT,
      isOwnNavRow,
      claimNavIcon,
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
