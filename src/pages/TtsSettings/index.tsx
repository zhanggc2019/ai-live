import { ChevronDown, Play } from 'lucide-react'
import { type ReactNode, type Ref, useEffect, useRef, useState } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { prepareSpeechPacing, splitSpeechForSynthesis } from 'shared/speechPacing'
import {
  MIMO_VOICES,
  QWEN_VOICES,
  resolveLanyunEmotionMode,
  type TtsProviderId,
  type TtsSettings,
} from 'shared/voice'
import { Title } from '@/components/common/Title'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAccounts } from '@/hooks/useAccounts'
import { useToast } from '@/hooks/useToast'
import { getVoiceConfig, useVoiceConfigStore } from '@/hooks/useVoiceConfig'
import { previewVoice } from '@/services/voice/runtime'
import { LanyunConnectionFields, LanyunSpeechSettings, LanyunVoicePicker } from './LanyunSettings'
import { SpeechPacingRequirements, SpeechPacingSettings } from './SpeechPacingSettings'
import { VoiceClone } from './VoiceClone'

interface SettingsSectionProps {
  title: string
  summary: string
  children: ReactNode
  ref?: Ref<HTMLDetailsElement>
}

/** 用可键盘操作的折叠区收起低频设置，收起后保留表单状态。 */
function SettingsSection({ title, summary, children, ref }: SettingsSectionProps) {
  return (
    <details ref={ref} className="group">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5 hover:bg-muted/60 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs text-muted-foreground">{summary}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground group-open:rotate-180"
        />
      </summary>
      <div className="px-5 pt-1 pb-5">{children}</div>
    </details>
  )
}

