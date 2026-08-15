import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SessionListItem from '../SessionListItem.vue'
import type { Session } from '../../stores/sessions'

function makeSession(title = '测试会话'): Session {
  return {
    id: 's1',
    title,
    createdAt: 1,
    updatedAt: 2,
    messages: [{ id: 'm1', role: 'user', content: '你好', status: 'done' }],
    renamed: false,
  }
}

describe('SessionListItem 重命名（REQ-012，iter-3 T3）', () => {
  it('双击标题进入编辑；Enter 提交非空标题并触发 rename', async () => {
    const wrapper = mount(SessionListItem, { props: { session: makeSession(), active: false } })
    await wrapper.find('.title').trigger('dblclick')
    expect(wrapper.find('.edit-input').exists()).toBe(true)

    const input = wrapper.find('.edit-input')
    await input.setValue('新标题')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('rename')![0]).toEqual(['新标题'])
    expect(wrapper.find('.edit-input').exists()).toBe(false)
  })

  it('Esc 取消：退出编辑，不触发 rename', async () => {
    const wrapper = mount(SessionListItem, { props: { session: makeSession(), active: false } })
    await wrapper.find('.title').trigger('dblclick')
    await wrapper.find('.edit-input').setValue('新标题')
    await wrapper.find('.edit-input').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('rename')).toBeUndefined()
    expect(wrapper.find('.edit-input').exists()).toBe(false)
  })

  it('空标题回车：退出编辑、不触发 rename，恢复原标题', async () => {
    const wrapper = mount(SessionListItem, { props: { session: makeSession(), active: false } })
    await wrapper.find('.title').trigger('dblclick')
    await wrapper.find('.edit-input').setValue('   ')
    await wrapper.find('.edit-input').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('rename')).toBeUndefined()
    expect(wrapper.find('.edit-input').exists()).toBe(false)
    expect(wrapper.find('.title').text()).toBe('测试会话')
  })

  it('损坏会话：双击不进入编辑', async () => {
    const s = makeSession()
    s.corrupted = true
    const wrapper = mount(SessionListItem, { props: { session: s, active: false } })
    await wrapper.find('.title').trigger('dblclick')
    expect(wrapper.find('.edit-input').exists()).toBe(false)
  })
})
