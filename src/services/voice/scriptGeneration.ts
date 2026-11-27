import { IPC_CHANNELS } from 'shared/ipcChannels'
import { countScriptCharacters, hasScriptReferences } from 'shared/liveScript'
import { create } from 'zustand'
import { useAIProviderStore } from '@/hooks/useAIProvider'
import { getVoiceConfig, useVoiceConfigStore } from '@/hooks/useVoiceConfig'
import { EVENTS, eventEmitter } from '@/utils/events'
import { archiveScriptHistory } from './history'

interface GenerationState {
  requestId: string
  status: 'generating' | 'cancelling' | 'idle'
  text: string
  error: string
  notice: string
}

export const useScriptGeneration = create<{ contexts: Record<string, GenerationState> }>(() => ({
  contexts: {},
}))

/** 更新指定账号的生成状态；不同账号的进度互不覆盖。 */
function setGeneration(accountId: string, state: GenerationState): void {
  useScriptGeneration.setState(current => ({
    contexts: { ...current.contexts, [accountId]: state },
  }))
}

/** 使用 AI 助手的文本模型生成草稿；切页继续生成，不自动修改正在播报的话术。 */
export async function generateScriptDraft(accountId: string): Promise<void> {
  const current = useScriptGeneration.getState().contexts[accountId]
  if (current && current.status !== 'idle') throw new Error('当前账号正在生成话术')
  const config = getVoiceConfig(accountId)
  if (!hasScriptReferences(config)) throw new Error('请先填写产品介绍、参考资料或原话术')
  const rewriting = Boolean(config.sourceScript.trim())
  const title = rewriting
    ? `${(config.scriptDraftTitle.replace(/·口语版$/u, '').trim() || '直播话术').slice(0, 55)}·口语版`
    : `${config.productIntro.trim().slice(0, 18) || '商品'}·直播话术`
  const ai = useAIProviderStore.getState().chat
  const apiKey = ai.apiKeys[ai.config.provider]
  if (!apiKey?.trim() || !ai.config.model?.trim())
    throw new Error('请先配置 AI 文本模型与 API Key，TTS 密钥不用于写作')
  const requestId = crypto.randomUUID()
  const references = {
    productIntro: config.productIntro,
    referenceText: config.referenceText,
    sourceScript: config.sourceScript,
    requirements: config.scriptRequirements,
  }
  /** 先留档生成时的正文和依据，再让结果进入可编辑区。 */
  function storeDraft(text: string, note?: string) {
    if (!text.trim()) return
    archiveScriptHistory(
      {
        id: requestId,
        accountId,
        title,
        createdAt: Date.now(),
        kind: 'draft',
        status: note ? 'partial' : 'ready',
        note,
        model: ai.config.model,
        text,
      },
      references,
    )
    useVoiceConfigStore.getState().update(accountId, {
      generatedScript: text,
      scriptDraftId: '',
      scriptDraftTitle: title,
    })
  }
  let state: GenerationState = { requestId, status: 'generating', text: '', error: '', notice: '' }
  setGeneration(accountId, state)
  const unsubscribe = window.ipcRenderer.on(IPC_CHANNELS.liveScript.progress, progress => {
    if (
      progress.requestId !== requestId ||
      progress.accountId !== accountId ||
      useScriptGeneration.getState().contexts[accountId]?.requestId !== requestId
    )
      return
    state = { ...state, text: (state.text + progress.chunk).slice(0, 20000) }
    setGeneration(accountId, {
      ...state,
      status: useScriptGeneration.getState().contexts[accountId].status,
    })
  })
  try {
    const result = await window.ipcRenderer.invoke(IPC_CHANNELS.liveScript.generate, {
      requestId,
      accountId,
      ...references,
      provider: ai.config.provider,
      model: ai.config.model,
      apiKey,
      customBaseURL: ai.customBaseURL,
    })
    if (useScriptGeneration.getState().contexts[accountId]?.requestId !== requestId) return
    const text = result.text || state.text
    storeDraft(
      text,
      result.error ||
        (result.cancelled ? '已停止生成' : result.truncated ? '模型输出达到上限' : undefined),
    )
    const count = countScriptCharacters(text)
    const notice = result.cancelled
      ? '已停止生成，当前内容保留为可编辑草稿。'
      : result.truncated
        ? '模型输出达到上限，当前内容可能未写完，可编辑后保存或重新生成。'
        : !rewriting && (count < 2700 || count > 3300)
          ? `当前约 ${count} 字，可核对商品事实后编辑或保存。`
          : '话术已生成，可以编辑、命名并保存到话术库。'
    setGeneration(accountId, { ...state, status: 'idle', text, error: result.error ?? '', notice })
  } catch (error) {
    if (useScriptGeneration.getState().contexts[accountId]?.requestId !== requestId) return
    storeDraft(state.text, '生成失败，保留已收到的正文')
    setGeneration(accountId, {
      ...state,
      status: 'idle',
      error: error instanceof Error ? error.message : '生成失败，请重试',
    })
  } finally {
    unsubscribe()
  }
}

/** 取消当前账号的生成请求，已到达的内容仍可编辑和保存。 */
export async function cancelScriptGeneration(accountId: string): Promise<void> {
  const state = useScriptGeneration.getState().contexts[accountId]
  if (!state || state.status === 'idle') return
  setGeneration(accountId, { ...state, status: 'cancelling' })
  try {
    await window.ipcRenderer.invoke(IPC_CHANNELS.liveScript.cancel, state.requestId)
  } catch {
    const current = useScriptGeneration.getState().contexts[accountId]
    if (current?.requestId === state.requestId && current.status !== 'idle')
      setGeneration(accountId, {
        ...current,
        status: 'generating',
        error: '取消失败，请重试；生成将在超时后自动结束',
      })
  }
}

eventEmitter.on(EVENTS.ACCOUNT_REMOVED, (accountId: string) => {
  void cancelScriptGeneration(accountId)
  useScriptGeneration.setState(state => {
    const contexts = { ...state.contexts }
    delete contexts[accountId]
    return { contexts }
  })
})
