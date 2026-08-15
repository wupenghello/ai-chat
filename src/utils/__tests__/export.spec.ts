import { describe, expect, it } from 'vitest'
import { sanitizeFilename, sessionToMarkdown } from '../export'
import type { Session } from '../../stores/sessions'

function makeSession(title = '测试会话', messages: Session['messages'] = []): Session {
  return { id: 's1', title, createdAt: 1, updatedAt: 2, messages }
}

describe('sanitizeFilename（REQ-013）', () => {
  it('文件名非法字符替换为 _', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })

  it('超长截前 40 字', () => {
    expect(sanitizeFilename('x'.repeat(50)).length).toBe(40)
  })

  it('空标题回退「会话」', () => {
    expect(sanitizeFilename('')).toBe('会话')
  })
})

describe('sessionToMarkdown（REQ-013）', () => {
  it('含一级标题 + 「## 用户 / ## AI」区分 + 逐字内容', () => {
    const s = makeSession('测试会话', [
      { id: 'm1', role: 'user', content: '你好', status: 'done' },
      { id: 'm2', role: 'assistant', content: '你好！', status: 'done' },
    ])
    const md = sessionToMarkdown(s, 'glm-5.3')
    expect(md).toContain('# 测试会话')
    expect(md).toContain('## 用户')
    expect(md).toContain('## AI')
    expect(md).toContain('你好')
    expect(md).toContain('你好！')
    expect(md).toContain('glm-5.3')
  })

  it('AI 消息原文（含 Markdown 源码）原样保留', () => {
    const s = makeSession('代码会话', [
      { id: 'm1', role: 'user', content: '给段代码', status: 'done' },
      { id: 'm2', role: 'assistant', content: '```js\nconst a = 1\n```', status: 'done' },
    ])
    const md = sessionToMarkdown(s)
    expect(md).toContain('```js')
    expect(md).toContain('const a = 1')
  })
})
