/**
 * REQ-026（design-iter-11 §1 基线）走查取证：账户区菜单（15）/ 管理员条件渲染（沿 iter-8 口径）/
 * 时间分组（11/12）/ rail 收起与持久化（16~18）/ 新建清空搜索（2）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'

vi.mock('../../stores/sessions', () => ({
  useSessionsStore: () => sessionsMock,
}))
vi.mock('../../stores/settings', () => ({
  useSettingsStore: () => ({ activeProfile: null }),
}))

import TheSidebar from '../TheSidebar.vue'
import { useAuthStore } from '../../stores/auth'
import type { Session } from '../../stores/sessions'

// 会话 store 替身：分组/排序断言需要可控的 sessions 数组
const sessionsMock = vi.hoisted(() => ({ sessions: [] as Session[], createSession: vi.fn(), activeId: null as string | null, switchTo: vi.fn(), renameSession: vi.fn(), removeSession: vi.fn() }))

function makeSession(id: string, title: string, updatedAt: number, extra: Partial<Session> = {}): Session {
  return { id, title, createdAt: updatedAt - 1000, updatedAt, messages: [], renamed: false, ...extra }
}

function mountSidebar() {
  return mount(TheSidebar, { global: { stubs: { Teleport: true } }, attachTo: document.body })
}

function login(admin: boolean) {
  const auth = useAuthStore()
  auth.checked = true
  auth.user = { id: admin ? 1 : 2, username: admin ? '猫南北' : 'bob', is_admin: admin }
}

beforeEach(() => {
  setActivePinia(createPinia())
  sessionsMock.sessions = []
  sessionsMock.activeId = null
  localStorage.removeItem('mm-sidebar-collapsed')
})

describe('账户区与菜单（REQ-026.3，走查 14/15）', () => {
  it('账户区 = 首字头像 + 用户名 +「···」菜单触发；旧元素（密钥标签/盾牌/常驻设置钮/登出 icon）不渲染', async () => {
    login(true)
    const wrapper = mountSidebar()
    expect(wrapper.find('.avatar').text()).toBe('猫')
    expect(wrapper.find('.acct-name').text()).toBe('猫南北')
    const html = wrapper.find('.acct').html()
    expect(html).not.toContain('统一密钥')
    expect(html).not.toContain('设置</button>') // 常驻设置钮不在账户区直渲染
    // 旧 footer 类整体不存在
    expect(wrapper.find('.footer').exists()).toBe(false)
    expect(wrapper.find('.profile-tag').exists()).toBe(false)
    wrapper.unmount()
  })

  it('菜单：设置 / 管理后台（管理员）/ 登出；选择分别触发 openSettings / 路由 / logout', async () => {
    login(true)
    const wrapper = mountSidebar()
    await wrapper.find('.acct .dd-trigger').trigger('click')
    const items = wrapper.findAll('[role="menuitem"]')
    expect(items.map((i) => i.text())).toEqual(['设置', '管理后台', '登出'])
    await items[0].trigger('click')
    expect(wrapper.emitted('openSettings')).toBeTruthy()
    wrapper.unmount()
  })

  it('普通用户：菜单无「管理后台」项（DOM 口径沿 iter-8：普通用户无后台痕迹）', async () => {
    login(false)
    const wrapper = mountSidebar()
    await wrapper.find('.acct .dd-trigger').trigger('click')
    const labels = wrapper.findAll('[role="menuitem"]').map((i) => i.text())
    expect(labels).toEqual(['设置', '登出'])
    expect(wrapper.find('.acct').html()).not.toContain('管理后台')
    wrapper.unmount()
  })

  it('登出走菜单项（非 danger）：emit logout', async () => {
    login(false)
    const wrapper = mountSidebar()
    await wrapper.find('.acct .dd-trigger').trigger('click')
    const items = wrapper.findAll('[role="menuitem"]')
    await items[items.length - 1].trigger('click')
    expect(wrapper.emitted('logout')).toBeTruthy()
    wrapper.unmount()
  })
})

describe('时间分组（REQ-026.2，走查 11/12）', () => {
  it('四组按序渲染、空组不渲染、组内 updatedAt 倒序、无逐条时间戳', () => {
    // 锚定当日零点，避免测试运行在凌晨时「N 小时前」跨零点漂移
    const sod = new Date()
    sod.setHours(0, 0, 0, 0)
    const day = 86_400_000
    const S = sod.getTime()
    sessionsMock.sessions = [
      makeSession('a', '今天一', S + 3_600_000),
      makeSession('b', '今天二', S + 7_200_000),
      makeSession('c', '昨天', S - 3_600_000),
      makeSession('d', '五天前', S - 5 * day),
      makeSession('e', '上月', S - 30 * day),
    ]
    const wrapper = mountSidebar()
    const labels = wrapper.findAll('.group-label').map((l) => l.text())
    expect(labels).toEqual(['今天', '昨天', '近 7 天', '更早'])
    const titles = wrapper.findAll('.title').map((t) => t.text())
    expect(titles).toEqual(['今天二', '今天一', '昨天', '五天前', '上月']) // 组内倒序
    expect(wrapper.find('.time').exists()).toBe(false) // 无逐条时间戳
    wrapper.unmount()
  })
})

describe('rail 收起与持久化（REQ-026.4，走查 16~18）', () => {
  it('收起 → rail 形态（展开/新建/搜索图标 + 底部头像）；展开钮/头像点击恢复', async () => {
    login(false)
    const wrapper = mountSidebar()
    await wrapper.find('button[aria-label="收起侧栏"]').trigger('click')
    expect(wrapper.find('.sidebar').classes()).toContain('rail')
    expect(wrapper.find('button[aria-label="展开侧栏"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="新建会话"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="搜索会话（展开侧栏）"]').exists()).toBe(true)
    expect(wrapper.find('.rail-avatar').text()).toBe('b')
    expect(localStorage.getItem('mm-sidebar-collapsed')).toBe('1')
    await wrapper.find('button[aria-label="展开侧栏"]').trigger('click')
    expect(wrapper.find('.sidebar').classes()).not.toContain('rail')
    expect(localStorage.getItem('mm-sidebar-collapsed')).toBe(null)
    wrapper.unmount()
  })

  it('挂载时读 localStorage：收起状态刷新保持（走查 18）', () => {
    localStorage.setItem('mm-sidebar-collapsed', '1')
    login(false)
    const wrapper = mountSidebar()
    expect(wrapper.find('.sidebar').classes()).toContain('rail')
    wrapper.unmount()
  })

  it('rail 点「搜索」= 展开侧栏并聚焦搜索框（走查 17）', async () => {
    localStorage.setItem('mm-sidebar-collapsed', '1')
    login(false)
    const wrapper = mountSidebar()
    await wrapper.find('button[aria-label="搜索会话（展开侧栏）"]').trigger('click')
    expect(wrapper.find('.sidebar').classes()).not.toContain('rail')
    expect(wrapper.find('.search-input').element).toBe(document.activeElement)
    wrapper.unmount()
  })
})

describe('新建会话（走查 2：点击新建并清空搜索）', () => {
  it('新建时清空搜索词并 emit chat', async () => {
    login(false)
    sessionsMock.sessions = [makeSession('a', '标题含密钥', Date.now(), { messages: [{ id: 'm', role: 'user', content: '密钥正文', status: 'done' }] })]
    const wrapper = mountSidebar()
    await wrapper.find('.search-input').setValue('密钥')
    expect(wrapper.findAll('.title').length).toBe(1)
    await wrapper.find('.new-btn').trigger('click')
    expect((wrapper.find('.search-input').element as HTMLInputElement).value).toBe('')
    expect(sessionsMock.createSession).toHaveBeenCalled()
    expect(wrapper.emitted('chat')).toBeTruthy()
    wrapper.unmount()
  })
})
