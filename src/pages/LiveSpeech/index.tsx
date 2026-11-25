import { History, Play, Square, Volume2 } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useLocation } from 'react-router'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { findScriptTopicConflict } from 'shared/liveScript'
import { splitSpeechText, TTS_PRESETS } from 'shared/voice'
import { Title } from '@/components/common/Title'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
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
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { useToast } from '@/hooks/useToast'
import { getVoiceConfig, useVoiceConfigStore } from '@/hooks/useVoiceConfig'
import { useVoiceHistoryStatus } from '@/services/voice/history'
import {
  previewVoice,
  startVoiceSession,
  stopVoiceSession,
  useVoiceRuntime,
} from '@/services/voice/runtime'
import { ScriptGenerator } from './ScriptGenerator'
import { VoicePicker } from './VoicePicker'

/** 将文案编辑和当前账号的开播准备放在一个工作区。 */
export default function LiveSpeech() {
  const location = useLocation()
  const accountId = useAccounts(state => state.currentAccountId)
  useVoiceConfigStore(state => state.contexts[accountId])
  const config = getVoiceConfig(accountId)
  const update = useVoiceConfigStore(state => state.update)
  const updateProvider = useVoiceConfigStore(state => state.updateProvider)
  const connected = useCurrentLiveControl(state => state.isConnected === 'connected')
  const runtime = useVoiceRuntime()
  const historyError = useVoiceHistoryStatus(state =>
    state.error?.accountId === accountId ? state.error.message : undefined,
  )
  const { toast } = useToast()
  const opening = splitSpeechText(config.openingScript)
  const selectedScript = config.savedScripts.find(script => script.id === config.selectedScriptId)
  const topicConflict =
    selectedScript && findScriptTopicConflict(selectedScript, config.savedScripts)
  const seedScript = selectedScript?.content ?? ''
  const seed = splitSpeechText(seedScript)
  const activeForAccount = runtime.accountId === accountId
  const onAir = (runtime.running || runtime.preparing) && runtime.mode !== 'preview'
  const canStart =
    selectedScript &&
    !topicConflict &&
    (!onAir || (runtime.mode === 'local' && runtime.phase === 'idle'))

  useEffect(() => {
    if (location.hash === '#broadcast-setup' || location.hash === '#script-studio') {
      document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' })
    }
  }, [location])

  /** 开始播报或试听，并呈现即时校验错误。 */
  function run(action: () => void) {
    try {
      action()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法启动语音')
    }
  }

  /** 切换话术时停止旧会话，并从最新存储读取刚保存的版本。 */
  function selectBroadcastScript(id: string) {
    const current = getVoiceConfig(accountId)
    if (id === current.selectedScriptId || !current.savedScripts.some(script => script.id === id))
      return
    const active = useVoiceRuntime.getState()
    if (active.accountId === accountId && (active.running || active.preparing)) {
      stopVoiceSession(accountId)
      toast.success('已停止上一份话术，请确认新话术后点击开始播报')
    }
    update(accountId, { selectedScriptId: id })
  }

  /** 选中编辑器刚保存的话术，并将开播面板带入视野。 */
  function useSavedScript(id: string) {
    selectBroadcastScript(id)
    document.getElementById('broadcast-setup')?.scrollIntoView({ block: 'start' })
  }

  /** 用本场音色试听一句讲解示例，不启动持续播报。 */
  async function auditionSelectedVoice() {
    try {
      const hasKey = await window.ipcRenderer.invoke(IPC_CHANNELS.tts.hasKey, config.provider)
      if (!hasKey) throw new Error('请先在音色克隆页面保存当前厂商的 API Key')
      const sample = Array.from(seed[0] ?? opening[0] ?? '欢迎来到直播间，今天为大家介绍这款产品。')
        .slice(0, 80)
        .join('')
      previewVoice(accountId, sample)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '音色试听失败')
    }
  }

  return (
    <div className="@container mx-auto max-w-7xl space-y-5 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Title title="直播话术" description="生成文案、选择音色，然后开始播报。" />
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="@min-[850px]:hidden">
            <Link to="#broadcast-setup">前往开播准备</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/live-speech/history">
              <History />
              播报历史
            </Link>
          </Button>
        </div>
      </div>
      {historyError && (
        <p role="alert" className="text-sm text-destructive">
          {historyError}
        </p>
      )}
      <div className="grid items-start gap-4 @min-[850px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <ScriptGenerator onUseScript={useSavedScript} />
        <Card id="broadcast-setup" className="@container min-w-0 scroll-mt-4 shadow-none">
          <CardHeader className="px-5 pt-5 pb-4">
            <h2 className="text-lg font-semibold">开播准备</h2>
            <CardDescription className="flex flex-wrap items-center gap-x-2">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`size-2 rounded-full ${connected ? 'bg-emerald-600' : 'bg-muted-foreground'}`}
                />
                {connected ? '已连接中控台 · 直播播报' : '未连接中控台 · 本机试听'}
              </span>
              {!connected && (
                <Link to="/" className="text-primary underline underline-offset-4">
                  连接中控台
                </Link>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-5 pb-5">
            <div className="space-y-2">
              <Label htmlFor="selected-live-script">本次播报话术</Label>
              <Select
                value={selectedScript?.id}
                onValueChange={selectBroadcastScript}
                disabled={!config.savedScripts.length}
              >
                <SelectTrigger id="selected-live-script" className="w-full min-w-0">
                  <SelectValue placeholder="请选择已保存话术" />
                </SelectTrigger>
                <SelectContent>
                  {config.savedScripts.map(script => (
                    <SelectItem key={script.id} value={script.id}>
                      {script.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!config.savedScripts.length && (
                <p className="text-xs text-muted-foreground">
                  先
                  <Link to="#script-studio" className="text-primary underline underline-offset-4">
                    生成或填写文案
                  </Link>
                  ，再保存并选用。
                </p>
              )}
            </div>
            <VoicePicker
              accountId={accountId}
              provider={config.provider}
              settings={{ ...TTS_PRESETS[config.provider], ...config.providers?.[config.provider] }}
              onSelect={voice => updateProvider(accountId, config.provider, { voice })}
              onPreview={() => void auditionSelectedVoice()}
              previewDisabled={runtime.running || runtime.preparing}
            />
            {selectedScript && (
              <div className="space-y-1 rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
                <p className="break-words">
                  话术正文：{selectedScript.title} · {seed.length} 句 /{' '}
                  {seedScript.replace(/\s/g, '').length} 字
                </p>
                <p>
                  随话术保存的商品资料：
                  {(selectedScript.productIntro ?? '').length +
                    (selectedScript.referenceText ?? '').length}{' '}
                  字
                </p>
              </div>
            )}
            {topicConflict && (
              <p className="text-sm text-destructive" role="alert">
                《{selectedScript.title}》的正文多次提到《{topicConflict.title}
                》的主题。请修改并保存正文后再播报。
              </p>
            )}
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  className="flex-1"
                  size="lg"
                  disabled={!canStart}
                  onClick={() =>
                    run(() => startVoiceSession(accountId, connected ? 'live' : 'local'))
                  }
                >
                  <Play />
                  开始播报
                </Button>
                {activeForAccount && onAir && (
                  <Button variant="outline" size="lg" onClick={() => stopVoiceSession(accountId)}>
                    <Square />
                    {runtime.preparing ? '取消准备' : '结束播报'}
                  </Button>
                )}
              </div>
              {activeForAccount && onAir && (
                <output className="block break-words text-sm font-medium text-primary">
                  当前正在{runtime.preparing ? '准备' : '播报'}：{runtime.activeScriptTitle}
                </output>
              )}
              {activeForAccount && (runtime.preparing || runtime.preparationError) && (
                <output className="block text-xs text-muted-foreground">
                  {runtime.preparationError ||
                    `正在预备语音：${runtime.preparedSeconds.toFixed(1)} / 约 ${runtime.preparationTargetSeconds} 秒`}
                </output>
              )}
              {activeForAccount && runtime.continuation.status !== 'idle' && (
                <output className="block text-xs text-muted-foreground">
                  {runtime.continuation.error ||
                    `已生成 ${runtime.continuation.generatedSegments} 段 · ${runtime.continuation.status === 'generating' || runtime.continuation.status === 'retrying' ? '正在准备下一段' : '等待合适字数继续供稿'}`}
                </output>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">
                开场和所选话术各播一次，后续由 AI 按商品资料续稿。
              </p>
            </div>
            <div className="space-y-3 border-t pt-4">
              <div className="grid gap-3 @min-[260px]:grid-cols-2">
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="prebuffer-seconds">开播前预备语音</Label>
                  <Select
                    value={String(config.prebufferSeconds)}
                    onValueChange={value => update(accountId, { prebufferSeconds: Number(value) })}
                  >
                    <SelectTrigger id="prebuffer-seconds" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">立即开始</SelectItem>
                      <SelectItem value="15">约 15 秒</SelectItem>
                      <SelectItem value="30">约 30 秒（推荐）</SelectItem>
                      <SelectItem value="45">约 45 秒</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="speech-gap">句间停顿（秒）</Label>
                  <Input
                    id="speech-gap"
                    type="number"
                    min={0}
                    max={30}
                    step={0.05}
                    value={config.gapMs / 1000}
                    onChange={event =>
                      update(accountId, {
                        gapMs: Math.round(
                          Math.max(0, Math.min(30, Number(event.target.value) || 0)) * 1000,
                        ),
                      })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="opening-script">开场介绍</Label>
                  <span className="text-xs text-muted-foreground">{opening.length} 句 · 可选</span>
                </div>
                <Textarea
                  id="opening-script"
                  value={config.openingScript}
                  maxLength={20000}
                  className="min-h-24"
                  placeholder="欢迎来到直播间。今天给大家介绍……"
                  onChange={event => update(accountId, { openingScript: event.target.value })}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!opening.length}
                  onClick={() => run(() => previewVoice(accountId, config.openingScript))}
                >
                  <Volume2 />
                  试听开场
                </Button>
              </div>
            </div>
            {connected && (
              <p className="text-xs text-muted-foreground">
                直播问答可在
                <Link
                  to="/auto-reply/settings"
                  className="text-primary underline underline-offset-4"
                >
                  自动回复设置
                </Link>
                启用语音。
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
