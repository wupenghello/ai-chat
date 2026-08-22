/**
 * iter-20 T2（REQ-049/051，design-iter-20 §2/§3）：≤768px 侧栏抽屉化 + 触控口径 —— App 级行为面。
 *
 * T2 首步 spike 结论（2026-08-22 实测）：本项目 vitest jsdom（jsdom v25）**未实现
 * window.matchMedia**——useMediaQuery 特性检测兜底 false（桌面口径），移动/触屏态测试
 * 用 vi.stubGlobal('matchMedia', q => ({ matches: map[q], ... })) 模拟（vitest 标准手段）。
 * 几何面（正文全宽/overlay 覆盖等布局断言）jsdom 无布局引擎不承载，降级 T3 走查脚本
 * （scripts/e2e-walkthrough-20.mjs 真实 Chrome 断言，plan 风险②处置）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('../../db/persistence', () => ({
  loadSessions: vi.fn(async () => []),
  saveSession: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
}))

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  runChatTurn: vi.fn(),
}))

import App from '../../App.vue'
import { useAuthStore } from '../../stores/auth'
import { useSessionsStore } from '../../stores/sessions'
import { runChatTurn, type TurnHandlers, type TurnEndReason } from '../../api/client'

const mockedStream = vi.mocked(runChatTurn)

/** matchMedia 桩：按查询串映射 matches（模拟 ≤768px / hover:none 等媒体特性） */
function stubMatchMedia(map: Record<string, boolean>) {
  const impl = (q: string) => ({
    matches: map[q] ?? false,
    media: q,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })
  vi.stubGlobal('matchMedia', impl)
}

