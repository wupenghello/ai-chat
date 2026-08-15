/**
 * 服务端持久化适配层测试（REQ-022 核心）：端点/方法/请求体、排序、401 失效钩子。
 * mock 全局 fetch，不依赖真实后端。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { deleteSession, loadSessions, saveSession } from '../persistence'
import type { PersistedSession } from '../persistence'
import { setUnauthorizedHandler } from '../../api/backend'

// 401 失效钩子：注册真实实现（request 内部调用），断言其被触发
const unauth = vi.fn()
setUnauthorizedHandler(() => unauth())

const SESSION: PersistedSession = {
  id: 's-1',
  title: 't',
  createdAt: 1,
  updatedAt: 2,
  messages: [{ id: 'm1', role: 'user', content: 'hi', status: 'done' }],
}

function fetchOk(json: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => json,
  } as Response)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('loadSessions', () => {
  it('GET /api/sessions 并按 updatedAt 降序排', async () => {
    const fetchMock = fetchOk([{ ...SESSION, id: 'old', updatedAt: 1 }, { ...SESSION, id: 'new', updatedAt: 9 }])
    vi.stubGlobal('fetch', fetchMock)
    const got = await loadSessions()
    expect(got.map((s) => s.id)).toEqual(['new', 'old'])
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({ method: 'GET' }))
  })

  it('401 → 触发登录态失效钩子并抛错', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: '未登录' }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    await expect(loadSessions()).rejects.toThrow('未登录')
    expect(unauth).toHaveBeenCalledTimes(1)
  })
})

describe('saveSession', () => {
  it('PUT /api/sessions/{id} 整档为请求体', async () => {
    const fetchMock = fetchOk({ detail: 'saved' })
    vi.stubGlobal('fetch', fetchMock)
    await saveSession(SESSION)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/sessions/s-1')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual(SESSION)
  })

  it('id 含特殊字符时 URL 编码', async () => {
    const fetchMock = fetchOk({ detail: 'saved' })
    vi.stubGlobal('fetch', fetchMock)
    await saveSession({ ...SESSION, id: 'a b/中文' })
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/sessions/${encodeURIComponent('a b/中文')}`)
  })
})

describe('deleteSession', () => {
  it('DELETE /api/sessions/{id}', async () => {
    const fetchMock = fetchOk({ detail: 'deleted' })
    vi.stubGlobal('fetch', fetchMock)
    await deleteSession('s-1')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/sessions/s-1')
    expect(init.method).toBe('DELETE')
  })
})
