import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MessageBubble from '../MessageBubble.vue'
import type { Message } from '../../stores/sessions'

function msg(content: string, role: 'user' | 'assistant' = 'assistant', status: Message['status'] = 'done'): Message {
  return { id: 'm1', role, content, status }
}

describe('MessageBubble 无头像布局（REQ-027，iter-11 T2，走查 23/24/26）', () => {
  it('AI 与用户消息均不渲染头像节点（DOM 级，非 CSS 隐藏）', () => {
    const ai = mount(MessageBubble, { props: { message: msg('回复') } })
    const user = mount(MessageBubble, { props: { message: msg('提问', 'user') } })
    expect(ai.find('.avatar').exists()).toBe(false)
    expect(user.find('.avatar').exists()).toBe(false)
    // 用户头像原文案「我」不作为任何元素文本出现
    expect(user.findAll('*').filter((n) => n.text() === '我').length).toBe(0)
  })

  it('用户消息气泡类（avatar-bg 令牌承载，色值由 guard:style + 浏览器走查把关）+ AI 消息无气泡背景类', () => {
    const user = mount(MessageBubble, { props: { message: msg('提问', 'user') } })
    const ai = mount(MessageBubble, { props: { message: msg('回复') } })
    expect(user.find('.bubble.user').exists()).toBe(true)
    expect(ai.find('.bubble.assistant').exists()).toBe(true)
  })
})

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
    expect(wrapper.find('[aria-label="修改"]').exists()).toBe(true)
    await wrapper.find('[aria-label="修改"]').trigger('click')
    expect(wrapper.find('.edit-ta').exists()).toBe(true)
    expect((wrapper.find('.edit-ta').element as HTMLTextAreaElement).value).toBe('原始内容')
    expect(wrapper.find('.edit-save').exists()).toBe(true)
    expect(wrapper.find('.edit-cancel').exists()).toBe(true)
  })

  it('空文本保存禁用；取消/Esc 退出编辑态', async () => {
    const wrapper = mount(MessageBubble, { props: { message: msg('原文', 'user') } })
    await wrapper.find('[aria-label="修改"]').trigger('click')
    await wrapper.find('.edit-ta').setValue('   ')
    expect(wrapper.find('.edit-save').attributes('disabled')).toBeDefined()

    await wrapper.find('.edit-cancel').trigger('click')
    expect(wrapper.find('.edit-ta').exists()).toBe(false)
  })

  it('保存触发 edit 事件并退出编辑态', async () => {
    const wrapper = mount(MessageBubble, { props: { message: msg('原文', 'user'), followingCount: 3 } })
    await wrapper.find('[aria-label="修改"]').trigger('click')
    await wrapper.find('.edit-ta').setValue('改后')
    await wrapper.find('.edit-save').trigger('click')
    expect(wrapper.emitted('edit')![0]).toEqual(['m1', '改后'])
    expect(wrapper.find('.edit-ta').exists()).toBe(false)
  })

  it('hint 显示将删除其后 N 条；N=0 降级为「仅重新生成」', async () => {
    const w1 = mount(MessageBubble, { props: { message: msg('x', 'user'), followingCount: 2 } })
    await w1.find('[aria-label="修改"]').trigger('click')
    expect(w1.find('.edit-hint').text()).toContain('2 条')

    const w2 = mount(MessageBubble, { props: { message: msg('x', 'user'), followingCount: 0 } })
    await w2.find('[aria-label="修改"]').trigger('click')
    expect(w2.find('.edit-hint').text()).toContain('仅重新生成')
  })

  it('AI 消息操作栏有复制但无编辑（CHG-003）', () => {
    const wrapper = mount(MessageBubble, { props: { message: msg('ai', 'assistant') } })
    expect(wrapper.find('[aria-label="复制"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="修改"]').exists()).toBe(false)
  })

  it('复制按钮点击不抛错（剪贴板降级）', async () => {
    const wrapper = mount(MessageBubble, { props: { message: msg('要复制的内容', 'user') } })
    await expect(wrapper.find('[aria-label="复制"]').trigger('click')).resolves.toBeUndefined()
  })

  it('有 forkId 时显示左右箭头版本切换并 emit toggleVersion（REQ-019）', async () => {
    const wrapper = mount(MessageBubble, { props: { message: { ...msg('x', 'user'), forkId: 'f1', forkIndex: 0 } } })
    const prev = wrapper.find('[aria-label="上一版本"]')
    const next = wrapper.find('[aria-label="下一版本"]')
    expect(prev.exists()).toBe(true)
    expect(next.exists()).toBe(true)
    expect(wrapper.find('.version-count').text()).toBe('1/2')
    await next.trigger('click')
    expect(wrapper.emitted('toggleVersion')![0]).toEqual(['f1'])
  })
})

