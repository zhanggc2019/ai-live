import { existsSync, mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { app, dialog } from 'electron'
import { productName } from '../../electron-builder.json'
import { name } from '../../package.json'

/** 保留已安装版本的账号、话术和密钥，首次启动时迁移原数据目录。 */
function configureApplicationIdentity() {
  const appDataPath = app.getPath('appData')
  const userDataPath = path.join(appDataPath, name)
  const legacyPath = path.join(appDataPath, 'xinghe-ai-live')
  if (!existsSync(userDataPath) && existsSync(legacyPath)) {
    try {
      renameSync(legacyPath, userDataPath)
    } catch (error) {
      // 另一个实例可能已完成迁移。
      if (!existsSync(userDataPath) || existsSync(legacyPath)) throw error
    }
  }
  mkdirSync(userDataPath, { recursive: true })
  app.setPath('userData', userDataPath)
  app.setName(productName)
}

if (typeof process.setSourceMapsEnabled === 'function') {
  process.setSourceMapsEnabled(true)
}

/** 初始化失败时明确退出并显示原因，避免残留一个无窗口的后台进程。 */
async function startApplication() {
  try {
    configureApplicationIdentity()
    await import('./app')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox(`${productName}启动失败`, message)
    app.exit(1)
  }
}

void startApplication()
