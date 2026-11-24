import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/useToast'
import { useUpdateConfigStore, useUpdateStore } from '@/hooks/useUpdate'
import { version } from '../../../../package.json'

/** 提供手动查询和查看已下载更新的入口，并保存启动检查偏好。 */
export function UpdateSetting() {
  const { enableAutoCheckUpdate, setEnableAutoCheckUpdate } = useUpdateConfigStore()
  const status = useUpdateStore(state => state.status)
  const check = useUpdateStore(state => state.check)
  const { toast } = useToast()

  /** 有更新时由全局对话框显示详情，最新版本用轻量反馈提示。 */
  async function checkUpdate() {
    if (await check()) toast.success('已是最新版本')
  }

  return (
    <Card id="update-section">
      <CardHeader>
        <CardTitle>软件更新</CardTitle>
        <CardDescription>当前版本 v{version} · GitHub Releases</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <Label htmlFor="software-auto-update">启动时检查更新</Label>
            <p className="text-sm text-muted-foreground">有新版本时显示更新日志</p>
          </div>
          <Switch
            id="software-auto-update"
            checked={enableAutoCheckUpdate}
            onCheckedChange={setEnableAutoCheckUpdate}
          />
        </div>
        <Button
          variant="outline"
          disabled={status === 'checking'}
          onClick={() => void checkUpdate()}
        >
          <RefreshCw className={status === 'checking' ? 'animate-spin' : undefined} />
          {status === 'checking'
            ? '检查中…'
            : ['downloading', 'ready', 'installing'].includes(status)
              ? '查看更新进度'
              : '检查更新'}
        </Button>
      </CardContent>
    </Card>
  )
}
