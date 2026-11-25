import { ArrowLeft, Download, Headphones, Play, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Title } from '@/components/common/Title'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { useAccounts } from '@/hooks/useAccounts'
import {
  deleteVoiceHistory,
  getVoiceHistoryClip,
  listVoiceHistory,
  listVoiceHistoryClips,
  useVoiceHistoryStatus,
  type VoiceHistoryClip,
  type VoiceHistorySession,
} from '@/services/voice/history'
import { useVoiceRuntime } from '@/services/voice/runtime'

const PAGE_SIZE = 50
const sessionDate = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
const clipTime = new Intl.DateTimeFormat('zh-CN', { timeStyle: 'medium' })

/** 使用当前账号的播报记录，切换账号时释放上一个播放器。 */
export default function VoiceHistoryPage() {
  const accountId = useAccounts(state => state.currentAccountId)
  return (
    <div className="@container mx-auto max-w-7xl space-y-5 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Title title="播报历史" description="按场查看已播出的话术，回放或下载保存在本机的音频。" />
        <Button asChild variant="outline">
          <Link to="/live-speech">
            <ArrowLeft />
            返回直播话术
          </Link>
        </Button>
      </div>
      <AccountHistory key={accountId} accountId={accountId} />
    </div>
  )
}

/** 刷新当前账号的场次，并在地址中保留所选场次。 */
function AccountHistory({ accountId }: { accountId: string }) {
  const revision = useVoiceHistoryStatus(state => state.revision)
  const [params, setParams] = useSearchParams()
  const [sessions, setSessions] = useState<VoiceHistorySession[] | null>(null)
  const [error, setError] = useState('')
  const selected = sessions?.find(item => item.id === params.get('session')) ?? sessions?.[0]

  useEffect(() => {
    let active = true
    void listVoiceHistory(accountId).then(
      items => {
        if (active && useVoiceHistoryStatus.getState().revision === revision) {
          setSessions(items)
          setError('')
        }
      },
      () => {
        if (active) setError('无法读取播报历史，请重新打开此页。')
      },
    )
    return () => {
      active = false
    }
  }, [accountId, revision])

  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    )
  if (!sessions)
    return <output className="block text-sm text-muted-foreground">正在读取播报历史…</output>
  if (!selected) {
    return (
      <Card className="shadow-none">
        <CardContent className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <Headphones aria-hidden="true" className="size-7 text-muted-foreground" />
          <p className="font-medium">还没有播报历史</p>
          <p className="text-sm text-muted-foreground">
            开始一场播报后，播完的音频会自动保存在这里。
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid items-start gap-4 @min-[800px]:grid-cols-[17rem_minmax(0,1fr)]">
      <Card className="gap-2 py-4 shadow-none">
        <CardHeader className="px-4">
          <h2 className="font-semibold">场次</h2>
        </CardHeader>
        <CardContent className="max-h-96 space-y-1 overflow-y-auto px-2">
          {sessions.map(session => (
            <Button
              key={session.id}
              variant={session.id === selected.id ? 'secondary' : 'ghost'}
              aria-pressed={session.id === selected.id}
              className="h-auto w-full min-w-0 flex-col items-start gap-1 px-3 py-2 whitespace-normal"
              onClick={() => setParams({ session: session.id })}
            >
              <span className="w-full text-left break-words">{session.title}</span>
              <span className="text-left text-xs font-normal text-muted-foreground">
                {sessionDate.format(session.startedAt)} · {session.clipCount} 段
              </span>
            </Button>
          ))}
        </CardContent>
      </Card>
      <SessionHistory key={selected.id} session={selected} />
    </div>
  )
}

/** 构造在同一台设备上可重新打开的段落链接。 */
function audioParams(sessionId: string, index: number) {
  return { session: sessionId, clip: String(index + 1) }
}

/** 独立试听播放完成后，允许查看与回放历史。 */
function isVoiceBusy(state: ReturnType<typeof useVoiceRuntime.getState>): boolean {
  return state.preparing || (state.running && (state.mode !== 'preview' || state.phase !== 'idle'))
}

