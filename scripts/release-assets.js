import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import semver from 'semver'
import { parse } from 'yaml'

const { version, name } = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
)
const [platform, signing] = process.argv.slice(2)
const source = resolve('release', version)
const destination = resolve('release', 'assets')

/** 确认标签与客户端内置版本一致，避免发行包永远检测不到更新。 */
function checkTag() {
  assert.equal(semver.valid(version), version, 'package.json 需要有效的 SemVer 版本')
  assert.equal(process.env.GITHUB_REF_NAME, `v${version}`, '标签必须与 package.json 版本一致')
}

/** 验证并收集更新清单引用的原始文件，保留 electron-builder 生成的文件名。 */
async function collectAssets() {
  assert.ok(platform === 'windows' || platform === 'macos', '不支持的打包平台')
  const windows = platform === 'windows'
  const signedMac = platform === 'macos' && signing === '--signed'
  const base = `${name}_${version}_${windows ? 'windows_x64' : 'macos_universal'}`
  const installer = `${base}.${windows ? 'exe' : 'dmg'}`
  const assets = new Set([installer])

  if (windows || signedMac) {
    const manifest = windows ? 'latest.yml' : 'latest-mac.yml'
    const updateFile = windows ? installer : `${base}.zip`
    const metadata = parse(await readFile(resolve(source, manifest), 'utf8'))
    assert.equal(metadata.version, version, '更新清单版本不一致')
    assert.ok(
      metadata.files?.some(file => file.url === updateFile),
      '更新清单缺少应用内更新包',
    )
    assets.add(manifest)
    assets.add(`${updateFile}.blockmap`)

    for (const file of metadata.files) {
      assert.match(file.url, /^[\w-][\w.-]*$/, '更新清单文件名无效')
      const filePath = resolve(source, file.url)
      assert.equal((await stat(filePath)).size, file.size, `${file.url} 文件大小不一致`)
      const hash = createHash('sha512')
      for await (const chunk of createReadStream(filePath)) hash.update(chunk)
      assert.equal(hash.digest('base64'), file.sha512, `${file.url} 校验失败`)
      assets.add(file.url)
    }
  }

  await mkdir(destination, { recursive: true })
  for (const asset of assets) {
    await copyFile(resolve(source, asset), resolve(destination, asset))
  }
  console.log([...assets].join('\n'))
}

if (platform === 'check-tag') checkTag()
else await collectAssets()
