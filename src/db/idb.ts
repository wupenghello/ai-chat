/** REQ-006：IndexedDB 持久化（只被 stores 调用；测试中整体 mock） */

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
