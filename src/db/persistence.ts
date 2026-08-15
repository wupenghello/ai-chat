/**
 * 会话持久化 —— 服务端适配层（REQ-022 核心，iter-6 T3）。
 *
 * 与原 db/idb.ts 同接口（loadSessions/saveSession/deleteSession），
 * stores/sessions 只改了 import 来源；IndexedDB 自此不再产生新的会话写入，
 * db/idb.ts 保留为 v0.4.0 及以前本地数据的一次性迁移源（导入入口 iter-8）。
 * 冲突策略 LWW：PUT 整档覆盖，被覆盖端下次加载以后端为准（CEO 定案）。
 */

import { request } from '../api/backend'
import type { PersistedSession } from './idb'

export type { PersistedSession }

export async function loadSessions(): Promise<PersistedSession[]> {
  const list = await request<PersistedSession[]>('GET', '/api/sessions')
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveSession(session: PersistedSession): Promise<void> {
  await request('PUT', `/api/sessions/${encodeURIComponent(session.id)}`, session)
}

export async function deleteSession(id: string): Promise<void> {
  await request('DELETE', `/api/sessions/${encodeURIComponent(id)}`)
}
