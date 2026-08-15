/**
 * REQ-006（CHG-004 改写）：IndexedDB 持久化 —— 自 iter-6 T3 起不再作为运行时存储，
 * 仅保留为 v0.4.0 及以前本地数据的一次性迁移源（「导入本地会话到云端」入口 iter-8）。
 * 运行时读写已切至 db/persistence.ts（服务端，REQ-022）。
 */

const DB_NAME = 'ai-chat'
const STORE = 'sessions'
const VERSION = 1

export interface PersistedMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  status: 'done' | 'generating' | 'interrupted' | 'stopped' | 'error'
  error?: { kind: string; message: string }
  /** REQ-019：有可切换版本时指向 Session.branches 的 key */
  forkId?: string
  /** REQ-019：版本序号（0=新版，1=旧版），供版本计数器展示 */
  forkIndex?: 0 | 1
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
