/**
 * design-iter-8 §1.1 走查 1/2（REQ-025）：侧栏底栏盾牌入口——仅管理员渲染，
 * 普通用户 DOM 无该节点（入口隐藏是 UI 层，安全边界在服务端 403）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'

vi.mock('../../stores/sessions', () => ({
  useSessionsStore: () => ({ sessions: [], createSession: vi.fn(), activeId: null }),
}))
vi.mock('../../stores/settings', () => ({
  useSettingsStore: () => ({ activeProfile: null }),
}))

import TheSidebar from '../TheSidebar.vue'
import { useAuthStore } from '../../stores/auth'

beforeEach(() => {
  setActivePinia(createPinia())
})

function mountSidebar() {
  return mount(TheSidebar, { global: { stubs: { Teleport: true } } })
}

describe('管理后台入口（design-iter-8 §1.1，定夺 ③）', () => {
  it('管理员：盾牌入口在档案标签与登出之间，title「管理后台（仅管理员可见）」', () => {
    const auth = useAuthStore()
    auth.checked = true
    auth.user = { id: 1, username: '猫南北', is_admin: true }
    const wrapper = mountSidebar()
    const adminBtn = wrapper.find('button[aria-label="管理后台"]')
    expect(adminBtn.exists()).toBe(true)
    expect(adminBtn.attributes('title')).toBe('管理后台（仅管理员可见）')
    // 位置：profile-tag 之后、登出之前
    const footer = wrapper.find('.footer')
    const html = footer.html()
    expect(html.indexOf('管理后台')).toBeGreaterThan(html.indexOf('profile-tag'))
    expect(html.indexOf('aria-label="登出"')).toBeGreaterThan(html.indexOf('管理后台'))
  })

  it('普通用户：DOM 中不存在盾牌节点，底栏无任何后台痕迹', () => {
    const auth = useAuthStore()
    auth.checked = true
    auth.user = { id: 2, username: 'bob', is_admin: false }
    const wrapper = mountSidebar()
    expect(wrapper.find('button[aria-label="管理后台"]').exists()).toBe(false)
    expect(wrapper.find('.footer').html()).not.toContain('管理后台')
  })
})
