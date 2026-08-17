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

describe('sessionToMarkdown · v2 blocks（CHG-007 REQ-013 改写，iter-13 T2）', () => {
  it('文本段照旧 + 工具段一行「> [工具 name · 状态]」（格式逐字断言面）', () => {
    const s = makeSession('工具会话', [
      { id: 'm1', role: 'user', content: '北京天气', status: 'done' },
      {
        id: 'm2',
        role: 'assistant',
        content: [
          { type: 'text', text: '我先查一下' },
          { type: 'tool_call', tool_call_id: 'c1', name: 'demo_weather', arguments: '{"city":"北京"}' },
          { type: 'tool_result', tool_call_id: 'c1', status: 'ok', result: '北京：晴', duration_ms: 5 },
          { type: 'text', text: '今天晴。' },
        ],
        status: 'done',
      },
    ] as never)
    const md = sessionToMarkdown(s)
    expect(md).toContain('我先查一下')
    expect(md).toContain('> [工具 demo_weather · 完成]')
    expect(md).toContain('今天晴。')
    expect(md).not.toContain('北京：晴') // 工具结果本体不入导出正文
  })

  it('状态词四态：失败 / 超时 / 已中断（无结果派生）', () => {
    const mk = (result?: { status: string }) =>
      makeSession('t', [
        { id: 'm1', role: 'user', content: 'q', status: 'done' },
        {
          id: 'm2',
          role: 'assistant',
          content: [
            { type: 'text', text: 'r' },
            { type: 'tool_call', tool_call_id: 'c1', name: 'echo', arguments: '{}' },
            ...(result ? [{ type: 'tool_result', tool_call_id: 'c1', status: result.status, result: 'x', duration_ms: 1 }] : []),
          ],
          status: 'done',
        },
      ] as never)
    expect(sessionToMarkdown(mk({ status: 'error' }))).toContain('> [工具 echo · 失败]')
    expect(sessionToMarkdown(mk({ status: 'timeout' }))).toContain('> [工具 echo · 超时]')
    expect(sessionToMarkdown(mk(undefined))).toContain('> [工具 echo · 已中断]')
  })
})

