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
    /** Per-session gate: the panel and the composer chip share this route. */
    const SESSION_URL = '/api/memory/session'
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
        bootSnapshot: '固化 boot 快照',
        bootSnapshotHint: '开启后本会话内不再重读记忆库，会话中途写入的改动下个会话才生效（省前缀缓存）；关闭=每轮实时重读',
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
        growthNowError: '回顾失败',
        growthNowNoSession: '没有活跃会话可回顾',
        sessionSection: '会话与工作区',
        sessionSectionHint: '记忆开关按会话生效：关闭后本会话不注入记忆、不提醒、不盖 last_access（记忆文件不会删）。',
        sessionCurrent: '当前会话记忆',
        sessionCurrentHint: '只影响当前会话；输入框旁的 chip 与 /memory off 效果相同',
        sessionWorkspace: '此工作区默认关闭',
        sessionWorkspaceHint: '以当前会话的工作目录为准，之后该目录下的新会话默认不记记忆',
        sessionNoActive: '还没有活跃会话：先在任意会话里说句话，这里才能读出当前会话',
        sessionFailed: '操作失败，稍后再试：',
        sessionLoading: '读取会话状态中…',
        chipOn: '记忆开',
        chipOff: '记忆关',
        chipHint: '点击选择记忆范围（也可用 /memory on|off）',
        chipMenuSession: '本会话',
        chipMenuWorkspace: '此工作区默认',
        chipMenuOn: '开',
        chipMenuOff: '关',
        chipMenuTitle: '记忆范围',
        chipMenuUnavailable: '暂时读不到会话状态',
        chipMenuFailed: '操作失败：',
        soulSection: '人格基础（快速铸魂）',
        soulHint: '下面是通用默认值，按你的喜好改；保存后下一次会话生效。也可以直接在对话里让我逐项问，效果一样。',
        soulUnmanaged: '还没铸魂：下面是通用默认，可直接用或按喜好改',
        soulFromChat: '已铸魂（对话生成）：下面是 SOUL.md 里的当前值，保存后由面板接管',
        soulManaged: '已设置 · 保存后下一次会话生效',
        soulAgentName: '我的名字',
        soulAgentPlaceholder: '例如：小助手',
        soulUserName: '你的称呼',
        soulUserPlaceholder: '例如：小明',
        soulSummary: '基础人格描述',
        soulSummaryPlaceholder: '例如：直接、诚实、先结论后细节；不确定时明说，不编造。',
        soulSave: '保存人格',
        soulSaving: '保存中…',
        soulSaved: '已保存，下次会话生效',
        soulSavedForged: '已保存，铸魂标记为完成',
        soulLoading: '读取人格设置中…',
        soulFailed: '保存失败：',
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
        graph3dSpin: '自动旋转',
        graph3dHint: '拖空白旋转 · 滚轮缩放 · 拖节点整理布局 · 悬停/点击节点高亮邻居 · 双击节点打开文件 · 双击空白重置；只读、实时。',
        graph3dNeighbours: '邻居 {count} 个',
        graphSearchPlaceholder: '搜索记忆节点…',
        graphSearchNone: '没有匹配的节点',
        graphRevealFailed: '打开文件失败：',
        graphRevealButton: '在 Finder 中显示',
        graphCopyPath: '复制路径',
        graphCopied: '路径已复制',
        graphCopyFailed: '复制路径失败',
        graphRevealFallback: '打开失败，已复制路径；在 Finder 里按 ⌘⇧G 粘贴路径即可跳转',
        graphStats: '{pages} 页 · {links} 条页间互链 · {tagEdges} 条共享 tag',
        graphIndexRoutes: '{count} 条索引路由（虚线）',
        graphIsolated: '{count} 页暂时孤立',
        graphUpdatedAt: '更新于 {time}',
        graphNoLinks: '页面之间还没有互相引用——图谱目前只靠共享 tag 连接。写下「见 [某页](path)」会让关系变实。',
        graphIsolatedHint: '这 {count} 页还没和别的记忆连上：{list}{more}',
        graphMore: ' 等',
        legendLinks: '━ 页间互链',
        legendIndexRoutes: '┄ 索引路由',
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
        bootSnapshot: 'Pin boot snapshot',
        bootSnapshotHint: 'On: freeze the boot block for this session — memory written mid-session applies from the next session (saves prompt-cache misses); off: re-read live every turn',
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
        growthNowError: 'Recap failed',
        growthNowNoSession: 'No active session to recap',
        sessionSection: 'Session & workspace',
        sessionSectionHint: 'The memory switch is per session: off means no injection, no nudges and no last_access stamping for this session (nothing is deleted).',
        sessionCurrent: 'Memory for this session',
        sessionCurrentHint: 'Only affects the current session; the composer chip and /memory off do the same',
        sessionWorkspace: 'Mute this workspace by default',
        sessionWorkspaceHint: 'Uses the current session workspace; new sessions under this directory start muted',
        sessionNoActive: 'No active session yet: say something in any session so the panel can read it',
        sessionFailed: 'Something went wrong; try again: ',
        sessionLoading: 'Reading session state…',
        chipOn: 'Memory on',
        chipOff: 'Memory off',
        chipHint: 'Choose the memory scope (or /memory on|off)',
        chipMenuSession: 'This session',
        chipMenuWorkspace: 'Workspace default',
        chipMenuOn: 'On',
        chipMenuOff: 'Off',
        chipMenuTitle: 'Memory scope',
        chipMenuUnavailable: 'Could not read the session state',
        chipMenuFailed: 'Action failed: ',
        soulSection: 'Basic soul (quick forging)',
        soulHint: 'Below is a generic default — tweak it to taste; saving applies from the next session. You can also let me ask you item by item in chat.',
        soulUnmanaged: 'Not forged yet: the generic defaults below are ready to use or tweak',
        soulFromChat: 'Soul forged in chat: values below are parsed from SOUL.md; saving hands it to the panel',
        soulManaged: 'Set · saving applies from the next session',
        soulAgentName: 'My name',
        soulAgentPlaceholder: 'e.g. Assistant',
        soulUserName: 'What I call you',
        soulUserPlaceholder: 'e.g. Alex',
        soulSummary: 'Baseline persona',
        soulSummaryPlaceholder: 'e.g. Direct, honest, conclusion first; say when unsure, never fabricate.',
        soulSave: 'Save soul',
        soulSaving: 'Saving…',
        soulSaved: 'Saved; applies from the next session',
        soulSavedForged: 'Saved; soul forging marked complete',
        soulLoading: 'Reading the soul profile…',
        soulFailed: 'Save failed: ',
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
        graph3dSpin: 'Auto-spin',
        graph3dHint: 'Drag empty space to rotate · wheel to zoom · drag nodes to tidy the layout · hover or click a node to light up its neighbours · double-click a node to reveal its file · double-click empty space to reset; read-only, live.',
        graph3dNeighbours: 'Neighbours: {count}',
        graphSearchPlaceholder: 'Search memory nodes…',
        graphSearchNone: 'No matching nodes',
        graphRevealFailed: 'Could not open the file: ',
        graphRevealButton: 'Reveal in Finder',
        graphCopyPath: 'Copy path',
        graphCopied: 'Path copied',
        graphCopyFailed: 'Could not copy the path',
        graphRevealFallback: 'Reveal failed; the path was copied — paste it in your file manager to jump there',
        graphStats: '{pages} pages · {links} page links · {tagEdges} shared tags',
        graphIndexRoutes: '{count} index routes (dashed)',
        graphIsolated: '{count} pages isolated',
        graphUpdatedAt: 'updated {time}',
        graphNoLinks: 'Pages do not reference each other yet — the graph currently connects them only through shared tags. Writing "see [some page](path)" makes the relation real.',
        graphIsolatedHint: 'These {count} pages are not connected to any other memory yet: {list}{more}',
        graphMore: ' and more',
        legendLinks: '━ page links',
        legendIndexRoutes: '┄ index routes',
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
          // Mirror the host switch: on = label-primary track (white in dark themes,
          // black in light themes), off = neutral border track. No brand blue.
          background: checked
            ? 'var(--dsw-alias-label-primary, #1f2328)'
            : 'var(--dsw-alias-border-l2, rgba(128,128,128,0.45))',
          boxShadow: 'inset 0 0 0 1px rgba(128,128,128,0.35)',
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
          // Knob is the inverse of the track: dark on the white (dark-theme) track,
          // light on the black (light-theme) track.
          background: checked
            ? 'var(--dsw-alias-bg-layer-1, #1f2328)'
            : 'var(--dsw-alias-label-secondary, #888)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.35)',
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
        React.createElement('div', { 'data-dsh-memory-panel': '', style: { padding: '8px 0' } },
          React.createElement(SectionBoundary, null,
            React.createElement(SoulCard),
          ),
          // Graph card follows the soul card: these two are what people actually
          // open the panel for, so they should be visible without scrolling.
          React.createElement(SectionBoundary, { key: `graph-${gen}` },
            React.createElement(GraphCard),
          ),
          React.createElement(SectionBoundary, null,
            React.createElement(MemoryForm, { onSaved: () => setGen((value) => value + 1) }),
          ),
          React.createElement(SectionBoundary, { key: gen },
            React.createElement(InsightsCard),
          ),
        ),
      )
    }

    // ---------------- 记忆健康看板 ----------------

    const cardStyle = {
      // The settings rows below are full-width with 16px inner padding; cards
      // follow the same grid so their border lines up with the row separators.
      margin: '8px 0 16px',
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

    // ---------------- 人格基础（快速铸魂） ----------------
    //
    // 面板里直接填三件事，写入 SOUL.md 的受管区块（不碰用户手写内容），
    // 并顺手把 BOOTSTRAP 标 complete：没铸魂的用户不必先聊一轮才能甩掉模板人格。
    const SOUL_URL = '/api/memory/soul'

    function SoulCard(props) {
      const t = useT(props)
      const [state, setState] = React.useState(undefined)
      const [draft, setDraft] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(undefined)
      const [error, setError] = React.useState(undefined)

      React.useEffect(() => {
        fetch(SOUL_URL)
          .then(async (response) => {
            if (!response.ok) throw new Error(`GET ${response.status}`)
            return response.json()
          })
          .then((value) => setState(value))
          .catch(() => setState({ ok: false, reason: 'error' }))
      }, [])

      React.useEffect(() => {
        if (notice === undefined || typeof setTimeout !== 'function') return undefined
        const timer = setTimeout(() => setNotice(undefined), 5000)
        return () => clearTimeout(timer)
      }, [notice])

      if (state === undefined) {
        return React.createElement('div', { style: { ...cardStyle, fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #888)' } }, t('soulLoading'))
      }
      const profile = state.profile ?? {}
      const managed = profile.managed === true
      const value = draft ?? {
        agentName: profile.agentName ?? '',
        userName: profile.userName ?? '',
        summary: profile.summary ?? '',
      }
      const update = (key) => (event) => setDraft({ ...value, [key]: event.target.value })
      const save = () => {
        setBusy(true)
        setError(undefined)
        fetch(SOUL_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(value),
        })
          .then(async (response) => {
            const body = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(body.error ?? `POST ${response.status}`)
            setState({ ok: true, profile: body.profile, bootstrapStatus: body.bootstrapStatus, needsBootstrap: false })
            setDraft(undefined)
            setNotice(body.bootstrapChanged ? t('soulSavedForged') : t('soulSaved'))
          })
          .catch((err) => setError(`${t('soulFailed')}${err instanceof Error ? err.message : String(err)}`))
          .finally(() => setBusy(false))
      }

      const field = (label, key, placeholder, maxLength) => React.createElement('div', { style: { marginBottom: '10px' } },
        React.createElement('div', { style: labelStyle }, label),
        React.createElement('input', {
          type: 'text',
          'aria-label': label,
          value: value[key],
          placeholder,
          disabled: busy,
          maxLength,
          onChange: update(key),
          style: { ...inputStyle, width: '100%', maxWidth: '360px' },
        }),
      )

      return React.createElement('div', { style: cardStyle },
        React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px', marginBottom: '4px' } },
          React.createElement('div', { style: { ...labelStyle, fontWeight: 600 } }, t('soulSection')),
          state.needsBootstrap === false && !managed
            ? React.createElement('span', { style: subStyle }, t('soulFromChat'))
            : managed
              ? React.createElement('span', { style: subStyle }, t('soulManaged'))
              : React.createElement('span', { role: 'status', style: { ...subStyle, color: 'var(--dsw-alias-state-warning-primary, #b7791f)' } }, t('soulUnmanaged')),
        ),
        React.createElement('div', { style: { ...subStyle, marginBottom: '12px' } }, t('soulHint')),
        field(t('soulAgentName'), 'agentName', t('soulAgentPlaceholder'), 64),
        field(t('soulUserName'), 'userName', t('soulUserPlaceholder'), 64),
        React.createElement('div', { style: { marginBottom: '10px' } },
          React.createElement('div', { style: labelStyle }, t('soulSummary')),
          React.createElement('textarea', {
            'aria-label': t('soulSummary'),
            value: value.summary,
            placeholder: t('soulSummaryPlaceholder'),
            disabled: busy,
            maxLength: 2000,
            rows: 3,
            onChange: update('summary'),
            style: { ...inputStyle, width: '100%', maxWidth: '520px', fontFamily: 'inherit', resize: 'vertical' },
          }),
        ),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
          React.createElement('button', {
            type: 'button',
            disabled: busy,
            onClick: save,
            style: {
              padding: '7px 14px',
              fontSize: '13px',
              lineHeight: '18px',
              borderRadius: '6px',
              border: '1px solid transparent',
              // Host-style inverted primary button: label-primary fill with a
              // background-coloured label. Dark theme = light button + dark text,
              // light theme = dark button + light text. Brand-primary maps to white
              // on dark themes, which turned this into an unreadable white block.
              background: 'var(--dsw-alias-label-primary, #1f2328)',
              color: 'var(--dsw-alias-bg-layer-1, #ffffff)',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
            },
          }, busy ? t('soulSaving') : t('soulSave')),
          notice !== undefined ? React.createElement('span', { role: 'status', style: subStyle }, notice) : null,
        ),
        error !== undefined
          ? React.createElement('div', { role: 'alert', style: { marginTop: '8px', fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #e5484d)' } }, error)
          : null,
      )
    }

    // ---------------- 会话与工作区（设置面板） ----------------
    //
    // 会话级记忆开关的第二个入口：设置页没有 sessionId，Host 的
    // /api/memory/session 会用「最近发言的活跃会话」代理，所以这里读到/改到的
    // 就是用户当前正在用的那个会话。
    function SessionControls(props) {
      const t = useT(props)
      const [state, setState] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(undefined)

      React.useEffect(() => {
        fetch(SESSION_URL)
          .then(async (response) => {
            if (!response.ok) throw new Error(`GET ${response.status}`)
            return response.json()
          })
          .then((value) => setState(value))
          .catch(() => setState({ ok: false, reason: 'error' }))
      }, [])

      const act = (action) => {
        setBusy(true)
        setError(undefined)
        fetch(SESSION_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action }),
        })
          .then(async (response) => {
            const body = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(body.error ?? `POST ${response.status}`)
            setState(body)
          })
          .catch((err) => setError(`${t('sessionFailed')}${err instanceof Error ? err.message : String(err)}`))
          .finally(() => setBusy(false))
      }

      const heading = React.createElement('div', { style: { padding: '8px 16px 2px' } },
        React.createElement('div', { style: labelStyle }, t('sessionSection')),
        React.createElement('div', { style: subStyle }, t('sessionSectionHint')),
      )
      if (state === undefined) {
        return React.createElement('div', { style: { padding: '4px 0' } }, heading,
          React.createElement('div', { style: { padding: '8px 16px', ...subStyle } }, t('sessionLoading')))
      }
      const active = state.ok !== false
      const row = (label, hint, control) => React.createElement('div', { style: rowStyle },
        React.createElement('div', null,
          React.createElement('div', { style: labelStyle }, label),
          React.createElement('div', { style: subStyle }, hint),
        ),
        control,
      )
      return React.createElement('div', { style: { padding: '4px 0' } },
        heading,
        active ? null : React.createElement('div', { style: { padding: '8px 16px', ...subStyle } }, t('sessionNoActive')),
        active ? row(t('sessionCurrent'), t('sessionCurrentHint'),
          React.createElement(Toggle, {
            label: t('sessionCurrent'),
            checked: state.effective === true,
            disabled: busy,
            onChange: (next) => act(next ? 'on' : 'off'),
          })) : null,
        active ? row(t('sessionWorkspace'), t('sessionWorkspaceHint'),
          React.createElement(Toggle, {
            label: t('sessionWorkspace'),
            checked: state.workspaceDisabled === true,
            disabled: busy || typeof state.cwd !== 'string' || state.cwd.length === 0,
            onChange: (next) => act(next ? 'workspace-off' : 'workspace-on'),
          })) : null,
        active && typeof state.cwd === 'string' && state.cwd.length > 0
          ? React.createElement('div', { style: { padding: '2px 16px 8px', ...subStyle } }, state.cwd)
          : null,
        error !== undefined
          ? React.createElement('div', { role: 'alert', style: { padding: '4px 16px 8px', fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #e5484d)' } }, error)
          : null,
      )
    }

    // ---------------- 会话内 chip（composer 工具行左侧） ----------------
    //
    // 与内置 Plan 开关同构：状态来自 Host 的 per-session gate。点击打开下拉，
    // 分别设置「本会话」与「此工作区默认」——比盲切更可控；Host 拒绝时把
    // 原因显示出来（单点盲切失败时用户只会看到「点了没反应」）。
    const chipButtonStyle = (enabled) => ({
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      padding: '4px 8px',
      fontSize: '13px',
      lineHeight: '18px',
      borderRadius: '6px',
      border: 'none',
      // Match the composer toolbar's own secondary text/icons instead of
      // looking like a foreign pill (the boxed style read as "highlighted").
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary, #888)',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      opacity: enabled ? 1 : 0.55,
    })
    const chipMenuStyle = {
      position: 'absolute',
      bottom: 'calc(100% + 6px)',
      left: 0,
      zIndex: 40,
      minWidth: '156px',
      padding: '6px',
      borderRadius: '8px',
      border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2))',
      background: 'var(--dsw-alias-bg-layer-2, #fff)',
      boxShadow: '0 6px 20px rgba(0, 0, 0, 0.12)',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
    }
    const chipMenuHeadingStyle = { padding: '4px 8px 2px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #888)' }
    const chipMenuItemStyle = (active) => ({
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '5px 8px',
      fontSize: '12px',
      lineHeight: '16px',
      borderRadius: '5px',
      border: 'none',
      textAlign: 'left',
      background: active ? 'var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.12))' : 'transparent',
      color: 'var(--dsw-alias-label-primary, inherit)',
      cursor: 'pointer',
    })
    const chipMenuDividerStyle = { height: '1px', margin: '4px 6px', background: 'var(--dsw-alias-border-l1, rgba(128,128,128,0.2))' }
    const chipMenuErrorStyle = { padding: '4px 8px', fontSize: '11px', lineHeight: '15px', color: 'var(--dsw-alias-state-error-primary, #e5484d)' }

    /** 16px brain-circuit glyph (same paths as the settings nav mark). */
    function MemoryGlyph() {
      return React.createElement('svg', {
        width: 16,
        height: 16,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      }, BRAIN_CIRCUIT_PATHS.map((path, index) => (path.kind === 'circle'
        ? React.createElement('circle', { key: index, cx: path.cx, cy: path.cy, r: path.r })
        : React.createElement('path', { key: index, d: path.d }))))
    }

    function MemoryChip(props) {
      const t = useT(props)
      const sessionId = props?.sessionId
      const [state, setState] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const [open, setOpen] = React.useState(false)
      const [error, setError] = React.useState(undefined)

      const read = () => {
        if (typeof sessionId !== 'string' || sessionId.length === 0) return
        fetch(`${SESSION_URL}?sessionId=${encodeURIComponent(sessionId)}`)
          .then(async (response) => (response.ok ? response.json() : undefined))
          .then((value) => {
            if (value === undefined) return
            setState(value)
            if (value.ok === false) setError(t('chipMenuUnavailable'))
          })
          .catch(() => setError(t('chipMenuUnavailable')))
      }

      React.useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
        read()
        const timer = typeof setInterval === 'function' ? setInterval(read, 10000) : undefined
        return () => {
          if (timer !== undefined) clearInterval(timer)
        }
      }, [sessionId])

      // Close on outside click only while open (the test harness stubs hooks).
      React.useEffect(() => {
        if (!open || typeof document === 'undefined') return undefined
        const close = () => setOpen(false)
        document.addEventListener('mousedown', close)
        return () => document.removeEventListener('mousedown', close)
      }, [open])

      if (typeof sessionId !== 'string' || sessionId.length === 0) return null
      const enabled = state === undefined ? true : state.ok !== false && state.effective !== false
      const workspaceMuted = state?.workspaceDisabled === true

      const act = (action) => {
        setBusy(true)
        setError(undefined)
        fetch(SESSION_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, sessionId }),
        })
          .then(async (response) => {
            const body = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(body.error ?? `POST ${response.status}`)
            if (body.ok === false) throw new Error(String(body.reason ?? 'no-session'))
            setState(body)
            setOpen(false)
          })
          .catch((err) => setError(`${t('chipMenuFailed')}${err instanceof Error ? err.message : String(err)}`))
          .finally(() => setBusy(false))
      }

      const item = (label, action, active) => React.createElement('button', {
        type: 'button',
        role: 'menuitemradio',
        'aria-checked': active,
        disabled: busy,
        onClick: (event) => {
          event.stopPropagation()
          act(action)
        },
        style: chipMenuItemStyle(active),
      }, active ? `✓ ${label}` : `  ${label}`)

      const menu = open
        ? React.createElement('div', {
          role: 'menu',
          'aria-label': t('chipMenuTitle'),
          onMouseDown: (event) => event.stopPropagation(),
          style: chipMenuStyle,
        },
          React.createElement('div', { style: chipMenuHeadingStyle }, t('chipMenuSession')),
          item(t('chipMenuOn'), 'on', enabled),
          item(t('chipMenuOff'), 'off', !enabled),
          React.createElement('div', { style: chipMenuDividerStyle }),
          React.createElement('div', { style: chipMenuHeadingStyle }, t('chipMenuWorkspace')),
          item(t('chipMenuOn'), 'workspace-on', !workspaceMuted),
          item(t('chipMenuOff'), 'workspace-off', workspaceMuted),
          error !== undefined
            ? React.createElement('div', { role: 'alert', style: chipMenuErrorStyle }, error)
            : null,
        )
        : null

      return React.createElement('span', { style: { position: 'relative', display: 'inline-flex' } },
        React.createElement('button', {
          type: 'button',
          title: t('chipHint'),
          'aria-label': t('chipHint'),
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          'data-dsh-memory-chip-btn': '',
          disabled: busy,
          onClick: (event) => {
            event.stopPropagation()
            setOpen((value) => !value)
          },
          style: chipButtonStyle(enabled),
        },
          React.createElement(MemoryGlyph, null),
          React.createElement('span', null, enabled ? t('chipOn') : t('chipOff')),
        ),
        menu,
      )
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
            if (reason === 'no-session') { setGrowthNotice(t('growthNowNoSession')); return }
            if (reason === 'error' || reason === 'agent-gone' || reason === 'disposed') { setGrowthNotice(t('growthNowError')); return }
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

      return React.createElement('div', { style: { padding: '8px 0' } },
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
            React.createElement('div', { style: labelStyle }, t('bootSnapshot')),
            React.createElement('div', { style: subStyle }, t('bootSnapshotHint')),
          ),
          React.createElement(Toggle, {
            label: t('bootSnapshot'),
            checked: value.bootSnapshot === 'session',
            disabled,
            onChange: (next) => apply({ bootSnapshot: next ? 'session' : 'live' }),
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
        React.createElement(SessionControls, { t }),
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
    // ---------------- 记忆图谱（3D canvas，方案 B） ----------------
    //
    // 球面布局 + 透视投影，Canvas 绘制。交互：拖空白旋转、滚轮缩放、拖节点
    // 整理布局、悬停/点击高亮邻居、双击空白重置。
    //
    // 点击 vs 拖拽用「位移 + 时长」双阈值：demo 里只靠 3px 位移判定太急，
    // 轻点一下手指抖两像素就变成拖拽、选中不生效——也就是用户反馈的
    // 「选择节点不能及时显示出关联的点」。悬停也即时高亮，不等点击。
    const GRAPH3D = {
      width: 560,
      height: 400,
      radius: 250,
      focal: 900,
      camera: 340,
      zoomMin: 0.5,
      zoomMax: 2.4,
      clickSlop: 5,
      clickMs: 350,
    }

    // 以下数学内联自 lib/graph-3d.js（客户端只能 require 平台种子）。
    const GRAPH3D_GOLDEN = Math.PI * (3 - Math.sqrt(5))

    function graph3dSphere(nodes, radius) {
      const sorted = [...nodes].sort((a, b) => {
        const byType = String(a.type ?? '').localeCompare(String(b.type ?? ''))
        return byType !== 0 ? byType : String(a.id).localeCompare(String(b.id))
      })
      const count = sorted.length
      return sorted.map((node, index) => {
        const y = 1 - ((index + 0.5) * 2) / count
        const ring = Math.sqrt(Math.max(0, 1 - y * y))
        const angle = index * GRAPH3D_GOLDEN
        return {
          id: node.id,
          x: Math.cos(angle) * ring * radius,
          y: y * radius,
          z: Math.sin(angle) * ring * radius,
        }
      })
    }

    function graph3dRotate(point, yaw, pitch) {
      const cy = Math.cos(yaw)
      const sy = Math.sin(yaw)
      const cp = Math.cos(pitch)
      const sp = Math.sin(pitch)
      const x1 = point.x * cy - point.z * sy
      const z1 = point.x * sy + point.z * cy
      return { id: point.id, x: x1, y: point.y * cp - z1 * sp, z: point.y * sp + z1 * cp }
    }

    function graph3dUnrotate(point, yaw, pitch) {
      const cy = Math.cos(-yaw)
      const sy = Math.sin(-yaw)
      const cp = Math.cos(-pitch)
      const sp = Math.sin(-pitch)
      const y1 = point.y * cp - point.z * sp
      const z1 = point.y * sp + point.z * cp
      return { id: point.id, x: point.x * cy - z1 * sy, y: y1, z: point.x * sy + z1 * cy }
    }

    function graph3dProject(node, view) {
      const rotated = graph3dRotate(node, view.yaw, view.pitch)
      const scale = (GRAPH3D.focal / Math.max(60, GRAPH3D.focal + rotated.z + GRAPH3D.camera)) * view.zoom
      // 1 = nearest the camera, 0 = far pole.
      const depth = Math.max(0, Math.min(1, (GRAPH3D.radius - rotated.z) / (2 * GRAPH3D.radius)))
      return {
        id: node.id,
        x: GRAPH3D.width / 2 + rotated.x * scale,
        y: GRAPH3D.height / 2 + rotated.y * scale,
        z: rotated.z,
        scale,
        depth,
      }
    }

    function graph3dHit(points, x, y, radiusOf) {
      let best = null
      let bestDistance = Infinity
      for (const point of points) {
        const distance = Math.hypot(point.x - x, point.y - y)
        if (distance <= radiusOf(point) && distance < bestDistance) {
          best = point
          bestDistance = distance
        }
      }
      return best
    }

    function graph3dHexToRgba(hex, alpha) {
      const value = String(hex ?? '#8b8f96').replace('#', '')
      const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
      const num = Number.parseInt(full, 16)
      if (!Number.isFinite(num)) return `rgba(139,143,150,${alpha})`
      return `rgba(${(num >> 16) & 255},${(num >> 8) & 255},${num & 255},${alpha})`
    }

    /** 一帧 3D 场景：边按深度淡出、节点发光、选中置顶、标签按 LOD 显示。
     *  浅色主题不画发光——浅底上发光会把节点晕成一片灰白，看着「颜色奇怪」。 */
    function drawGraph3D(ctx, model, state, dpr, theme) {
      const view = state.view
      const selected = state.selected
      const hovered = state.hovered
      const projected = model.nodes.map((node) => graph3dProject(node, view))
      const byIdProj = new Map(projected.map((p) => [p.id, p]))
      projected.sort((a, b) => a.z - b.z) // far first
      const isNeighbour = (id) => selected !== undefined && (model.adjacency.get(selected)?.has(id) ?? false)
      const lit = (id) => selected === undefined || id === selected || isNeighbour(id)
      const selectedPoint = selected !== undefined ? byIdProj.get(selected) : undefined
      const light = theme.light

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, GRAPH3D.width, GRAPH3D.height)

      for (const edge of model.edges) {
        const a = byIdProj.get(edge.source)
        const b = byIdProj.get(edge.target)
        if (a === undefined || b === undefined) continue
        const on = selected !== undefined && (edge.source === selected || edge.target === selected)
        const hot = hovered !== undefined && (edge.source === hovered || edge.target === hovered)
        // 浅色背景上边要更实一点；深色背景可以淡，靠发光补层次。
        const base = light
          ? (edge.kind === 'index' ? 0.32 : edge.kind === 'tag' ? 0.36 : 0.68)
          : (edge.kind === 'index' ? 0.16 : edge.kind === 'tag' ? 0.2 : 0.45)
        const depthFactor = light
          ? 0.75 + 0.25 * ((a.depth + b.depth) / 2)
          : 0.4 + 0.6 * ((a.depth + b.depth) / 2)
        const alpha = (on || hot ? 0.9 : lit(edge.source) && lit(edge.target) ? base : 0.05) * depthFactor
        ctx.strokeStyle = theme.edges[edge.kind] ?? theme.edges.link
        ctx.globalAlpha = Math.max(0.02, Math.min(1, alpha))
        ctx.lineWidth = edge.kind === 'link' ? 1.2 : 0.8
        ctx.setLineDash(edge.kind === 'index' ? [3, 4] : [])
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
      ctx.setLineDash([])

      // 选中节点最后画：它永远不该被别的节点盖住。
      const order = projected.filter((p) => p.id !== selected)
      if (selectedPoint !== undefined) order.push(selectedPoint)
      for (const p of order) {
        const node = model.byId.get(p.id)
        if (node === undefined) continue
        const r = Math.max(1.5, node.baseR * p.scale)
        const alpha = lit(p.id)
          ? (light ? 0.9 + 0.1 * p.depth : 0.3 + 0.7 * p.depth)
          : (light ? 0.28 : 0.16)
        const isSelected = p.id === selected
        const isHovered = p.id === hovered
        const color = node.color ?? '#8b8f96'
        ctx.globalAlpha = Math.max(0.12, Math.min(1, alpha))
        if (light) {
          // 浅色主题：实心圆 + 白描边，绝不发光（发光在浅底上变成脏灰白）。
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = 'rgba(255,255,255,0.95)'
          ctx.lineWidth = 1.2
          ctx.stroke()
        } else {
          const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.6)
          glow.addColorStop(0, graph3dHexToRgba(color, 0.9))
          glow.addColorStop(0.5, graph3dHexToRgba(color, 0.3))
          glow.addColorStop(1, graph3dHexToRgba(color, 0))
          ctx.fillStyle = glow
          ctx.beginPath()
          ctx.arc(p.x, p.y, r * 2.6, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = Math.min(1, (isSelected ? 1 : alpha) + 0.1)
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
          ctx.fill()
        }
        if (isSelected || isHovered) {
          ctx.globalAlpha = 1
          ctx.strokeStyle = isSelected
            ? (light ? '#1f2328' : '#ffffff')
            : (light ? 'rgba(31,35,40,0.65)' : 'rgba(255,255,255,0.7)')
          ctx.lineWidth = 1.6
          ctx.beginPath()
          ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2)
          ctx.stroke()
        }
        const showLabel = isSelected || isHovered || isNeighbour(p.id) || (p.depth > 0.72 && p.scale > 0.9)
        if (showLabel) {
          const label = String(node.label).length > 18 ? `${String(node.label).slice(0, 17)}…` : String(node.label)
          ctx.globalAlpha = isSelected || isHovered ? 1 : 0.88
          ctx.font = '11px -apple-system, "PingFang SC", sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'bottom'
          ctx.lineWidth = 3
          ctx.strokeStyle = light ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.35)'
          ctx.strokeText(label, p.x, p.y - r - 4)
          ctx.fillStyle = isSelected || isHovered ? theme.labelStrong : theme.label
          ctx.fillText(label, p.x, p.y - r - 4)
        }
      }
      ctx.globalAlpha = 1
    }

    /** 从真实渲染背景判断明暗主题；CSS 变量读不到时一路向上找实际背景色。 */
    function graphCanvasTheme(canvas) {
      const style = typeof getComputedStyle === 'function' ? getComputedStyle(canvas) : undefined
      const cssVar = (name) => (style?.getPropertyValue?.(name) || '').trim()
      let background = ''
      if (typeof getComputedStyle === 'function' && typeof document !== 'undefined') {
        let node = canvas
        while (node && node !== document.documentElement) {
          const bg = getComputedStyle(node).backgroundColor
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
            background = bg
            break
          }
          node = node.parentElement
        }
        if (background === '' && document.body) background = getComputedStyle(document.body).backgroundColor
      }
      const light = isLightColor(background)
      return {
        light,
        label: light ? '#3d4451' : '#e8ecf7',
        labelStrong: light ? '#1f2328' : '#ffffff',
        edges: light
          ? { link: '#2563eb', index: '#6b7280', tag: '#7c3aed' }
          : {
            link: cssVar('--dsw-alias-brand-primary') || '#4c8bf5',
            index: cssVar('--dsw-alias-label-secondary') || '#8b8f96',
            tag: '#8b7bf5',
          },
      }
    }

    function isLightColor(value) {
      if (typeof value !== 'string' || value.length === 0) return false
      const text = value.trim().toLowerCase()
      const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(text)
      if (rgb !== null) {
        const lum = (0.299 * Number(rgb[1]) + 0.587 * Number(rgb[2]) + 0.114 * Number(rgb[3])) / 255
        return lum > 0.55
      }
      const hex = /^#([0-9a-f]{3,8})$/.exec(text)
      if (hex !== null) {
        const digits = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1].slice(0, 6)
        const num = Number.parseInt(digits, 16)
        return (0.299 * ((num >> 16) & 255) + 0.587 * ((num >> 8) & 255) + 0.114 * (num & 255)) / 255 > 0.55
      }
      return false
    }

    // 内联自 lib/graph-search.js（客户端只能 require 平台种子）。
    const GRAPH_REVEAL_URL = '/api/memory/reveal'
    const GRAPH_PATH_URL = '/api/memory/path'

    function graph3dMatch(nodes, query, limit = 8) {
      const needle = String(query ?? '').trim().toLowerCase()
      if (needle.length === 0) return []
      const scored = []
      for (const node of nodes) {
        const label = String(node.label ?? '').toLowerCase()
        const id = String(node.id ?? '').toLowerCase()
        const type = String(node.type ?? '').toLowerCase()
        const tags = Array.isArray(node.tags) ? node.tags.map((tag) => String(tag).toLowerCase()) : []
        let score = 0
        if (label === needle) score = 100
        else if (label.startsWith(needle)) score = 80
        else if (label.includes(needle)) score = 60
        else if (id.includes(needle)) score = 40
        else if (type === needle) score = 30
        else if (tags.includes(needle)) score = 20
        else if (tags.some((tag) => tag.includes(needle))) score = 10
        if (score > 0) scored.push({ node, score })
      }
      scored.sort((a, b) => b.score - a.score || String(a.node.label ?? '').localeCompare(String(b.node.label ?? '')))
      return scored.slice(0, limit).map((entry) => entry.node)
    }

    function graph3dFocusAngles(node) {
      const x = Number(node?.x ?? 0)
      const y = Number(node?.y ?? 0)
      const z = Number(node?.z ?? 0)
      const ring = Math.hypot(x, z)
      return { yaw: Math.atan2(x, z), pitch: Math.atan2(y, ring) }
    }

    const GraphView = React.memo(function GraphView(props) {
      const { graph, fetchedAt } = props
      const t = useT(props)
      const nodes = graph.nodes ?? []
      const edges = graph.edges ?? []
      const stats = graph.stats ?? {}
      const canvasRef = React.useRef(null)
      // 尊重系统的「减少动态效果」：默认不自动转，但仍可手动旋转。
      const reducedMotion = typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const stateRef = React.useRef({
        view: { yaw: 0.55, pitch: -0.2, zoom: 1 },
        selected: undefined,
        hovered: undefined,
        drag: undefined,
        spin: !reducedMotion,
      })
      const [selected, setSelected] = React.useState(undefined)
      const [spin, setSpin] = React.useState(!reducedMotion)
      // 用户拖过的节点位置：轮询刷新时保留，别把布局打回原形。
      const draggedRef = React.useRef(new Map())

      const model = React.useMemo(() => {
        const list = nodes.map((n) => ({
          id: n.id,
          label: n.label,
          type: n.type,
          color: n.color,
          degree: n.degree ?? 0,
          hub: n.hub === true,
          x: 0,
          y: 0,
          z: 0,
          baseR: 4.5 + Math.min(9, (n.degree ?? 0) * 0.6),
        }))
        const positions = graph3dSphere(list, GRAPH3D.radius)
        const byPos = new Map(positions.map((p) => [p.id, p]))
        for (const node of list) {
          const pos = byPos.get(node.id)
          node.x = pos.x
          node.y = pos.y
          node.z = pos.z
        }
        for (const [id, pos] of draggedRef.current) {
          const node = list.find((n) => n.id === id)
          if (node !== undefined) {
            node.x = pos.x
            node.y = pos.y
            node.z = pos.z
          }
        }
        const byId = new Map(list.map((n) => [n.id, n]))
        const adjacency = new Map(list.map((n) => [n.id, new Set()]))
        const edgeList = edges.filter((e) => byId.has(e.source) && byId.has(e.target))
        for (const edge of edgeList) {
          adjacency.get(edge.source).add(edge.target)
          adjacency.get(edge.target).add(edge.source)
        }
        return { nodes: list, byId, edges: edgeList, adjacency }
      }, [graph])
      const [query, setQuery] = React.useState('')
      const [notice, setNotice] = React.useState(undefined)
      const matches = React.useMemo(() => graph3dMatch(model.nodes, query), [model, query])

      /** 搜索命中：把目标节点转到屏幕正中并选中（邻居自动高亮）。 */
      const focusNode = (node) => {
        const angles = graph3dFocusAngles(node)
        stateRef.current.view.yaw = angles.yaw
        stateRef.current.view.pitch = angles.pitch
        stateRef.current.selected = node.id
        setSelected(node.id)
        setQuery('')
      }

      /** 让 host 解析节点的绝对路径并写进剪贴板（E 兜底的核心）。 */
      const copyPathToClipboard = async (id) => {
        try {
          const response = await fetch(`${GRAPH_PATH_URL}?id=${encodeURIComponent(id)}`)
          const body = await response.json().catch(() => ({}))
          if (!response.ok || typeof body.path !== 'string') throw new Error(body.error ?? `GET ${response.status}`)
          if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
          await navigator.clipboard.writeText(body.path)
          return true
        } catch {
          return false
        }
      }

      /** 「复制路径」按钮。 */
      const copyNodePath = async (id) => {
        setNotice((await copyPathToClipboard(id)) ? t('graphCopied') : t('graphCopyFailed'))
      }

      /** 「在 Finder 中显示」按钮 + 双击节点；失败时自动复制路径兜底。 */
      const revealNode = (id) => {
        fetch(GRAPH_REVEAL_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id }),
        })
          .then(async (response) => {
            const body = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(body.error ?? `POST ${response.status}`)
            return body
          })
          .then(() => setNotice(undefined))
          .catch(async (error) => {
            const message = error instanceof Error ? error.message : String(error)
            const copied = await copyPathToClipboard(id)
            setNotice(copied ? t('graphRevealFallback') : `${t('graphRevealFailed')}${message}`)
          })
      }

      /** 双击节点：优先在 DSH 右侧栏打开该 md 文件；不可用时回退系统文件管理器。 */
      const openInSidebar = async (id) => {
        const sidebar = sidebarRightService
        if (!sidebar || typeof sidebar.openResource !== 'function') return false
        const pathInfo = await fetch(`${GRAPH_PATH_URL}?id=${encodeURIComponent(id)}`)
          .then((response) => response.json())
          .catch(() => null)
        if (!pathInfo || pathInfo.ok !== true || typeof pathInfo.path !== 'string') return false
        const absolute = pathInfo.path.replace(/\\/g, '/')
        const session = await fetch(SESSION_URL)
          .then((response) => response.json())
          .catch(() => null)
        if (!session || session.ok !== true || typeof session.sessionId !== 'string') return false
        const root = typeof session.cwd === 'string' && session.cwd.length > 0
          ? session.cwd.replace(/\\/g, '/').replace(/\/+$/, '')
          : undefined
        const encodePath = (path) => path.split('/')
          .map((segment, index) => (index === 0 && /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
          .join('/')
        let address
        if (root !== undefined && (absolute === root || absolute.startsWith(`${root}/`))) {
          const relative = absolute.slice(root.length).replace(/^\/+/, '')
          address = `dsh-resource://file/session/${encodeURIComponent(session.sessionId)}/${encodePath(relative)}`
        } else {
          address = `dsh-resource://file/absolute/${encodePath(absolute.replace(/^\/+/, ''))}`
        }
        await sidebar.openResource(address)
        return true
      }
      const openNode = (id) => {
        openInSidebar(id)
          .then((opened) => { if (!opened) revealNode(id) })
          .catch(() => revealNode(id))
      }

      React.useEffect(() => { stateRef.current.selected = selected }, [selected])
      React.useEffect(() => { stateRef.current.spin = spin }, [spin])

      // 渲染循环：空闲时球体慢转；画布颜色每年主题切换一次即可。
      React.useEffect(() => {
        const canvas = canvasRef.current
        if (canvas === null || typeof canvas.getContext !== 'function') return undefined
        const ctx = canvas.getContext('2d')
        if (ctx === null) return undefined
        const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
        canvas.width = Math.floor(GRAPH3D.width * dpr)
        canvas.height = Math.floor(GRAPH3D.height * dpr)
        const theme = graphCanvasTheme(canvas)
        let raf = 0
        const render = () => {
          const state = stateRef.current
          if (state.spin && state.drag === undefined) state.view.yaw += 0.0028
          drawGraph3D(ctx, model, state, dpr, theme)
          raf = requestAnimationFrame(render)
        }
        raf = requestAnimationFrame(render)
        return () => { if (raf !== 0) cancelAnimationFrame(raf) }
      }, [model])

      // 交互：hover 即时高亮；点击用「位移 + 时长」双阈值判定（demo 的单阈值
      // 会让轻点变成拖拽，选中不生效）。
      React.useEffect(() => {
        const canvas = canvasRef.current
        if (canvas === null || typeof canvas.addEventListener !== 'function') return undefined
        const localPoint = (event) => {
          const rect = canvas.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) return { x: event.clientX, y: event.clientY }
          return {
            x: ((event.clientX - rect.left) / rect.width) * GRAPH3D.width,
            y: ((event.clientY - rect.top) / rect.height) * GRAPH3D.height,
          }
        }
        const projectedNow = () => model.nodes.map((node) => graph3dProject(node, stateRef.current.view))
        const radiusOf = (point) => {
          const node = model.byId.get(point.id)
          return Math.max(6, (node?.baseR ?? 6) * point.scale + 5)
        }
        const hoverAt = (point) => {
          const hit = graph3dHit(projectedNow(), point.x, point.y, radiusOf)
          stateRef.current.hovered = hit?.id ?? undefined
        }
        const onDown = (event) => {
          if (event.button !== undefined && event.button !== 0) return
          const point = localPoint(event)
          const hit = graph3dHit(projectedNow(), point.x, point.y, radiusOf)
          stateRef.current.drag = {
            kind: hit !== null ? 'node' : 'rotate',
            id: hit?.id,
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            lastX: point.x,
            lastY: point.y,
            startAt: Date.now(),
            moved: false,
          }
          try { canvas.setPointerCapture?.(event.pointerId) } catch { /* synthetic events have no capture */ }
        }
        const onMove = (event) => {
          const point = localPoint(event)
          const drag = stateRef.current.drag
          if (drag === undefined) {
            hoverAt(point)
            return
          }
          if (drag.pointerId !== undefined && event.pointerId !== drag.pointerId) return
          if (drag.kind === 'node') {
            const node = model.byId.get(drag.id)
            if (node === undefined) return
            const view = stateRef.current.view
            const projection = graph3dProject(node, view)
            const dx = (point.x - drag.lastX) / Math.max(0.05, projection.scale)
            const dy = (point.y - drag.lastY) / Math.max(0.05, projection.scale)
            const rotated = graph3dRotate(node, view.yaw, view.pitch)
            const world = graph3dUnrotate(
              { x: rotated.x + dx, y: rotated.y + dy, z: rotated.z },
              view.yaw,
              view.pitch,
            )
            node.x = world.x
            node.y = world.y
            node.z = world.z
            draggedRef.current.set(node.id, { x: node.x, y: node.y, z: node.z })
            drag.lastX = point.x
            drag.lastY = point.y
            drag.moved = true
          } else {
            const moved = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY)
            if (moved > 2) drag.moved = true
            if (drag.moved) {
              stateRef.current.view.yaw += (event.clientX - drag.startClientX) * 0.006
              stateRef.current.view.pitch = Math.max(
                -1.2,
                Math.min(1.2, stateRef.current.view.pitch - (event.clientY - drag.startClientY) * 0.006),
              )
              drag.startClientX = event.clientX
              drag.startClientY = event.clientY
            }
          }
          hoverAt(point)
        }
        const onUp = (event) => {
          const drag = stateRef.current.drag
          stateRef.current.drag = undefined
          if (drag === undefined) return
          const duration = Date.now() - drag.startAt
          const moved = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY)
          const isClick = !drag.moved && duration <= GRAPH3D.clickMs && moved <= GRAPH3D.clickSlop
          if (!isClick) return
          if (drag.kind === 'node') {
            const next = stateRef.current.selected === drag.id ? undefined : drag.id
            stateRef.current.selected = next
            setSelected(next)
          } else {
            stateRef.current.selected = undefined
            setSelected(undefined)
          }
        }
        const onWheel = (event) => {
          event.preventDefault()
          const factor = event.deltaY < 0 ? 1.08 : 0.92
          stateRef.current.view.zoom = Math.max(
            GRAPH3D.zoomMin,
            Math.min(GRAPH3D.zoomMax, stateRef.current.view.zoom * factor),
          )
        }
        const onDouble = (event) => {
          const point = localPoint(event)
          const hit = graph3dHit(projectedNow(), point.x, point.y, radiusOf)
          if (hit !== null) {
            stateRef.current.selected = hit.id
            setSelected(hit.id)
            openNode(hit.id)
            return
          }
          stateRef.current.view = { yaw: 0.55, pitch: -0.2, zoom: 1 }
          stateRef.current.selected = undefined
          setSelected(undefined)
        }
        const onLeave = () => {
          stateRef.current.hovered = undefined
          stateRef.current.drag = undefined
        }
        canvas.addEventListener('pointerdown', onDown)
        canvas.addEventListener('pointermove', onMove)
        canvas.addEventListener('pointerup', onUp)
        canvas.addEventListener('pointercancel', onUp)
        canvas.addEventListener('pointerleave', onLeave)
        canvas.addEventListener('wheel', onWheel, { passive: false })
        canvas.addEventListener('dblclick', onDouble)
        return () => {
          canvas.removeEventListener('pointerdown', onDown)
          canvas.removeEventListener('pointermove', onMove)
          canvas.removeEventListener('pointerup', onUp)
          canvas.removeEventListener('pointercancel', onUp)
          canvas.removeEventListener('pointerleave', onLeave)
          canvas.removeEventListener('wheel', onWheel)
          canvas.removeEventListener('dblclick', onDouble)
        }
      }, [model])

      if (nodes.length === 0) return null

      const byId = model.byId
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
      const selectedNode = selected !== undefined ? byId.get(selected) : undefined
      const selectedNeighbours = selected !== undefined ? (model.adjacency.get(selected)?.size ?? 0) : 0
      const smallButtonStyle = {
        fontSize: '11px',
        padding: '2px 8px',
        borderRadius: '6px',
        cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #999)',
      }

      return React.createElement('div', { style: cardStyle },
        React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' } },
          React.createElement('div', { style: cardTitleStyle }, t('graphTitle')),
          React.createElement('div', { style: { display: 'flex', gap: '6px' } },
            React.createElement('button', {
              type: 'button',
              onClick: () => setSpin((value) => !value),
              style: smallButtonStyle,
            }, `${t('graph3dSpin')}${spin ? ' ✓' : ''}`),
            React.createElement('button', {
              type: 'button',
              onClick: () => {
                stateRef.current.view = { yaw: 0.55, pitch: -0.2, zoom: 1 }
                stateRef.current.selected = undefined
                setSelected(undefined)
              },
              style: smallButtonStyle,
            }, t('graphResetView')),
          ),
        ),
        React.createElement('div', { style: cardSubStyle },
          fill(t('graphStats'), { pages: stats.pages ?? nodes.length, links: stats.links ?? 0, tagEdges: stats.tagEdges ?? 0 })
          + (stats.indexLinks ? ` · ${fill(t('graphIndexRoutes'), { count: stats.indexLinks })}` : '')
          + (isolated.length > 0 ? ` · ${fill(t('graphIsolated'), { count: isolated.length })}` : '')
          + (fetchedAt instanceof Date ? ` · ${fill(t('graphUpdatedAt'), { time: fetchedAt.toLocaleTimeString() })}` : ''),
        ),
        React.createElement('div', { style: { position: 'relative', marginBottom: '8px' } },
          React.createElement('input', {
            type: 'search',
            value: query,
            placeholder: t('graphSearchPlaceholder'),
            'aria-label': t('graphSearchPlaceholder'),
            onChange: (event) => setQuery(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && matches.length > 0) {
                event.preventDefault?.()
                focusNode(matches[0])
              }
              if (event.key === 'Escape') setQuery('')
            },
            style: { ...inputStyle, width: '100%', boxSizing: 'border-box' },
          }),
          query.trim().length > 0 && matches.length === 0
            ? React.createElement('div', { role: 'status', style: { marginTop: '4px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #888)' } }, t('graphSearchNone'))
            : null,
          query.trim().length > 0 && matches.length > 0
            ? React.createElement('div', {
              style: {
                position: 'absolute',
                zIndex: 20,
                left: 0,
                right: 0,
                top: '100%',
                marginTop: '2px',
                maxHeight: '190px',
                overflowY: 'auto',
                borderRadius: '8px',
                border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))',
                background: 'var(--dsw-alias-bg-layer-2, #1b1e24)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
              },
            }, ...matches.map((node) => React.createElement('button', {
              key: node.id,
              type: 'button',
              onClick: () => focusNode(node),
              style: {
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '7px 10px',
                border: 'none',
                background: 'transparent',
                color: 'var(--dsw-alias-label-primary, #e8ecf7)',
                fontSize: '12px',
                cursor: 'pointer',
              },
            }, `${node.label} · ${typeLabel(node.type, t)}`)))
            : null,
        ),
        React.createElement('canvas', {
          ref: canvasRef,
          'aria-label': t('graphTitle'),
          role: 'img',
          style: {
            display: 'block',
            width: '100%',
            height: 'auto',
            aspectRatio: `${GRAPH3D.width} / ${GRAPH3D.height}`,
            borderRadius: '8px',
            touchAction: 'none',
            cursor: 'grab',
          },
        }),
        React.createElement('div', { style: { marginTop: '8px', fontSize: '11px', lineHeight: '17px', color: 'var(--dsw-alias-label-secondary, #888)' } },
          t('graph3dHint'),
        ),
        selectedNode !== undefined
          ? React.createElement('div', {
            role: 'status',
            style: {
              marginTop: '6px',
              padding: '6px 8px',
              borderRadius: '6px',
              background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12))',
              fontSize: '11px',
              lineHeight: '17px',
            },
          },
            React.createElement('b', null, selectedNode.label),
            ` · ${typeLabel(selectedNode.type, t)} · degree ${selectedNode.degree} · `,
            fill(t('graph3dNeighbours'), { count: selectedNeighbours }),
            React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary, #888)' } }, selectedNode.id),
            React.createElement('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } },
              React.createElement('button', {
                type: 'button',
                onClick: () => revealNode(selectedNode.id),
                style: smallButtonStyle,
              }, t('graphRevealButton')),
              React.createElement('button', {
                type: 'button',
                onClick: () => copyNodePath(selectedNode.id),
                style: smallButtonStyle,
              }, t('graphCopyPath')),
            ),
          )
          : null,
        notice !== undefined
          ? React.createElement('div', { role: 'alert', style: { marginTop: '8px', fontSize: '11px', color: 'var(--dsw-alias-state-error-primary, #e5484d)' } }, notice)
          : null,
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
    // Right-sidebar navigation service (0.18.0, DSH ≥ 0.2.2); undefined on older hosts.
    let sidebarRightService
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
      `[${NAV_ICON_ATTR}] svg { display: none; }`,
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
      // Right-sidebar navigation (double-click a graph node opens the file in
      // the sidebar). Optional service: older hosts just fall back to reveal.
      try {
        sidebarRightService = ctx.get?.('sidebarRight') ?? ctx.sidebarRight ?? undefined
      } catch {
        sidebarRightService = undefined
      }
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
      // 会话内开关（composer 工具行左侧 chip）。旧宿主可能不声明该 slot：
      // 注册失败只影响 chip，/memory 命令与设置面板入口仍然可用。
      try {
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'memory-session-toggle',
          order: 100,
          locale: LOCALE_NS,
        }, MemoryChip))
      } catch {
        // no composer slot on this host
      }
      // 官方 settings.section 没有 icon 字段，侧栏标记只能靠自己认领；
      // 认领键就是当前语言的 label（语言切换后 MutationObserver 会重新对齐）。
      ctx.effect(() => claimNavIcon(labelOf), 'memory: settings nav icon')
      // Inline styles cannot express :hover; the chip should light up like the
      // composer's other toolbar buttons on pointer-over.
      ctx.effect(() => {
        if (typeof document === 'undefined') return undefined
        const tag = document.createElement('style')
        tag.textContent = '[data-dsh-memory-chip-btn]:hover { background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12)); } [data-dsh-memory-chip-btn]:disabled { cursor: not-allowed; }'
        document.head.appendChild(tag)
        return () => tag.remove()
      }, 'memory: chip styles')
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    // Test seam: the browser half cannot be imported by Node, so the pure
    // helpers and the component itself are exposed for a vm-based harness.
    // Underscore-prefixed and additive: the host only reads `apply`/`inject`.
    exports.__test = {
      MemorySection,
      MemoryForm,
      SessionControls,
      MemoryChip,
      SoulCard,
      SOUL_URL,
      SESSION_URL,
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
      GRAPH3D,
      graph3dSphere,
      graph3dRotate,
      graph3dUnrotate,
      graph3dProject,
      graph3dHit,
      graph3dMatch,
      graph3dFocusAngles,
      GRAPH_REVEAL_URL,
      GRAPH_PATH_URL,
      isLightColor,
    }
    return module.exports
  },
})
