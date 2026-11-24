import { IPC_CHANNELS } from 'shared/ipcChannels'
import { updateManager } from '#/managers/UpdateManager'
import { typedIpcMainHandle } from '#/utils'

/** 注册更新查询、确认下载与安装的主进程入口。 */
export function setupUpdateIpcHandlers() {
  typedIpcMainHandle(IPC_CHANNELS.updater.checkUpdate, () => updateManager.checkUpdateVersion())
  typedIpcMainHandle(IPC_CHANNELS.updater.startDownload, (_, version) =>
    updateManager.startDownload(version),
  )
  typedIpcMainHandle(IPC_CHANNELS.updater.quitAndInstall, () => updateManager.quitAndInstall())
}
