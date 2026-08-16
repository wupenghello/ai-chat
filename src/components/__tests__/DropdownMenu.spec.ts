/**
 * 通用下拉菜单组件（design-iter-11 §2 基线，REQ-026.5）——走查 19~22 组件级取证：
 * 外点关闭吞掉首击 / Esc 回焦 / 键盘矩阵 / 互斥 / toggle / 禁用项。
 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import DropdownMenu, { type DropMenuItem } from '../DropdownMenu.vue'

const ITEMS: DropMenuItem[] = [
  { key: 'rename', label: '重命名' },
  { key: 'remove', label: '删除', danger: true, separator: true },
]

function mountMenu(items: DropMenuItem[] = ITEMS) {
  return mount(DropdownMenu, { props: { items, triggerAria: '会话操作' }, attachTo: document.body })
}

async function openMenu(wrapper: ReturnType<typeof mountMenu>) {
  await wrapper.find('button.dd-trigger').trigger('click')
}

describe('DropdownMenu（REQ-026.5）', () => {
  it('触发钮带 aria-haspopup/aria-label；点击开菜单（role=menu），aria-expanded 联动', async () => {
    const wrapper = mountMenu()
    const trig = wrapper.find('button.dd-trigger')
    expect(trig.attributes('aria-haspopup')).toBe('menu')
    expect(trig.attributes('aria-label')).toBe('会话操作')
    expect(trig.attributes('aria-expanded')).toBe('false')
    await openMenu(wrapper)
    expect(trig.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('[role="menu"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('点击项：emit select + 关闭菜单（走查 6/20）', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    await wrapper.findAll('button[role="menuitem"]')[0].trigger('click')
    expect(wrapper.emitted('select')![0]).toEqual(['rename'])
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('开态再点触发钮 = 关闭（toggle，走查 20）', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    await wrapper.find('button.dd-trigger').trigger('click')
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('禁用项：aria-disabled + title 原因，点击不 emit（走查 7）', async () => {
    const wrapper = mountMenu([
      { key: 'rename', label: '重命名', disabled: true, reason: '无法读取的会话不可重命名' },
      { key: 'remove', label: '删除', danger: true },
    ])
    await openMenu(wrapper)
    const items = wrapper.findAll('button[role="menuitem"]')
    expect(items[0].attributes('aria-disabled')).toBe('true')
    expect(items[0].attributes('title')).toBe('无法读取的会话不可重命名')
    await items[0].trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()
    expect(wrapper.find('[role="menu"]').exists()).toBe(true) // 未关闭
    wrapper.unmount()
  })

  it('外点关闭且吞掉首击：底层元素不触发（走查 19，capture 拦截）', async () => {
    const underlying = document.createElement('button')
    const spy = vi.fn()
    underlying.addEventListener('click', spy)
    document.body.appendChild(underlying)

    const wrapper = mountMenu()
    await openMenu(wrapper)
    underlying.click() // 原生派发，走 document capture
    await wrapper.vm.$nextTick() // doClose 触发的渲染刷新
    expect(wrapper.find('[role="menu"]').exists()).toBe(false) // 菜单关了
    expect(spy).not.toHaveBeenCalled() // 首击被吞，底层未触发
    underlying.click() // 第二次恢复正常
    expect(spy).toHaveBeenCalledTimes(1)
    underlying.remove()
    wrapper.unmount()
  })

  it('Esc 关闭且焦点回触发钮（走查 20）', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    await wrapper.find('[role="menu"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.element.querySelector('button.dd-trigger'))
    wrapper.unmount()
  })

  it('键盘：↑/↓ 循环跳过禁用项，Enter 执行并回焦（走查 21）', async () => {
    const wrapper = mountMenu([
      { key: 'a', label: 'A', disabled: true },
      { key: 'b', label: 'B' },
      { key: 'c', label: 'C' },
    ])
    await openMenu(wrapper)
    const menu = wrapper.find('[role="menu"]')
    // 开菜单聚焦首可用项（跳过禁用的 a）
    expect(document.activeElement?.textContent).toBe('B')
    await menu.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement?.textContent).toBe('C')
    await menu.trigger('keydown', { key: 'ArrowDown' }) // 循环回 B
    expect(document.activeElement?.textContent).toBe('B')
    await menu.trigger('keydown', { key: 'End' })
    expect(document.activeElement?.textContent).toBe('C')
    await menu.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('select')![0]).toEqual(['c'])
    expect(document.activeElement).toBe(wrapper.element.querySelector('button.dd-trigger'))
    wrapper.unmount()
  })

  it('多实例互斥：开新菜单即关旧菜单（走查 22）', async () => {
    const w1 = mountMenu()
    const w2 = mountMenu()
    await openMenu(w1)
    expect(w1.find('[role="menu"]').exists()).toBe(true)
    await openMenu(w2)
    expect(w1.find('[role="menu"]').exists()).toBe(false)
    expect(w2.find('[role="menu"]').exists()).toBe(true)
    w1.unmount()
    w2.unmount()
  })

  it('separator 项前渲染分隔线（走查 6/15）', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    expect(wrapper.find('.dd-sep').exists()).toBe(true)
    wrapper.unmount()
  })
})
