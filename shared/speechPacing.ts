import {
  classifyLanyunEmotion,
  resolveLanyunEmotionMode,
  splitSpeechText,
  type TtsProviderId,
  type TtsSettings,
} from './voice'

export interface SpeechPacingSettings {
  enabled: boolean
  minRate: number
  maxRate: number
  style: 'natural' | 'calm' | 'energetic'
  requirements: string
}

export interface SpeechPacingPlan {
  rate: number
  reason: string
}

export const DEFAULT_SPEECH_PACING: SpeechPacingSettings = {
  enabled: true,
  minRate: 0.85,
  maxRate: 1.15,
  style: 'natural',
  requirements: '',
}

/** 限制持久化倍率的范围，兼容旧配置或非法数值。 */
function safeRate(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(2, Math.max(0.5, value)) * 100) / 100
    : fallback
}

/** 按厂商补齐节奏设置，并保证上下限有序。 */
export function normalizeSpeechPacing(
  stored?: Partial<SpeechPacingSettings> | null,
  provider?: TtsProviderId,
): SpeechPacingSettings {
  const min = safeRate(
    stored?.minRate,
    provider === 'lanyun' ? 0.93 : DEFAULT_SPEECH_PACING.minRate,
  )
  const max = safeRate(
    stored?.maxRate,
    provider === 'lanyun' ? 1.07 : DEFAULT_SPEECH_PACING.maxRate,
  )
  return {
    enabled: typeof stored?.enabled === 'boolean' ? stored.enabled : true,
    minRate: Math.min(min, max),
    maxRate: Math.max(min, max),
    style: stored?.style === 'calm' || stored?.style === 'energetic' ? stored.style : 'natural',
    requirements:
      typeof stored?.requirements === 'string' ? stored.requirements.slice(0, 1000) : '',
  }
}

/** 从常见中文节奏要求提取整体倾向，先处理否定表达，避免“不要太快”被当作加速。 */
function requirementsBias(requirements: string): number {
  const normalized = requirements
    .replace(/(?:不要|别|避免|不能)(?:太|过)?快/g, '舒缓')
    .replace(/(?:不要|别|避免|不能)(?:太|过)?慢/g, '轻快')
  const slow = /舒缓|慢一点|稍慢|放慢|慢速|缓慢|沉稳|轻柔|安静|自习室|助眠|睡前/.test(normalized)
  const fast = /轻快|快一点|稍快|加快|快节奏|活泼|活力|热情|欢快|节奏明快/.test(normalized)
  return (Number(fast) - Number(slow)) * 0.2
}

/** 提取与配置无关的内容倾向，保持分段和调速对同一句话的判断一致。 */
function contentPacing(text: string): { score: number; reason: string } {
  if (
    /注意|请留意|提醒|务必|切勿|禁止|不适合|不建议|不包含|除外|以.{0,12}为准|使用条件|适用范围/.test(
      text,
    )
  ) {
    return { score: -0.85, reason: '注意事项，放慢讲清' }
  }
  // “平一点”“快一点”等程度补语常见于口语。保留“一点半”“一点钟”等明确时间。
  const numericText = text.replace(
    /(?<=[大小高低宽窄远近快慢轻重深浅长短薄厚软硬松紧平稳暖凉冷热亮暗早晚多少顺些])一点(?!半|钟|[零〇一二两三四五六七八九十]+分)/gu,
    '',
  )
  if (
    /\d|[零〇一二两三四五六七八九十百千万亿半]+(?:元|块|折|毫升|升|克|斤|公斤|厘米|毫米|米|度|小时|分钟|个月|天|年|点)|百分之|价格|费用|收费|退款|有效期/.test(
      numericText,
    )
  ) {
    return { score: -0.7, reason: '数字与交易信息，放慢讲清' }
  }
  if (/参数|规格|尺寸|材质|容量|步骤|首先|其次|最后|分别/.test(text)) {
    return { score: -0.4, reason: '参数与步骤，稳步讲解' }
  }
  if (/别着急|不用担心|不必担心|放心|慢慢来|放松|陪伴/.test(text)) {
    return { score: -0.35, reason: '安抚与陪伴，舒缓表达' }
  }
  if (/欢迎|大家好|朋友们好|感谢|谢谢|一起来|一起看看|聊一聊|聊聊|告诉我|评论区|留言/.test(text)) {
    return { score: 0.5, reason: '欢迎与互动，稍快表达' }
  }
  if (/[?？]/.test(text)) return { score: 0.2, reason: '提问互动，轻快表达' }
  return { score: 0, reason: '自然讲解' }
}

