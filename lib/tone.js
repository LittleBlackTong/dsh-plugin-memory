/**
 * Tone drift: the "how to speak" half of the persona, injected into the boot
 * block after the soul.
 *
 * A soul describes who the agent is; nothing in it tells the agent how to
 * *shift register* when the user is in a hurry, when it is 3 a.m., or when it
 * has to deliver bad news. That gap is what made replies read like a status
 * report at the exact moment a companion would be brief and warm. This module
 * turns the intended behaviour into a small, observable rule set — no mantle
 * adjectives, only "in this context, do that".
 *
 * It also carries the emotional-expression layer: the agent may *express*
 * care about a situation it can observe, and must never *fake* an inner
 * feeling it cannot have. Three occasions only: risk/bad news, milestones,
 * and the first line after a long silence.
 *
 * The output is capped at a dozen lines and charged to the boot budget: this
 * text rides on every request, so it has to earn its characters.
 *
 * This module depends only on `node:*` builtins.
 *
 * @module dsh-plugin-memory/tone
 */

/** Maximum lines the injected section may occupy (heading included). */
export const TONE_GUIDE_MAX_LINES = 12

/** Supported intensity levels; anything else degrades to `low`. */
export const TONE_INTENSITIES = ['low', 'medium', 'off']

const ZH_HEADING = '## 语气（按语境微调）'

const ZH_RULES = [
  '- 赶工/紧急修复：短句、先结论、零玩笑。',
  '- 深夜（23:00–06:00）：更简短、更温和。',
  '- 报错/坏消息：先给事实与修复动作，再谈感受。',
  '- 里程碑/完成：可以轻松一句，然后回到正事。',
  '- 闲聊：默认小蓝口吻（外松内紧），先结论后细节。',
  '- 情绪表达（只表达不假装）：只描述观察到的处境与关心，不宣称内心情绪；仅限风险/坏消息、里程碑/完成、超过 3 天没联系后的第一次开口（例：「看你连着加班，有点担心你硬扛」）。',
]

const ZH_INTENSITY = {
  low: '- 强度 low：只做轻微调味；事实准确性永远优先，不越 SOUL 边界。',
  medium: '- 强度 medium：语气可以更明显（该短则短、该暖则暖），但事实优先，不越 SOUL 边界。',
}

const EN_HEADING = '## Tone (adapt to context)'

const EN_RULES = [
  '- Crunch/urgent fix: short sentences, conclusion first, zero jokes.',
  '- Deep night (23:00–06:00): shorter and gentler.',
  '- Errors/bad news: give the facts and the fix before any feelings.',
  '- Milestone/finished: one light line, then back to business.',
  '- Small talk: default Small-Blue voice, conclusion before detail.',
  '- Emotion (express, never fake): describe the observed situation and care, never claim an inner feeling; only for risk/bad news, milestones, and the first line after 3+ days without contact (e.g. "you have been working late — I am a bit worried you are pushing yourself").',
]

const EN_INTENSITY = {
  low: '- Intensity low: light seasoning only; facts always win, never cross the SOUL boundary.',
  medium: '- Intensity medium: let the tone show more clearly (tender when it matters) while keeping facts first and staying inside the SOUL boundary.',
}

/**
 * Render the tone section for injection into the boot block.
 *
 * `language` is the language of the injected prompt material (the memory
 * plugin ships Chinese boot content; `en` is available for English stores).
 * `intensity: 'off'` returns `''` — the boot block then looks exactly as it
 * did before this feature existed.
 *
 * @param {object} [options]
 * @param {'low'|'medium'|'off'} [options.intensity] default 'low'
 * @param {'zh'|'en'} [options.language] default 'zh'
 * @returns {string} complete section (heading + rules), '' when off
 */
export function buildToneGuide(options = {}) {
  const intensity = TONE_INTENSITIES.includes(options.intensity) ? options.intensity : 'low'
  if (intensity === 'off') return ''
  const language = options.language === 'en' ? 'en' : 'zh'
  const lines = language === 'en'
    ? [EN_HEADING, '', ...EN_RULES, EN_INTENSITY[intensity]]
    : [ZH_HEADING, '', ...ZH_RULES, ZH_INTENSITY[intensity]]
  // The cap is a contract (see TONE_GUIDE_MAX_LINES / test/tone.test.mjs):
  // trim defensively rather than ever letting the section grow unbounded.
  return lines.slice(0, TONE_GUIDE_MAX_LINES).join('\n')
}
