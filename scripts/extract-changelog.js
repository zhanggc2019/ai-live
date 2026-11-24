import { readFile } from 'node:fs/promises'

const packageUrl = new URL('../package.json', import.meta.url)
const changelogUrl = new URL('../CHANGELOG.md', import.meta.url)
const { version } = JSON.parse(await readFile(packageUrl, 'utf8'))

/** 只提取与标签完全对应的版本段，空结果交给 GitHub 生成发行说明。 */
function extractChangelog(markdown, tag) {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex(line => line.trim() === `## ${tag}`)
  if (start < 0) return ''
  const end = lines.findIndex((line, index) => index > start && /^##\s/.test(line))
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join('\n')
    .trim()
}

const notes = extractChangelog(
  await readFile(changelogUrl, 'utf8'),
  process.argv[2] ?? `v${version}`,
)
if (notes) process.stdout.write(notes)
