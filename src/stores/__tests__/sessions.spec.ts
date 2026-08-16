import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../../db/persistence', () => ({
  loadSessions: vi.fn(async () => []),
  saveSession: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
}))

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  streamChat: vi.fn(),
  streamChatViaProxy: vi.fn(),
}))

import { streamChat, streamChatViaProxy, type StreamHandlers } from '../../api/client'
import { useSettingsStore } from '../settings'
import { useAuthStore } from '../auth'
import { useSessionsStore } from '../sessions'

const mockedStream = vi.mocked(streamChat)

function abortableStream(): Promise<string> {
  return new Promise((resolve, reject) => {
    mockedStream.mock.calls.at(-1)![3]?.addEventListener?.('abort', () => {
      const e = new Error('aborted')
      e.name = 'AbortError'
      reject(e)
    })
    setTimeout(() => resolve('慢速完整回复'), 1000)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  setActivePinia(createPinia())
  const settings = useSettingsStore()
  settings.save({ baseUrl: 'https://x', model: 'm', apiKey: 'k' })
})

describe('sessions store · 发送与生成（REQ-001/002）', () => {
  it('未登录且无档案（主界面实际不可达态）：返回 false，不调 API', async () => {
    localStorage.clear()
    setActivePinia(createPinia())
    const sessions = useSessionsStore()
    await expect(sessions.send('hi')).resolves.toBe(false)
    expect(streamChat).not.toHaveBeenCalled()
    expect(streamChatViaProxy).not.toHaveBeenCalled()
  })

  it('统一 key 模式（REQ-023 v3）：已登录无档案 → 走后端代理，直连不触发', async () => {
    localStorage.clear()
    setActivePinia(createPinia())
    useAuthStore().user = { id: 1, username: 'alice' }
    vi.mocked(streamChatViaProxy).mockImplementation((_m, h: StreamHandlers) => {
      h.onDelta('你')
      h.onDelta('好')
      return Promise.resolve('你好')
    })
    const sessions = useSessionsStore()
    await expect(sessions.send('hi')).resolves.toBe(true)
    expect(streamChat).not.toHaveBeenCalled()
    expect(vi.mocked(streamChatViaProxy)).toHaveBeenCalledTimes(1)
    expect(sessions.active!.messages[1]).toMatchObject({
      role: 'assistant',
      content: '你好',
      status: 'done',
    })
  })

  it('正常流式：delta 累积、最终 done、标题取自首条消息', async () => {
    mockedStream.mockImplementation((_c, _m, h: StreamHandlers) => {
      h.onDelta('你')
      h.onDelta('好')
      return Promise.resolve('你好')
    })
    const sessions = useSessionsStore()
    await sessions.send('我叫小明')
    const s = sessions.active!
    expect(s.title).toBe('我叫小明')
    expect(s.messages).toHaveLength(2)
    expect(s.messages[1]).toMatchObject({ role: 'assistant', content: '你好', status: 'done' })
  })
})

describe('中断与错误（REQ-003/004/007 + CHG-001）', () => {
  it('生成中新建会话：原回复标注 interrupted，新会话立即激活', async () => {
    mockedStream.mockImplementation(abortableStream)
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
    let release!: (v: string) => void
    const gate = new Promise<string>((res) => (release = res))
    mockedStream.mockImplementation((_c, _m, h: StreamHandlers) => {
      h.onDelta('部分')
      return gate
    })
    const sessions = useSessionsStore()
    const other = sessions.createSession() // 历史会话（无生成）
    const p = sessions.send('慢问题') // 在当前会话生成
    await new Promise((r) => setTimeout(r, 10))
    const genId = sessions.activeId!

    // Bug#1 回归：onDelta 改的是响应式代理，store 读到的内容实时更新
    expect(sessions.sessions.find((s) => s.id === genId)!.messages[1].content).toBe('部分')

    sessions.switchTo(other) // 切走（CHG-001：不中断）
    expect(sessions.isGenerating(genId)).toBe(true)
    release('完整')
    await p
    expect(sessions.isGenerating(genId)).toBe(false)
    expect(sessions.sessions.find((s) => s.id === genId)!.messages[1]).toMatchObject({
      status: 'done',
      content: '部分',
    })
  })

  it('API 401：消息标 error 且带 kind=auth，可重试成功', async () => {
    mockedStream.mockRejectedValueOnce(Object.assign(new Error('密钥无效'), { kind: 'auth' }))
    const sessions = useSessionsStore()
    await sessions.send('hi')
    const failed = sessions.active!.messages[1]
    expect(failed.status).toBe('error')
    expect(failed.error!.kind).toBe('auth')

    mockedStream.mockResolvedValueOnce('好了')
    await sessions.retry(failed.id)
    expect(sessions.active!.messages).toHaveLength(2) // 失败消息被替换，不新增用户消息
    expect(sessions.active!.messages[1]).toMatchObject({ status: 'done', content: '好了' })
  })
})

describe('停止生成（REQ-010，iter-2 T2）', () => {
  it('用户主动停止：保留已生成部分并标注 stopped，生成态解除', async () => {
    let delta!: (t: string) => void
    mockedStream.mockImplementation((_c, _m, h: StreamHandlers, signal?: AbortSignal) => {
      delta = (t) => h.onDelta(t)
      return new Promise<string>((_res, rej) => {
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
    expect(msg.content).toBe('已生成的一段') // 已生成部分保留
    expect(sessions.isGenerating(sessions.activeId)).toBe(false)
  })

  it('stopRequested 不残留：停止后再发新消息正常完成', async () => {
    let first = true
    mockedStream.mockImplementation((_c, _m, h: StreamHandlers, signal?: AbortSignal) => {
      if (first) {
        first = false
        return new Promise((_res, rej) => {
          signal?.addEventListener('abort', () => {
            const e = new Error('aborted')
            e.name = 'AbortError'
            rej(e)
          })
          setTimeout(() => _res('完整'), 5000)
        })
      }
      h.onDelta('新回复')
      return Promise.resolve('新回复')
    })
    const sessions = useSessionsStore()
    const p1 = sessions.send('第一条')
    await new Promise((r) => setTimeout(r, 10))
    sessions.stopGeneration()
    await p1
    expect(sessions.active!.messages[1].status).toBe('stopped')

    await sessions.send('第二条')
    expect(sessions.active!.messages[3]).toMatchObject({ status: 'done', content: '新回复' })
  })

  it('边界：无生成时 stopGeneration 为 no-op，不报错', () => {
    const sessions = useSessionsStore()
    expect(() => sessions.stopGeneration()).not.toThrow()
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
})

describe('系统提示词组装（REQ-008，iter-2 T3）', () => {
  it('已设置时请求上下文首位为 system；未设置时不携带 system', async () => {
    mockedStream.mockResolvedValue('ok')
    const settings = useSettingsStore()
    const sessions = useSessionsStore()

    settings.saveSystemPrompt('回复只用英文')
    await sessions.send('hi')
    const withSys = mockedStream.mock.calls.at(-1)![1] as Array<{ role: string }>
    expect(withSys[0]).toEqual({ role: 'system', content: '回复只用英文' })

    settings.saveSystemPrompt('')
    await sessions.send('again')
    const withoutSys = mockedStream.mock.calls.at(-1)![1] as Array<{ role: string }>
    expect(withoutSys.some((m) => m.role === 'system')).toBe(false)
  })
})

describe('停止时效构造性证明（NCR-iter2-003 整改）', () => {
  it('stopGeneration() 调用返回前 AbortSignal 已置 aborted（同步路径，无异步间隙 → 点击到停止渲染仅需一个 Vue 渲染 tick，远小于 200ms 阈值）', async () => {
    let captured: AbortSignal | undefined
    mockedStream.mockImplementation((_c, _m, _h: StreamHandlers, signal?: AbortSignal) => {
      captured = signal
      return new Promise<string>((_res, rej) => {
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

describe('消息编辑与重新生成（REQ-015，iter-4 T2）', () => {
  it('编辑历史消息：删除编辑点及其后消息，从编辑点重建，上下文不含旧后文', async () => {
    mockedStream
      .mockResolvedValueOnce('回复1')
      .mockResolvedValueOnce('回复2')
      .mockResolvedValueOnce('新回复')
    const sessions = useSessionsStore()
    await sessions.send('问题1')
    await sessions.send('问题2')
    expect(sessions.active!.messages).toHaveLength(4)

    await sessions.editAndRegenerate(sessions.active!.messages[0].id, '改后问题1')

    const msgs = sessions.active!.messages
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toMatchObject({ role: 'user', content: '改后问题1' })
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: '新回复', status: 'done' })
    // 上下文：仅编辑后的用户消息（新 assistant 占位不参与请求）
    const ctx = mockedStream.mock.calls.at(-1)![1] as Array<{ role: string; content: string }>
    expect(ctx).toEqual([{ role: 'user', content: '改后问题1' }])
  })

  it('编辑中间轮次：编辑点之前的轮次完整保留，其后消息被替换', async () => {
    mockedStream
      .mockResolvedValueOnce('回复1')
      .mockResolvedValueOnce('回复2')
      .mockResolvedValueOnce('新回复2')
    const sessions = useSessionsStore()
    await sessions.send('问题1')
    await sessions.send('问题2')

    await sessions.editAndRegenerate(sessions.active!.messages[2].id, '改后问题2')

    const msgs = sessions.active!.messages
    expect(msgs).toHaveLength(4)
    expect(msgs[0]).toMatchObject({ role: 'user', content: '问题1' }) // 第一轮不变
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: '回复1' })
    expect(msgs[2]).toMatchObject({ role: 'user', content: '改后问题2' }) // 第二轮被替换
    expect(msgs[3]).toMatchObject({ role: 'assistant', content: '新回复2', status: 'done' })
    // 上下文：第一轮完整保留 + 编辑后的第二轮用户消息；旧第二轮后文不出现
    const ctx = mockedStream.mock.calls.at(-1)![1] as Array<{ role: string; content: string }>
    expect(ctx).toEqual([
      { role: 'user', content: '问题1' },
      { role: 'assistant', content: '回复1' },
      { role: 'user', content: '改后问题2' },
    ])
  })

  it('生成中编辑：中断当前生成，从编辑点重建，新生成不受旧 finally 干扰', async () => {
    let call = 0
    mockedStream.mockImplementation((_c, _m, _h: StreamHandlers, signal?: AbortSignal) => {
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
      return Promise.resolve('新回复')
    })
    const sessions = useSessionsStore()
    const p = sessions.send('长问题')
    await new Promise((r) => setTimeout(r, 10))
    expect(sessions.isGenerating(sessions.activeId)).toBe(true)

    await sessions.editAndRegenerate(sessions.active!.messages[0].id, '改后问题')
    await p

    const msgs = sessions.active!.messages
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toMatchObject({ role: 'user', content: '改后问题' })
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: '新回复', status: 'done' })
    expect(sessions.isGenerating(sessions.activeId)).toBe(false)
  })

  it('空文本 / 非用户消息 / 不存在的消息：no-op 不发请求', async () => {
    mockedStream.mockResolvedValueOnce('回复')
    const sessions = useSessionsStore()
    await sessions.send('问题')
    const calls = mockedStream.mock.calls.length

    await sessions.editAndRegenerate(sessions.active!.messages[0].id, '   ')
    await sessions.editAndRegenerate(sessions.active!.messages[1].id, '改')
    await sessions.editAndRegenerate('不存在', '改')

    expect(mockedStream.mock.calls.length).toBe(calls) // 未新增请求
  })

  it('版本切换：编辑后保留旧分支，toggleVersion 在新旧分支间互换（REQ-019）', async () => {
    mockedStream.mockResolvedValueOnce('回复1').mockResolvedValueOnce('新回复')
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
    expect(sessions.active!.messages[1]).toMatchObject({ role: 'assistant', content: '回复1', status: 'done' })

    // 再切回新分支
    sessions.toggleVersion(forkId!)
    expect(sessions.active!.messages[0]).toMatchObject({ role: 'user', content: '改后问题' })
    expect(sessions.active!.messages[1]).toMatchObject({ role: 'assistant', content: '新回复', status: 'done' })
  })
})