/** 蓝云同一次合成可读出相邻短句的承接，限制长度给评论插播留出机会。 */
export function splitSpeechForSynthesis(text: string, provider: TtsSettings): string[] {
  if (provider.provider !== 'lanyun') return splitSpeechText(text)
  const mode = resolveLanyunEmotionMode(provider)
  const adaptiveEmotion = mode === 'natural' || mode === 'expressive'
  const segments: string[] = []
  for (const line of text.split(/\r\n?|\n/u)) {
    const sentences = splitSpeechText(line)
    for (let index = 0; index < sentences.length; index++) {
      const current = sentences[index]
      const next = sentences[index + 1]
      if (
        !next ||
        !/[。！？.!?][”’」』"']*$/u.test(current) ||
        /^(?:换个(?:话题|角度|场景)|咱们换|接下来(?:聊|说|看)|再来(?:说说|聊聊)|说回)/u.test(
          next,
        ) ||
        (adaptiveEmotion && (classifyLanyunEmotion(current) || classifyLanyunEmotion(next)))
      ) {
        segments.push(current)
        continue
      }
      const currentScore = contentPacing(current).score
      const nextScore = contentPacing(next).score
      const separator = /[。！？][”’」』"']*$/u.test(current) ? '' : ' '
      const combined = current + separator + next
      // 数字和注意事项各留出停顿，节奏倾向差异明显的短句也分别朗读。
      if (
        Math.min(currentScore, nextScore) > -0.7 &&
        Math.abs(currentScore - nextScore) < 0.4 &&
        Array.from(combined).length <= 48
      ) {
        segments.push(combined)
        index++
      } else segments.push(current)
    }
  }
  return segments
}

/** 按内容与直播间要求确定每段倍率；相同文本和配置可稳定复用缓存。 */
export function planSpeechPacing(
  text: string,
  settings: SpeechPacingSettings,
  fallbackRequirements = '',
): SpeechPacingPlan {
  const config = normalizeSpeechPacing(settings)
  let { score, reason } = contentPacing(text)
  if (Array.from(text).length > 70 || (text.match(/[，,、；;]/g)?.length ?? 0) >= 3) {
    score -= 0.15
    reason += '；长句稍慢'
  }
  const styleBias = config.style === 'calm' ? -0.25 : config.style === 'energetic' ? 0.25 : 0
  const requestBias = requirementsBias(config.requirements.trim() || fallbackRequirements)
  score = Math.max(-1, Math.min(1, score + styleBias + requestBias))
  if (styleBias || requestBias) reason += '；结合直播间节奏'
  const center = (config.minRate + config.maxRate) / 2
  const rate = safeRate(center + ((config.maxRate - config.minRate) / 2) * score, center)
  return { rate: Math.min(config.maxRate, Math.max(config.minRate, rate)), reason }
}

/** 为每段选择唯一的调速位置：蓝云使用原生合成倍率，其他厂商使用保音高播放。 */
export function prepareSpeechPacing(
  text: string,
  provider: TtsSettings,
  settings: SpeechPacingSettings,
  fallbackRequirements = '',
): SpeechPacingPlan & { synthesisSettings: TtsSettings; playbackRate: number } {
  const config = normalizeSpeechPacing(settings)
  const nativeRate = provider.provider === 'lanyun'
  const plan = config.enabled
    ? planSpeechPacing(text, config, fallbackRequirements)
    : { rate: nativeRate ? safeRate(provider.speechRate, 1) : 1, reason: '固定语速' }
  return {
    ...plan,
    synthesisSettings: nativeRate ? { ...provider, speechRate: plan.rate } : { ...provider },
    playbackRate: nativeRate ? 1 : plan.rate,
  }
}
