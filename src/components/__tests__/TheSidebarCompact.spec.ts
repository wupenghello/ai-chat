/**
 * iter-16 T3（CHG-010 REQ-040，design-iter-16 §2/§3/§5.1）：TheSidebar 手动压缩流程——
 * 菜单触发 → POST /api/chat/compact → 执行中 pill + 菜单项禁用防重复 → 四终态 toast
 * 逐字（C5~C8）；前端零预判本地 generating（409 服务端唯一判定，走查条 25 vitest 面）；
 * 切换会话不 abort 在途请求（走查条 29）。
 * 独立 mock 与夹具，既有 TheSidebar.spec.ts 零触达（沿 AdminTelemetry.spec 先例）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'

const sessionsMock = vi.hoisted(() => ({
  sessions: [] as Session[],
  createSession: vi.fn(),
  activeId: null as string | null,
  switchTo: vi.fn(),
  renameSession: vi.fn(),
  removeSession: vi.fn(),
}))

const backendMock = vi.hoisted(() => ({ compactSession: vi.fn() }))

vi.mock('../../stores/sessions', () => ({ useSessionsStore: () => sessionsMock }))
vi.mock('../../stores/settings', () => ({ useSettingsStore: () => ({ activeProfile: null }) }))
vi.mock('../../api/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/backend')>()),
  backend: backendMock,
}))

import TheSidebar from '../TheSidebar.vue'
import { useAuthStore } from '../../stores/auth'
import { useToastStore } from '../../stores/toast'
import { ApiBackendError } from '../../api/backend'
import type { Session } from '../../stores/sessions'

function makeSession(id: string, extra: Partial<Session> = {}): Session {
  return {
    id, title: `会话 ${id}`, createdAt: 1, updatedAt: Date.now(),
    messages: [{ id: 'm1', role: 'user', content: '你好', status: 'done' }],
    renamed: false, ...extra,
  }
}

function mountSidebar() {
  return mount(TheSidebar, { global: { stubs: { Teleport: true } }, attachTo: document.body })
}

/** 打开首个列表项菜单并点击「压缩上下文」（menuitem 第 3 位） */
async function clickCompact(wrapper: ReturnType<typeof mountSidebar>) {
  await wrapper.find('.item .dd-trigger').trigger('click')
  await wrapper.findAll('[role="menuitem"]')[2].trigger('click')
}

const C5 = '✓ 上下文压缩完成：中段历史已摘要，聊天记录不受影响'
const C6 = '当前会话无需压缩：历史还短'
const C7 = '压缩失败，请稍后再试'
const C8 = '该会话正在生成回复，暂不能压缩，请等生成完成后再试'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  sessionsMock.sessions = []
  sessionsMock.activeId = null
  const auth = useAuthStore()
  auth.checked = true
  auth.user = { id: 2, username: 'bob', is_admin: false }
})

describe('成功路径（走查条 17/18/20/21）', () => {
  it('点击压缩项 → 发请求（body 仅 session_id 由 API 层封装）→ 执行中 pill + 菜单禁用 → 成功 toast C5 success 变体不带数字', async () => {
    let resolve!: (v: unknown) => void
    backendMock.compactSession.mockReturnValue(new Promise((r) => { resolve = r }))
    sessionsMock.sessions = [makeSession('s1')]
    const wrapper = mountSidebar()
    await clickCompact(wrapper)
    expect(backendMock.compactSession).toHaveBeenCalledWith('s1')

    // 在途：pill「压缩中」+ 菜单项禁用防重复（再点不发第二次请求）
    expect(wrapper.find('.pill.compact').text()).toBe('压缩中')
    await clickCompact(wrapper)
    expect(backendMock.compactSession).toHaveBeenCalledTimes(1)

    resolve({ status: 'compacted', tokens_before: 41235 })
    await flushPromises()
    const toast = useToastStore()
    expect(toast.items).toHaveLength(1)
    expect(toast.items[0].message).toBe(C5) // 逐字 + 不呈现 token 数字（定夺③）
    expect(toast.items[0].variant).toBe('success')
    expect(wrapper.find('.pill.compact').exists()).toBe(false) // 终态清除
    wrapper.unmount()
  })
})

describe('其余三终态 toast（走查条 22/23/24/25）', () => {
  it('200 skipped → toast C6（无需压缩逐字）', async () => {
    backendMock.compactSession.mockResolvedValue({ status: 'skipped', reason: 'too_short' })
    sessionsMock.sessions = [makeSession('s1')]
    const wrapper = mountSidebar()
    await clickCompact(wrapper)
    await flushPromises()
    const toast = useToastStore()
    expect(toast.items[0].message).toBe(C6)
    expect(toast.items[0].variant).toBeUndefined() // 默认白字
    expect(wrapper.find('.pill.compact').exists()).toBe(false)
    wrapper.unmount()
  })

  it('409 → toast 呈现服务端 message 逐字 C8（前端直接呈现，两路径同文）', async () => {
    backendMock.compactSession.mockRejectedValue(new ApiBackendError(409, C8))
    sessionsMock.sessions = [makeSession('s1')]
    const wrapper = mountSidebar()
    await clickCompact(wrapper)
    await flushPromises()
    expect(useToastStore().items[0].message).toBe(C8)
    expect(wrapper.find('.pill.compact').exists()).toBe(false)
    wrapper.unmount()
  })

  it('5xx/422/404/网络错误 → toast C7 固定文案兜底', async () => {
    for (const err of [
      new ApiBackendError(502, C7),
      new ApiBackendError(422, '无法读取的会话不可压缩'),
      new ApiBackendError(0, '网络错误，请检查网络后重试'),
    ]) {
      backendMock.compactSession.mockRejectedValueOnce(err)
      sessionsMock.sessions = [makeSession('s1')]
      const wrapper = mountSidebar()
      await clickCompact(wrapper)
      await flushPromises()
      const items = useToastStore().items
      expect(items.at(-1)!.message).toBe(C7)
      expect(wrapper.find('.pill.compact').exists()).toBe(false)
      wrapper.unmount()
    }
  })

  it('本地生成中的会话点击压缩仍发请求（前端零预判，409 服务端唯一判定——走查条 25）', async () => {
    backendMock.compactSession.mockResolvedValue({ status: 'compacted', tokens_before: null })
    sessionsMock.sessions = [makeSession('s1', {
      messages: [{ id: 'm1', role: 'assistant', content: '', status: 'generating' }],
    })]
    const wrapper = mountSidebar()
    await clickCompact(wrapper)
    expect(backendMock.compactSession).toHaveBeenCalledTimes(1) // 不拦截、照常发
    await flushPromises()
    wrapper.unmount()
  })
})

describe('执行中切换会话（走查条 29：不 abort、toast 全局显示）', () => {
  it('压缩在途切换其他会话：请求继续、终态 toast 照常到达', async () => {
    let resolve!: (v: unknown) => void
    backendMock.compactSession.mockReturnValue(new Promise((r) => { resolve = r }))
    sessionsMock.sessions = [makeSession('s1'), makeSession('s2')]
    const wrapper = mountSidebar()
    await clickCompact(wrapper)
    expect(backendMock.compactSession).toHaveBeenCalledTimes(1)
    // 切到另一会话（不 abort 在途请求）
    await wrapper.findAll('.item')[1].trigger('click')
    expect(sessionsMock.switchTo).toHaveBeenCalledWith('s2')
    resolve({ status: 'compacted', tokens_before: null })
    await flushPromises()
    expect(useToastStore().items).toHaveLength(1) // toast 全局到达
    expect(useToastStore().items[0].message).toBe(C5)
    wrapper.unmount()
  })
})
