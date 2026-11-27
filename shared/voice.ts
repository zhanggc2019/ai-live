export type TtsProviderId = 'mimo' | 'lanyun' | 'qwen' | 'openai-compatible'

export type TtsLanguage = 'ZH' | 'EN' | 'JA' | 'ES' | 'AR'
export const LANYUN_EMOTION_DEFAULTS = {
  natural: { reminder: 0.1, question: 0.14, welcome: 0.22, emphasis: 0.28 },
  expressive: { reminder: 0.18, question: 0.24, welcome: 0.36, emphasis: 0.46 },
} as const

type LanyunAdaptiveEmotionMode = keyof typeof LANYUN_EMOTION_DEFAULTS
export type LanyunEmotionMode = 'original' | 'voice' | LanyunAdaptiveEmotionMode
export type LanyunEmotionKind = keyof typeof LANYUN_EMOTION_DEFAULTS.natural
export type LanyunEmotionStrengths = Partial<Record<LanyunEmotionKind, number>>

const LANYUN_SENTENCE_TONES: [LanyunEmotionKind, RegExp][] = [
  [
    'reminder',
    /^(?:提醒一下|注意一下|注意[，,：:]|这里(?:要)?注意|这一点要注意|务必|千万别|别忘了|不用担心|别着急)/,
  ],
  ['question', /[？?][！!？?”’」』"']*$/],
  ['emphasis', /^(?:重点是|关键是|最要紧的是|尤其要看|特别要留意|真正有用的是)/],
  ['welcome', /^(?:欢迎|刚进来|大家好|朋友们好|谢谢|感谢|嗨[，,]|哈喽)/],
]

export interface TtsSettings {
  provider: TtsProviderId
  baseURL: string
  model: string
  voice: string
  instructions: string
  userId?: string
  voiceIdType?: 'voice_id' | 'external_voice_id'
  language?: TtsLanguage
  speechRate?: number
  intervalSilence?: number
  lanyunEmotionMode?: LanyunEmotionMode
  lanyunEmotionStrengths?: Partial<Record<LanyunAdaptiveEmotionMode, LanyunEmotionStrengths>>
}

/** 新配置默认沿用原音色，旧配置有情感描述时延续手动模式。 */
export function resolveLanyunEmotionMode(
  settings: Pick<TtsSettings, 'instructions' | 'lanyunEmotionMode'>,
): LanyunEmotionMode {
  return settings.lanyunEmotionMode ?? (settings.instructions.trim() ? 'voice' : 'original')
}

/** 播放分段和 TTS 请求共用句型判断，保留需要单独表达的句子。 */
export function classifyLanyunEmotion(text: string): LanyunEmotionKind | undefined {
  const sentence = text
    .trim()
    .replace(/^(?:不过|还有|另外|对了|所以)[，,]/, '')
    .trimStart()
  return LANYUN_SENTENCE_TONES.find(([, pattern]) => pattern.test(sentence))?.[0]
}

export interface TtsVoice {
  id: string
  name: string
  isPrivate: boolean
}

export interface VoiceListRequest {
  requestId: string
  settings: TtsSettings
}

export interface CloneVoiceRequest {
  requestId: string
  name: string
  fileName: string
  audio: Uint8Array
  settings: TtsSettings
}

export interface SpeechAudio {
  base64: string
  mimeType: 'audio/wav' | 'audio/mpeg'
}

export interface SynthesisRequest {
  requestId: string
  text: string
  settings: TtsSettings
}

export const TTS_PRESETS: Record<TtsProviderId, TtsSettings> = {
  mimo: {
    provider: 'mimo',
    baseURL: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2.5-tts',
    voice: 'mimo_default',
    instructions: '用自然、亲切的中文直播讲解语气朗读，语速适中。',
  },
  lanyun: {
    provider: 'lanyun',
    baseURL: 'https://tts.lanyun.net',
    model: 'IndexTTS-2.5',
    voice: '',
    instructions: '',
    userId: '',
    voiceIdType: 'voice_id',
    language: 'ZH',
    speechRate: 1,
    intervalSilence: 120,
  },
  qwen: {
    provider: 'qwen',
    baseURL: '',
    model: 'qwen-audio-3.1-tts-flash',
    voice: 'longanhuan_v3.1',
    instructions: '用自然、亲切的中文直播讲解语气朗读，语速适中。',
  },
  'openai-compatible': {
    provider: 'openai-compatible',
    baseURL: '',
    model: '',
    voice: '',
    instructions: '',
  },
}

// 四种音色均支持北京和新加坡地域；其他音色可直接填写官方 Voice ID。
export const QWEN_VOICES = [
  { id: 'longanhuan_v3.1', name: '龙安欢 · 女声' },
  { id: 'longanlingxin_v3.1', name: '龙安灵心 · 女声' },
  { id: 'longanfengyue_v3.1', name: '龙安风悦 · 女声' },
  { id: 'xunanchuan_v3.1', name: '许南川 · 男声' },
]

export const MIMO_VOICES = [
  'mimo_default',
  '冰糖',
  '茉莉',
  '苏打',
  '白桦',
  'Mia',
  'Chloe',
  'Milo',
  'Dean',
]

/** 按中英文句末及换行切句；保留小数、标点和引号，限制单次合成长度。 */
export function splitSpeechText(text: string, maxLength = 220): string[] {
  const limit = Math.max(10, Math.floor(maxLength))
  const sentences =
    text
      .replace(/\r\n?/g, '\n')
      .match(/[^。！？!?；;\n]+[。！？!?；;]*[”’」』"]*|[。！？!?；;]+/gu) ?? []
  const result: string[] = []
  for (const sentence of sentences) {
    // 英文句号仅在空白或结尾前分句，避免拆开价格、域名及版本号。
    for (const part of sentence.split(/(?<=\.)\s+(?=[A-Z\u4e00-\u9fff])/u)) {
      const chars = Array.from(part.trim())
      for (let offset = 0; offset < chars.length; offset += limit) {
        const chunk = chars
          .slice(offset, offset + limit)
          .join('')
          .trim()
        if (chunk && /[\p{L}\p{N}]/u.test(chunk)) result.push(chunk)
      }
    }
  }
  return result
}
