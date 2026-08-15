import { defineStore } from 'pinia'
import { buildContext, streamChat, type ChatMessage } from '../api/client'
import { useSettingsStore } from './settings'
import * as db from '../db/idb'
import type { PersistedSession } from '../db/idb'

export type MessageStatus = 'done' | 'generating' | 'interrupted' | 'stopped' | 'error'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  status: MessageStatus
  error?: { kind: string; message: string }
  /** REQ-019：有可切换版本时指向 Session.branches 的 key */
  forkId?: string
  /** REQ-019：版本序号（0=新版，1=旧版），供版本计数器展示 */
  forkIndex?: 0 | 1
}

export interface Session extends PersistedSession {
  messages: Message[]
  /** REQ-004：损坏会话灰化展示，不可进入 */
  corrupted?: boolean
  /** REQ-009 × REQ-012：手动改名后置 true，自动命名不再覆盖 */
  renamed?: boolean
}

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`

const titleOf = (text: string) => {
  const t = text.trim()
  if (!t) return '新会话'
  return t.length > 20 ? `${t.slice(0, 20)}…` : t
}

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
    /** 每个会话独立的生成控制器（CHG-001：切换会话不再中断，后台继续） */
    controllers: {} as Record<string, AbortController>,
    /** 用户主动停止的会话（REQ-010）：abort 后标注 stopped，与系统中断 interrupted 区分 */
    stopRequested: {} as Record<string, true>,
    /** 生成纪元：每次 generate 递增；REQ-015 编辑中断旧生成后，旧 finally 不再清理新控制器 */
    generation: {} as Record<string, number>,
  }),

  getters: {
    active(state): Session | null {
      return state.sessions.find((s) => s.id === state.activeId) ?? null
    },
    /** 指定会话是否正在生成（Composer 按当前会话禁用） */
    isGenerating(state) {
      return (sessionId: string | null) => !!sessionId && !!state.controllers[sessionId]
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

    /** 中断指定会话的生成并标注（REQ-003：仅"新建会话"使用；CHG-001 后切换不再调用） */
    abortSession(sessionId: string) {
      this.controllers[sessionId]?.abort()
    },

    /** REQ-010：停止当前查看会话的生成。已结束（无控制器）时 no-op（边界态：流恰好结束） */
    stopGeneration() {
      const id = this.activeId
      if (!id || !this.controllers[id]) return
      this.stopRequested[id] = true
      this.controllers[id].abort()
    },

    createSession(): string {
      if (this.activeId) this.abortSession(this.activeId) // REQ-003：生成中新建 = 中断并标注
      const s: Session = {
        id: uid(),
        title: '新会话',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
        renamed: false,
      }
      this.sessions.unshift(s)
      this.activeId = s.id
      void this.persist(s)
      return s.id
    },

    switchTo(id: string) {
      const target = this.sessions.find((s) => s.id === id)
      if (!target || target.corrupted) return
      // CHG-001：切换不中断生成，目标会话在后台继续流式更新
      this.activeId = id
    },

    /** REQ-012：手动重命名。空标题 no-op（UI 恢复原标题）；非空写入并置 renamed 防自动命名覆盖 */
    renameSession(id: string, title: string) {
      const session = this.sessions.find((s) => s.id === id)
      if (!session || session.corrupted) return
      const trimmed = title.trim()
      if (!trimmed) return
      session.title = trimmed
      session.renamed = true
      session.updatedAt = Date.now()
      void this.persist(session)
    },

    async removeSession(id: string) {
      this.abortSession(id) // 被删会话若有后台生成，一并终止
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
      if (this.controllers[session.id]) return true // 该会话已在生成中，忽略重复发送

      if (session.messages.length === 0 && !session.renamed) session.title = titleOf(text)
      const userMsg: Message = { id: uid(), role: 'user', content: text, status: 'done' }
      const aiMsg: Message = { id: uid(), role: 'assistant', content: '', status: 'generating' }
      session.messages.push(userMsg, aiMsg)
      session.updatedAt = Date.now()
      void this.persist(session)

      // 关键：从响应式数组取回代理对象，后续变更才能触发视图更新（Bug#1 根因）
      const aiMsgReactive = session.messages[session.messages.length - 1]
      await this.generate(session, aiMsgReactive)
      return true
    },

    /** 重试失败的回复：复用原用户消息重新生成（REQ-007 验收） */
    async retry(messageId: string): Promise<void> {
      const session = this.active
      if (!session || this.controllers[session.id]) return
      const idx = session.messages.findIndex((m) => m.id === messageId)
      if (idx < 0) return
      const failed = session.messages[idx]
      if (failed.status !== 'error') return
      session.messages.splice(idx, 1, { ...failed, status: 'generating', content: '', error: undefined })
      const retryMsg = session.messages[idx]
      await this.generate(session, retryMsg)
    },

    /** REQ-015：编辑历史用户消息并重新生成其后内容 */
    async editAndRegenerate(messageId: string, newText: string): Promise<void> {
      const session = this.active
      if (!session || session.corrupted) return
      const trimmed = newText.trim()
      if (!trimmed) return
      const idx = session.messages.findIndex((m) => m.id === messageId)
      if (idx < 0) return
      if (session.messages[idx].role !== 'user') return

      // 生成中编辑：中断当前生成（不置 stopRequested，语义为「生成中断」），递增纪元让旧 finally 失效
      if (this.controllers[session.id]) {
        this.generation[session.id] = (this.generation[session.id] ?? 0) + 1
        this.controllers[session.id].abort()
        delete this.controllers[session.id]
      }

      // 归档旧分支（REQ-019 版本切换）：深拷贝，避免与响应式对象互相引用成环
      const oldBranch = JSON.parse(JSON.stringify(session.messages.slice(idx))) as Message[]
      const forkId = uid()
      oldBranch[0].forkId = forkId
      oldBranch[0].forkIndex = 1 // 旧版
      session.branches = session.branches ?? {}
      session.branches[forkId] = oldBranch

      // 删除编辑点及其后所有消息，从编辑点重建
      session.messages.splice(idx)
      const userMsg: Message = { id: uid(), role: 'user', content: trimmed, status: 'done', forkId, forkIndex: 0 }
      const aiMsg: Message = { id: uid(), role: 'assistant', content: '', status: 'generating' }
      session.messages.push(userMsg, aiMsg)
      session.updatedAt = Date.now()
      void this.persist(session)

      const aiMsgReactive = session.messages[session.messages.length - 1]
      await this.generate(session, aiMsgReactive)
    },

    /** REQ-019：切换消息版本（编辑/重新生成后的新旧分支互换） */
    toggleVersion(forkId: string) {
      const session = this.active
      if (!session || session.corrupted) return
      const branches = session.branches
      if (!branches) return
      const alternate = branches[forkId]
      if (!alternate) return
      const idx = session.messages.findIndex((m) => m.forkId === forkId)
      if (idx < 0) return
      const current = JSON.parse(JSON.stringify(session.messages.slice(idx))) as Message[]
      current[0].forkId = forkId
      branches[forkId] = current
      session.messages.splice(idx, session.messages.length - idx, ...alternate)
      session.updatedAt = Date.now()
      void this.persist(session)
    },

    async generate(session: Session, aiMsg: Message) {
      const settings = useSettingsStore()
      const controller = new AbortController()
      const epoch = (this.generation[session.id] = (this.generation[session.id] ?? 0) + 1)
      this.controllers[session.id] = controller
      try {
        const full = await streamChat(
          { baseUrl: settings.config.baseUrl!, model: settings.config.model!, apiKey: settings.config.apiKey! },
          // REQ-008：系统提示词（如有）置于首位；buildContext 保证其不受 20 轮截断影响
          buildContext(
            settings.systemPrompt
              ? [{ role: 'system', content: settings.systemPrompt }, ...toContext(session.messages.filter((m) => m.id !== aiMsg.id))]
              : toContext(session.messages.filter((m) => m.id !== aiMsg.id)),
          ),
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
          // REQ-010 用户主动停止 = stopped；REQ-003/006 系统中断 = interrupted
          aiMsg.status = this.stopRequested[session.id] ? 'stopped' : 'interrupted'
        } else {
          const err = e as { kind?: string; message?: string }
          aiMsg.status = 'error'
          aiMsg.error = { kind: err.kind ?? 'unknown', message: err.message ?? '未知错误' }
        }
      } finally {
        session.updatedAt = Date.now()
        // REQ-015：仅当仍是当前纪元才清理控制器——编辑中断后旧生成的 finally 不得清掉新控制器
        if (this.generation[session.id] === epoch) {
          delete this.controllers[session.id]
          delete this.stopRequested[session.id]
        }
        void this.persist(session)
      }
    },
  },
})
