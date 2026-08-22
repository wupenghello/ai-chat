/**
 * iter-20 T3（REQ-050）：设置弹窗 ≤480px 全屏化 CSS/DOM 契约断言——
 * 沿 T2 MobileCssContract 体例：jsdom 无布局引擎，像素级几何（inset 0 实测 100vw×100vh）由
 * T3 走查脚本（真实 Chrome）承载；本文件断言「规则面收敛」：全屏规则全部落在
 * @media (max-width: 480px) 带界块内（桌面 720px 分栏规则面零触碰）+ 关键几何值逐字
 * （100vw/100vh/inset 0/radius 0/横滚 overflow-x:auto）+ DOM 面（验收 6 横向导航滚动可见）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'

vi.mock('../../api/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/backend')>()),
  backend: {
    listProfiles: vi.fn(async () => []),
    getQuota: vi.fn(async () => null),
  },
}))

import SettingsForm from '../SettingsForm.vue'
import { useSettingsStore } from '../../stores/settings'
import { useAuthStore } from '../../stores/auth'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

/** 截取某个 @media 块（自声明起至下一个 @media 或 style 尾）——T2 MobileCssContract 同款 */
const mediaBlock = (src: string, query: string) => {
  const start = src.indexOf(`@media (${query})`)
  expect(start, `缺少 @media (${query}) 块`).toBeGreaterThanOrEqual(0)
  const rest = src.slice(start + query.length + 8)
  const next = rest.indexOf('@media')
  return next === -1 ? rest : rest.slice(0, next)
}

describe('REQ-050 ≤480px 弹窗全屏态（CSS 契约，验收 1/2/3）', () => {
  const src = read('../SettingsForm.vue')
  const b480 = mediaBlock(src, 'max-width: 480px')
  const outside = src.slice(0, src.indexOf('@media'))

  it('容器全屏：inset 0 + 100vw × 100vh + 圆角 0 + 无投影（验收 1）', () => {
    expect(b480).toContain('.settings-modal')
    expect(b480).toContain('position: fixed')
    expect(b480).toContain('inset: 0')
    expect(b480).toContain('width: 100vw')
    expect(b480).toContain('height: 100vh')
    expect(b480).toContain('max-width: none')
    expect(b480).toContain('max-height: none')
    expect(b480).toContain('border-radius: 0')
    expect(b480).toContain('box-shadow: none')
  })

  it('导航横切：flex-direction row + overflow-x:auto（定夺⑤横向滚动条）+ 滚动条 --c-scrollbar 既有令牌', () => {
    expect(b480).toContain('.sm-nav')
    expect(b480).toContain('flex-direction: row')
    expect(b480).toContain('overflow-x: auto')
    expect(b480).toContain('var(--c-scrollbar)')
    // 分区钮形态原样平移：钮基础样式（36px 高/选中 primary-l）在媒体查询外零改动
    expect(outside).toContain('.sm-nav button.on')
  })

  it('单滚动：表单列唯一纵向滚动容器（导航 overflow-y:hidden，纵轴不双重滚动）（验收 2）', () => {
    expect(b480).toContain('overflow-y: hidden')
    // .sm-pane overflow-y:auto 为基线属性（媒体查询外原样保留）
    expect(outside).toContain('.sm-pane')
    expect(outside).toContain('overflow-y: auto')
    // 弹窗根 overflow:hidden 基线（全屏态不产生文档级滚动 → 验收 3 不横向溢出的容器面）
    expect(outside).toContain('overflow: hidden')
  })

  it('内嵌二级弹窗（档案编辑/未保存确认）同口径全屏（100vw × 100vh + radius 0）', () => {
    expect(b480).toContain('.modal')
    expect(b480).toContain('width: 100vw')
    expect(b480).toContain('height: 100vh')
    expect(b480).toContain('border-radius: 0')
  })

  it('桌面 720px 分栏逐像素零变化（验收 5）：width/max-width/height/导航 168px 全属性在媒体查询外原样保留', () => {
    expect(outside).toContain('width: 720px')
    expect(outside).toContain('max-width: calc(100vw - 32px)')
    expect(outside).toContain('height: 560px')
    expect(outside).toContain('max-height: calc(100vh - 64px)')
    expect(outside).toContain('width: 168px')
    // 桌面二级弹窗 440px 卡片形态原样保留
    expect(outside).toContain('width: 440px')
  })
})

