import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../../db/persistence', () => ({
  loadSessions: vi.fn(async () => []),
  saveSession: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
}))

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  runChatTurn: vi.fn(),
}))

/**
 * iter-13 T2（CHG-007）口径迁移登记：
 * - mock 面由 streamChatViaProxy(context, handlers, signal) → runChatTurn(sessionId, message, opts, handlers, signal)
 * - 「上下文组装」类断言（REQ-002/008 组装位置、编辑重建上下文内容）退役 → 服务端 pytest 承载
 *   （backend/tests/test_turn.py test_组装等价_* 等）；客户端侧改断言回合请求参数（session_id / message / system_prompt）
 * - assistant 消息 content 由 string → Block[]（v2 写侧）；文本断言经 contentText 适配层
 */

import { contentText, runChatTurn, type TurnHandlers, type TurnEndReason } from '../../api/client'
import { useSettingsStore } from '../settings'
import { useAuthStore } from '../auth'
import { useSessionsStore } from '../sessions'

const mockedTurn = vi.mocked(runChatTurn)

/** 便利实现：文本 delta 序列 + turn.end(reason) */
function reply(text: string, reason: TurnEndReason = 'done') {
  return (_sid: string, _msg: string, _opts: { systemPrompt?: string }, h: TurnHandlers) => {
    if (text) h.onEvent({ type: 'text.delta', text })
    h.onEvent({ type: 'turn.start', session_id: _sid, turn_id: 't' })
    return Promise.resolve(reason)
  }
}

