import { Download, Rocket } from 'lucide-react'
import { useEffect } from 'react'
import Markdown from 'react-markdown'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { useIpcListener } from '@/hooks/useIpc'
import { useUpdateConfigStore, useUpdateStore } from '@/hooks/useUpdate'
import { productName } from '../../../electron-builder.json'

/** 在全局显示发行说明、下载进度和重启安装入口。 */
export function UpdateDialog() {
  const { status, info, progress, error, open, setOpen, check, download, setProgress, install } =
    useUpdateStore()
  const autoCheck = useUpdateConfigStore(state => state.enableAutoCheckUpdate)
  useIpcListener(IPC_CHANNELS.updater.downloadProgress, ({ percent }) => setProgress(percent))
  useIpcListener(
    IPC_CHANNELS.updater.installError,
    useUpdateStore(state => state.handleInstallError),
  )

  useEffect(() => {
    if (autoCheck) void check(true)
  }, [autoCheck, check])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>{info ? `${productName} v${info.latestVersion}` : '软件更新'}</DialogTitle>
        <DialogDescription>
          {info ? `当前版本 v${info.currentVersion} · GitHub Releases` : '检查 GitHub 上的正式版本'}
        </DialogDescription>
        {info?.releaseNote && (
          <div className="markdown-body max-h-64 overflow-auto rounded-md border p-3 text-sm">
            <Markdown
              skipHtml
              components={{
                a: props => (
                  <a href={props.href} target="_blank" rel="noreferrer">
                    {props.children}
                  </a>
                ),
              }}
            >
              {info.releaseNote}
            </Markdown>
          </div>
        )}
        {error && (
          <p className="break-words text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {status === 'downloading' && (
          <div className="space-y-2" role="status">
            <div className="flex justify-between text-sm">
              <span>下载更新</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} aria-label="更新下载进度" />
          </div>
        )}
        {status === 'ready' && (
          <p className="text-sm text-muted-foreground">
            已下载更新。重启会结束当前直播连接和播报。
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            关闭
          </Button>
          {info && (error || !info.canInstallInApp) && (
            <Button asChild variant={info.canInstallInApp ? 'outline' : 'default'}>
              <a href={info.downloadURL} target="_blank" rel="noreferrer">
                <Download />
                手动下载安装包
              </a>
            </Button>
          )}
          {status === 'available' && info?.canInstallInApp && (
            <Button onClick={() => void download()}>
              <Download />
              下载更新
            </Button>
          )}
          {status === 'error' && <Button onClick={() => void check()}>重新检查</Button>}
          {(status === 'ready' || status === 'installing') && (
            <Button disabled={status === 'installing'} onClick={() => void install()}>
              <Rocket />
              {status === 'installing' ? '正在启动安装…' : '重启并安装'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
