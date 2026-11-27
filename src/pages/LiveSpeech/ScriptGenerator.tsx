import { Loader2, Save, Sparkles, Square } from 'lucide-react'
import {
  countScriptCharacters,
  hasScriptReferences,
  type SavedLiveScript,
  saveLiveScript,
} from 'shared/liveScript'
import AIModelInfo from '@/components/ai-chat/AIModelInfo'
import { APIKeyDialog } from '@/components/ai-chat/APIKeyDialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAccounts } from '@/hooks/useAccounts'
import { useToast } from '@/hooks/useToast'
import { getVoiceConfig, useVoiceConfigStore } from '@/hooks/useVoiceConfig'
import { archiveScriptHistory } from '@/services/voice/history'
import {
  cancelScriptGeneration,
  generateScriptDraft,
  useScriptGeneration,
} from '@/services/voice/scriptGeneration'

/** 生成可编辑的长话术，支持命名保存、另存及下次开播选用。 */
export function ScriptGenerator({ onUseScript }: { onUseScript: (id: string) => void }) {
  const accountId = useAccounts(state => state.currentAccountId)
  useVoiceConfigStore(state => state.contexts[accountId])
  const config = getVoiceConfig(accountId)
  const update = useVoiceConfigStore(state => state.update)
  const generation = useScriptGeneration(state => state.contexts[accountId])
  const busy = Boolean(generation && generation.status !== 'idle')
  const draft = busy ? (generation?.text ?? '') : config.generatedScript
  const { toast } = useToast()

  /** 启动请求并显示缺少产品资料或模型配置的错误。 */
  async function generate() {
    try {
      await generateScriptDraft(accountId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成失败')
    }
  }

  /** 将编辑区里的正文和商品资料一起保存为同一个话术版本。 */
  function save(asNew: boolean, useForBroadcast = false) {
    try {
      const current = getVoiceConfig(accountId)
      const id = asNew ? undefined : current.scriptDraftId || undefined
      const savedScripts = saveLiveScript(current.savedScripts, {
        id,
        title: current.scriptDraftTitle,
        content: current.generatedScript,
        productIntro: current.productIntro,
        referenceText: current.referenceText,
        sourceScript:
          current.sourceScript || (hasScriptReferences(current) ? '' : current.generatedScript),
        scriptRequirements: current.scriptRequirements,
      })
      const previous = id && current.savedScripts.find(script => script.id === id)
      if (previous) archiveSavedVersion(previous)
      archiveSavedVersion(savedScripts[0])
      update(accountId, {
        savedScripts,
        scriptDraftId: savedScripts[0].id,
        scriptDraftTitle: savedScripts[0].title,
        generatedScript: savedScripts[0].content,
        sourceScript: savedScripts[0].sourceScript ?? '',
      })
      if (useForBroadcast) onUseScript(savedScripts[0].id)
      toast.success(useForBroadcast ? '话术已保存并选用' : '话术与商品资料已保存')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    }
  }

  /** 留档每次人工保存，首次覆盖旧版本时也把覆盖前的正文收进历史。 */
  function archiveSavedVersion(script: SavedLiveScript) {
    archiveScriptHistory(
      {
        id: `saved:${script.id}:${script.updatedAt ?? 'original'}`,
        accountId,
        title: script.title,
        createdAt: Number.isFinite(Date.parse(script.updatedAt)) ? Date.parse(script.updatedAt) : 0,
        kind: 'saved',
        status: 'ready',
        text: script.content,
      },
      {
        productIntro: script.productIntro ?? '',
        referenceText: script.referenceText,
        sourceScript: script.sourceScript ?? script.content,
        requirements: script.scriptRequirements ?? '',
      },
    )
  }

  /** 载入已保存条目的正文与商品资料，不改变本次播报选择。 */
  function load(id: string) {
    const script = config.savedScripts.find(item => item.id === id)
    if (script)
      update(accountId, {
        scriptDraftId: id,
        scriptDraftTitle: script.title,
        generatedScript: script.content,
        productIntro: script.productIntro ?? '',
        referenceText: script.referenceText ?? '',
        sourceScript: script.sourceScript ?? script.content,
        scriptRequirements: script.scriptRequirements ?? '',
      })
  }

  /** 新建独立草稿，清空上一份话术的产品资料以防串稿。 */
  function newDraft() {
    update(accountId, {
      scriptDraftId: '',
      scriptDraftTitle: '',
      generatedScript: '',
      productIntro: '',
      referenceText: '',
      sourceScript: '',
      scriptRequirements: '',
    })
  }

  /** 删除库中选中的版本，保留编辑草稿及其商品资料。 */
  function removeSavedScript() {
    const current = getVoiceConfig(accountId)
    update(accountId, {
      savedScripts: current.savedScripts.filter(script => script.id !== current.scriptDraftId),
      scriptDraftId: '',
      ...(current.selectedScriptId === current.scriptDraftId ? { selectedScriptId: '' } : {}),
    })
    toast.success('已从话术库删除，当前编辑正文仍保留')
  }

  const selected = config.savedScripts.find(script => script.id === config.scriptDraftId)
  const hasUnsavedChanges = Boolean(
    selected &&
      (selected.content !== config.generatedScript ||
        selected.title !== config.scriptDraftTitle ||
        (selected.productIntro ?? '') !== config.productIntro ||
        (selected.referenceText ?? '') !== config.referenceText ||
        (selected.sourceScript ?? selected.content) !== config.sourceScript ||
        (selected.scriptRequirements ?? '') !== config.scriptRequirements),
  )

  return (
    <Card id="script-studio" className="@container min-w-0 scroll-mt-4 shadow-none">
      <CardHeader className="px-5 pt-5 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">文案生成</h2>
          <Button variant="outline" size="sm" disabled={busy} onClick={newDraft}>
            新建话术
          </Button>
        </div>
        <CardDescription>填写商品资料，生成或编辑直播话术。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-5 pb-5">
        {config.savedScripts.length > 0 && (
          <div className="space-y-2 border-b pb-4">
            <Label htmlFor="script-library">打开已保存话术</Label>
            <Select disabled={busy} value={config.scriptDraftId || undefined} onValueChange={load}>
              <SelectTrigger id="script-library" className="w-full">
                <SelectValue placeholder="选择一份话术载入编辑器" />
              </SelectTrigger>
              <SelectContent>
                {config.savedScripts.map(script => (
                  <SelectItem key={script.id} value={script.id}>
                    {script.title} · {countScriptCharacters(script.content)} 字
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid gap-3 @min-[420px]:grid-cols-2">
          <div className="space-y-2 @min-[420px]:col-span-2">
            <Label htmlFor="script-product-intro">简短产品介绍</Label>
            <Textarea
              id="script-product-intro"
              value={config.productIntro}
              maxLength={8000}
              disabled={busy}
              className="min-h-16"
              placeholder="例如：500 毫升通勤水杯，杯盖可拆洗，适合办公室和出差。"
              onChange={event => update(accountId, { productIntro: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="script-requirements">补充要求（选填）</Label>
            <Textarea
              id="script-requirements"
              value={config.scriptRequirements}
              maxLength={1000}
              disabled={busy}
              className="min-h-16"
              placeholder="例如：亲切自然、不喊麦，重点讲解日常使用场景，适当穿插互动问题。"
              onChange={event => update(accountId, { scriptRequirements: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="script-reference-text">商品要素与参考资料</Label>
            <Textarea
              id="script-reference-text"
              aria-label="商品要素与参考资料"
              value={config.referenceText}
              maxLength={12000}
              disabled={busy}
              className="min-h-16"
              placeholder="产品名称、规格与适用人群、已确认的价格和优惠、常见问题与参考回答……"
              onChange={event => update(accountId, { referenceText: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">首篇、续稿和问答会参考这些资料。</p>
          </div>
          <div className="space-y-2 @min-[420px]:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="script-source">原话术（选填）</Label>
              {!config.sourceScript.trim() && draft.trim() && !busy && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => update(accountId, { sourceScript: draft })}
                >
                  用当前正文作原稿
                </Button>
              )}
            </div>
            <Textarea
              id="script-source"
              value={config.sourceScript}
              maxLength={20000}
              disabled={busy}
              className="min-h-16"
              placeholder="粘贴原来的文案。改写会参考里面的卖点和产品特色。"
              onChange={event => update(accountId, { sourceScript: event.target.value })}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <APIKeyDialog type="chat" />
            <AIModelInfo type="chat" />
          </div>
          {busy ? (
            <Button
              variant="outline"
              disabled={generation?.status === 'cancelling'}
              onClick={() => void cancelScriptGeneration(accountId)}
            >
              <Square className="h-4 w-4" />
              {generation?.status === 'cancelling' ? '正在停止…' : '停止生成'}
            </Button>
          ) : (
            <Button disabled={!hasScriptReferences(config)} onClick={generate}>
              <Sparkles className="h-4 w-4" />
              {config.sourceScript.trim() ? '按原话术改写' : '生成约 3000 字话术'}
            </Button>
          )}
        </div>
        <div className="space-y-2 border-t pt-4">
          <Label htmlFor="script-draft-title">话术名称</Label>
          <Input
            id="script-draft-title"
            value={config.scriptDraftTitle}
            maxLength={60}
            disabled={busy}
            placeholder="例如：水杯日常讲解版"
            onChange={event => update(accountId, { scriptDraftTitle: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="generated-script">话术正文（可编辑）</Label>
            <span className="text-xs text-muted-foreground">
              {countScriptCharacters(draft)} 字（不含空白）
              {hasUnsavedChanges ? ' · 有未保存修改' : ''}
            </span>
          </div>
          <Textarea
            id="generated-script"
            value={draft}
            readOnly={busy}
            maxLength={20000}
            className="min-h-52"
            placeholder="AI 生成的正文会逐步显示在这里，也可以直接粘贴或编辑已有话术。"
            onChange={event => update(accountId, { generatedScript: event.target.value })}
          />
          {busy && (
            <output className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在生成话术，可以切换页面；已生成 {countScriptCharacters(draft)} 字。
            </output>
          )}
          {generation?.error && (
            <p role="alert" className="text-sm text-destructive">
              {generation.error}
            </p>
          )}
          {!busy && generation?.notice && (
            <p className="text-sm text-muted-foreground">{generation.notice}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || !draft.trim() || !config.scriptDraftTitle.trim()}
            onClick={() => save(false)}
          >
            <Save className="h-4 w-4" />
            {config.scriptDraftId ? '保存修改' : '保存话术'}
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !draft.trim() || !config.scriptDraftTitle.trim()}
            onClick={() => save(false, true)}
          >
            保存并选用
          </Button>
          {config.scriptDraftId && (
            <Button
              variant="outline"
              disabled={busy || !draft.trim() || !config.scriptDraftTitle.trim()}
              onClick={() => save(true)}
            >
              另存为新话术
            </Button>
          )}
          {selected && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" disabled={busy}>
                  删除已保存版本
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>删除“{selected.title}”？</AlertDialogTitle>
                  <AlertDialogDescription>
                    将从当前账号的话术库移除该版本，编辑草稿及已载入的讲解正文仍然保留。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={removeSavedScript}>删除版本</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          编辑草稿会自动保留；点击保存后才更新话术库。已保存 {config.savedScripts.length} / 50
          份，每份最多 20000 字，按当前直播账号保存。
        </p>
      </CardContent>
    </Card>
  )
}
