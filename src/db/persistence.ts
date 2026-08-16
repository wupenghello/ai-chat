/**
 * 会话持久化 —— 服务端适配层（REQ-022 核心，iter-6 T3）+ 断网暂存与自动重试（iter-7 T3）。
 *
 * 与原 db/idb.ts 同接口（loadSessions/saveSession/deleteSession），
 * stores/sessions 只改了 import 来源；IndexedDB 自此不再产生新的会话写入，
 * db/idb.ts 保留为 v0.4.0 及以前本地数据的一次性迁移源（导入入口 iter-8）。
 * 冲突策略 LWW：PUT 整档覆盖，被覆盖端下次加载以后端为准（CEO 定案）。
 *
 * 断网暂存（REQ-022 异常分支「写回失败」）：
 * - 写回失败且属临时性（网络层失败/5xx）→ 操作入 localStorage 暂存队列，不静默丢数据；
 *   401 等逻辑性失败不入队（登录失效走既有跳转）
 * - 同一会话在队列中只保留最后一次操作（put 整档覆盖/delete），压缩后重放结果与逐条
 *   按序重放一致——LWW 语义不被乱序破坏
 * - 自动重试：浏览器 online 事件 + 入队 5s 退避 + 队列非空时每 30s；逐条按序重放，
 *   临时性失败中断本轮（保序），非临时性（如 4xx 毒丸）丢弃继续
 * - 连续失败提示「部分更改未同步」（spec 定稿文案）：同一积压期只提示一次，队列清空后重置
 */

import { ApiBackendError, request } from '../api/backend'
import type { PersistedSession } from './idb'
import { useToastStore } from '../stores/toast'

export type { PersistedSession }

type PendingOp = {
  seq: number // 单调序号：重放出队按身份移除（DEF-017 竞态——重放期间同 id 新入队时 slice(1) 会错删他项）
  kind: 'put' | 'delete'
  id: string
  data?: PersistedSession
}

const QUEUE_KEY = 'ai-chat:pending-ops'

/** 临时性失败（断网/后端暂不可用）才暂存；4xx 是逻辑错误，重放也必然失败 */
function isTransient(e: unknown): boolean {
  return e instanceof ApiBackendError && (e.status === 0 || e.status >= 500)
}

function loadQueue(): PendingOp[] {
  try {
    const raw = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function storeQueue(q: PendingOp[]): void {
  if (q.length === 0) localStorage.removeItem(QUEUE_KEY)
  else localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
}

/** 暂存队列当前长度（观测/测试用；亦可供 UI 判断「有未同步更改」） */
export function pendingOpsCount(): number {
  return loadQueue().length
}

let unsyncWarned = false

function warnUnsynced(): void {
  if (unsyncWarned) return
  unsyncWarned = true
  useToastStore().push('部分更改未同步，恢复网络后自动重试')
}

function enqueue(op: Omit<PendingOp, 'seq'>): void {
  const q = loadQueue().filter((o) => o.id !== op.id) // 同会话只留最后操作（LWW 压缩）
  const seq = (q.at(-1)?.seq ?? 0) + 1
  q.push({ ...op, seq })
  storeQueue(q)
  warnUnsynced()
}

export async function loadSessions(): Promise<PersistedSession[]> {
  const list = await request<PersistedSession[]>('GET', '/api/sessions')
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveSession(session: PersistedSession): Promise<void> {
  const id = encodeURIComponent(session.id)
  try {
    await request('PUT', `/api/sessions/${id}`, session)
  } catch (e) {
    if (isTransient(e)) {
      enqueue({ kind: 'put', id: session.id, data: session })
      scheduleReplay()
    } else {
      throw e
    }
  }
}

export async function deleteSession(id: string): Promise<void> {
  const enc = encodeURIComponent(id)
  try {
    await request('DELETE', `/api/sessions/${enc}`)
  } catch (e) {
    if (isTransient(e)) {
      enqueue({ kind: 'delete', id })
      scheduleReplay()
    } else {
      throw e
    }
  }
}

// ---- 自动重试 ----

let replaying = false

/** 按序重放暂存队列；临时性失败中断本轮（保持顺序），全部成功后清队列与提示状态 */
export async function flushPending(): Promise<void> {
  if (replaying) return
  replaying = true
  try {
    while (true) {
      const q = loadQueue()
      if (q.length === 0) break
      const op = q[0]
      const enc = encodeURIComponent(op.id)
      try {
        if (op.kind === 'put') await request('PUT', `/api/sessions/${enc}`, op.data)
        else await request('DELETE', `/api/sessions/${enc}`)
      } catch (e) {
        if (isTransient(e)) return // 仍断网：保留队列，等下一轮触发
        // 非临时性失败（毒丸）：丢弃该条继续，避免卡死后续操作
        storeQueue(loadQueue().filter((o) => o.seq !== op.seq))
        continue
      }
      // 按 seq 身份出队：重放的 await 期间可能同 id 新入队（DEF-017 竞态），
      // slice(1) 会错删队头之后被压缩重排的其他项——filter 精确移除本条
      storeQueue(loadQueue().filter((o) => o.seq !== op.seq))
    }
    unsyncWarned = false // 队列清空：下一次积压重新提示
  } finally {
    replaying = false
  }
}

let retryTimer: ReturnType<typeof setTimeout> | undefined
let pollTimer: ReturnType<typeof setInterval> | undefined

function scheduleReplay(): void {
  clearTimeout(retryTimer)
  retryTimer = setTimeout(() => void flushPending(), 5000)
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flushPending())
  pollTimer = setInterval(() => {
    if (pendingOpsCount() > 0) void flushPending()
  }, 30_000)
}

/** 测试用：停掉模块级轮询定时器，避免句柄泄漏干扰用例 */
export function _stopPolling(): void {
  clearInterval(pollTimer)
}
