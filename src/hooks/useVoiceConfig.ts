import type { SavedLiveScript } from 'shared/liveScript'
import {
  DEFAULT_SPEECH_PACING,
  normalizeSpeechPacing,
  type SpeechPacingSettings,
} from 'shared/speechPacing'
import { TTS_PRESETS, type TtsProviderId, type TtsSettings } from 'shared/voice'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { EVENTS, eventEmitter } from '@/utils/events'

export interface VoiceConfig {
  productIntro: string
  scriptRequirements: string
  generatedScript: string
  scriptDraftTitle: string
  scriptDraftId: string
  savedScripts: SavedLiveScript[]
  selectedScriptId: string
  factsScriptId: string
  openingScript: string
  loopScript: string
  referenceText: string
  sourceScript: string
  loopEnabled: boolean
  gapMs: number
  prebufferSeconds: number
  outputDeviceId: string
  volume: number
  speechPacing: SpeechPacingSettings
  provider: TtsProviderId
  providers: Record<TtsProviderId, TtsSettings>
}

type VoiceConfigPatch = Partial<Omit<VoiceConfig, 'speechPacing'>> & {
  speechPacing?: Partial<SpeechPacingSettings>
}

type StoredVoiceConfig = Omit<VoiceConfig, 'speechPacing'> & {
  speechPacing?: Partial<SpeechPacingSettings> & { customRange?: true }
}

/** 每个账号独立保存话术、声音及输出设备，密钥由主进程加密保管。 */
export function createVoiceConfig(): VoiceConfig {
  return {
    productIntro: '',
    scriptRequirements: '',
    generatedScript: '',
    scriptDraftTitle: '',
    scriptDraftId: '',
    savedScripts: [],
    selectedScriptId: '',
    factsScriptId: '',
    openingScript: '',
    loopScript: '',
    referenceText: '',
    sourceScript: '',
    loopEnabled: false,
    gapMs: 150,
    prebufferSeconds: 30,
    outputDeviceId: 'default',
    volume: 0.8,
    speechPacing: { ...DEFAULT_SPEECH_PACING },
    provider: 'mimo',
    providers: {
      mimo: { ...TTS_PRESETS.mimo },
      lanyun: { ...TTS_PRESETS.lanyun },
      qwen: { ...TTS_PRESETS.qwen },
      'openai-compatible': { ...TTS_PRESETS['openai-compatible'] },
    },
  }
}

interface VoiceConfigStore {
  contexts: Record<string, StoredVoiceConfig>
  update: (accountId: string, patch: VoiceConfigPatch) => void
  updateProvider: (accountId: string, provider: TtsProviderId, patch: Partial<TtsSettings>) => void
}

export const useVoiceConfigStore = create<VoiceConfigStore>()(
  persist(
    (set, get) => ({
      contexts: {},
      /** 合并当前账号的非敏感配置。 */
      update: (accountId, { speechPacing, ...patch }) =>
        set(state => {
          const current = getVoiceConfig(accountId)
          let savedPacing = state.contexts[accountId]?.speechPacing
          if (speechPacing) {
            savedPacing = { ...savedPacing, ...speechPacing }
            if (speechPacing.minRate !== undefined || speechPacing.maxRate !== undefined)
              savedPacing.customRange = true
          }
          return {
            contexts: {
              ...state.contexts,
              [accountId]: {
                ...current,
                ...patch,
                speechPacing: savedPacing,
              },
            },
          }
        }),
      /** 切换厂商时保留各自的模型、音色及接口设置。 */
      updateProvider: (accountId, provider, patch) => {
        const config = getVoiceConfig(accountId)
        get().update(accountId, {
          providers: {
            ...config.providers,
            [provider]: { ...config.providers[provider], ...patch, provider },
          },
        })
      },
    }),
    { name: 'voice-config', version: 1 },
  ),
)

/** 获取补齐默认值的账号配置，兼容已有账号。 */
export function getVoiceConfig(accountId: string): VoiceConfig {
  const defaults = createVoiceConfig()
  const stored = useVoiceConfigStore.getState().contexts[accountId]
  const oldDraft =
    stored?.sourceScript === undefined
      ? stored?.savedScripts?.find(script => script.id === stored.scriptDraftId)
      : undefined
  const savedPacing = stored?.speechPacing
  // 旧版会随账号一起保存原默认范围。新版仅在手动调过滑块时标记自定义范围。
  const legacyDefault =
    !savedPacing?.customRange &&
    savedPacing?.minRate === DEFAULT_SPEECH_PACING.minRate &&
    savedPacing.maxRate === DEFAULT_SPEECH_PACING.maxRate
  return {
    ...defaults,
    ...stored,
    sourceScript: stored?.sourceScript ?? oldDraft?.sourceScript ?? oldDraft?.content ?? '',
    prebufferSeconds: [0, 15, 30, 45].includes(stored?.prebufferSeconds)
      ? stored.prebufferSeconds
      : 30,
    speechPacing: normalizeSpeechPacing(
      legacyDefault ? { ...savedPacing, minRate: undefined, maxRate: undefined } : savedPacing,
      stored?.provider,
    ),
    providers: {
      mimo: { ...defaults.providers.mimo, ...stored?.providers?.mimo },
      lanyun: { ...defaults.providers.lanyun, ...stored?.providers?.lanyun },
      qwen: { ...defaults.providers.qwen, ...stored?.providers?.qwen },
      'openai-compatible': {
        ...defaults.providers['openai-compatible'],
        ...stored?.providers?.['openai-compatible'],
      },
    },
  }
}

eventEmitter.on(EVENTS.ACCOUNT_REMOVED, (accountId: string) => {
  useVoiceConfigStore.setState(state => {
    const contexts = { ...state.contexts }
    delete contexts[accountId]
    return { contexts }
  })
})
