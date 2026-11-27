import { useEffect, useRef, useState } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import {
  LANYUN_EMOTION_DEFAULTS,
  type LanyunEmotionKind,
  type LanyunEmotionMode,
  type LanyunEmotionStrengths,
  resolveLanyunEmotionMode,
  type TtsLanguage,
  type TtsSettings,
  type TtsVoice,
} from 'shared/voice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'

const LANYUN_STRENGTH_FIELDS = [
  ['reminder', '提醒强度'],
  ['question', '提问强度'],
  ['welcome', '欢迎强度'],
  ['emphasis', '强调强度'],
] as const

interface EditProps {
  settings: TtsSettings
  onChange: (patch: Partial<TtsSettings>) => void
}

interface VoicePickerProps extends EditProps {
  hasKey: boolean
  keyRevision: number
}

/** 选择蓝云音色；更换应用密钥或用户身份时清理过期目录。 */
export function LanyunVoicePicker({ settings, hasKey, keyRevision, onChange }: VoicePickerProps) {
  const identity = JSON.stringify([settings.baseURL, settings.userId, keyRevision, hasKey])
  const [catalog, setCatalog] = useState<{ identity: string; voices: TtsVoice[]; loaded: boolean }>(
    { identity, voices: [], loaded: false },
  )
  const { voices, loaded } = catalog.identity === identity ? catalog : { voices: [], loaded: false }
  const [loading, setLoading] = useState(false)
  const requestRef = useRef<string | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    // 目录的可见范围由地址、应用密钥和用户身份共同决定。
    setCatalog({ identity, voices: [], loaded: false })
    setLoading(false)
    return () => {
      const id = requestRef.current
      requestRef.current = null
      if (id) window.ipcRenderer.invoke(IPC_CHANNELS.tts.cancel, id).catch(() => {})
    }
  }, [identity])

  /** 读取公开及当前用户可见的私人音色，忽略已取消或已切换身份的结果。 */
  async function loadVoices() {
    const requestId = crypto.randomUUID()
    requestRef.current = requestId
    setLoading(true)
    try {
      const items = await window.ipcRenderer.invoke(IPC_CHANNELS.tts.listVoices, {
        requestId,
        settings,
      })
      if (requestRef.current !== requestId) return
      setCatalog({ identity, voices: items, loaded: true })
      toast.success(items.length ? `已获取 ${items.length} 个音色` : '当前应用和用户暂无可用音色')
    } catch (error) {
      if (requestRef.current === requestId)
        toast.error(error instanceof Error ? error.message : '音色列表获取失败')
    } finally {
      if (requestRef.current === requestId) {
        requestRef.current = null
        setLoading(false)
      }
    }
  }

  return (
    <div className="grid gap-2">
      {settings.voiceIdType !== 'external_voice_id' && (
        <div className="space-y-2">
          <Label htmlFor="lanyun-voices">可用音色</Label>
          <div className="flex flex-wrap gap-2">
            <Select
              disabled={!voices.length || loading}
              value={voices.some(voice => voice.id === settings.voice) ? settings.voice : ''}
              onValueChange={value => onChange({ voice: value })}
            >
              <SelectTrigger id="lanyun-voices" className="min-w-40 flex-1">
                <SelectValue placeholder={loaded ? '请选择音色' : '获取音色后选择'} />
              </SelectTrigger>
              <SelectContent>
                {voices.map(voice => (
                  <SelectItem key={voice.id} value={voice.id}>
                    {voice.name}
                    {voice.isPrivate ? ' · 私人' : ''} · {voice.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" disabled={!hasKey || loading} onClick={loadVoices}>
              {loading ? '获取中…' : '获取音色'}
            </Button>
          </div>
          {loaded && !voices.length && (
            <p className="text-xs text-muted-foreground">暂无可用音色，请检查应用权限和用户 ID。</p>
          )}
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="tts-voice">音色 ID</Label>
        <Input
          id="tts-voice"
          value={settings.voice}
          maxLength={settings.voiceIdType === 'external_voice_id' ? 128 : 64}
          placeholder={
            settings.voiceIdType === 'external_voice_id'
              ? '填写 external_voice_id'
              : '从目录选择，或直接填写 voice_id'
          }
          onChange={event => onChange({ voice: event.target.value })}
        />
      </div>
    </div>
  )
}

/** 管理蓝云私人音色的身份及 ID 类型。 */
export function LanyunConnectionFields({ settings, onChange }: EditProps) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="lanyun-user">用户 ID（私人音色需要）</Label>
        <Input
          id="lanyun-user"
          value={settings.userId ?? ''}
          maxLength={256}
          placeholder="填写私人音色所属的用户 ID"
          onChange={event => onChange({ userId: event.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="lanyun-id-type">音色 ID 类型</Label>
        <Select
          value={settings.voiceIdType ?? 'voice_id'}
          onValueChange={value =>
            onChange({ voiceIdType: value as TtsSettings['voiceIdType'], voice: '' })
          }
        >
          <SelectTrigger id="lanyun-id-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="voice_id">蓝云音色 ID（voice_id）</SelectItem>
            <SelectItem value="external_voice_id">外部映射 ID（external_voice_id）</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  )
}

/** 调整蓝云的情感、语言及单次合成内部停顿。 */
export function LanyunSpeechSettings({ settings, onChange }: EditProps) {
  const emotionMode = resolveLanyunEmotionMode(settings)
  const strengthMode =
    emotionMode === 'natural' || emotionMode === 'expressive' ? emotionMode : undefined
  const emotionStrengths = strengthMode
    ? settings.lanyunEmotionStrengths?.[strengthMode]
    : undefined

  /** 保存当前档的修改，并保留另一档的自定义强度。 */
  function saveEmotionStrengths(strengths: LanyunEmotionStrengths) {
    if (strengthMode) {
      onChange({
        lanyunEmotionStrengths: { ...settings.lanyunEmotionStrengths, [strengthMode]: strengths },
      })
    }
  }

  /** 留空恢复此句式的默认值，零值作为明确的停用设置保存。 */
  function updateEmotionStrength(kind: LanyunEmotionKind, value: number | undefined) {
    const next = { ...emotionStrengths }
    if (value === undefined) delete next[kind]
    else next[kind] = value
    saveEmotionStrengths(next)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="lanyun-emotion-mode">语气起伏</Label>
        <Select
          value={emotionMode}
          onValueChange={value => onChange({ lanyunEmotionMode: value as LanyunEmotionMode })}
        >
          <SelectTrigger id="lanyun-emotion-mode" aria-describedby="lanyun-emotion-help">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="original">仅用原音色（默认）</SelectItem>
            <SelectItem value="voice">按音色或情感描述</SelectItem>
            <SelectItem value="natural">自然起伏（推荐）</SelectItem>
            <SelectItem value="expressive">起伏更明显</SelectItem>
          </SelectContent>
        </Select>
        <p id="lanyun-emotion-help" className="text-xs text-muted-foreground">
          {emotionMode === 'original'
            ? '使用音色本身的表现，语速仍按播报节奏设置。'
            : strengthMode
              ? '按每句话的内容调整情感和强度，普通讲解沿用原音色。'
              : '使用下方的情感描述，留空时沿用原音色。'}
        </p>
        {strengthMode && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p id="lanyun-strength-help" className="text-xs text-muted-foreground">
                填写 0～1。留空用默认值，填 0 停用该类语气。
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!Object.keys(emotionStrengths ?? {}).length}
                onClick={() => saveEmotionStrengths({})}
              >
                恢复本档默认
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {LANYUN_STRENGTH_FIELDS.map(([kind, label]) => {
                const id = `lanyun-emotion-${kind}`
                const defaultValue = LANYUN_EMOTION_DEFAULTS[strengthMode][kind].toFixed(2)
                return (
                  <div key={kind} className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <Label htmlFor={id}>{label}</Label>
                      <span id={`${id}-default`} className="text-xs text-muted-foreground">
                        默认 {defaultValue}
                      </span>
                    </div>
                    <Input
                      id={id}
                      aria-describedby={`lanyun-strength-help ${id}-default`}
                      type="number"
                      min={0}
                      max={1}
                      step="any"
                      placeholder={defaultValue}
                      value={emotionStrengths?.[kind] ?? ''}
                      onChange={event => {
                        const { value, valueAsNumber, validity } = event.currentTarget
                        if (
                          !validity.badInput &&
                          (value === '' || (valueAsNumber >= 0 && valueAsNumber <= 1))
                        ) {
                          updateEmotionStrength(kind, value === '' ? undefined : valueAsNumber)
                        }
                      }}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="lanyun-language">合成语言</Label>
          <Select
            value={settings.language ?? 'ZH'}
            onValueChange={value => onChange({ language: value as TtsLanguage })}
          >
            <SelectTrigger id="lanyun-language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ZH">中文</SelectItem>
              <SelectItem value="EN">英文</SelectItem>
              <SelectItem value="JA">日文</SelectItem>
              <SelectItem value="ES">西班牙文</SelectItem>
              <SelectItem value="AR">阿拉伯文</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="lanyun-silence">合成内部停顿（毫秒）</Label>
          <Input
            id="lanyun-silence"
            type="number"
            min={0}
            max={1000}
            step={10}
            value={settings.intervalSilence ?? 120}
            onChange={event => onChange({ intervalSilence: Number(event.target.value) })}
          />
        </div>
      </div>
    </div>
  )
}
