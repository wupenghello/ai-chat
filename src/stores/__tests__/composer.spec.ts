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
