import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { countScriptCharacters } from 'shared/liveScript'
import { Title } from '@/components/common/Title'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAccounts } from '@/hooks/useAccounts'
import {
  listScriptHistory,
  type ScriptHistoryRecord,
  useScriptHistoryStatus,
} from '@/services/voice/history'

const PAGE_SIZE = 20
const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'medium',
})
const STATUS = { ready: '', partial: '未完成', skipped: '未采用' } as const

/** 描述版本来源，实时续稿带上本场的段号。 */
function revisionSource(record: ScriptHistoryRecord): string {
  if (record.kind === 'saved') return '人工保存'
  if (record.kind === 'draft') return '首篇生成'
  return `实时续稿 · 第 ${record.segmentIndex} 段`
}

/** 用当前直播账号查询文案历史，切换账号时关闭已打开的版本。 */
export default function ScriptHistoryPage() {
  const accountId = useAccounts(state => state.currentAccountId)
  return (
    <div className="@container mx-auto max-w-7xl space-y-5 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Title title="文案历史" description="核对每次生成和保存的正文，以及当时引用的资料。" />
        <Button asChild variant="outline">
          <Link to="/live-speech#script-studio">
            <ArrowLeft />
            返回直播话术
          </Link>
        </Button>
      </div>
      <AccountScriptHistory key={accountId} accountId={accountId} />
    </div>
  )
}

/** 分页显示账号内的文案，选中一版即可查看正文和引用快照。 */
function AccountScriptHistory({ accountId }: { accountId: string }) {
  const revision = useScriptHistoryStatus(state => state.revision)
  const saveError = useScriptHistoryStatus(state => state.saveErrors[accountId])
  const [records, setRecords] = useState<ScriptHistoryRecord[] | null>(null)
  const [pages, setPages] = useState<Pick<ScriptHistoryRecord, 'createdAt' | 'id'>[]>([])
  const [activeId, setActiveId] = useState('')
  const [readError, setReadError] = useState(false)
  const before = pages.at(-1)

  useEffect(() => {
    let active = true
    void listScriptHistory(accountId, before, PAGE_SIZE + 1).then(
      items => {
        if (active && useScriptHistoryStatus.getState().revision === revision) {
          setRecords(items)
          setReadError(false)
        }
      },
      () => {
        if (active) setReadError(true)
      },
    )
    return () => {
      active = false
    }
  }, [accountId, before, revision])

  const shown = records?.slice(0, PAGE_SIZE) ?? []
  const selected = shown.find(record => record.id === activeId) ?? shown[0]

  /** 保留上一页的游标，新增文案时仍能返回正在核查的位置。 */
  function showOlder() {
    const last = shown.at(-1)
    if (last) setPages([...pages, { createdAt: last.createdAt, id: last.id }])
  }

  return (
    <>
      {saveError && (
        <p role="alert" className="text-sm text-destructive">
          部分文案未能写入历史，请检查本机存储空间。
        </p>
      )}
      {readError ? (
        <p role="alert" className="text-sm text-destructive">
          无法读取文案历史，请重新打开此页。
        </p>
      ) : !records ? (
        <output className="block text-sm text-muted-foreground">正在读取文案历史…</output>
      ) : !selected ? (
        <p className="rounded-xl border bg-card px-5 py-8 text-sm text-muted-foreground">
          还没有文案历史。生成首篇、开始续稿或保存话术后即可查看。
        </p>
      ) : (
        <div className="grid items-start gap-4 @min-[730px]:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
          <Card className="min-w-0 shadow-none">
            <CardContent className="space-y-2 p-3">
              <div className="max-h-[28rem] space-y-1 overflow-auto">
                {shown.map(record => (
                  <Button
                    key={record.id}
                    type="button"
                    variant={record.id === selected.id ? 'secondary' : 'ghost'}
                    aria-pressed={record.id === selected.id}
                    className="h-auto w-full min-w-0 flex-col items-start gap-1 px-3 py-2 text-left whitespace-normal"
                    onClick={() => setActiveId(record.id)}
                  >
                    <span className="max-w-full break-words">{record.title}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {revisionSource(record)}
                      {record.status !== 'ready' && ` · ${STATUS[record.status]}`}
                    </span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {record.createdAt ? dateFormat.format(record.createdAt) : '保存时间未知'}
                    </span>
                  </Button>
                ))}
              </div>
              {(pages.length > 0 || records.length > PAGE_SIZE) && (
                <div className="flex flex-wrap gap-2 px-2 pb-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!pages.length}
                    onClick={() => setPages(pages.slice(0, -1))}
                  >
                    较新
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={records.length <= PAGE_SIZE}
                    onClick={showOlder}
                  >
                    较早
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          <ScriptRevision key={selected.id} record={selected} />
        </div>
      )}
    </>
  )
}

/** 原样呈现当时的正文与资料快照，避免后续编辑覆盖核查依据。 */
function ScriptRevision({ record }: { record: ScriptHistoryRecord }) {
  const references = [
    ['原话术', record.references.sourceScript],
    ['产品介绍', record.references.productIntro],
    ['商品要素与参考资料', record.references.referenceText],
    ['补充要求', record.references.requirements],
    ['本场首篇播稿', record.seedScript === record.references.sourceScript ? '' : record.seedScript],
  ].filter(([, value]) => value?.trim())
  return (
    <Card className="min-w-0 shadow-none">
      <CardContent className="space-y-4 p-5">
        <div className="space-y-1">
          <h2 className="text-base font-semibold break-words">{record.title}</h2>
          <p className="text-xs text-muted-foreground">
            {revisionSource(record)} · {countScriptCharacters(record.text)} 字
            {record.model && ` · ${record.model}`}
          </p>
          {record.theme && (
            <p className="text-xs text-muted-foreground">本段主题　{record.theme}</p>
          )}
          {record.note && <p className="text-sm text-muted-foreground">{record.note}</p>}
        </div>
        <section aria-label="文案正文">
          <pre className="max-h-96 overflow-auto rounded-md bg-muted p-4 font-sans text-sm leading-relaxed break-words whitespace-pre-wrap">
            {record.text}
          </pre>
        </section>
        {references.length > 0 && (
          <details className="border-t pt-3">
            <summary className="cursor-pointer text-sm font-medium">当时的参考依据</summary>
            <div className="mt-3 space-y-3">
              {references.map(([label, value]) => (
                <div key={label} className="space-y-1">
                  <h3 className="text-sm font-medium">{label}</h3>
                  <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-sans text-sm leading-relaxed break-words whitespace-pre-wrap">
                    {value}
                  </pre>
                </div>
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  )
}
