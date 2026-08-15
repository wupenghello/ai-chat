import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MessageBubble from '../MessageBubble.vue'
import type { Message } from '../../stores/sessions'

function msg(content: string, role: 'user' | 'assistant' = 'assistant', status: Message['status'] = 'done'): Message {
  return { id: 'm1', role, content, status }
}

describe('MessageBubble Markdown 渲染（REQ-011，iter-3 T2）', () => {
  it('AI 回复按 Markdown 渲染为 HTML', () => {
    const wrapper = mount(MessageBubble, { props: { message: msg('## 标题\n\n- 列表项') } })
    expect(wrapper.find('.md').exists()).toBe(true)
    expect(wrapper.find('.md h2').text()).toBe('标题')
    expect(wrapper.find('.md li').text()).toBe('列表项')
  })

  it('用户消息保持纯文本，不渲染 Markdown', () => {
    const wrapper = mount(MessageBubble, { props: { message: msg('**加粗**', 'user') } })
    expect(wrapper.find('.md').exists()).toBe(false)
    expect(wrapper.find('.content').text()).toBe('**加粗**')
  })

  it('代码块含语言标签与复制按钮', () => {
    const wrapper = mount(MessageBubble, { props: { message: msg('```js\nconst a = 1\n```') } })
    expect(wrapper.find('.code-block').exists()).toBe(true)
    expect(wrapper.find('.code-lang').text()).toBe('js')
    expect(wrapper.find('.code-copy').text()).toBe('复制')
  })

  it('XSS：script 不渲染为可执行标签', () => {
    const wrapper = mount(MessageBubble, { props: { message: msg('<script>alert(1)</script>') } })
    expect(wrapper.find('.md script').exists()).toBe(false)
  })
})

describe('MessageBubble 编辑（REQ-015，iter-4 T2）', () => {
  it('用户消息有编辑入口，点击进入编辑态并回填原文本', async () => {
    const wrapper = mount(MessageBubble, { props: { message: msg('原始内容', 'user') } })
    expect(wrapper.find('[aria-label="编辑"]').exists()).toBe(true)
    await wrapper.find('[aria-label="编辑"]').trigger('click')
    expect(wrapper.find('.edit-ta').exists()).toBe(true)
    expect((wrapper.find('.edit-ta').element as HTMLTextAreaElement).value).toBe('原始内容')
    expect(wrapper.find('.edit-save').exists()).toBe(true)
    expect(wrapper.find('.edit-cancel').exists()).toBe(true)
  })

  it('空文本保存禁用；取消/Esc 退出编辑态', async () => {
    const wrapper = mount(MessageBubble, { props: { message: msg('原文', 'user') } })
    await wrapper.find('[aria-label="编辑"]').trigger('click')
    await wrapper.find('.edit-ta').setValue('   ')
    expect(wrapper.find('.edit-save').attributes('disabled')).toBeDefined()

    await wrapper.find('.edit-cancel').trigger('click')
    expect(wrapper.find('.edit-ta').exists()).toBe(false)
  })

  it('保存触发 edit 事件并退出编辑态', async () => {
    const wrapper = mount(MessageBubble, { props: { message: msg('原文', 'user'), followingCount: 3 } })
    await wrapper.find('[aria-label="编辑"]').trigger('click')
    await wrapper.find('.edit-ta').setValue('改后')
    await wrapper.find('.edit-save').trigger('click')
    expect(wrapper.emitted('edit')![0]).toEqual(['m1', '改后'])
    expect(wrapper.find('.edit-ta').exists()).toBe(false)
  })

  it('hint 显示将删除其后 N 条；N=0 降级为「仅重新生成」', async () => {
    const w1 = mount(MessageBubble, { props: { message: msg('x', 'user'), followingCount: 2 } })
    await w1.find('[aria-label="编辑"]').trigger('click')
    expect(w1.find('.edit-hint').text()).toContain('2 条')

    const w2 = mount(MessageBubble, { props: { message: msg('x', 'user'), followingCount: 0 } })
    await w2.find('[aria-label="编辑"]').trigger('click')
    expect(w2.find('.edit-hint').text()).toContain('仅重新生成')
  })

  it('AI 消息操作栏有复制但无编辑（CHG-003）', () => {
    const wrapper = mount(MessageBubble, { props: { message: msg('ai', 'assistant') } })
    expect(wrapper.find('[aria-label="复制"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="编辑"]').exists()).toBe(false)
  })

  it('复制按钮点击不抛错（剪贴板降级）', async () => {
    const wrapper = mount(MessageBubble, { props: { message: msg('要复制的内容', 'user') } })
    await expect(wrapper.find('[aria-label="复制"]').trigger('click')).resolves.toBeUndefined()
  })

  it('有 forkId 时显示「切换版本」并 emit toggleVersion（REQ-019）', async () => {
    const wrapper = mount(MessageBubble, { props: { message: { ...msg('x', 'user'), forkId: 'f1' } } })
    const btn = wrapper.find('[aria-label="切换版本"]')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    expect(wrapper.emitted('toggleVersion')![0]).toEqual(['f1'])
  })
})
