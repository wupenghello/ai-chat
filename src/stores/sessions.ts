import { defineStore } from 'pinia'
import { runChatTurn, type Block, type MessageContent, type SourceItem } from '../api/client'
import { useAuthStore } from './auth'
import { useSettingsStore } from './settings'
import { useQuotaStore } from './quota'
import * as db from '../db/persistence'
import type { PersistedSession } from '../db/persistence'

export type MessageStatus = 'done' | 'generating' | 'interrupted' | 'stopped' | 'error'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  /** CHG-007 REQ-032：v1 = string（存量与用户消息恒 string）；v2 assistant = Block[]（读时归一化在渲染层） */
  content: MessageContent
  status: MessageStatus
  error?: { kind: string; message: string }
  /** REQ-019：有可切换版本时指向 Session.branches 的 key */
  forkId?: string
  /** REQ-019：版本序号（0=新版，1=旧版），供版本计数器展示 */
  forkIndex?: 0 | 1
  /** CHG-007 REQ-030：turn.end(max_steps) 定型标注——消息末尾「已到单回合步数上限」pill（design-iter-13 §3.4） */
  maxSteps?: boolean
  /** CHG-012/REQ-047：turn.end(time_limit) 定型标注——消息末尾「已到研究时长上限」pill（design-iter-18 §4；与 maxSteps 互斥，一回合一 pill） */
  timeLimit?: boolean
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
    /** REQ-018：任一会话在生成中（用于档案切换「待生效」标注） */
    isAnyGenerating(state): boolean {
      return Object.keys(state.controllers).length > 0
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
      // 深拷贝为普通对象后整档 PUT 服务端（LWW）；断网暂存与自动重试在 persistence 层（iter-7 T3），
      // 此处仅兜非临时性失败（结构类 4xx，预期不可见）。
      // CHG-007（iter-13 T2）：新客户端 PUT 恒带 schema: 2（写侧守卫载体，design-iter-13 §4.3；
      // 消息级 v1/v2 与档级标记独立，老消息 string 原样保存）
      const doc = JSON.parse(JSON.stringify(clean)) as typeof clean & { schema?: number }
      doc.schema = 2
      return db
        .saveSession(doc)
        .catch((e) => console.warn('会话保存失败（非临时性）', e))
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

    /** REQ-021 注销前：终止全部生成中会话（用户主动注销，标注 stopped；不改动其余状态） */
    abortAllGenerations() {
      for (const id of Object.keys(this.controllers)) {
        this.stopRequested[id] = true
        this.controllers[id].abort()
      }
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
      // 断网删除同样入暂存队列自动重试（iter-7 T3）；非临时性失败仅告警不打断 UI
      await db.deleteSession(id).catch((e) => console.warn('会话删除失败（非临时性）', e))
    },

    /** 发送一条消息并流式生成回复。返回 false 表示不可发送：
     *  v3 双模式（REQ-023，iter-7 T2）——全部请求经后端代理（后端按生效档案/统一 key 路由），
     *  登录即可发送；未登录（实际不可达：路由守卫保证主界面已登录）返回 false。
     *  CHG-012/REQ-047（iter-18 T3）：mode 加法可选参数（回合级属性）——'research' = 深度研究
     *  回合（开关开启态发送）；缺省 undefined = 普通回合（现状零变化）。
     *  CHG-018/REQ-055（直派批次）：depth 加法可选参数——深研档位（light/standard/deep），
     *  缺省 undefined = 后端按 standard（请求体零变化）。 */
    async send(text: string, mode?: 'research', depth?: 'light' | 'standard' | 'deep'): Promise<boolean> {
      if (!useAuthStore().user) return false

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
      await this.generate(session, aiMsgReactive, mode, depth)
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

    async generate(
      session: Session,
      aiMsg: Message,
      mode?: 'research',
      depth?: 'light' | 'standard' | 'deep',
    ) {
      const settings = useSettingsStore()
      const controller = new AbortController()
      const epoch = (this.generation[session.id] = (this.generation[session.id] ?? 0) + 1)
      this.controllers[session.id] = controller
      // CHG-007（iter-13 T2）：回合端点——上下文由服务端自库组装（REQ-033，请求体无历史数组）；
      // 本回合用户消息 = aiMsg 之前最近一条 user（send/retry/editAndRegenerate 均为相邻结构）
      const idx = session.messages.findIndex((m) => m.id === aiMsg.id)
      let userText = ''
      for (let i = idx - 1; i >= 0; i--) {
        const m = session.messages[i]
        if (m.role === 'user') {
          userText = typeof m.content === 'string' ? m.content : ''
          break
        }
      }
      aiMsg.content = [] // v2 写侧：assistant 消息以 blocks 起稿（至少一段在定型时保证）
      const blocks = aiMsg.content as Block[]
      // 回合端点在服务端按会话 id 取库组装（REQ-033）：必须确保本条用户消息已落服务端
      // ——首次 send 的 createSession/persist 均为 fire-and-forget，不 await 会与回合请求竞态
      // （真实走查发现的集成缺陷：回合先到 → 服务端 404）。persist 已 catch 非临时性失败。
      await this.persist(session)
      try {
        const reason = await runChatTurn(
          session.id,
          userText,
          { systemPrompt: settings.systemPrompt || undefined, ...(mode ? { mode } : {}), ...(depth ? { depth } : {}) },
          {
            onEvent: (ev) => {
              // TurnEvent 含宽型未知成员：字面量判别后分支内显式断言字段
              if (ev.type === 'text.delta') {
                const e = ev as { type: 'text.delta'; text: string }
                const last = blocks[blocks.length - 1]
                // 工具事件后首帧开新文本段（design-iter-13 §4.1：blocks 顺序 = 事件顺序）
                if (last && last.type === 'text') last.text += e.text
                else blocks.push({ type: 'text', text: e.text })
              } else if (ev.type === 'tool.call') {
                const e = ev as { type: 'tool.call'; tool_call_id: string; name: string; arguments: string }
                blocks.push({ type: 'tool_call', tool_call_id: e.tool_call_id, name: e.name, arguments: e.arguments })
              } else if (ev.type === 'tool.result') {
                const e = ev as {
                  type: 'tool.result'
                  tool_call_id: string
                  status: 'ok' | 'error' | 'timeout'
                  result: string
                  duration_ms: number
                  sources?: SourceItem[]
                }
                // iter-14 T3（design-iter-14 §6.4）：sources 随 tool_result 段进 blocks——
                // 落库随 PUT 整档透传保真；仅 ok 且非空时后端携带，前端原样接收（可选字段零适配）
                blocks.push({
                  type: 'tool_result',
                  tool_call_id: e.tool_call_id,
                  status: e.status,
                  result: e.result,
                  duration_ms: e.duration_ms,
                  ...(e.sources && e.sources.length > 0 ? { sources: e.sources } : {}),
                })
              }
              // 其余事件（turn.start/step/usage/未知 type）不驱动 UI（design-iter-13 §4.1）
            },
          },
          controller.signal,
        )
        if (blocks.length === 0) blocks.push({ type: 'text', text: '' })
        aiMsg.status = 'done'
        if (reason === 'max_steps') aiMsg.maxSteps = true
        else if (reason === 'time_limit') aiMsg.timeLimit = true
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          // REQ-010 用户主动停止 = stopped；REQ-003/006 系统中断 = interrupted
          aiMsg.status = this.stopRequested[session.id] ? 'stopped' : 'interrupted'
        } else {
          const err = e as { kind?: string; message?: string; status?: number }
          aiMsg.status = 'error'
          aiMsg.error = { kind: err.kind ?? 'unknown', message: err.message ?? '未知错误' }
          // CHG-012/REQ-047（design-iter-18 §6.2）：research 回合受理即拒（422 research_unavailable）
          // → 重取 quota 刷新禁用态（开关发送时已复位，此处仅刷新服务端可用性快照）
          if (mode === 'research' && err.status === 422) void useQuotaStore().refresh()
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
