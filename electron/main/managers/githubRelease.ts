import semver from 'semver'
import builderConfig from '../../../electron-builder.json'
import { name } from '../../../package.json'
import type { AppUpdate } from '../../../shared/appUpdate'

const { owner, repo } = builderConfig.publish
export const releaseApi = `https://api.github.com/repos/${owner}/${repo}/releases/latest`

/** 从正式发行版筛选适用于本机的安装包和完整的应用内更新资产。 */
export function selectAppUpdate(
  payload: unknown,
  currentVersion: string,
  platform: NodeJS.Platform,
  arch: string,
): AppUpdate | undefined {
  if (!payload || typeof payload !== 'object') throw new Error('GitHub 返回了无效的发行信息')
  const release = payload as { tag_name?: string; body?: string; assets?: { name: string }[] }
  const version = typeof release.tag_name === 'string' ? semver.valid(release.tag_name) : null
  if (!version || !Array.isArray(release.assets))
    throw new Error('GitHub 发行版缺少版本或安装包信息')
  if (semver.lte(version, currentVersion)) return
  const windows = platform === 'win32' && arch === 'x64'
  if (!windows && platform !== 'darwin') return

  const base = `${name}_${version}_${windows ? 'windows_x64' : 'macos_universal'}`
  const installer = `${base}.${windows ? 'exe' : 'dmg'}`
  const assets = new Set(release.assets.map(asset => asset.name))
  if (!assets.has(installer)) throw new Error('该发行版缺少适用于当前系统的安装包')
  const canInstallInApp = windows
    ? assets.has('latest.yml')
    : assets.has('latest-mac.yml') && assets.has(`${base}.zip`)

  return {
    currentVersion,
    latestVersion: version,
    releaseNote: typeof release.body === 'string' ? release.body.trim() : undefined,
    downloadURL: `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(release.tag_name ?? '')}/${installer}`,
    canInstallInApp,
  }
}
