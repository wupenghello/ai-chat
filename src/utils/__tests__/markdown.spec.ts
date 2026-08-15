import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../markdown'

describe('renderMarkdown（REQ-011）', () => {
  it('纯文本：按普通段落渲染', () => {
    expect(renderMarkdown('你好')).toContain('<p>你好</p>')
  })

  it('标题 / 列表 / 表格结构正确', () => {
    const md = '## 标题\n\n- 列表项\n\n| 参数 | 说明 |\n| --- | --- |\n| a | b |'
    const html = renderMarkdown(md)
    expect(html).toContain('<h2>标题</h2>')
    expect(html).toContain('<li>列表项</li>')
    expect(html).toContain('<table>')
    expect(html).toContain('table-wrap')
  })

  it('代码块含语言标签与复制按钮', () => {
    const html = renderMarkdown('```python\nprint(1)\n```')
    expect(html).toContain('code-block')
    expect(html).toContain('code-lang')
    expect(html).toContain('python')
    expect(html).toContain('code-copy')
    expect(html).toContain('复制')
  })

  it('XSS：原始 HTML 被转义为文本，不产生可执行标签', () => {
    const html = renderMarkdown('<script>alert(1)</script><img src=x onerror=alert(2)>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
  })

  it('XSS：javascript: 链接不渲染为可点击链接', () => {
    const html = renderMarkdown('[点我](javascript:alert(1))')
    expect(html).not.toContain('href="javascript:')
  })

  it('正常 http 链接可渲染（对照）', () => {
    const html = renderMarkdown('[官网](https://example.com)')
    expect(html).toContain('href="https://example.com"')
  })

  it('空文本返回空串', () => {
    expect(renderMarkdown('')).toBe('')
  })
})
