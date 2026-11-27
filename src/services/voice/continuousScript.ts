import {
  type ContinuationScriptRequest,
  countScriptCharacters,
  type LiveScriptResult,
  type ScriptOutputStatus,
} from 'shared/liveScript'
import { splitSpeechText } from 'shared/voice'

export const CONTINUATION_THEMES = [
  '挑一天里的一个时刻，聊聊什么时候会用上',
  '从一种常见习惯说起，怎么按自己的习惯挑',
  '说一个容易忽略的小细节，放到平时有什么用',
  '挑一个买之前容易犹豫的问题聊清楚',
  '从实际用起来的一小步说起，聊聊怎么做更顺手',
  '说说在几种选择之间纠结时，可以先看哪一点',
  '从一个自然的小问题聊到观众自己的需要',
  '换一个还没聊过的生活场景，顺带提一下最相关的参数',
] as const

export interface ContinuousScriptConfig {
  accountId: string
  seedScript: string
  sourceScript?: string
  scriptTitle?: string
  productIntro: string
  referenceText: string
  requirements: string
  provider: string
  model: string
  apiKey: string
  customBaseURL?: string
}

export interface ContinuousScriptState {
  status: 'idle' | 'waiting' | 'generating' | 'retrying' | 'error'
  theme: string
  generatedSegments: number
  error: string
}

export interface ContinuousScriptDriver {
  generate(request: ContinuationScriptRequest, signal: AbortSignal): Promise<LiveScriptResult>
  onAttempt?(
    request: ContinuationScriptRequest,
    output: { text: string; status: ScriptOutputStatus; note?: string },
    title?: string,
  ): void
  onText(text: string): void
  onState(state: ContinuousScriptState): void
}

/** 只比较足够长的非参数句，拦截模型整段复读，同时允许必要的商品信息重提。 */
function repeatedSentenceShare(text: string, history: string[]): number {
  const known = new Set(
    history
      .flatMap(item => splitSpeechText(item))
      .map(item => item.replace(/[\s，。！？、；,.!?;:：]/gu, ''))
      .filter(item => item.length >= 14 && !/\d|价格|容量|规格|材质/.test(item)),
  )
  const sentences = splitSpeechText(text)
    .map(item => item.replace(/[\s，。！？、；,.!?;:：]/gu, ''))
    .filter(item => item.length >= 14 && !/\d|价格|容量|规格|材质/.test(item))
  if (!sentences.length) return 0
  const seen = new Set<string>()
  let repeated = 0
  for (const sentence of sentences) {
    if (known.has(sentence) || seen.has(sentence)) repeated++
    seen.add(sentence)
  }
  return repeated / sentences.length
}

/** 长底稿分成较短的续稿批次，减少同一话题持续太久。 */
export function continuationTarget(seedScript: string): number {
  return Math.max(400, Math.min(1000, countScriptCharacters(seedScript)))
}

/** 继续按底稿规模预留生成时间，缩短续稿批次时也保留提前量。 */
export function continuationThreshold(seedCharacters: number): number {
  return seedCharacters <= 1000
    ? Math.max(400, seedCharacters)
    : Math.max(600, Math.min(1200, Math.round(seedCharacters * 0.48)))
}

/** 管理单场直播的提前供稿、主题轮换、重复检测、有限重试与取消。 */
export class ContinuousScriptController {
  private config: ContinuousScriptConfig | null = null
  private controller = new AbortController()
  private generation = 0
  private generating = false
  private failed = false
  private themeIndex = 0
  private history: string[] = []
  private usedThemes: string[] = []
  private remainingCharacters = 0
  private rearmAtCharacters = Number.POSITIVE_INFINITY
  private paused = false
  private state: ContinuousScriptState = {
    status: 'idle',
    theme: '',
    generatedSegments: 0,
    error: '',
  }

  constructor(private driver: ContinuousScriptDriver) {}

  /** 开始新会话，保留本场底稿快照并丢弃上一场的迟到结果。 */
  start(config: ContinuousScriptConfig): void {
    this.stop()
    this.config = { ...config }
    this.controller = new AbortController()
    this.history = [config.seedScript]
    this.usedThemes = []
    this.themeIndex = 0
    this.rearmAtCharacters = Number.POSITIVE_INFINITY
    this.failed = false
    this.publish({ status: 'waiting', theme: '', generatedSegments: 0, error: '' })
  }

  /** 根据尚未朗读的真实文字量决定是否需要提前生成下一段。 */
  observe(running: boolean, paused: boolean, remainingCharacters: number): void {
    if (!this.config) return
    if (!running) {
      this.stop()
      return
    }
    this.paused = paused
    this.remainingCharacters = remainingCharacters
    if (paused || this.generating || this.failed || remainingCharacters > this.rearmAtCharacters)
      return
    if (remainingCharacters <= continuationThreshold(countScriptCharacters(this.config.seedScript)))
      void this.generateNext()
  }

