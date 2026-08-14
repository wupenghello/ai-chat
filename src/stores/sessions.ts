import { defineStore } from 'pinia'
import { buildContext, streamChat, type ChatMessage } from '../api/client'
import { useSettingsStore } from './settings'
import * as db from '../db/idb'
import type { PersistedSession } from '../db/idb'

export type MessageStatus = 'done' | 'generating' | 'interrupted' | 'error'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  status: MessageStatus
  error?: { kind: string; message: string }
}

export interface Session extends PersistedSession {
  messages: Message[]
  /** REQ-004：损坏会话灰化展示，不可进入 */
  corrupted?: boolean
}

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`

const titleOf = (text: string) => (text.trim().slice(0, 20) || '新会话')

/** 会话内可作为上下文的消息：用户消息 + 有内容的 ai 回复（错误/空回复不进上下文） */
function toContext(messages: Message[]): ChatMessage[] {
  return messages
    .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content && m.status !== 'error'))
    .map((m) => ({ role: m.role, content: m.content }))
}

export const useSessionsStore = defineStore('sessions', {
  state: () => ({
    sessions: [] as Session[],
    activeId: null as string | null,
    generating: false,
    controller: null as AbortController | null,
  }),

  getters: {
    active(state): Session | null {
      return state.sessions.find((s) => s.id === state.activeId) ?? null
    },
  },

  actions: {
    /** 启动时恢复；流式中断的刷新恢复为 interrupted（REQ-006 验收） */
    async init() {
      const rows = await db.loadSessions()
      this.sessions = rows.map((r) => ({
        ...r,
        corrupted: r.messages === null || r.messages === undefined,
        messages: (r.messages ?? []).map((m) => (m.status === 'generating' ? { ...m, status: 'interrupted' } : m)),
      }))
      this.activeId = this.sessions[0]?.id ?? null
    },

    persist(session: Session) {
      const { corrupted: _c, ...clean } = session
      // Pinia 的 reactive Proxy 无法被 IndexedDB 结构化克隆，深拷贝为普通对象
      return db.saveSession(JSON.parse(JSON.stringify(clean)))
    },

    /** 生成中新建/切换 = 中断当前并标注（REQ-003/004） */
    abortActive() {
      if (!this.controller) return
      this.controller.abort()
      this.controller = null
    },

    createSession(): string {
      this.abortActive()
      const s: Session = {
        id: uid(),
        title: '新会话',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      }
      this.sessions.unshift(s)
      this.activeId = s.id
      void this.persist(s)
      return s.id
    },

    switchTo(id: string) {
      const target = this.sessions.find((s) => s.id === id)
      if (!target || target.corrupted) return
      this.abortActive()
      this.activeId = id
    },

    async removeSession(id: string) {
      if (this.activeId === id) this.abortActive()
      this.sessions = this.sessions.filter((s) => s.id !== id)
      if (this.activeId === id) this.activeId = this.sessions[0]?.id ?? null
      await db.deleteSession(id)
    },

    /** 发送一条消息并流式生成回复。返回 false 表示未配置（UI 负责引导设置页） */
    async send(text: string): Promise<boolean> {
      const settings = useSettingsStore()
      if (!settings.isConfigured) return false

      let session = this.active
      if (!session || session.corrupted) session = this.sessions.find((s) => !s.corrupted) ?? null
      if (!session) {
        this.createSession()
        session = this.active!
      }

      const userMsg: Message = { id: uid(), role: 'user', content: text, status: 'done' }
      const aiMsg: Message = { id: uid(), role: 'assistant', content: '', status: 'generating' }
      if (session.messages.length === 0) session.title = titleOf(text)
      session.messages.push(userMsg, aiMsg)
      session.updatedAt = Date.now()
      void this.persist(session)

      await this.generate(session, aiMsg)
      return true
    },

    /** 重试失败的回复：复用原用户消息重新生成（REQ-007 验收） */
    async retry(messageId: string): Promise<void> {
      const session = this.active
      if (!session) return
      const idx = session.messages.findIndex((m) => m.id === messageId)
      if (idx < 0) return
      const failed = session.messages[idx]
      if (failed.status !== 'error') return
      const retryMsg: Message = { ...failed, status: 'generating', content: '', error: undefined }
      session.messages.splice(idx, 1, retryMsg)
      await this.generate(session, retryMsg)
    },

    async generate(session: Session, aiMsg: Message) {
      const settings = useSettingsStore()
      const controller = new AbortController()
      this.controller = controller
      this.generating = true
      try {
        const full = await streamChat(
          { baseUrl: settings.config.baseUrl!, model: settings.config.model!, apiKey: settings.config.apiKey! },
          buildContext(toContext(session.messages.filter((m) => m.id !== aiMsg.id))),
          {
            onDelta: (d) => {
              aiMsg.content += d
            },
          },
          controller.signal,
        )
        if (!aiMsg.content) aiMsg.content = full // 兜底：兼容未走流式回调的响应
        aiMsg.status = 'done'
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          aiMsg.status = 'interrupted' // REQ-003/004：中断并标注
        } else {
          const err = e as { kind?: string; message?: string }
          aiMsg.status = 'error'
          aiMsg.error = { kind: err.kind ?? 'unknown', message: err.message ?? '未知错误' }
        }
      } finally {
        session.updatedAt = Date.now()
        this.generating = false
        this.controller = null
        void this.persist(session)
      }
    },
  },
})