describe('MessageBubble 引用来源卡与降级引导条（iter-14 T3，design-iter-14 §2/§3）', () => {
  const SOURCES = [{ title: '来源A', url: 'https://a.example.com/1', snippet: '片段' }]

  function aiMsg(content: Message['content']): Message {
    return { id: 'm1', role: 'assistant', content, status: 'done' }
  }

  it('配对 tool_result 含非空 sources 且 ok → 引用卡渲染于工具卡之后、文本之前（§2.1 位置）', () => {
    const w = mount(MessageBubble, {
      props: {
        message: aiMsg([
          { type: 'text', text: '我搜一下。' },
          { type: 'tool_call', tool_call_id: 'c1', name: 'search', arguments: '{"query":"q"}' },
          { type: 'tool_result', tool_call_id: 'c1', status: 'ok', result: '摘要文本', duration_ms: 100, sources: SOURCES },
          { type: 'text', text: '回答正文。' },
        ]),
      },
    })
    const kids = w.find('.bubble.assistant').findAll(':scope > *')
    const order = kids.map((k) => k.classes().join('.'))
    const toolIdx = order.findIndex((c) => c.includes('tool-card'))
    const srcIdx = order.findIndex((c) => c.includes('source-card'))
    const textIdx = kids.findIndex((k) => k.classes().includes('md') && k.text().includes('回答正文'))
    expect(srcIdx).toBeGreaterThan(toolIdx)
    expect(textIdx).toBeGreaterThan(srcIdx) // 引用卡在回答首段之前
    expect(w.find('.source-card .sc-head').text()).toBe('引用来源 · 1 条')
  })

  it('不渲染条件（§2.1）：sources 缺失 / 空数组 / status ≠ ok → 无引用卡', () => {
    const noSources = mount(MessageBubble, {
      props: {
        message: aiMsg([
          { type: 'tool_call', tool_call_id: 'c1', name: 'search', arguments: '{}' },
          { type: 'tool_result', tool_call_id: 'c1', status: 'ok', result: '未搜到相关内容', duration_ms: 100 },
        ]),
      },
    })
    expect(noSources.find('.source-card').exists()).toBe(false)

    const emptySources = mount(MessageBubble, {
      props: {
        message: aiMsg([
          { type: 'tool_call', tool_call_id: 'c1', name: 'search', arguments: '{}' },
          { type: 'tool_result', tool_call_id: 'c1', status: 'ok', result: 'r', duration_ms: 100, sources: [] },
        ]),
      },
    })
    expect(emptySources.find('.source-card').exists()).toBe(false)

    const failed = mount(MessageBubble, {
      props: {
        message: aiMsg([
          { type: 'tool_call', tool_call_id: 'c1', name: 'search', arguments: '{}' },
          { type: 'tool_result', tool_call_id: 'c1', status: 'error', result: '搜索服务返回 429', duration_ms: 100, sources: SOURCES },
          { type: 'text', text: '降级直答。' },
        ]),
      },
    })
    expect(failed.find('.source-card').exists()).toBe(false) // status ≠ ok 一律无卡
  })

  it('空结果如实呈现（D2 逐字）：「未搜到相关内容」在工具卡结果区原样渲染，无引用卡无引导条', async () => {
    const w = mount(MessageBubble, {
      props: {
        message: aiMsg([
          { type: 'tool_call', tool_call_id: 'c1', name: 'search', arguments: '{"query":"冷门"}' },
          { type: 'tool_result', tool_call_id: 'c1', status: 'ok', result: '未搜到相关内容', duration_ms: 2210 },
          { type: 'text', text: '这次搜索没有找到相关内容。' },
        ]),
      },
    })
    await w.find('.tc-head').trigger('click') // 历史卡折叠，展开看结果区
    expect(w.find('.tc-result-text').text()).toBe('未搜到相关内容')
    expect(w.find('.source-card').exists()).toBe(false)
    expect(w.find('.degrade-note').exists()).toBe(false) // 空 ≠ 失败，不显示误导性降级条
  })

  it('D1 降级引导条（逐字）：search error/timeout 且有后续文本段 → 失败卡后、直答前渲染', () => {
    const mk = (status: 'error' | 'timeout', result: string) =>
      mount(MessageBubble, {
        props: {
          message: aiMsg([
            { type: 'tool_call', tool_call_id: 'c1', name: 'search', arguments: '{"query":"q"}' },
            { type: 'tool_result', tool_call_id: 'c1', status, result, duration_ms: 10000 },
            { type: 'text', text: '基于已有知识的直答。' },
          ]),
        },
      })
    for (const w of [mk('error', '搜索服务返回 429'), mk('timeout', '工具执行超时')]) {
      const bar = w.find('.degrade-note')
      expect(bar.exists()).toBe(true)
      expect(bar.text()).toBe('搜索未成功，以下为模型直接回答') // D1 逐字，error/timeout 共用
      expect(bar.attributes('role')).toBe('note')
      const kids = w.find('.bubble.assistant').findAll(':scope > *')
      const toolIdx = kids.findIndex((k) => k.classes().join('.').includes('tool-card'))
      const barIdx = kids.findIndex((k) => k.classes().includes('degrade-note'))
      const textIdx = kids.findIndex((k) => k.classes().includes('md') && k.text().includes('直答'))
      expect(barIdx).toBe(toolIdx + 1) // 失败卡之后
      expect(textIdx).toBeGreaterThan(barIdx) // 直答首段之前
    }
  })

  it('D1 条件边界：无后续文本段（回合中断于失败）无引导条；非 search 工具失败无引导条', () => {
    const aborted = mount(MessageBubble, {
      props: {
        message: aiMsg([
          { type: 'tool_call', tool_call_id: 'c1', name: 'search', arguments: '{}' },
          { type: 'tool_result', tool_call_id: 'c1', status: 'timeout', result: '工具执行超时', duration_ms: 10000 },
        ]),
      },
    })
    expect(aborted.find('.degrade-note').exists()).toBe(false) // 无直答文本 → 不误导

    const otherTool = mount(MessageBubble, {
      props: {
        message: aiMsg([
          { type: 'tool_call', tool_call_id: 'c1', name: 'demo_weather', arguments: '{}' },
          { type: 'tool_result', tool_call_id: 'c1', status: 'error', result: '参数错误', duration_ms: 3 },
          { type: 'text', text: '后续文本。' },
        ]),
      },
    })
    expect(otherTool.find('.degrade-note').exists()).toBe(false) // D1 仅 search（§3 触发行）
  })

  it('渲染层派生不落库（§3 D1/走查条 20）：引导条与引用卡均非 blocks 段，复制正文不含', async () => {
    const w = mount(MessageBubble, {
      props: {
        message: aiMsg([
          { type: 'tool_call', tool_call_id: 'c1', name: 'search', arguments: '{"query":"q"}' },
          { type: 'tool_result', tool_call_id: 'c1', status: 'ok', result: '摘要', duration_ms: 5, sources: SOURCES },
          { type: 'text', text: '回答。' },
        ]),
      },
    })
    // blocks 无对应段（渲染层派生）；contentText 适配层只取文本段（导出/复制共用，REQ-013/016 零适配）
    const blocks = (w.props('message').content as import('../../api/client').Block[]).filter((b) => b.type !== 'text')
    expect(blocks.every((b) => b.type === 'tool_call' || b.type === 'tool_result')).toBe(true)
    const { contentText } = await import('../../api/client')
    expect(contentText(w.props('message').content)).toBe('回答。') // 来源标题/摘要不入正文
  })
})
