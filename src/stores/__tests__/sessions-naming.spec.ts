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
}))

import { streamChat } from '../../api/client'
import { useSettingsStore } from '../settings'
import { useSessionsStore } from '../sessions'

const mockedStream = vi.mocked(streamChat)

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  setActivePinia(createPinia())
  useSettingsStore().save({ baseUrl: 'https://x', model: 'm', apiKey: 'k' })
})

describe('会话自动命名（REQ-009，iter-3 T1）', () => {
  it('首条消息超 20 字：截前 20 字加省略号', async () => {
    mockedStream.mockResolvedValue('ok')
    const sessions = useSessionsStore()
    const long = '帮我写一封请假邮件，理由是家里有急事需要尽快处理'
    await sessions.send(long)
    expect(sessions.active!.title).toBe(`${long.slice(0, 20)}…`)
  })

  it('首条消息 ≤20 字：原文作标题，不加省略号', async () => {
    mockedStream.mockResolvedValue('ok')
    const sessions = useSessionsStore()
    await sessions.send('我叫小明')
    expect(sessions.active!.title).toBe('我叫小明')
  })
})

describe('会话重命名（REQ-012，iter-3 T3）', () => {
  it('renameSession：写入标题、置 renamed、持久化', async () => {
    const { saveSession } = await import('../../db/persistence')
    const sessions = useSessionsStore()
    const id = sessions.createSession()
    sessions.renameSession(id, '请假邮件（重要）')
    const s = sessions.sessions.find((x) => x.id === id)!
    expect(s.title).toBe('请假邮件（重要）')
    expect(s.renamed).toBe(true)
    expect(saveSession).toHaveBeenCalled()
  })

  it('手动重命名后，首条消息不再覆盖标题', async () => {
    mockedStream.mockResolvedValue('ok')
    const sessions = useSessionsStore()
    const id = sessions.createSession()
    sessions.renameSession(id, '请假邮件（重要）')
    await sessions.send('帮我写一封请假邮件，理由是家里有急事')
    expect(sessions.sessions.find((x) => x.id === id)!.title).toBe('请假邮件（重要）')
  })

  it('空标题（trim 空）no-op：不改标题、不置 renamed', async () => {
    mockedStream.mockResolvedValue('ok')
    const sessions = useSessionsStore()
    const id = sessions.createSession()
    sessions.renameSession(id, '   ')
    const s = sessions.sessions.find((x) => x.id === id)!
    expect(s.title).toBe('新会话')
    expect(s.renamed).toBeFalsy()
  })
})
