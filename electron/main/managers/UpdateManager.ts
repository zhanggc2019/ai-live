import { createRequire } from 'node:module'
import { app, net } from 'electron'
import type { AppUpdater, ProgressInfo } from 'electron-updater'
import type { AppUpdate } from 'shared/appUpdate'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import windowManager from '#/windowManager'
import { createLogger } from '../logger'
import { releaseApi, selectAppUpdate } from './githubRelease'

const logger = createLogger('update')

class UpdateManager {
  private updater?: AppUpdater
  private available?: AppUpdate
  private downloading = false
  private downloaded = false
  private installing = false

  /** 仅在安装版查询 GitHub 正式发行版，日志和安装包来自同一个标签。 */
  async checkUpdateVersion(): Promise<AppUpdate | undefined> {
    if (!app.isPackaged) return
    const response = await net.fetch(releaseApi, {
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'xinghe-ai-live' },
    })
    if (response.status === 404) {
      this.available = undefined
      return
    }
    if (!response.ok) throw new Error(`GitHub 检查更新失败（HTTP ${response.status}）`)
    this.available = selectAppUpdate(
      await response.json(),
      app.getVersion(),
      process.platform,
      process.arch,
    )
    return this.available
  }

  /** 配置 electron-updater，只在用户确认后下载和安装。 */
  private getUpdater() {
    if (!this.updater) {
      const { autoUpdater } = createRequire(import.meta.url)('electron-updater') as {
        autoUpdater: AppUpdater
      }
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = false
      autoUpdater.allowPrerelease = false
      autoUpdater.allowDowngrade = false
      autoUpdater.disableWebInstaller = true
      autoUpdater.logger = logger
      autoUpdater.on('download-progress', (progress: ProgressInfo) => {
        windowManager.send(IPC_CHANNELS.updater.downloadProgress, progress)
      })
      autoUpdater.on('error', (error: Error) => {
        if (!this.installing) return
        this.installing = false
        windowManager.send(IPC_CHANNELS.updater.installError, error.message)
      })
      this.updater = autoUpdater
    }
    return this.updater
  }

  /** 校验更新器拿到的版本与用户确认的版本一致，再下载并校验安装包。 */
  async startDownload(version: string) {
    if (this.downloading) throw new Error('更新正在下载')
    if (!this.available?.canInstallInApp || this.available.latestVersion !== version) {
      throw new Error('更新信息已变更，请重新检查更新')
    }
    this.downloading = true
    this.downloaded = false
    try {
      const updater = this.getUpdater()
      const result = await updater.checkForUpdates()
      if (!result?.isUpdateAvailable || result.updateInfo.version !== version) {
        throw new Error('更新版本已变更，请重新检查更新')
      }
      await updater.downloadUpdate()
      this.downloaded = true
    } finally {
      this.downloading = false
    }
  }

  /** 在下载校验通过后退出客户端并启动安装。 */
  quitAndInstall() {
    if (!this.downloaded || !this.updater) throw new Error('请先完成更新下载')
    if (this.installing) throw new Error('正在启动安装')
    this.installing = true
    try {
      this.updater.quitAndInstall()
    } catch (error) {
      this.installing = false
      throw error
    }
  }
}

export const updateManager = new UpdateManager()
