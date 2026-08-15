import { describe, expect, it } from 'vitest'
import type { Message, Session } from '../../stores/sessions'
import { highlightSegments, matchSession } from '../search'

const msg = (content: string): Message => ({ id: 'm', role: 'user', content, status: 'done' })

function mkSession(over: Partial<Session> = {}): Session {
  return { id: 's1', title: '测试会话', createdAt: 1, updatedAt: 2, messages: [], ...over }
}

describe('matchSession（REQ-016，iter-4 T3）', () => {
  it('标题命中返回 title，正文命中返回 body + 含关键词片段', () => {
    expect(matchSession(mkSession({ title: '请假邮件' }), '请假')).toEqual({ type: 'title' })

    const body = matchSession(
      mkSession({ title: '其他', messages: [msg('帮我写一封请假邮件发给老板')] }),
      '请假',
    )
    expect(body?.type).toBe('body')
    expect(body?.snippet).toContain('请假')
  })

  it('大小写不敏感；空关键词 / 损坏会话 / 无匹配返回 null', () => {
    expect(matchSession(mkSession({ title: 'Hello World' }), 'hello')).toEqual({ type: 'title' })
    expect(matchSession(mkSession({}), '')).toBeNull()
    expect(matchSession(mkSession({ corrupted: true }), '测试')).toBeNull()
    expect(matchSession(mkSession({ title: 'abc' }), '不存在')).toBeNull()
  })

  it('标题命中优先于正文（标题含关键词时不落到 body）', () => {
    const hit = matchSession(
      mkSession({ title: '请假邮件', messages: [msg('正文里也提到请假')] }),
      '请假',
    )
    expect(hit).toEqual({ type: 'title' })
  })
})

describe('highlightSegments（REQ-016）', () => {
  it('切分命中/非命中片段', () => {
    expect(highlightSegments('请假邮件', '请假')).toEqual([
      { text: '请假', hit: true },
      { text: '邮件', hit: false },
    ])
  })

  it('空关键词返回整段非命中；多次出现全部高亮', () => {
    expect(highlightSegments('abc', '')).toEqual([{ text: 'abc', hit: false }])
    expect(highlightSegments('a1a2a', 'a')).toEqual([
      { text: 'a', hit: true },
      { text: '1', hit: false },
      { text: 'a', hit: true },
      { text: '2', hit: false },
      { text: 'a', hit: true },
    ])
  })
})
