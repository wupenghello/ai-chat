/**
 * iter-20 T2（REQ-049/051，design-iter-20 §3 定夺④ + M45）：触控口径切换——
 * hover:none 下 placeholder = M45「输入消息」、闲置态 Enter hint 不渲染；
 * M40/M41/生成中提示保留；hover:hover 存量逐字零变化（沿 iter-18 §8 零回退）。
 * 模拟口径 = vi.stubGlobal('matchMedia')（见 MobileShell.spec spike 结论）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ComposerBox from '../ComposerBox.vue'

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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('REQ-049/051 Composer 触控口径（hover:none）', () => {
  beforeEach(() => {
    stubMatchMedia({ '(hover: none)': true })
  })

  it('M45 逐字：触屏 placeholder = 「输入消息」（无 Enter 表述）', () => {
    const wrapper = mount(ComposerBox)
    expect(wrapper.find('textarea').attributes('placeholder')).toBe('输入消息')
  })

  it('定夺④：触屏闲置态（researchAvailable=true 且未开启）Enter hint 不渲染', () => {
    const wrapper = mount(ComposerBox, { props: { researchAvailable: true } })
    expect(wrapper.find('.hint-right').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Enter 发送')
  })

  it('M41 保留：触屏禁用态（researchAvailable 缺省）hint 逐字渲染（与输入方式无关）', () => {
    const wrapper = mount(ComposerBox)
    expect(wrapper.find('.hint-right').text()).toBe('深度研究暂不可用：需联网搜索可用')
  })

  it('M40 保留：触屏开启态 hint 逐字渲染', async () => {
    const wrapper = mount(ComposerBox, { props: { researchAvailable: true } })
    await wrapper.find('.tsw').trigger('click')
    expect(wrapper.find('.hint-right').text()).toBe(
      '已开启深度研究：发送后 AI 将自动拆解问题、多轮联网搜索并给出带引用的报告，耗时较长',
    )
  })

  it('生成中提示保留：触屏 generating 态 hint 逐字渲染', () => {
    const wrapper = mount(ComposerBox, { props: { generating: true } })
    expect(wrapper.find('.hint-right').text()).toBe('AI 回复生成中，发送暂不可用…')
  })

  it('桌面零回退（hover:hover）：placeholder 与闲置态 hint 存量逐字不变', () => {
    stubMatchMedia({ '(hover: none)': false, '(hover: hover)': true })
    const wrapper = mount(ComposerBox, { props: { researchAvailable: true } })
    expect(wrapper.find('textarea').attributes('placeholder')).toBe('输入消息，Enter 发送，Shift+Enter 换行')
    expect(wrapper.find('.hint-right').text()).toBe('Enter 发送 · Shift+Enter 换行')
  })
})
