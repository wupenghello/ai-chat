/**
 * REQ-006（CHG-004 改写）：IndexedDB 持久化 —— 自 iter-6 T3 起不再作为运行时存储，
 * 仅保留为 v0.4.0 及以前本地数据的一次性迁移源（「导入本地会话到云端」入口 iter-8）。
 * 运行时读写已切至 db/persistence.ts（服务端，REQ-022）。
 */

import type { Block } from '../api/client'

const DB_NAME = 'ai-chat'
const STORE = 'sessions'
const VERSION = 1

export interface PersistedMessage {
  id: string
  role: 'user' | 'assistant'
  /** CHG-007 REQ-032（iter-13 T2）：v1 = string（存量与用户消息恒 string）；v2 assistant = blocks */
  content: string | Block[]
  status: 'done' | 'generating' | 'interrupted' | 'stopped' | 'error'
  error?: { kind: string; message: string }
  /** REQ-019：有可切换版本时指向 Session.branches 的 key */
  forkId?: string
  /** REQ-019：版本序号（0=新版，1=旧版），供版本计数器展示 */
  forkIndex?: 0 | 1
  /** CHG-007 REQ-030：turn.end(max_steps) 定型标注 */
  maxSteps?: boolean
}

export interface PersistedSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: PersistedMessage[]
  /** REQ-009 × REQ-012：手动改名后置 true，自动命名不再覆盖 */
  renamed?: boolean
  /** REQ-019：版本分支存档（key=forkId，value=深拷贝的替代分支消息序列） */
  branches?: Record<string, PersistedMessage[]>
  /** CHG-007（iter-13 T2）：整档写侧守卫载体——新客户端 PUT 恒带 2；无标记 = v1 老档。
   *  与消息级 v1/v2 独立（消息按 content 类型各自判定，branches 内可混流） */
  schema?: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

function isValidSession(s: unknown): s is PersistedSession {
  return (
    !!s &&
    typeof s === 'object' &&
    typeof (s as PersistedSession).id === 'string' &&
    Array.isArray((s as PersistedSession).messages)
  )
}

/** 读取全部会话；单条损坏不炸整体，标记 corrupted 由调用方处理 */
export async function loadSessions(): Promise<PersistedSession[]> {
  const rows = await tx<PersistedSession[]>('readonly', (s) => s.getAll() as IDBRequest<PersistedSession[]>)
  return rows.filter(isValidSession).sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveSession(session: PersistedSession): Promise<void> {
  await tx('readwrite', (s) => s.put(session))
}

export async function deleteSession(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id))
}

/** REQ-022/006（iter-8 T3）：导入完成 30 天后整库删除（只读安全窗到期清除，可观测验收） */
export function purgeLegacyDb(): Promise<void> {
  dbPromise = null
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve() // 删除失败不阻塞启动，下次到期检查再试
    req.onblocked = () => resolve()
  })
}
