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

  it('「···」菜单：重命名 / 导出会话 / 压缩上下文 / 删除（danger + 前置分隔线，走查 6 全量/T2）', async () => {
    // 改写映射（iter-16 T3）：菜单加法项「压缩上下文」位于导出之后、danger 分隔线之前——
    // 既有一/二/四位文案与配色零变化（design-iter-16 §6 零回退映射 iter-11#6）
    const wrapper = mount(SessionListItem, { props: { session: makeSession(), active: false } })
    await openMenu(wrapper)
    const items = wrapper.findAll('[role="menuitem"]')
    expect(items.map((i) => i.text())).toEqual(['重命名', '导出会话', '压缩上下文', '删除'])
    expect(items[3].classes()).toContain('danger')
    expect(wrapper.find('.dd-sep').exists()).toBe(true)
    wrapper.unmount()
  })

  it('菜单「导出会话」触发 export（走查 36，REQ-027 T2）', async () => {
    const wrapper = mount(SessionListItem, { props: { session: makeSession(), active: false } })
    await openMenu(wrapper)
    await wrapper.findAll('[role="menuitem"]')[1].trigger('click')
    expect(wrapper.emitted('export')).toBeTruthy()
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
    await wrapper.findAll('[role="menuitem"]')[3].trigger('click') // iter-16 T3 加法项后删除居第 4 位
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
    await items[3].trigger('click') // iter-16 T3 加法项后删除居第 4 位
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

describe('SessionListItem 手动压缩入口（REQ-040，iter-16 T3，design-iter-16 §2）', () => {
  it('菜单加法项「压缩上下文」：导出之后、danger 分隔线之前；点击 emit compact', async () => {
    const wrapper = mount(SessionListItem, { props: { session: makeSession(), active: false } })
    await openMenu(wrapper)
    const items = wrapper.findAll('[role="menuitem"]')
    expect(items[2].text()).toBe('压缩上下文') // 走查条 15 C1 逐字
    expect(items[2].classes()).not.toContain('danger')
    await items[2].trigger('click')
    expect(wrapper.emitted('compact')).toBeTruthy()
    expect(wrapper.emitted('select')).toBeUndefined() // 走查条 17：点击不触发会话切换
    wrapper.unmount()
  })

  it('corrupted 会话：压缩项禁用 + title 逐字 C4（走查条 15）', async () => {
    const s = makeSession()
    s.corrupted = true
    const wrapper = mount(SessionListItem, { props: { session: s, active: false } })
    await openMenu(wrapper)
    const compact = wrapper.findAll('[role="menuitem"]')[2]
    expect(compact.attributes('aria-disabled')).toBe('true')
    expect(compact.attributes('title')).toBe('无法读取的会话不可压缩')
    await compact.trigger('click')
    expect(wrapper.emitted('compact')).toBeUndefined()
    wrapper.unmount()
  })

  it('执行中：压缩项禁用 + title 逐字 C3 防重复；重命名/导出/删除不受影响（走查条 20）', async () => {
    const wrapper = mount(SessionListItem, {
      props: { session: makeSession(), active: false, compacting: true },
    })
    await openMenu(wrapper)
    const items = wrapper.findAll('[role="menuitem"]')
    expect(items[2].attributes('aria-disabled')).toBe('true')
    expect(items[2].attributes('title')).toBe('压缩中')
    expect(items[0].attributes('aria-disabled')).toBeUndefined() // 重命名可用
    expect(items[1].attributes('aria-disabled')).toBeUndefined() // 导出可用
    expect(items[3].attributes('aria-disabled')).toBeUndefined() // 删除可用
    await items[2].trigger('click')
    expect(wrapper.emitted('compact')).toBeUndefined()
    wrapper.unmount()
  })

  it('执行中 pill：spinner + 「压缩中」逐字 C2，优先于「生成中断」（走查条 18/19）', () => {
    const s = makeSession()
    s.messages = [{ id: 'm1', role: 'assistant', content: 'x', status: 'interrupted' }]
    const compact = mount(SessionListItem, {
      props: { session: s, active: false, compacting: true },
    })
    expect(compact.find('.pill.compact').exists()).toBe(true)
    expect(compact.find('.pill.compact').text()).toBe('压缩中')
    expect(compact.find('.pill.compact .pill-spin').exists()).toBe(true)
    expect(compact.find('.pill.cut').exists()).toBe(false) // 进行中 > 历史状态
    compact.unmount()
    // 非执行中：生成中断 pill 照常（零回退）
    const idle = mount(SessionListItem, { props: { session: s, active: false } })
    expect(idle.find('.pill.cut').exists()).toBe(true)
    expect(idle.find('.pill.compact').exists()).toBe(false)
    idle.unmount()
  })

  it('corrupted 会话无压缩中 pill（项禁用不可触发，互斥口径）', () => {
    const s = makeSession()
    s.corrupted = true
    const wrapper = mount(SessionListItem, {
      props: { session: s, active: false, compacting: false },
    })
    expect(wrapper.find('.pill.compact').exists()).toBe(false)
    expect(wrapper.find('.pill.broken').text()).toBe('无法读取')
    wrapper.unmount()
  })
})
