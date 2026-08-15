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
