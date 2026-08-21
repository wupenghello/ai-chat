import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ComposerBox from '../../components/ComposerBox.vue'

function keyEvent(key: string, shift = false) {
  return new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true })
}

describe('ComposerBox（REQ-001）', () => {
  it('空输入时发送按钮禁用', () => {
    const wrapper = mount(ComposerBox)
    expect(wrapper.find('.send').attributes('disabled')).toBeDefined()
  })

  it('Enter 发送并清空；Shift+Enter 换行不发送', async () => {
    const wrapper = mount(ComposerBox)
    const ta = wrapper.find('textarea')
    await ta.setValue('你好')
    expect(wrapper.find('.send').attributes('disabled')).toBeUndefined()
    ta.element.dispatchEvent(keyEvent('Enter'))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('send')![0]).toEqual(['你好'])
    expect((ta.element as HTMLTextAreaElement).value).toBe('')

    await ta.setValue('第二行')
    ta.element.dispatchEvent(keyEvent('Enter', true))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('send')).toHaveLength(1) // 未新增发送
  })

  it('生成中（generating）：可输入但 Enter 不发送，停止按钮出现并触发 stop', async () => {
    const wrapper = mount(ComposerBox, { props: { generating: true } })
    const ta = wrapper.find('textarea')
    expect(ta.attributes('disabled')).toBeUndefined() // 草稿不丢，仍可输入
    await ta.setValue('下一条草稿')
    ta.element.dispatchEvent(keyEvent('Enter'))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('send')).toBeUndefined()

    expect(wrapper.find('.send').exists()).toBe(false)
    const stop = wrapper.find('.stop')
    expect(stop.exists()).toBe(true)
    expect(stop.attributes('disabled')).toBeUndefined()
    await stop.trigger('click')
    expect(wrapper.emitted('stop')).toHaveLength(1)
  })

  it('非生成中点停止（边界：流恰好已结束）不触发 stop 事件', async () => {
    const wrapper = mount(ComposerBox, { props: { generating: false } })
    expect(wrapper.find('.stop').exists()).toBe(false) // 停止按钮不渲染，send 态
  })
})

describe('ComposerBox 深度研究模式开关（REQ-047，design-iter-18 §2）', () => {
  it('默认关态：标签逐字 M38 + aria-label 逐字 M39 + hint 存量文案零回退', () => {
    const wrapper = mount(ComposerBox, { props: { researchAvailable: true } })
    expect(wrapper.find('.mlabel').text()).toBe('深度研究')
    expect(wrapper.find('.mlabel').classes()).not.toContain('on')
    expect(wrapper.find('.tsw').attributes('aria-label')).toBe('深度研究模式开关')
    expect(wrapper.find('.tsw').attributes('aria-checked')).toBe('false')
    expect(wrapper.find('.hint-right').text()).toBe('Enter 发送 · Shift+Enter 换行')
  })

  it('开启态：点击开关 → 标签 on 类 + hint = M40 逐字（走查条 4）', async () => {
    const wrapper = mount(ComposerBox, { props: { researchAvailable: true } })
    await wrapper.find('.tsw').trigger('click')
    expect(wrapper.find('.mlabel').classes()).toContain('on')
    expect(wrapper.find('.hint-right').text()).toBe(
      '已开启深度研究：发送后 AI 将自动拆解问题、多轮联网搜索并给出带引用的报告，耗时较长',
    )
    expect(wrapper.find('.tsw').attributes('aria-checked')).toBe('true')
  })

  it('禁用态（researchAvailable=false）：开关 disabled + 标签 dis + hint M41 + title M42，不隐藏（走查条 5）', async () => {
    const wrapper = mount(ComposerBox, { props: { researchAvailable: false } })
    const sw = wrapper.find('.tsw')
    expect(sw.attributes('disabled')).toBeDefined()
    expect(wrapper.find('.mlabel').classes()).toContain('dis')
    expect(wrapper.find('.hint-right').text()).toBe('深度研究暂不可用：需联网搜索可用')
    expect(wrapper.find('.composer-hint').attributes('title')).toBe(
      '深度研究依赖联网搜索：需要管理员开启搜索并配置密钥，且当前生效档案开启「支持工具」',
    )
    await sw.trigger('click') // 禁用态点击无反应
    expect(wrapper.find('.tsw').attributes('aria-checked')).toBe('false')
  })

  it('开启态发送：emit send 携带 mode=research + 开关发送即复位（REQ-047 验收 1 前半）', async () => {
    const wrapper = mount(ComposerBox, { props: { researchAvailable: true } })
    await wrapper.find('.tsw').trigger('click')
    const ta = wrapper.find('textarea')
    await ta.setValue('开放问题')
    ta.element.dispatchEvent(keyEvent('Enter'))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('send')![0]).toEqual(['开放问题', 'research'])
    // 发送即复位（§2.3 定夺③）
    expect(wrapper.find('.tsw').attributes('aria-checked')).toBe('false')
    expect(wrapper.find('.hint-right').text()).toBe('Enter 发送 · Shift+Enter 换行')
  })

  it('关闭态发送：emit send 零 mode 字段（REQ-047 验收 1 后半，iter-13#42 复跑）', async () => {
    const wrapper = mount(ComposerBox, { props: { researchAvailable: true } })
    const ta = wrapper.find('textarea')
    await ta.setValue('普通问题')
    ta.element.dispatchEvent(keyEvent('Enter'))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('send')![0]).toEqual(['普通问题'])
  })

  it('可用性翻转：开启态下 researchAvailable 翻 false → 强制复位 + 禁用（走查条 6）', async () => {
    const wrapper = mount(ComposerBox, { props: { researchAvailable: true } })
    await wrapper.find('.tsw').trigger('click')
    expect(wrapper.find('.mlabel').classes()).toContain('on')
    await wrapper.setProps({ researchAvailable: false })
    expect(wrapper.find('.tsw').attributes('aria-checked')).toBe('false')
    expect(wrapper.find('.tsw').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.mlabel').classes()).toContain('dis')
    expect(wrapper.find('.hint-right').text()).toBe('深度研究暂不可用：需联网搜索可用')
  })
})
