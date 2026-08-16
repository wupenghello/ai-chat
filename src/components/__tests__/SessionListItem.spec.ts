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

/** REQ-026.1 菜单路径（design-iter-11 §1.2，走查 5/6/7）：「···」→ 重命名 / 删除 */
async function openMenu(wrapper: ReturnType<typeof mount>) {
  await wrapper.find('.dd-trigger').trigger('click')
}

describe('SessionListItem 单行化与菜单（REQ-026，iter-11 T1）', () => {
  it('单行结构：仅标题 + 「···」触发钮，无逐条时间戳、无常驻铅笔/垃圾桶', () => {
    const wrapper = mount(SessionListItem, { props: { session: makeSession(), active: false } })
    expect(wrapper.find('.title').exists()).toBe(true)
    expect(wrapper.find('.dd-trigger').attributes('aria-label')).toBe('会话操作')
    expect(wrapper.find('.time').exists()).toBe(false)
    expect(wrapper.find('.rename-btn').exists()).toBe(false)
    expect(wrapper.find('.del').exists()).toBe(false)
  })

  it('「···」菜单：重命名 / 删除（danger + 前置分隔线，走查 6）', async () => {
    const wrapper = mount(SessionListItem, { props: { session: makeSession(), active: false } })
    await openMenu(wrapper)
    const items = wrapper.findAll('[role="menuitem"]')
    expect(items.map((i) => i.text())).toEqual(['重命名', '删除'])
    expect(items[1].classes()).toContain('danger')
    expect(wrapper.find('.dd-sep').exists()).toBe(true)
    wrapper.unmount()
  })

  it('菜单「重命名」进入行内编辑；Enter 提交非空标题触发 rename', async () => {
    const wrapper = mount(SessionListItem, { props: { session: makeSession(), active: false } })
    await openMenu(wrapper)
    await wrapper.findAll('[role="menuitem"]')[0].trigger('click')
    expect(wrapper.find('.edit-input').exists()).toBe(true)
    await wrapper.find('.edit-input').setValue('新标题')
    await wrapper.find('.edit-input').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('rename')![0]).toEqual(['新标题'])
    wrapper.unmount()
  })

  it('菜单「删除」触发 remove', async () => {
    const wrapper = mount(SessionListItem, { props: { session: makeSession(), active: false } })
    await openMenu(wrapper)
    await wrapper.findAll('[role="menuitem"]')[1].trigger('click')
    expect(wrapper.emitted('remove')).toBeTruthy()
    wrapper.unmount()
  })

  it('损坏会话：菜单「重命名」禁用（title 原因）；「删除」可用（走查 7）', async () => {
    const s = makeSession()
    s.corrupted = true
    const wrapper = mount(SessionListItem, { props: { session: s, active: false } })
    await openMenu(wrapper)
    const items = wrapper.findAll('[role="menuitem"]')
    expect(items[0].attributes('aria-disabled')).toBe('true')
    await items[0].trigger('click')
    expect(wrapper.find('.edit-input').exists()).toBe(false)
    expect(wrapper.emitted('rename')).toBeUndefined()
    await items[1].trigger('click')
    expect(wrapper.emitted('remove')).toBeTruthy()
    wrapper.unmount()
  })
})

describe('SessionListItem 行内重命名（REQ-012 沿现状口径，走查 8）', () => {
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
