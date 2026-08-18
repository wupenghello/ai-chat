import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ToggleSwitch from '../ToggleSwitch.vue'

/**
 * 开关（toggle switch）组件规格——design-iter-14 §4.2 / 公司 components.md v1.3：
 * 36×20 轨道（开 primary-solid / 关 hover-bg）+ 16px 白实体滑块（开态位移 16px）；
 * role=switch + aria-checked 同步；:focus-visible 3px 焦点环；Enter/Space 原生（button 语义）。
 * 几何 computed 断言（36×20/位移）由真实 Chrome 走查承载（scripts/e2e-walkthrough-14.mjs 条 26）。
 */
describe('ToggleSwitch（design-iter-14 §4.2，components.md v1.3）', () => {
  it('语义：button + role=switch + aria-checked 随态同步 + 可访问名', async () => {
    const w = mount(ToggleSwitch, { props: { modelValue: false, label: '联网搜索开关' } })
    const btn = w.find('button.tsw')
    expect(btn.element.tagName).toBe('BUTTON')
    expect(btn.attributes('role')).toBe('switch')
    expect(btn.attributes('aria-checked')).toBe('false')
    expect(btn.attributes('aria-label')).toBe('联网搜索开关')
    // Enter/Space 原生触发 = button 语义承载（jsdom 不合成键盘激活，真实键盘路径由走查条 6/27 承载）
    await w.setProps({ modelValue: true })
    expect(btn.attributes('aria-checked')).toBe('true')
  })

  it('开态类与关态类（.on = primary-solid 轨道；几何值走查承载）', () => {
    const off = mount(ToggleSwitch, { props: { modelValue: false, label: 'x' } })
    expect(off.find('.tsw').classes()).not.toContain('on')
    const on = mount(ToggleSwitch, { props: { modelValue: true, label: 'x' } })
    expect(on.find('.tsw').classes()).toContain('on')
  })

  it('点击 emit update:modelValue 翻转值；disabled 不 emit', async () => {
    const w = mount(ToggleSwitch, { props: { modelValue: false, label: 'x' } })
    await w.find('.tsw').trigger('click')
    expect(w.emitted('update:modelValue')).toEqual([[true]])
    await w.setProps({ modelValue: true })
    await w.find('.tsw').trigger('click')
    expect(w.emitted('update:modelValue')).toEqual([[true], [false]])

    const d = mount(ToggleSwitch, { props: { modelValue: false, label: 'x', disabled: true } })
    await d.find('.tsw').trigger('click')
    expect(d.emitted('update:modelValue')).toBeUndefined()
  })
})
