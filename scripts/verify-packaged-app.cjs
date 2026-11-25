const { spawnSync } = require('node:child_process')
const path = require('node:path')

/** 从 Windows 安装版归档加载运行时依赖，发现缺包时终止构建。 */
module.exports = function verifyPackagedApp({ appOutDir, electronPlatformName, packager }) {
  if (process.platform !== 'win32' || electronPlatformName !== 'win32') return

  const executable = path.join(appOutDir, `${packager.appInfo.productFilename}.exe`)
  const manifest = path.join(appOutDir, 'resources', 'app.asar', 'package.json')
  const probe = spawnSync(
    executable,
    [
      '-e',
      `const packagedRequire = require('node:module').createRequire(process.argv[1])
       const { dependencies } = packagedRequire(process.argv[1])
       for (const dependency of Object.keys(dependencies)) {
         packagedRequire(dependency)
       }`,
      manifest,
    ],
    {
      cwd: appOutDir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: '' },
      stdio: 'inherit',
      timeout: 30000,
    },
  )
  if (probe.error) throw probe.error
  if (probe.status !== 0) throw new Error('安装包运行时依赖校验失败')
}