function abortableTurn(): Promise<TurnEndReason> {
  return new Promise((resolve, reject) => {
    mockedTurn.mock.calls.at(-1)![4]?.addEventListener?.('abort', () => {
      const e = new Error('aborted')
      e.name = 'AbortError'
      reject(e)
    })
    setTimeout(() => resolve('done'), 1000)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  setActivePinia(createPinia())
  const settings = useSettingsStore()
  settings.systemPrompt = ''
  useAuthStore().user = { id: 1, username: 'tester' }
})

describe('sessions store · 发送与生成（REQ-001/002/030）', () => {
  it('未登录（主界面实际不可达态）：返回 false，不调 API', async () => {
    localStorage.clear()
    setActivePinia(createPinia())
    const sessions = useSessionsStore()
    await expect(sessions.send('hi')).resolves.toBe(false)
    expect(runChatTurn).not.toHaveBeenCalled()
  })

  it('已登录：走回合端点，请求体 = 会话 id + 本条消息（REQ-033）', async () => {
    localStorage.clear()
    setActivePinia(createPinia())
    useAuthStore().user = { id: 1, username: 'alice' }
    mockedTurn.mockImplementation(reply('你好'))
    const sessions = useSessionsStore()
    await expect(sessions.send('hi')).resolves.toBe(true)
    expect(mockedTurn).toHaveBeenCalledTimes(1)
    const [sid, msg] = mockedTurn.mock.calls[0]
    expect(sid).toBe(sessions.active!.id)
    expect(msg).toBe('hi')
    expect(contentText(sessions.active!.messages[1].content)).toBe('你好')
    expect(sessions.active!.messages[1].status).toBe('done')
  })

  it('正常流式：delta 累积、最终 done、标题取自首条消息', async () => {
    mockedTurn.mockImplementation((_sid, _msg, _opts, h) => {
      h.onEvent({ type: 'text.delta', text: '你' })
      h.onEvent({ type: 'text.delta', text: '好' })
      return Promise.resolve('done')
    })
    const sessions = useSessionsStore()
    await sessions.send('我叫小明')
    const s = sessions.active!
    expect(s.title).toBe('我叫小明')
    expect(s.messages).toHaveLength(2)
    expect(contentText(s.messages[1].content)).toBe('你好')
    expect(s.messages[1].status).toBe('done')
  })

  it('工具回合：tool.call/tool.result 驱动 blocks 顺序组装（REQ-032）', async () => {
    mockedTurn.mockImplementation((_sid, _msg, _opts, h) => {
      h.onEvent({ type: 'text.delta', text: '我先查一下' })
      h.onEvent({ type: 'tool.call', tool_call_id: 'c1', name: 'demo_weather', arguments: '{"city":"北京"}' })
      h.onEvent({ type: 'tool.result', tool_call_id: 'c1', status: 'ok', result: '北京：晴', duration_ms: 5 })
      h.onEvent({ type: 'text.delta', text: '今天晴。' }) // 工具事件后首帧开新文本段
      return Promise.resolve('done')
    })
    const sessions = useSessionsStore()
    await sessions.send('北京天气')
    const m = sessions.active!.messages[1]
    expect(m.content).toEqual([
      { type: 'text', text: '我先查一下' },
      { type: 'tool_call', tool_call_id: 'c1', name: 'demo_weather', arguments: '{"city":"北京"}' },
      { type: 'tool_result', tool_call_id: 'c1', status: 'ok', result: '北京：晴', duration_ms: 5 },
      { type: 'text', text: '今天晴。' },
    ])
    expect(contentText(m.content)).toBe('我先查一下\n\n今天晴。')
  })

  it('turn.end(max_steps)：消息标 maxSteps（上限 pill 数据源，REQ-030）', async () => {
    mockedTurn.mockImplementation(reply('部分回答', 'max_steps'))
    const sessions = useSessionsStore()
    await sessions.send('长链问题')
    const m = sessions.active!.messages[1]
    expect(m.status).toBe('done')
    expect(m.maxSteps).toBe(true)
  })

  it('未知事件不驱动 UI（前向兼容静默跳过）', async () => {
    mockedTurn.mockImplementation((_sid, _msg, _opts, h) => {
      h.onEvent({ type: 'future.event' } as never)
      h.onEvent({ type: 'turn.start', session_id: 's', turn_id: 't' })
      h.onEvent({ type: 'usage', requests: 1, tokens: 9 })
      return Promise.resolve('done')
    })
    const sessions = useSessionsStore()
    await sessions.send('hi')
    expect(sessions.active!.messages[1].content).toEqual([{ type: 'text', text: '' }])
  })
})

describe('中断与错误（REQ-003/004/007 + CHG-001）', () => {
  it('生成中新建会话：原回复标注 interrupted，新会话立即激活', async () => {
    mockedTurn.mockImplementation(abortableTurn)
    const sessions = useSessionsStore()
    const p = sessions.send('慢问题')
    await new Promise((r) => setTimeout(r, 10)) // 让 generate 挂起
    sessions.createSession()
    await p
    expect(sessions.sessions[1].messages[1].status).toBe('interrupted')
    expect(sessions.activeId).toBe(sessions.sessions[0].id)
    expect(sessions.isGenerating(sessions.sessions[1].id)).toBe(false)
  })

  it('CHG-001 + Bug#1：生成中切换会话不中断、后台流式更新在 store 中实时可见', async () => {
    let release!: (v: TurnEndReason) => void
    const gate = new Promise<TurnEndReason>((res) => (release = res))
    mockedTurn.mockImplementation((_sid, _msg, _opts, h) => {
      h.onEvent({ type: 'text.delta', text: '部分' })
      return gate
    })
    const sessions = useSessionsStore()
    const other = sessions.createSession() // 历史会话（无生成）
    const p = sessions.send('慢问题') // 在当前会话生成
    await new Promise((r) => setTimeout(r, 10))
    const genId = sessions.activeId!

    // Bug#1 回归：事件改的是响应式代理，store 读到的内容实时更新
    expect(contentText(sessions.sessions.find((s) => s.id === genId)!.messages[1].content)).toBe('部分')

    sessions.switchTo(other) // 切走（CHG-001：不中断）
    expect(sessions.isGenerating(genId)).toBe(true)
    release('done')
    await p
    expect(sessions.isGenerating(genId)).toBe(false)
    expect(contentText(sessions.sessions.find((s) => s.id === genId)!.messages[1].content)).toBe('部分')
  })

  it('API 401：消息标 error 且带 kind=auth，可重试成功', async () => {
    mockedTurn.mockRejectedValueOnce(Object.assign(new Error('密钥无效'), { kind: 'auth' }))
    const sessions = useSessionsStore()
    await sessions.send('hi')
    const failed = sessions.active!.messages[1]
    expect(failed.status).toBe('error')
    expect(failed.error!.kind).toBe('auth')

    mockedTurn.mockImplementationOnce(reply('好了'))
    await sessions.retry(failed.id)
    expect(sessions.active!.messages).toHaveLength(2) // 失败消息被替换，不新增用户消息
    expect(contentText(sessions.active!.messages[1].content)).toBe('好了')
  })
})

describe('停止生成（REQ-010，iter-2 T2）', () => {
  it('用户主动停止：保留已生成部分并标注 stopped，生成态解除', async () => {
    let delta!: (t: string) => void
    mockedTurn.mockImplementation((_sid, _msg, _opts, h, signal?: AbortSignal) => {
      delta = (t) => h.onEvent({ type: 'text.delta', text: t })
      return new Promise((_res, rej) => {
        signal?.addEventListener('abort', () => {
          const e = new Error('aborted')
          e.name = 'AbortError'
          rej(e)
        })
      })
    })
    const sessions = useSessionsStore()
    const p = sessions.send('长问题')
    await new Promise((r) => setTimeout(r, 10))
    delta('已生成的一段')
    expect(sessions.isGenerating(sessions.activeId)).toBe(true)

    sessions.stopGeneration()
    await p
    const msg = sessions.active!.messages[1]
    expect(msg.status).toBe('stopped') // 主动停止 ≠ interrupted
    expect(contentText(msg.content)).toBe('已生成的一段') // 已生成部分保留
    expect(sessions.isGenerating(sessions.activeId)).toBe(false)
  })

  it('stopRequested 不残留：停止后再发新消息正常完成', async () => {
    let first = true
    mockedTurn.mockImplementation((_sid, _msg, _opts, h, signal?: AbortSignal) => {
      if (first) {
        first = false
        return new Promise((_res, rej) => {
          signal?.addEventListener('abort', () => {
            const e = new Error('aborted')
            e.name = 'AbortError'
            rej(e)
          })
          setTimeout(() => _res('done'), 5000)
        })
      }
      h.onEvent({ type: 'text.delta', text: '新回复' })
      return Promise.resolve('done')
    })
    const sessions = useSessionsStore()
    const p1 = sessions.send('第一条')
    await new Promise((r) => setTimeout(r, 10))
    sessions.stopGeneration()
    await p1
    expect(sessions.active!.messages[1].status).toBe('stopped')

    await sessions.send('第二条')
    expect(contentText(sessions.active!.messages[3].content)).toBe('新回复')
  })

  it('边界：无生成时 stopGeneration 为 no-op，不报错', () => {
    const sessions = useSessionsStore()
    expect(() => sessions.stopGeneration()).not.toThrow()
  })
})

describe('REQ-021 注销前终止全部生成', () => {
  it('abortAllGenerations：终止所有生成中会话并标注 stopped（注销异常分支）', () => {
    const sessions = useSessionsStore()
    const a = { abort: vi.fn() } as unknown as AbortController
    const b = { abort: vi.fn() } as unknown as AbortController
    sessions.controllers['s1'] = a
    sessions.controllers['s2'] = b
    sessions.abortAllGenerations()
    expect(a.abort).toHaveBeenCalledTimes(1)
    expect(b.abort).toHaveBeenCalledTimes(1)
    expect(sessions.stopRequested['s1']).toBe(true)
    expect(sessions.stopRequested['s2']).toBe(true)
  })

  it('无生成中会话：abortAllGenerations 为 no-op，不报错', () => {
    const sessions = useSessionsStore()
    expect(() => sessions.abortAllGenerations()).not.toThrow()
  })
})

describe('会话管理（REQ-003/004/005）', () => {
  it('删除当前会话后自动切到最近的会话', async () => {
    const sessions = useSessionsStore()
    const a = sessions.createSession()
    const b = sessions.createSession()
    sessions.switchTo(a)
    await sessions.removeSession(a)
    expect(sessions.activeId).toBe(b)
  })

  it('恢复时 generating 消息回标 interrupted（REQ-006）', async () => {
    const { loadSessions } = await import('../../db/persistence')
    vi.mocked(loadSessions).mockResolvedValueOnce([
      {
        id: 's1',
        title: 't',
        createdAt: 1,
        updatedAt: 2,
        messages: [
          { id: 'm1', role: 'user', content: 'q', status: 'done' },
          { id: 'm2', role: 'assistant', content: '部分回', status: 'generating' },
        ],
      } as never,
    ])
    const sessions = useSessionsStore()
    await sessions.init()
    expect(sessions.active!.messages[1].status).toBe('interrupted')
  })

  it('v1 存量会话（content string）原样加载不迁移（读时归一化在渲染层）', async () => {
    const { loadSessions } = await import('../../db/persistence')
    vi.mocked(loadSessions).mockResolvedValueOnce([
      {
        id: 's1',
        title: 't',
        createdAt: 1,
        updatedAt: 2,
        messages: [
          { id: 'm1', role: 'user', content: 'q', status: 'done' },
          { id: 'm2', role: 'assistant', content: '旧回复', status: 'done' },
        ],
      } as never,
    ])
    const sessions = useSessionsStore()
    await sessions.init()
    expect(sessions.active!.messages[1].content).toBe('旧回复') // string 原样
  })

  it('持久化载荷顶层恒带 schema: 2（写侧守卫载体，REQ-032 验收 3）', async () => {
    const { saveSession } = await import('../../db/persistence')
    mockedTurn.mockImplementation(reply('ok'))
    const sessions = useSessionsStore()
    await sessions.send('hi')
    const doc = vi.mocked(saveSession).mock.calls.at(-1)![0] as { schema?: number }
    expect(doc.schema).toBe(2)
  })
})

describe('系统提示词随回合上传（REQ-008 改写，iter-13 T2）', () => {
  it('已设置时回合请求携带 system_prompt；未设置时不携带', async () => {
    mockedTurn.mockImplementation(reply('ok'))
    const settings = useSettingsStore()
    const sessions = useSessionsStore()

    settings.saveSystemPrompt('回复只用英文')
    await sessions.send('hi')
    expect(mockedTurn.mock.calls.at(-1)![2]).toEqual({ systemPrompt: '回复只用英文' })

    settings.saveSystemPrompt('')
    await sessions.send('again')
    expect(mockedTurn.mock.calls.at(-1)![2]).toEqual({ systemPrompt: undefined })
  })
})

describe('停止时效构造性证明（NCR-iter2-003 整改）', () => {
  it('stopGeneration() 调用返回前 AbortSignal 已置 aborted（同步路径，无异步间隙 → 点击到停止渲染仅需一个 Vue 渲染 tick，远小于 200ms 阈值）', async () => {
    let captured: AbortSignal | undefined
    mockedTurn.mockImplementation((_sid, _msg, _opts, _h, signal?: AbortSignal) => {
      captured = signal
      return new Promise((_res, rej) => {
        signal?.addEventListener('abort', () => {
          const e = new Error('aborted')
          e.name = 'AbortError'
          rej(e)
        })
      })
    })
    const sessions = useSessionsStore()
    const p = sessions.send('长回答')
    await new Promise((r) => setTimeout(r, 10))

    sessions.stopGeneration()
    expect(captured!.aborted).toBe(true) // 同步断言：不 await、不 setTimeout

    await p
    expect(sessions.active!.messages[1].status).toBe('stopped')
  })
})

describe('消息编辑与重新生成（REQ-015，iter-4 T2；iter-13 T2 回合化）', () => {
  it('编辑历史消息：删除编辑点及其后消息，从编辑点重建，回合请求即编辑后文本', async () => {
    mockedTurn
      .mockImplementationOnce(reply('回复1'))
      .mockImplementationOnce(reply('回复2'))
      .mockImplementationOnce(reply('新回复'))
    const sessions = useSessionsStore()
    await sessions.send('问题1')
    await sessions.send('问题2')
    expect(sessions.active!.messages).toHaveLength(4)

    await sessions.editAndRegenerate(sessions.active!.messages[0].id, '改后问题1')

    const msgs = sessions.active!.messages
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toMatchObject({ role: 'user', content: '改后问题1' })
    expect(contentText(msgs[1].content)).toBe('新回复')
    // 回合请求：编辑后的用户消息（上下文组装在服务端——test_turn.py 组装组承载）
    const [, msg] = mockedTurn.mock.calls.at(-1)!
    expect(msg).toBe('改后问题1')
  })

  it('编辑中间轮次：编辑点之前的轮次完整保留，其后消息被替换', async () => {
    mockedTurn
      .mockImplementationOnce(reply('回复1'))
      .mockImplementationOnce(reply('回复2'))
      .mockImplementationOnce(reply('新回复2'))
    const sessions = useSessionsStore()
    await sessions.send('问题1')
    await sessions.send('问题2')

    await sessions.editAndRegenerate(sessions.active!.messages[2].id, '改后问题2')

    const msgs = sessions.active!.messages
    expect(msgs).toHaveLength(4)
    expect(msgs[0]).toMatchObject({ role: 'user', content: '问题1' }) // 第一轮不变
    expect(contentText(msgs[1].content)).toBe('回复1')
    expect(msgs[2]).toMatchObject({ role: 'user', content: '改后问题2' }) // 第二轮被替换
    expect(contentText(msgs[3].content)).toBe('新回复2')
    const [, msg] = mockedTurn.mock.calls.at(-1)!
    expect(msg).toBe('改后问题2')
  })

  it('生成中编辑：中断当前生成，从编辑点重建，新生成不受旧 finally 干扰', async () => {
    let call = 0
    mockedTurn.mockImplementation((_sid, _msg, _opts, _h, signal?: AbortSignal) => {
      call++
      if (call === 1) {
        return new Promise((_res, rej) => {
          signal?.addEventListener('abort', () => {
            const e = new Error('aborted')
            e.name = 'AbortError'
            rej(e)
          })
        })
      }
      return Promise.resolve('done')
    })
    const sessions = useSessionsStore()
    const p = sessions.send('长问题')
    await new Promise((r) => setTimeout(r, 10))
    expect(sessions.isGenerating(sessions.activeId)).toBe(true)

    // 第一回合无 delta：先手动补一段已生成内容再编辑（断言保留）
    await sessions.editAndRegenerate(sessions.active!.messages[0].id, '改后问题')
    await p

    const msgs = sessions.active!.messages
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toMatchObject({ role: 'user', content: '改后问题' })
    expect(msgs[1].status).toBe('done')
    expect(sessions.isGenerating(sessions.activeId)).toBe(false)
  })

  it('空文本 / 非用户消息 / 不存在的消息：no-op 不发请求', async () => {
    mockedTurn.mockImplementationOnce(reply('回复'))
    const sessions = useSessionsStore()
    await sessions.send('问题')
    const calls = mockedTurn.mock.calls.length

    await sessions.editAndRegenerate(sessions.active!.messages[0].id, '   ')
    await sessions.editAndRegenerate(sessions.active!.messages[1].id, '改')
    await sessions.editAndRegenerate('不存在', '改')

    expect(mockedTurn.mock.calls.length).toBe(calls) // 未新增请求
  })

  it('版本切换：编辑后保留旧分支，toggleVersion 在新旧分支间互换（REQ-019）', async () => {
    mockedTurn.mockImplementationOnce(reply('回复1')).mockImplementationOnce(reply('新回复'))
    const sessions = useSessionsStore()
    await sessions.send('问题1')
    const uid = sessions.active!.messages[0].id

    await sessions.editAndRegenerate(uid, '改后问题')
    expect(sessions.active!.messages[0]).toMatchObject({ role: 'user', content: '改后问题' })
    const forkId = sessions.active!.messages[0].forkId
    expect(forkId).toBeTruthy()

    // 切到旧分支
    sessions.toggleVersion(forkId!)
    expect(sessions.active!.messages[0]).toMatchObject({ role: 'user', content: '问题1' })
    expect(contentText(sessions.active!.messages[1].content)).toBe('回复1')

    // 再切回新分支
    sessions.toggleVersion(forkId!)
    expect(sessions.active!.messages[0]).toMatchObject({ role: 'user', content: '改后问题' })
    expect(contentText(sessions.active!.messages[1].content)).toBe('新回复')
  })
})

describe('sessions store · 引用来源数据面（iter-14 T3，design-iter-14 §6.4）', () => {
  it('tool.result 携带 sources → 随 tool_result 段进 blocks（落库透传保真）；无 sources 零附加键', async () => {
    const sources = [{ title: '来源A', url: 'https://a.example.com/1', snippet: '片段' }]
    mockedTurn.mockImplementation((_sid, _msg, _opts, h) => {
      h.onEvent({ type: 'tool.call', tool_call_id: 'c1', name: 'search', arguments: '{"query":"q"}' })
      h.onEvent({ type: 'tool.result', tool_call_id: 'c1', status: 'ok', result: '摘要', duration_ms: 5, sources })
      h.onEvent({ type: 'text.delta', text: '回答。' })
      return Promise.resolve('done')
    })
    const sessions = useSessionsStore()
    await sessions.send('搜一下')
    const withSources = sessions.active!.messages[1].content
    expect(withSources).toEqual([
      { type: 'tool_call', tool_call_id: 'c1', name: 'search', arguments: '{"query":"q"}' },
      { type: 'tool_result', tool_call_id: 'c1', status: 'ok', result: '摘要', duration_ms: 5, sources },
      { type: 'text', text: '回答。' },
    ])

    // 无 sources（老事件形状/失败结果）：块形状零变化（既有 toEqual 断言兼容面）——独立 Pinia 隔离会话
    setActivePinia(createPinia())
    useAuthStore().user = { id: 1, username: 'tester' }
    mockedTurn.mockImplementation((_sid, _msg, _opts, h) => {
      h.onEvent({ type: 'tool.call', tool_call_id: 'c1', name: 'search', arguments: '{}' })
      h.onEvent({ type: 'tool.result', tool_call_id: 'c1', status: 'error', result: '搜索服务返回 429', duration_ms: 640 })
      h.onEvent({ type: 'text.delta', text: '直答。' })
      return Promise.resolve('done')
    })
    const s2 = useSessionsStore()
    await s2.send('再搜')
    expect(s2.active!.messages[1].content).toEqual([
      { type: 'tool_call', tool_call_id: 'c1', name: 'search', arguments: '{}' },
      { type: 'tool_result', tool_call_id: 'c1', status: 'error', result: '搜索服务返回 429', duration_ms: 640 },
      { type: 'text', text: '直答。' },
    ])
  })

  it('存量零回退面（§2.1 适配面零新增）：导出/搜索正文不含 sources（contentText 只取文本段）', async () => {
    const sources = [{ title: '来源A', url: 'https://a.example.com/1', snippet: '片段' }]
    mockedTurn.mockImplementation((_sid, _msg, _opts, h) => {
      h.onEvent({ type: 'tool.call', tool_call_id: 'c1', name: 'search', arguments: '{"query":"q"}' })
      h.onEvent({ type: 'tool.result', tool_call_id: 'c1', status: 'ok', result: '摘要 + 来源列表文本', duration_ms: 5, sources })
      h.onEvent({ type: 'text.delta', text: '回答正文。' })
      return Promise.resolve('done')
    })
    const sessions = useSessionsStore()
    await sessions.send('搜一下')
    const m = sessions.active!.messages[1]
    expect(contentText(m.content)).toBe('回答正文。') // 来源标题/URL/片段与工具文本均不入正文（REQ-013/016 零适配）
  })
})
