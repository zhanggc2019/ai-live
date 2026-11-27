import type { LiveScriptInput, ScriptOutputStatus } from 'shared/liveScript'
import { create } from 'zustand'

export interface VoiceHistorySession {
  id: string
  accountId: string
  title: string
  mode: 'live' | 'local'
  startedAt: number
  clipCount: number
}

export interface VoiceHistoryClip {
  index: number
  text: string
  playedAt: number
  playbackRate: number
  durationSeconds: number | null
  synthesisMs: number
}

export const useVoiceHistoryStatus = create<{
  revision: number
  error: { accountId: string; message: string } | null
}>(() => ({ revision: 0, error: null }))

export interface ScriptHistoryEntry {
  id: string
  accountId: string
  title: string
  createdAt: number
  kind: 'draft' | 'continuation' | 'saved'
  status: ScriptOutputStatus
  text: string
  model?: string
  segmentIndex?: number
  theme?: string
  note?: string
  seedScript?: string
}

export interface ScriptHistoryRecord extends ScriptHistoryEntry {
  references: LiveScriptInput
}

export const useScriptHistoryStatus = create<{
  revision: number
  saveErrors: Record<string, boolean>
}>(() => ({ revision: 0, saveErrors: {} }))

let database: Promise<IDBDatabase> | undefined

/** 文本索引与音频分开保存，浏览历史时只读取列表用到的数据。 */
function openHistory(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ai-live-voice-history', 2)
      request.onupgradeneeded = event => {
        const db = request.result
        if (event.oldVersion < 1) {
          db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('accountId', 'accountId')
          db.createObjectStore('clips')
          db.createObjectStore('audio')
        }
        db.createObjectStore('scriptHistory', { keyPath: ['accountId', 'id'] }).createIndex(
          'accountDate',
          ['accountId', 'createdAt', 'id'],
        )
      }
      request.onsuccess = () => {
        const db = request.result
        db.onclose = db.onversionchange = () => {
          db.close()
          database = undefined
        }
        resolve(db)
      }
      request.onerror = () => reject(request.error)
    }).catch(error => {
      database = undefined
      throw error
    })
  }
  return database
}

/** 将单次数据库读取转换为 Promise。 */
function read<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** 只在整个事务提交后更新界面，避免显示还没有音频的历史条目。 */
function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('历史记录保存失败'))
  })
}

/** 保存正文和原始依据。即使传入完整请求，也只记录审稿所需的字段。 */
export function archiveScriptHistory(entry: ScriptHistoryEntry, input: LiveScriptInput): void {
  if (!entry.text.trim()) return
  const references: LiveScriptInput = {
    productIntro: input.productIntro,
    referenceText: input.referenceText,
    sourceScript: input.sourceScript,
    requirements: input.requirements,
  }
  void openHistory()
    .then(async db => {
      const transaction = db.transaction('scriptHistory', 'readwrite', { durability: 'strict' })
      const done = committed(transaction)
      transaction.objectStore('scriptHistory').put({ ...entry, references })
      await done
      useScriptHistoryStatus.setState(state => ({ revision: state.revision + 1 }))
    })
    .catch(() => {
      useScriptHistoryStatus.setState(state => ({
        saveErrors: { ...state.saveErrors, [entry.accountId]: true },
      }))
    })
}

/** 用账号内的时间和 ID 游标分页，续稿持续生成时也能稳定翻看旧版本。 */
export async function listScriptHistory(
  accountId: string,
  before: Pick<ScriptHistoryEntry, 'createdAt' | 'id'> | undefined,
  limit: number,
): Promise<ScriptHistoryRecord[]> {
  const db = await openHistory()
  const range = IDBKeyRange.bound(
    [accountId, 0],
    before ? [accountId, before.createdAt, before.id] : [accountId, Number.MAX_SAFE_INTEGER],
    false,
    Boolean(before),
  )
  const request = db
    .transaction('scriptHistory')
    .objectStore('scriptHistory')
    .index('accountDate')
    .openCursor(range, 'prev')
  return new Promise((resolve, reject) => {
    const records: ScriptHistoryRecord[] = []
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor || records.length >= limit) {
        resolve(records)
        return
      }
      records.push(cursor.value)
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
  })
}

/** 按播出顺序将单句文本和音频一同持久化，已有场次的数据可跨重启读取。 */
export async function appendVoiceHistory(
  session: VoiceHistorySession,
  clip: Omit<VoiceHistoryClip, 'index'>,
  audio: Blob,
): Promise<void> {
  const db = await openHistory()
  const transaction = db.transaction(['sessions', 'clips', 'audio'], 'readwrite', {
    durability: 'strict',
  })
  const done = committed(transaction)
  const sessions = transaction.objectStore('sessions')
  const lookup = sessions.get(session.id)
  lookup.onsuccess = () => {
    const current: VoiceHistorySession = lookup.result ?? session
    const index = current.clipCount
    transaction.objectStore('clips').add({ ...clip, index }, [session.id, index])
    transaction.objectStore('audio').add(audio, [session.id, index])
    sessions.put({ ...current, clipCount: index + 1 })
  }
  await done
  useVoiceHistoryStatus.setState(state => ({ revision: state.revision + 1 }))
}

/** 返回当前账号的场次，最近开始的播报排在前面。 */
export async function listVoiceHistory(accountId: string): Promise<VoiceHistorySession[]> {
  const db = await openHistory()
  const rows: VoiceHistorySession[] = await read(
    db.transaction('sessions').objectStore('sessions').index('accountId').getAll(accountId),
  )
  return rows.sort((left, right) => right.startedAt - left.startedAt)
}

/** 按页读取话术，加载长场次时也无需一次读取全部音频。 */
export async function listVoiceHistoryClips(
  sessionId: string,
  offset: number,
  limit: number,
): Promise<VoiceHistoryClip[]> {
  const db = await openHistory()
  const range = IDBKeyRange.bound([sessionId, offset], [sessionId, offset + limit - 1])
  return read(db.transaction('clips').objectStore('clips').getAll(range))
}

/** 按段读取原始二进制音频及播出时所用的播放倍率。 */
export async function getVoiceHistoryClip(
  sessionId: string,
  index: number,
): Promise<{ clip: VoiceHistoryClip; audio: Blob }> {
  const db = await openHistory()
  const transaction = db.transaction(['clips', 'audio'])
  const key = [sessionId, index]
  const [clip, audio] = await Promise.all([
    read(transaction.objectStore('clips').get(key)),
    read(transaction.objectStore('audio').get(key)),
  ])
  if (!clip || !audio) throw new Error('该段音频已被删除或无法读取')
  return { clip, audio }
}

/** 同时删除指定场次的话术和音频，释放本地存储空间。 */
export async function deleteVoiceHistory(sessionId: string): Promise<void> {
  const db = await openHistory()
  const transaction = db.transaction(['sessions', 'clips', 'audio'], 'readwrite', {
    durability: 'strict',
  })
  const done = committed(transaction)
  const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER])
  transaction.objectStore('sessions').delete(sessionId)
  transaction.objectStore('clips').delete(range)
  transaction.objectStore('audio').delete(range)
  await done
  useVoiceHistoryStatus.setState(state => ({ revision: state.revision + 1 }))
}
