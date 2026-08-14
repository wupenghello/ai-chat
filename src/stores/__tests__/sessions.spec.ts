import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../../db/idb', () => ({
  loadSessions: vi.fn(async () => []),
  saveSession: vi.fn(),
  deleteSession: vi.fn(),
}))

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  streamChat: vi.fn(),
}))

import { streamChat, type StreamHandlers } from '../../api/client'
import { useSettingsStore } from '../settings'
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
  it('未配置时返回 false，不调 API', async () => {
    localStorage.clear()
    setActivePinia(createPinia())
    const sessions = useSessionsStore()
    await expect(sessions.send('hi')).resolves.toBe(false)
    expect(streamChat).not.toHaveBeenCalled()
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

describe('中断与错误（REQ-003/004/007）', () => {
  it('生成中新建会话：原回复标注 interrupted，新会话立即激活', async () => {
    mockedStream.mockImplementation(abortableStream)
    const sessions = useSessionsStore()
    const p = sessions.send('慢问题')
    await new Promise((r) => setTimeout(r, 10)) // 让 generate 挂起
    sessions.createSession()
    await p
    expect(sessions.sessions[1].messages[1].status).toBe('interrupted')
    expect(sessions.activeId).toBe(sessions.sessions[0].id)
    expect(sessions.generating).toBe(false)
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
    const { loadSessions } = await import('../../db/idb')
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
