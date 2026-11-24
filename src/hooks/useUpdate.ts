import type { AppUpdate } from 'shared/appUpdate'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error'

interface UpdateStore {
  status: UpdateStatus
  info?: AppUpdate
  progress: number
  error?: string
  open: boolean
  setOpen: (open: boolean) => void
  check: (silent?: boolean) => Promise<boolean>
  download: () => Promise<void>
  setProgress: (progress: number) => void
  install: () => Promise<void>
  handleInstallError: (error: string) => void
}

export const useUpdateStore = create<UpdateStore>()((set, get) => ({
  status: 'idle',
  progress: 0,
  open: false,
  setOpen: open => set({ open }),

  /** 主动检查时显示错误，启动检查在失败时仅保留正常界面。 */
  async check(silent = false) {
    const { status } = get()
    if (status === 'checking') return false
    if (status === 'downloading' || status === 'ready' || status === 'installing') {
      if (!silent) set({ open: true })
      return false
    }
    set({ status: 'checking', error: undefined })
    try {
      const info = await window.ipcRenderer.invoke(IPC_CHANNELS.updater.checkUpdate)
      set({ status: info ? 'available' : 'idle', info, open: Boolean(info), progress: 0 })
      return !info
    } catch (error) {
      set({
        status: silent ? 'idle' : 'error',
        info: undefined,
        error: error instanceof Error ? error.message : '检查更新失败',
        open: !silent,
      })
      return false
    }
  },

  /** 下载状态在关闭窗口后保留，方便随时回到更新界面。 */
  async download() {
    const { info, status } = get()
    if (!info?.canInstallInApp || status !== 'available') return
    set({ status: 'downloading', progress: 0, error: undefined })
    try {
      await window.ipcRenderer.invoke(IPC_CHANNELS.updater.startDownload, info.latestVersion)
      set({ status: 'ready', progress: 100, open: true })
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : '下载更新失败',
        open: true,
      })
    }
  },

  /** 只接收当前下载操作的进度。 */
  setProgress(progress) {
    if (get().status === 'downloading') set({ progress })
  },

  /** 保留已校验的安装包，让安装失败后可以直接重试。 */
  async install() {
    if (get().status !== 'ready') return
    set({ status: 'installing', error: undefined })
    try {
      await window.ipcRenderer.invoke(IPC_CHANNELS.updater.quitAndInstall)
    } catch (error) {
      get().handleInstallError(error instanceof Error ? error.message : '启动安装失败')
    }
  },

  /** 接收原生安装器报告的错误，并允许再次确认安装。 */
  handleInstallError(error) {
    if (get().status === 'installing') set({ status: 'ready', error, open: true })
  },
}))

interface UpdateConfigStore {
  enableAutoCheckUpdate: boolean
  setEnableAutoCheckUpdate: (enabled: boolean) => void
}

export const useUpdateConfigStore = create<UpdateConfigStore>()(
  persist(
    set => ({
      enableAutoCheckUpdate: true,
      setEnableAutoCheckUpdate: enabled => set({ enableAutoCheckUpdate: enabled }),
    }),
    {
      name: 'update-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ enableAutoCheckUpdate }) => ({ enableAutoCheckUpdate }),
    },
  ),
)
