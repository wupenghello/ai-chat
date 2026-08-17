import type { Session } from '../stores/sessions'
import { contentText } from '../api/client'

/** 搜索结果：标题命中（优先）或正文命中（带上下文片段） */
export interface SearchHit {
  type: 'title' | 'body'
  snippet?: string
}

/** 截取关键词前后各 12 字的上下文片段，超出部分加省略号 */
function snippetAround(content: string, index: number, length: number): string {
  const start = Math.max(0, index - 12)
  const end = Math.min(content.length, index + length + 12)
  return (start > 0 ? '…' : '') + content.slice(start, end) + (end < content.length ? '…' : '')
}

/** REQ-016（CHG-007 改写）：标题或消息**文本段**命中——blocks 消息取文本段拼接，
 * 工具调用参数与结果不入索引（design-iter-13 §2 适配面）；损坏会话/空关键词返回 null */
export function matchSession(session: Session, query: string): SearchHit | null {
  const q = query.trim().toLowerCase()
  if (!q || session.corrupted) return null
  if (session.title.toLowerCase().includes(q)) return { type: 'title' }
  for (const m of session.messages) {
    const text = contentText(m.content)
    const idx = text.toLowerCase().indexOf(q)
    if (idx >= 0) return { type: 'body', snippet: snippetAround(text, idx, q.length) }
  }
  return null
}

/** 把文本按关键词切分为命中/非命中片段，供模板高亮渲染（text 插值，XSS 安全） */
export function highlightSegments(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const q = query.trim().toLowerCase()
  if (!q) return [{ text, hit: false }]
  const lower = text.toLowerCase()
  const out: Array<{ text: string; hit: boolean }> = []
  let i = 0
  while (i < text.length) {
    const idx = lower.indexOf(q, i)
    if (idx < 0) {
      out.push({ text: text.slice(i), hit: false })
      break
    }
    if (idx > i) out.push({ text: text.slice(i, idx), hit: false })
    out.push({ text: text.slice(idx, idx + q.length), hit: true })
    i = idx + q.length
  }
  return out
}