/** 挂起式回合 mock（沿 integration.spec 口径）：事件手动推送——承载验收 7 不断流断言 */
function gatedStream() {
  let delta!: (t: string) => void
  let finish!: () => void
  const promise = new Promise<TurnEndReason>((res) => (finish = () => res('done')))
  mockedStream.mockImplementation((_sid: string, _msg: string, _opts: { systemPrompt?: string }, h: TurnHandlers) => {
    delta = (t: string) => h.onEvent({ type: 'text.delta', text: t })
    return promise
  })
  return { push: (t: string) => delta(t), finish: () => finish() }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  setActivePinia(createPinia())
  useAuthStore().user = { id: 1, username: 'tester', is_admin: false }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function mountApp() {
  const wrapper = mount(App)
  await flushPromises()
  return wrapper
}

describe('REQ-049 ≤768px 抽屉化：开合三径 + 瞬态 + 顶条', () => {
  beforeEach(() => {
    stubMatchMedia({ '(max-width: 768px)': true })
  })

  it('入口钮 M44「打开会话列表」逐字 + 初始 aria-expanded=false；顶条会话名与当前会话同源', async () => {
    const wrapper = await mountApp() // onMounted init 先行（会从 persistence 载入空表）
    const sessions = useSessionsStore()
    sessions.createSession()
    sessions.renameSession(sessions.activeId!, '移动端会话甲')
    await flushPromises()
    const btn = wrapper.find('.drawer-btn')
    expect(btn.attributes('aria-label')).toBe('打开会话列表')
    expect(btn.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.topbar-title').text()).toBe('移动端会话甲')
  })

  it('点入口钮开抽屉：app/sidebar 挂 drawer-open + aria-expanded=true；不写 mm-sidebar-collapsed', async () => {
    const wrapper = await mountApp()
    await wrapper.find('.drawer-btn').trigger('click')
    expect(wrapper.find('.app').classes()).toContain('drawer-open')
    expect(wrapper.find('.sidebar').classes()).toContain('drawer-open')
    expect(wrapper.find('.drawer-btn').attributes('aria-expanded')).toBe('true')
    // 验收 6：瞬态不持久化——开合态零 localStorage 写入
    expect(localStorage.getItem('mm-sidebar-collapsed')).toBeNull()
  })

  it('关闭径①点遮罩：drawer-open 移除 + aria-expanded=false，仍零 localStorage 写入', async () => {
    const wrapper = await mountApp()
    await wrapper.find('.drawer-btn').trigger('click')
    await wrapper.find('.drawer-mask').trigger('click')
    expect(wrapper.find('.app').classes()).not.toContain('drawer-open')
    expect(wrapper.find('.sidebar').classes()).not.toContain('drawer-open')
    expect(wrapper.find('.drawer-btn').attributes('aria-expanded')).toBe('false')
    expect(localStorage.getItem('mm-sidebar-collapsed')).toBeNull()
  })

  it('关闭径②Esc：抽屉关闭（遮罩/选中会话三径同一 closeDrawer）', async () => {
    const wrapper = await mountApp()
    await wrapper.find('.drawer-btn').trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('.app').classes()).not.toContain('drawer-open')
  })

  it('关闭径③选中会话：switchTo 生效 + 抽屉自动关（REQ-049 主流程：开 → 选 → 关 → 正文全宽）', async () => {
    const wrapper = await mountApp()
    const sessions = useSessionsStore()
    sessions.createSession() // 会话 1（active）
    const first = sessions.activeId!
    sessions.createSession() // 会话 2
    sessions.renameSession(sessions.activeId!, '会话乙')
    sessions.renameSession(first, '会话甲')
    await flushPromises()
    const target = sessions.sessions.find((s) => s.title === '会话甲')! // 点选非 active 的「会话甲」
    await wrapper.find('.drawer-btn').trigger('click')
    const items = wrapper.findAll('.session-list .item')
    await items[items.findIndex((i) => i.text().includes('会话甲'))].trigger('click')
    await flushPromises()
    expect(sessions.activeId).toBe(target.id)
    expect(wrapper.find('.app').classes()).not.toContain('drawer-open')
    expect(localStorage.getItem('mm-sidebar-collapsed')).toBeNull()
  })

  it('桌面收起键污染防护：移动端预存 collapsed=1 → rail 抑制（展开模板）且键值不变', async () => {
    localStorage.setItem('mm-sidebar-collapsed', '1')
    const wrapper = await mountApp()
    // ≤768px 零 rail 口径：collapsed 被抑制，渲染展开模板（rail 按钮不出现）
    expect(wrapper.find('.sidebar').classes()).not.toContain('rail')
    expect(wrapper.find('.sidebar .new-btn').exists()).toBe(true)
    expect(localStorage.getItem('mm-sidebar-collapsed')).toBe('1') // 键值零变化
  })

  it('验收 7：生成中开合抽屉 SSE 流帧序不变（抽屉为纯容器切换，与流零事件交互）', async () => {
    const stream = gatedStream()
    const wrapper = await mountApp()
    const ta = wrapper.find('.composer textarea')
    await ta.setValue('生成中开合抽屉')
    await ta.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    stream.push('帧A')
    await flushPromises()
    // 生成中开抽屉 → 关抽屉，流帧持续追加
    await wrapper.find('.drawer-btn').trigger('click')
    stream.push('帧B')
    await wrapper.find('.drawer-mask').trigger('click')
    stream.push('帧C')
    await flushPromises()
    const text = wrapper.find('.bubble.assistant').text()
    expect(text).toContain('帧A')
    expect(text).toContain('帧B')
    expect(text).toContain('帧C')
    expect(text.indexOf('帧A')).toBeLessThan(text.indexOf('帧B'))
    expect(text.indexOf('帧B')).toBeLessThan(text.indexOf('帧C'))
    stream.finish()
    await flushPromises()
  })

  it('桌面隔离（>768px）：collapsed=1 时 rail 形态保留（REQ-026 走查 16~18 零回退）', async () => {
    stubMatchMedia({}) // 全部 matches=false = 桌面口径
    localStorage.setItem('mm-sidebar-collapsed', '1')
    const wrapper = await mountApp()
    expect(wrapper.find('.sidebar').classes()).toContain('rail')
    expect(wrapper.find('.sidebar .new-btn').exists()).toBe(false) // rail 模板（窄条）
  })
})
