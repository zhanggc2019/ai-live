import assert from 'node:assert/strict'
import test from 'node:test'
import { selectAppUpdate } from '../electron/main/managers/githubRelease'

/** 模拟 GitHub Releases 的标签、日志和平台资产。 */
function release(...assetNames: string[]) {
  return {
    tag_name: 'v1.0.3',
    body: '## 更新日志\n\n- 调整开播布局',
    assets: assetNames.map(name => ({ name })),
  }
}

test('Windows 只在同一发行版包含安装包和清单时开放应用内安装', () => {
  const installer = 'ai-live_1.0.3_windows_x64.exe'
  const update = selectAppUpdate(release(installer, 'latest.yml'), '1.0.2', 'win32', 'x64')
  assert.equal(update?.latestVersion, '1.0.3')
  assert.equal(update?.canInstallInApp, true)
  assert.match(update?.releaseNote ?? '', /调整开播布局/)
  assert.equal(
    update?.downloadURL,
    `https://github.com/zhanggc2019/ai-live/releases/download/v1.0.3/${installer}`,
  )
  assert.equal(selectAppUpdate(release(installer), '1.0.2', 'win32', 'x64')?.canInstallInApp, false)
})

test('已安装相同或更高版本时忽略发行版，缺少适用安装包时报告错误', () => {
  for (const current of ['1.0.3', '1.0.4']) {
    assert.equal(selectAppUpdate(release(), current, 'win32', 'x64'), undefined)
  }
  assert.throws(() => selectAppUpdate(release(), '1.0.2', 'win32', 'x64'), /缺少适用于当前系统/)
})

test('macOS 仅有 DMG 时提供手动下载，有 ZIP 和清单时允许应用内安装', () => {
  const dmg = 'ai-live_1.0.3_macos_universal.dmg'
  const zip = 'ai-live_1.0.3_macos_universal.zip'
  assert.equal(selectAppUpdate(release(dmg), '1.0.2', 'darwin', 'arm64')?.canInstallInApp, false)
  const update = selectAppUpdate(release(dmg, zip, 'latest-mac.yml'), '1.0.2', 'darwin', 'x64')
  assert.equal(update?.canInstallInApp, true)
  assert.ok(update?.downloadURL.endsWith(dmg))
})
