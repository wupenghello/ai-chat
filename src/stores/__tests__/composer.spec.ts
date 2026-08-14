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

  it('disabled 状态（生成中）时 Enter 不发送', async () => {
    const wrapper = mount(ComposerBox, { props: { disabled: true, hint: '正在生成回复…' } })
    const ta = wrapper.find('textarea')
    await ta.setValue('x')
    ta.element.dispatchEvent(keyEvent('Enter'))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('send')).toBeUndefined()
  })
})