/** 展示本场的有序文字和音频入口，一次加载一页文字及一段音频。 */
function SessionHistory({ session }: { session: VoiceHistorySession }) {
  const busy = useVoiceRuntime(isVoiceBusy)
  const [params, setParams] = useSearchParams()
  const index = Number(params.get('clip')) - 1
  const selected =
    params.get('session') === session.id &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < session.clipCount
  const [offset, setOffset] = useState(0)
  const [clips, setClips] = useState<VoiceHistoryClip[]>([])
  const [playback, setPlayback] = useState<{ continuous: boolean; attempt: number } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void listVoiceHistoryClips(
      session.id,
      offset,
      Math.min(PAGE_SIZE, session.clipCount - offset),
    ).then(
      items => {
        if (active) {
          setClips(items)
          setError('')
        }
      },
      () => {
        if (active) setError('无法读取本场话术。')
      },
    )
    return () => {
      active = false
    }
  }, [session.id, session.clipCount, offset])

  useEffect(() => {
    if (busy) setPlayback(null)
  }, [busy])

  /** 在默认输出设备回放，检查最新播报状态以避免声音叠加。 */
  function replay(index: number, continuous: boolean) {
    if (isVoiceBusy(useVoiceRuntime.getState())) return
    setPlayback(current => ({ continuous, attempt: (current?.attempt ?? 0) + 1 }))
    setParams(audioParams(session.id, index), { replace: true })
  }

  /** 连续回放仅在当前播放器自然结束时进入下一段。 */
  function playNext() {
    if (playback?.continuous && index + 1 < session.clipCount) {
      setParams(audioParams(session.id, index + 1), { replace: true })
    }
  }

  /** 删除已停止场次，失败时保留原记录并在本场提示。 */
  async function removeSession() {
    if (isVoiceBusy(useVoiceRuntime.getState())) return
    closePlayer()
    try {
      await deleteVoiceHistory(session.id)
    } catch {
      setError('删除失败，请稍后重试。')
    }
  }

  /** 关闭音频控件并清除当前段落链接。 */
  function closePlayer() {
    setPlayback(null)
    setParams({ session: session.id }, { replace: true })
  }

  return (
    <Card className="min-w-0 shadow-none">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-lg font-semibold break-words">{session.title}</h2>
            <p className="text-sm text-muted-foreground">
              {sessionDate.format(session.startedAt)} ·{' '}
              {session.mode === 'live' ? '直播播报' : '本机播报'} · {session.clipCount} 段
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => replay(0, true)}>
              <Play />
              连续回放
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={busy}>
                  <Trash2 />
                  删除本场
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>删除本场播报？</AlertDialogTitle>
                  <AlertDialogDescription>
                    会同时从本机删除本场的历史话术和音频。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void removeSession()}>
                    确认删除
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        {busy && <p className="text-sm text-muted-foreground">播报或试听结束后可回放历史音频。</p>}
        {!busy && selected && (
          <HistoryPlayer
            key={`${index}-${playback?.attempt ?? 0}`}
            sessionId={session.id}
            index={index}
            autoStart={Boolean(playback)}
            onEnded={playNext}
            onClose={closePlayer}
          />
        )}
      </CardHeader>
      <CardContent>
        {error && (
          <p role="alert" className="pb-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <ol start={offset + 1} className="divide-y border-y">
          {clips.map(clip => (
            <li
              key={clip.index}
              className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 py-3"
            >
              <div className="min-w-0 flex-1 space-y-1 [flex-basis:15rem]">
                <p className="break-words">{clip.text}</p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {clipTime.format(clip.playedAt)} · 音频时长{' '}
                  {clip.durationSeconds === null ? '未知' : `${clip.durationSeconds.toFixed(1)} 秒`}{' '}
                  · 合成耗时 {(clip.synthesisMs / 1000).toFixed(2)} 秒
                </p>
              </div>
              <Button asChild size="sm" variant="outline" className="aria-disabled:opacity-50">
                <Link
                  to={{
                    search: new URLSearchParams(audioParams(session.id, clip.index)).toString(),
                  }}
                  replace
                  aria-disabled={busy}
                  onClick={event => {
                    if (isVoiceBusy(useVoiceRuntime.getState())) {
                      event.preventDefault()
                      return
                    }
                    setPlayback(current => ({
                      continuous: false,
                      attempt: (current?.attempt ?? 0) + 1,
                    }))
                  }}
                >
                  <Play />
                  播放第 {clip.index + 1} 段
                </Link>
              </Button>
            </li>
          ))}
        </ol>
        {session.clipCount > PAGE_SIZE && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              第 {offset + 1}–{Math.min(offset + PAGE_SIZE, session.clipCount)} 段
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!offset}
                onClick={() => setOffset(offset - PAGE_SIZE)}
              >
                上一页
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={offset + PAGE_SIZE >= session.clipCount}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                下一页
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** 将已存的音频变成可回放、可下载的本地链接，切换段落后释放链接。 */
function HistoryPlayer({
  sessionId,
  index,
  autoStart,
  onEnded,
  onClose,
}: {
  sessionId: string
  index: number
  autoStart: boolean
  onEnded: () => void
  onClose: () => void
}) {
  const player = useRef<HTMLAudioElement>(null)
  const [file, setFile] = useState<{ url: string; extension: string } | null>(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    let url: string | undefined
    const element = player.current
    void getVoiceHistoryClip(sessionId, index).then(
      ({ clip, audio }) => {
        if (!active || !element) return
        url = URL.createObjectURL(audio)
        element.src = url
        element.defaultPlaybackRate = clip.playbackRate
        element.playbackRate = clip.playbackRate
        element.preservesPitch = true
        setFile({ url, extension: audio.type === 'audio/mpeg' ? 'mp3' : 'wav' })
        if (autoStart) {
          void element.play().catch(() => {
            if (active) setNotice('请点击播放器中的播放按钮。')
          })
        }
      },
      () => {
        if (active) setNotice('该段音频无法读取。')
      },
    )
    return () => {
      active = false
      element?.pause()
      element?.removeAttribute('src')
      if (url) URL.revokeObjectURL(url)
    }
  }, [sessionId, index, autoStart])

  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">第 {index + 1} 段音频</span>
        <div className="flex items-center gap-1">
          {file && (
            <Button size="sm" variant="ghost" asChild>
              <a href={file.url} download={`播报第 ${index + 1} 段.${file.extension}`}>
                <Download />
                下载音频
              </a>
            </Button>
          )}
          <Button size="icon" variant="ghost" aria-label="关闭播放器" onClick={onClose}>
            <X />
          </Button>
        </div>
      </div>
      {/* biome-ignore lint/a11y/useMediaCaption: 本页逐段呈现音频的完整文字稿。 */}
      <audio
        ref={player}
        controls
        aria-label={`播报第 ${index + 1} 段`}
        className="w-full"
        onEnded={onEnded}
        onPlay={() => setNotice('')}
        onError={() => setNotice('该段音频无法播放。')}
      />
      {notice && <output className="block text-sm text-muted-foreground">{notice}</output>}
    </div>
  )
}
