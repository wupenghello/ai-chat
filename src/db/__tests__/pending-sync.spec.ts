import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../../api/backend', () => ({
  request: vi.fn(),
  ApiBackendError: class ApiBackendError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message)
    }
  },
}))

import { request, ApiBackendError } from '../../api/backend'
import { useToastStore } from '../../stores/toast'
import {
  _stopPolling,
  deleteSession,
  flushPending,
  pendingOpsCount,
  saveSession,
  type PersistedSession,
} from '../persistence'

const mocked = vi.mocked(request)

const session = (id: string, content = 'v1'): PersistedSession =>
  ({
    id,
    title: 't',
    createdAt: 1,
    updatedAt: 2,
    messages: [{ id: 'm1', role: 'user', content, status: 'done' }],
    renamed: false,
  }) as PersistedSession

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  _stopPolling()
})

describe('断网暂存（REQ-022 异常分支「写回失败」，iter-7 T3）', () => {
  it('网络层失败 → 入队不丢数据 + 提示「部分更改未同步」', async () => {
    mocked.mockRejectedValueOnce(new ApiBackendError(0, '网络错误，请检查网络后重试'))
    await saveSession(session('s1'))
    expect(pendingOpsCount()).toBe(1)
    const toast = useToastStore()
    expect(toast.items.some((t) => t.message.includes('部分更改未同步'))).toBe(true)
  })

  it('5xx（后端暂不可用）同样暂存；4xx 逻辑错误不入队直接抛出', async () => {
    mocked.mockRejectedValueOnce(new ApiBackendError(503, 'unavailable'))
    await saveSession(session('s1'))
    expect(pendingOpsCount()).toBe(1)

    mocked.mockRejectedValueOnce(new ApiBackendError(422, 'bad payload'))
    await expect(saveSession(session('s2'))).rejects.toBeInstanceOf(ApiBackendError)
    expect(pendingOpsCount()).toBe(1) // 未新增
  })

  it('同一会话多次失败 → 队列压缩为最后一次整档（LWW 不被乱序破坏）', async () => {
    mocked.mockRejectedValue(new ApiBackendError(0, 'down'))
    await saveSession(session('s1', 'v1'))
    await saveSession(session('s1', 'v2'))
    await saveSession(session('s1', 'v3'))
    expect(pendingOpsCount()).toBe(1)
    // flush 时只 PUT 最新整档
    mocked.mockResolvedValueOnce(undefined)
    await flushPending()
    expect(mocked).toHaveBeenCalledWith('PUT', '/api/sessions/s1', session('s1', 'v3'))
    expect(pendingOpsCount()).toBe(0)
  })

  it('put 后 delete → 队列只留 delete；恢复后重放删除', async () => {
    mocked.mockRejectedValueOnce(new ApiBackendError(0, 'down'))
    await saveSession(session('s1'))
    mocked.mockRejectedValueOnce(new ApiBackendError(0, 'down'))
    await deleteSession('s1')
    expect(pendingOpsCount()).toBe(1)

    mocked.mockResolvedValueOnce(undefined)
    await flushPending()
    expect(mocked).toHaveBeenCalledWith('DELETE', '/api/sessions/s1')
    expect(pendingOpsCount()).toBe(0)
  })

  it('多会话按入队顺序重放；中途仍断网则保留剩余队列', async () => {
    mocked.mockRejectedValue(new ApiBackendError(0, 'down'))
    await saveSession(session('a'))
    await saveSession(session('b'))

    mocked.mockImplementationOnce(() => Promise.resolve(undefined)) // a 成功
    mocked.mockImplementationOnce(() => Promise.reject(new ApiBackendError(0, 'down'))) // b 仍断
    await flushPending()
    expect(mocked).toHaveBeenLastCalledWith('PUT', '/api/sessions/b', session('b'))
    expect(pendingOpsCount()).toBe(1) // b 保留，a 已出队

    mocked.mockResolvedValue(undefined)
    await flushPending()
    expect(pendingOpsCount()).toBe(0)
  })

  it('重放遇非临时性失败（毒丸）丢弃该条，不卡死后续', async () => {
    mocked.mockRejectedValue(new ApiBackendError(0, 'down'))
    await saveSession(session('a'))
    await saveSession(session('b'))

    mocked.mockImplementationOnce(() => Promise.reject(new ApiBackendError(422, 'bad'))) // a 毒丸
    mocked.mockResolvedValueOnce(undefined) // b 成功
    await flushPending()
    expect(pendingOpsCount()).toBe(0)
  })

  it('提示去重：同一积压期只弹一次；队列清空后下次积压重新提示', async () => {
    mocked.mockRejectedValue(new ApiBackendError(0, 'down'))
    await saveSession(session('a'))
    await saveSession(session('b'))
    const toast = useToastStore()
    expect(toast.items.filter((t) => t.message.includes('部分更改未同步'))).toHaveLength(1)

    mocked.mockResolvedValue(undefined)
    await flushPending()
    expect(pendingOpsCount()).toBe(0)

    mocked.mockRejectedValue(new ApiBackendError(0, 'down'))
    await saveSession(session('c'))
    // 新积压期重新提示（+1），但同一积压期内多步操作不重复弹
    expect(toast.items.filter((t) => t.message.includes('部分更改未同步'))).toHaveLength(2)
  })

  it('恢复网络（online 事件）自动触发重放', async () => {
    mocked.mockRejectedValueOnce(new ApiBackendError(0, 'down'))
    await saveSession(session('s1'))
    mocked.mockResolvedValueOnce(undefined)
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect(pendingOpsCount()).toBe(0))
  })

  it('写回成功（在线）不入队', async () => {
    mocked.mockResolvedValueOnce(undefined)
    await saveSession(session('s1'))
    expect(pendingOpsCount()).toBe(0)
    const toast = useToastStore()
    expect(toast.items).toHaveLength(0)
  })
})
