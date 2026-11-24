import { useMemoizedFn } from 'ahooks'
import { ArrowRight, CircleAlert, GlobeIcon, XIcon } from 'lucide-react'
import React from 'react'
import { Link } from 'react-router'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useAccounts } from '@/hooks/useAccounts'
import { useCurrentChromeConfig, useCurrentChromeConfigActions } from '@/hooks/useChromeConfig'
import { useCurrentLiveControl, useCurrentLiveControlActions } from '@/hooks/useLiveControl'
import { useToast } from '@/hooks/useToast'
import PlatformSelect from './PlatformSelect'

const StatusAlert = React.memo(() => {
  const platform = useCurrentLiveControl(state => state.platform)
  if (platform === 'wxchannel') {
    return (
      <Alert>
        <CircleAlert className="h-4 w-4" />
        <AlertTitle>你选择了视频号平台，请注意以下事项：</AlertTitle>
        <AlertDescription>
          <ol className="list-decimal list-inside">
            <li>
              请先确认<strong>开播后</strong>再连接中控台
            </li>
            <li>
              视频号助手无法<strong>一号多登</strong>，在别处登录视频号助手会
              <strong>中断连接</strong>!
            </li>
          </ol>
        </AlertDescription>
      </Alert>
    )
  }
  if (platform === 'taobao') {
    return (
      <Alert>
        <CircleAlert className="h-4 w-4" />
        <AlertTitle>你选择了淘宝平台，请注意以下事项：</AlertTitle>
        <AlertDescription>
          <ol className="list-decimal list-inside">
            <li>
              请先确认<strong>开播后</strong>
              再连接中控台，因为进入淘宝中控台需要获取<strong>直播间ID</strong>
            </li>
            <li>
              目前淘宝会触发人机验证，所以将<strong>强制关闭无头模式</strong>
              ，除了登录和人机验证之外请尽量不要操作浏览器
            </li>
          </ol>
        </AlertDescription>
      </Alert>
    )
  }
  return null
})

/** 将平台选择、连接状态和连接后的开播入口放在一起。 */
const StatusCard = React.memo(() => {
  const connected = useCurrentLiveControl(context => context.isConnected === 'connected')
  return (
    <Card className="shadow-none">
      <CardHeader className="px-5 pt-5 pb-4">
        <CardTitle>平台连接</CardTitle>
        <CardDescription>
          <ConnectState />
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-36 flex-1 space-y-2">
              <Label htmlFor="live-platform">直播平台</Label>
              <PlatformSelect />
            </div>
            <ConnectToLiveControl />
          </div>
          <StatusAlert />
          <Separator />
          <HeadlessSetting />
          {connected && (
            <div className="flex justify-end border-t pt-4">
              <Button asChild>
                <Link to="/live-speech#broadcast-setup">
                  去开播准备 <ArrowRight />
                </Link>
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
})

const ConnectToLiveControl = React.memo(() => {
  const { setIsConnected } = useCurrentLiveControlActions()
  const platform = useCurrentLiveControl(context => context.platform)
  const isConnected = useCurrentLiveControl(context => context.isConnected)
  const chromePath = useCurrentChromeConfig(context => context.path)
  const storageState = useCurrentChromeConfig(context => context.storageState)
  let headless = useCurrentChromeConfig(context => context.headless)
  const account = useAccounts(store => store.getCurrentAccount())

  if (platform === 'taobao') {
    headless = false
  }

  const { toast } = useToast()

  const connectLiveControl = useMemoizedFn(async () => {
    try {
      if (!account) {
        toast.error('找不到对应账号')
        return
      }
      setIsConnected('connecting')
      const result = await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.liveControl.connect, {
        headless,
        chromePath,
        storageState,
        platform,
        account,
      })

      if (result) {
        setIsConnected('connected')
        toast.success('已连接到直播控制台')
      } else {
        throw new Error('连接直播控制台失败')
      }
    } catch (error) {
      setIsConnected('disconnected')
      toast.error(error instanceof Error ? error.message : '连接直播控制台失败')
    }
  })

  const disconnectLiveControl = useMemoizedFn(async () => {
    if (!account) {
      toast.error('找不到对应账号')
      return
    }
    try {
      await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.liveControl.disconnect, account.id)
      toast.success('已断开连接')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '断开连接失败')
    } finally {
      setIsConnected('disconnected')
    }
  })

  const handleButtonClick = useMemoizedFn(() => {
    if (isConnected === 'connected') {
      disconnectLiveControl()
    } else {
      connectLiveControl()
    }
  })

  return isConnected === 'connected' ? (
    <DisconnectButton handleButtonClick={handleButtonClick} />
  ) : (
    <ConnectButton isLoading={isConnected === 'connecting'} handleButtonClick={handleButtonClick} />
  )
})

const ConnectButton = React.memo(
  ({ isLoading, handleButtonClick }: { isLoading: boolean; handleButtonClick: () => void }) => {
    return (
      <Button onClick={handleButtonClick} disabled={isLoading}>
        <GlobeIcon />
        {isLoading ? '连接中...' : '连接直播控制台'}
      </Button>
    )
  },
)

/** 连接状态与断开操作各自使用固定标签。 */
const DisconnectButton = React.memo(({ handleButtonClick }: { handleButtonClick: () => void }) => {
  return (
    <Button variant="outline" onClick={handleButtonClick}>
      <XIcon />
      断开连接
    </Button>
  )
})

const ConnectState = React.memo(() => {
  const isConnected = useCurrentLiveControl(context => context.isConnected)
  const accountName = useCurrentLiveControl(context => context.accountName)
  return (
    <span className="flex items-center gap-2" role="status">
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${isConnected === 'connected' ? 'bg-emerald-600' : 'bg-muted-foreground'}`}
      />
      <span className="text-sm text-muted-foreground">
        {isConnected === 'connected'
          ? `已连接${accountName ? ` (${accountName})` : ''}`
          : isConnected === 'connecting'
            ? '正在连接'
            : '未连接'}
      </span>
    </span>
  )
})

const HeadlessSetting = () => {
  const headless = useCurrentChromeConfig(context => context.headless ?? false)
  const platform = useCurrentLiveControl(context => context.platform)
  const isConnected = useCurrentLiveControl(context => context.isConnected)
  const { setHeadless } = useCurrentChromeConfigActions()
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <Label htmlFor="headless-browser">后台运行浏览器</Label>
        <div className="text-muted-foreground text-xs">
          开启后浏览器将在后台运行，不会在桌面显示
        </div>
      </div>
      <Switch
        id="headless-browser"
        checked={headless && platform !== 'taobao'}
        disabled={platform === 'taobao' || isConnected !== 'disconnected'}
        onCheckedChange={v => setHeadless(v)}
      />
    </div>
  )
}

export default StatusCard