/** 先提供音色选择和试听，将厂商、克隆及输出配置放在可展开的区域。 */
export default function TtsSettingsPage() {
  const accountId = useAccounts(state => state.currentAccountId)
  useVoiceConfigStore(state => state.contexts[accountId])
  const config = getVoiceConfig(accountId)
  const { provider, speechPacing: pacing } = config
  const update = useVoiceConfigStore(state => state.update)
  const updateProvider = useVoiceConfigStore(state => state.updateProvider)
  const settings = config.providers[provider]
  const disableEmotionDescription =
    provider === 'lanyun' && resolveLanyunEmotionMode(settings) !== 'voice'
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [keyRevision, setKeyRevision] = useState(0)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [preview, setPreview] = useState('要是你平时用小包，可以先看看这个杯子放不放得下。')
  const connection = useRef<HTMLDetailsElement>(null)
  const keyField = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  useEffect(() => {
    let active = true
    setApiKey('')
    setHasKey(false)
    window.ipcRenderer
      .invoke(IPC_CHANNELS.tts.hasKey, provider)
      .then(value => {
        if (active) setHasKey(value)
      })
      .catch(error => {
        if (active) toast.error(error instanceof Error ? error.message : '无法读取密钥状态')
      })
    return () => {
      active = false
    }
  }, [provider, toast])

  useEffect(() => {
    /** 保留设备切换状态，以便提示用户重新选择失联的设备。 */
    const refresh = () => {
      navigator.mediaDevices
        ?.enumerateDevices()
        .then(items => setDevices(items.filter(item => item.kind === 'audiooutput')))
        .catch(() => {})
    }
    refresh()
    navigator.mediaDevices?.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refresh)
  }, [])

  /** 保存输入密钥后立即从输入框移除，密钥由主进程加密保管。 */
  async function saveKey() {
    setSaving(true)
    try {
      await window.ipcRenderer.invoke(IPC_CHANNELS.tts.saveKey, provider, apiKey)
      setHasKey(Boolean(apiKey.trim()))
      setApiKey('')
      setKeyRevision(value => value + 1)
      toast.success('TTS 密钥已加密保存')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '密钥保存失败')
    } finally {
      setSaving(false)
    }
  }

  /** 展开连接表单并聚焦密钥，方便首次配置后回到试听。 */
  function configureKey() {
    if (connection.current) connection.current.open = true
    keyField.current?.focus()
  }

  /** 用户授权后更新设备名称，并立即释放麦克风。 */
  async function discoverDevices() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      for (const track of stream.getTracks()) track.stop()
      const items = await navigator.mediaDevices.enumerateDevices()
      setDevices(items.filter(item => item.kind === 'audiooutput'))
      toast.success('音频设备已刷新')
    } catch {
      toast.error('无法读取设备名称，请检查 Windows 麦克风权限。也可使用默认输出设备')
    }
  }

  /** 将厂商配置更新到当前账号，切换厂商时保留各自的设置。 */
  function updateSettings(patch: Partial<TtsSettings>) {
    updateProvider(accountId, provider, patch)
  }

  /** 试听使用与直播一致的厂商、音色及输出设备。 */
  function audition() {
    try {
      previewVoice(accountId, preview)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '试听失败')
    }
  }

  return (
    <div className="@container container max-w-5xl space-y-5 pb-5">
      <Title
        title="音色克隆"
        description="选择直播音色并试听。设置按账号保存，下次开始播报时生效。"
      />
      <div className="grid items-start gap-4 @min-[610px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="min-w-0 shadow-none">
          <CardHeader className="p-5 pb-3">
            <CardTitle className="text-base">音色与试听</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-5 pt-0">
            <div className="space-y-2">
              <Label htmlFor="tts-provider">厂商</Label>
              <Select
                disabled={saving}
                value={provider}
                onValueChange={value => update(accountId, { provider: value as TtsProviderId })}
              >
                <SelectTrigger id="tts-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mimo">小米 MiMo V2.5 TTS</SelectItem>
                  <SelectItem value="lanyun">蓝云 TTS（IndexTTS-2.5）</SelectItem>
                  <SelectItem value="qwen">阿里千问 TTS（Qwen Audio 3.1 Flash）</SelectItem>
                  <SelectItem value="openai-compatible">OpenAI 兼容语音厂商</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {provider === 'lanyun' ? (
              <LanyunVoicePicker
                key={accountId}
                settings={settings}
                hasKey={hasKey && !saving}
                keyRevision={keyRevision}
                onChange={updateSettings}
              />
            ) : (
              <div className="space-y-2">
                <Label htmlFor="tts-voice">音色</Label>
                {provider === 'openai-compatible' ? (
                  <Input
                    id="tts-voice"
                    value={settings.voice}
                    maxLength={200}
                    placeholder="填写厂商提供的音色 ID"
                    onChange={event => updateSettings({ voice: event.target.value })}
                  />
                ) : (
                  <Select
                    value={settings.voice}
                    onValueChange={value => updateSettings({ voice: value })}
                  >
                    <SelectTrigger id="tts-voice">
                      <SelectValue placeholder="选择音色" />
                    </SelectTrigger>
                    <SelectContent>
                      {provider === 'mimo' ? (
                        MIMO_VOICES.map(voice => (
                          <SelectItem key={voice} value={voice}>
                            {voice === 'mimo_default' ? 'MiMo 默认音色' : voice}
                          </SelectItem>
                        ))
                      ) : (
                        <>
                          {settings.voice &&
                            !QWEN_VOICES.some(voice => voice.id === settings.voice) && (
                              <SelectItem value={settings.voice}>
                                当前音色 · {settings.voice}
                              </SelectItem>
                            )}
                          {QWEN_VOICES.map(voice => (
                            <SelectItem key={voice.id} value={voice.id}>
                              {voice.name}
                            </SelectItem>
                          ))}
                        </>
                      )}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
            <div className="space-y-2 border-t pt-3">
              <Label htmlFor="tts-preview">试听文字</Label>
              <Textarea
                id="tts-preview"
                className="min-h-14"
                value={preview}
                maxLength={1000}
                onChange={event => setPreview(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  disabled={!hasKey || saving || !settings.voice.trim() || !preview.trim()}
                  onClick={audition}
                >
                  <Play aria-hidden="true" />
                  合成并播放
                </Button>
                {!hasKey && !saving && (
                  <Button variant="link" size="sm" onClick={configureKey}>
                    配置 API Key
                  </Button>
                )}
              </div>
              <details className="group">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-sm py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                  <span>分段语速预览</span>
                  <ChevronDown aria-hidden="true" className="size-3.5 group-open:rotate-180" />
                </summary>
                <fieldset
                  className="mt-2 min-w-0 space-y-2 rounded-md bg-muted p-3 text-xs"
                  aria-label="分段语速预览"
                >
                  {[...new Set(splitSpeechForSynthesis(preview, settings))]
                    .slice(0, 4)
                    .map(text => {
                      const plan = prepareSpeechPacing(
                        text,
                        settings,
                        pacing,
                        config.scriptRequirements,
                      )
                      return (
                        <div key={text} className="flex items-start gap-2">
                          <span className="shrink-0 font-medium tabular-nums">
                            {plan.rate.toFixed(2)}×
                          </span>
                          <span className="min-w-0 truncate" title={`${text}\n${plan.reason}`}>
                            {text}
                          </span>
                        </div>
                      )
                    })}
                </fieldset>
              </details>
            </div>
          </CardContent>
        </Card>
        <div className="min-w-0 space-y-4">
          <SpeechPacingSettings
            settings={pacing}
            onChange={patch => update(accountId, { speechPacing: patch })}
            fixedRate={
              provider === 'lanyun'
                ? {
                    value: settings.speechRate ?? 1,
                    onChange: speechRate => updateSettings({ speechRate }),
                  }
                : undefined
            }
          />
          <Card className="shadow-none">
            <SettingsSection title="克隆私人音色" summary="蓝云 · 上传录音">
              <VoiceClone
                key={accountId}
                settings={settings}
                hasKey={hasKey && !saving}
                onCreated={voice =>
                  updateProvider(accountId, 'lanyun', { voice: voice.id, voiceIdType: 'voice_id' })
                }
              />
            </SettingsSection>
          </Card>
        </div>
      </div>
      <Card className="divide-y shadow-none">
        <SettingsSection
          title="厂商连接"
          summary={hasKey ? '已保存密钥' : '未配置密钥'}
          ref={connection}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="tts-key">API Key {hasKey ? '· 已保存' : '· 未配置'}</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="tts-key"
                  ref={keyField}
                  className="min-w-36 flex-1"
                  type="password"
                  autoComplete="new-password"
                  value={apiKey}
                  placeholder={hasKey ? '输入新密钥可替换' : '粘贴厂商 API Key'}
                  onChange={event => setApiKey(event.target.value)}
                />
                <Button variant="outline" disabled={saving || !apiKey.trim()} onClick={saveKey}>
                  保存密钥
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">同一厂商的密钥在本机各账号间共用。</p>
            </div>
            {provider !== 'mimo' && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="tts-url">API 基础地址</Label>
                <Input
                  id="tts-url"
                  value={settings.baseURL}
                  placeholder={
                    provider === 'qwen'
                      ? 'https://业务空间ID.cn-beijing.maas.aliyuncs.com/api/v1'
                      : 'https://厂商域名/v1'
                  }
                  onChange={event => updateSettings({ baseURL: event.target.value })}
                />
                {provider === 'qwen' && (
                  <p className="text-xs text-muted-foreground">
                    填写百炼控制台的业务空间地址，并使用同地域 API Key。
                  </p>
                )}
              </div>
            )}
            {(provider === 'mimo' || provider === 'openai-compatible') && (
              <div className="space-y-2">
                <Label htmlFor="tts-model">模型</Label>
                <Input
                  id="tts-model"
                  value={settings.model}
                  maxLength={200}
                  onChange={event => updateSettings({ model: event.target.value })}
                />
              </div>
            )}
            {provider === 'lanyun' && (
              <LanyunConnectionFields settings={settings} onChange={updateSettings} />
            )}
            {provider === 'qwen' && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="qwen-voice-id">音色 ID（可填写其他系统或复刻音色）</Label>
                <Input
                  id="qwen-voice-id"
                  value={settings.voice}
                  maxLength={200}
                  onChange={event => updateSettings({ voice: event.target.value })}
                />
              </div>
            )}
            {provider === 'openai-compatible' && (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                厂商需支持 /audio/speech 接口和 WAV 输出。
              </p>
            )}
          </div>
        </SettingsSection>
        <SettingsSection
          title="朗读细调"
          summary={provider === 'lanyun' ? '语气、语言、停顿' : '朗读风格、播报要求'}
        >
          <div className="space-y-5">
            {provider === 'lanyun' && (
              <LanyunSpeechSettings settings={settings} onChange={updateSettings} />
            )}
            <div className="space-y-2">
              <Label htmlFor="tts-style">
                {provider === 'lanyun' ? '情感描述（可选）' : '朗读风格'}
              </Label>
              <Textarea
                id="tts-style"
                disabled={disableEmotionDescription}
                value={settings.instructions}
                maxLength={2000}
                placeholder="例如：亲切自然，像和熟人聊天。"
                onChange={event => updateSettings({ instructions: event.target.value })}
              />
              {disableEmotionDescription && (
                <p className="text-xs text-muted-foreground">选择「按音色或情感描述」时使用。</p>
              )}
              {provider === 'openai-compatible' && (
                <p className="text-xs text-muted-foreground">请按厂商支持的朗读指令填写。</p>
              )}
            </div>
            <SpeechPacingRequirements
              settings={pacing}
              onChange={patch => update(accountId, { speechPacing: patch })}
            />
          </div>
        </SettingsSection>
        <SettingsSection title="声音输出" summary="输出设备、音量">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tts-output">输出设备</Label>
              <Select
                value={config.outputDeviceId}
                onValueChange={value => update(accountId, { outputDeviceId: value })}
              >
                <SelectTrigger id="tts-output">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">系统默认输出设备</SelectItem>
                  {devices
                    .filter(device => device.deviceId && device.deviceId !== 'default')
                    .map((device, index) => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.label || `音频输出设备 ${index + 1}`}
                      </SelectItem>
                    ))}
                  {config.outputDeviceId !== 'default' &&
                    !devices.some(device => device.deviceId === config.outputDeviceId) && (
                      <SelectItem value={config.outputDeviceId}>
                        已保存的设备（暂未检测到）
                      </SelectItem>
                    )}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={discoverDevices}>
                授权并刷新设备
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tts-volume">播放音量 {Math.round(config.volume * 100)}%</Label>
              <input
                id="tts-volume"
                className="w-full accent-primary"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={config.volume}
                onChange={event => update(accountId, { volume: Number(event.target.value) })}
              />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-2">
              在 OBS 或直播伴侣中选择应用音频、桌面音频或虚拟声卡录音端，只采集其中一路，避免重音。
            </p>
          </div>
        </SettingsSection>
      </Card>
    </div>
  )
}