  /** 开播预备阶段主动获取一段续稿，用于底稿不足以覆盖预备时长的情况。 */
  async prepareNext(): Promise<void> {
    if (!this.config) throw new Error('续稿会话尚未开始')
    await this.generateNext(true)
    if (this.failed) throw new Error(this.state.error)
  }

  /** 取消模型请求，清除会话历史并让所有迟到结果失效。 */
  stop(): void {
    this.generation++
    this.controller.abort()
    this.config = null
    this.generating = false
    this.failed = false
    this.history = []
    this.publish({ status: 'idle', theme: '', generatedSegments: 0, error: '' })
  }

  /** 广播独立供稿状态，让界面能区分模型等待与 TTS 等待。 */
  private publish(patch: Partial<ContinuousScriptState>): void {
    this.state = { ...this.state, ...patch }
    this.driver.onState({ ...this.state })
  }

  /** 生成新角度的完整段落；失败最多重试两次，成功后由队列按句预合成。 */
  private async generateNext(preparing = false): Promise<void> {
    const config = this.config
    if (!config || this.generating) return
    this.generating = true
    const generation = this.generation
    const signal = this.controller.signal
    let lastError = '续稿失败'
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal.aborted || generation !== this.generation) return
      const theme = CONTINUATION_THEMES[this.themeIndex++ % CONTINUATION_THEMES.length]
      this.publish({ status: attempt ? 'retrying' : 'generating', theme, error: '' })
      const request: ContinuationScriptRequest = {
        mode: 'continuation',
        requestId: crypto.randomUUID(),
        accountId: config.accountId,
        provider: config.provider,
        model: config.model,
        apiKey: config.apiKey,
        customBaseURL: config.customBaseURL,
        productIntro: config.productIntro,
        referenceText: config.referenceText,
        sourceScript: config.sourceScript ?? config.seedScript,
        requirements: config.requirements,
        seedScript: config.seedScript,
        targetCharacters: continuationTarget(config.seedScript),
        segmentIndex: this.state.generatedSegments + 1,
        theme,
        recentThemes: this.usedThemes.slice(-6),
        recentSamples: this.history
          .slice(-3)
          .map(text =>
            text.length <= 1000 ? text : `${text.slice(0, 500)}\n…\n${text.slice(-450)}`,
          ),
      }
      try {
        const result = await this.driver.generate(request, signal)
        const stale = signal.aborted || generation !== this.generation
        const text = result.text
        let rejection = result.error ?? ''
        if (result.cancelled || stale) rejection ||= '续稿已取消'
        else if (!rejection && countScriptCharacters(text) < 160)
          rejection = '续稿字数不足，需至少约 160 字'
        else if (!rejection && repeatedSentenceShare(text, this.history.slice(-3)) > 0.32)
          rejection = '续稿与近期内容重复过多'
        if (text.trim())
          this.driver.onAttempt?.(
            request,
            {
              text,
              status:
                stale || result.cancelled || result.error
                  ? 'partial'
                  : rejection
                    ? 'skipped'
                    : 'ready',
              note: rejection || (result.truncated ? '模型输出达到上限' : undefined),
            },
            config.scriptTitle,
          )
        if (stale) return
        if (rejection) throw new Error(rejection)
        this.history.push(text)
        this.history = this.history.slice(-3)
        this.usedThemes.push(theme)
        this.usedThemes = this.usedThemes.slice(-12)
        const remainingBeforeSupply = this.remainingCharacters
        this.driver.onText(text)
        this.remainingCharacters = Math.max(
          this.remainingCharacters,
          remainingBeforeSupply + countScriptCharacters(text),
        )
        this.rearmAtCharacters =
          this.remainingCharacters - Math.min(100, Math.round(request.targetCharacters * 0.1))
        this.publish({
          status: 'waiting',
          theme,
          generatedSegments: this.state.generatedSegments + 1,
          error: '',
        })
        this.generating = false
        if (!preparing) this.observe(true, this.paused, this.remainingCharacters)
        return
      } catch (error) {
        if (signal.aborted || generation !== this.generation) return
        lastError = error instanceof Error ? error.message : '续稿失败'
      }
    }
    if (signal.aborted || generation !== this.generation) return
    this.generating = false
    this.failed = true
    this.publish({
      status: 'error',
      error: `续稿失败：${lastError}。请检查文本模型后重新开始播报。`,
    })
  }
}