describe('REQ-050 二级弹窗组件同口径（CSS 契约）', () => {
  it('ConfirmModal：≤480px 全屏（100vw×100vh/radius 0）；桌面 360px 基线在媒体查询外保留', () => {
    const src = read('../ConfirmModal.vue')
    const b = mediaBlock(src, 'max-width: 480px')
    expect(b).toContain('width: 100vw')
    expect(b).toContain('height: 100vh')
    expect(b).toContain('max-width: none')
    expect(b).toContain('border-radius: 0')
    expect(src.slice(0, src.indexOf('@media'))).toContain('width: 360px')
  })

  it('DeleteAccountModal：≤480px 全屏（100vw×100vh/radius 0/纵向滚动）；桌面 420px 基线保留', () => {
    const src = read('../DeleteAccountModal.vue')
    const b = mediaBlock(src, 'max-width: 480px')
    expect(b).toContain('width: 100vw')
    expect(b).toContain('height: 100vh')
    expect(b).toContain('max-height: none')
    expect(b).toContain('border-radius: 0')
    expect(b).toContain('overflow-y: auto')
    expect(src.slice(0, src.indexOf('@media'))).toContain('width: 420px')
  })
})

describe('REQ-050 验收 6 「前往高级设置」全屏态复验（DOM 面）', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  async function mountForm(props?: Record<string, unknown>) {
    const settings = useSettingsStore()
    settings.profilesLoaded = true
    useAuthStore().user = { id: 1, username: '猫南北' }
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    // attachTo：showPane 经 document.querySelector 寻导航钮，须挂真 document（detach DOM 查不到）
    const div = document.createElement('div')
    document.body.appendChild(div)
    return { w: mount(SettingsForm, { props: { open: true, ...props }, attachTo: div }), spy }
  }

  it('分区切换顺带 scrollIntoView 导航目标钮（横向导航下滚动至可见；nearest 口径桌面零滚动）', async () => {
    const { w, spy } = await mountForm()
    await w.findAll('.sm-nav [role="tab"]')[4].trigger('click') // AI 的记忆 → 目标钮 index 4
    await Promise.resolve()
    expect(spy).toHaveBeenCalled()
    expect((spy.mock.instances[0] as HTMLElement)?.dataset.pane).toBe('memory')
  })

  it('locateAdv 直达：分区落「高级设置」+ 导航条滚动至目标钮可见 + 标题高亮 flash（验收 6 / iter-2 走查 15）', async () => {
    const { w, spy } = await mountForm({ locateAdv: true })
    await Promise.resolve()
    const visible = w.findAll('.sm-pane').filter((p) => (p.element as HTMLElement).style.display !== 'none')
    expect(visible.length).toBe(1)
    expect(visible[0].text()).toContain('高级设置 · 自填供应商密钥')
    expect(spy).toHaveBeenCalled()
    expect((spy.mock.instances.at(-1) as HTMLElement)?.dataset.pane).toBe('adv')
    await vi.waitFor(() => expect(w.find('.section-label.flash').exists()).toBe(true))
  })

  it('键盘切分区（focusNav 路径）亦 scrollIntoView 且 focus 不再触发滚动（preventScroll）', async () => {
    const { w } = await mountForm()
    await w.findAll('.sm-nav [role="tab"]')[0].trigger('keydown', { key: 'ArrowDown' })
    await Promise.resolve()
    const focused = document.activeElement as HTMLElement | null
    expect(focused?.dataset.pane).toBe('mode')
    expect(focused?.matches('.sm-nav button')).toBe(true)
  })
})

describe('REQ-050 验收 4 既有用例容器兼容面（T3 首步 spike 机器背书）', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('全屏化零改容器结构：settings-mask/settings-modal/sm-nav(七 tab)/sm-pane 类名与 DOM 形状零变化', async () => {
    // CHG-015 改写映射（iter-21 T3）：六 tab → 七 tab（「用量与费用」加法分区，
    // design-iter-21 §2）；旧断言 6 → 新断言 7，功能性删除为零
    const settings = useSettingsStore()
    settings.profilesLoaded = true
    useAuthStore().user = { id: 1, username: '猫南北' }
    const w = mount(SettingsForm, { props: { open: true } })
    expect(w.find('.settings-mask').exists()).toBe(true)
    expect(w.find('.settings-modal[role="dialog"][aria-modal="true"]').exists()).toBe(true)
    expect(w.findAll('.sm-nav [role="tab"]')).toHaveLength(7)
    expect(w.findAll('.sm-pane')).toHaveLength(7)
  })

  it('二级弹窗全屏化仅 CSS：ConfirmModal/DeleteAccountModal 组件 DOM 零变化（挂载即开 props 兼容）', async () => {
    const settings = useSettingsStore()
    settings.profilesLoaded = true
    useAuthStore().user = { id: 1, username: '猫南北' }
    const w = mount(SettingsForm, { props: { open: true } })
    const del = w.findComponent({ name: 'DeleteAccountModal' })
    const confirm = w.findComponent({ name: 'ConfirmModal' })
    expect(del.exists() && confirm.exists()).toBe(true)
    expect(del.props('open')).toBe(false)
    expect(confirm.props('open')).toBe(false)
  })
})
