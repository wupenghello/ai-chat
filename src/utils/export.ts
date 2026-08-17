import type { Message, Session } from '../stores/sessions'
import { contentBlocks } from '../api/client'

/** REQ-013：会话导出为 Markdown 文件。纯函数导出便于单测，下载副作用集中在 exportSession。 */

const pad = (n: number) => String(n).padStart(2, '0')

/** 文件名非法字符替换为 _，超长截前 40 字；空则回退「会话」 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').slice(0, 40) || '会话'
}

/** CHG-007 REQ-013 改写：v2 blocks 消息正文 = 文本段照旧 + 工具段一行「> [工具 name · 状态]」
 * （状态词：完成/失败/超时/已中断——design-iter-13 §2 适配面，格式逐字断言面）；v1 会话逐字不变 */
function messageBody(m: Message): string {
  if (typeof m.content === 'string') return m.content
  const lines: string[] = []
  const results = new Map<string, { status: string }>()
  for (const b of contentBlocks(m.content)) {
    if (b.type === 'tool_result') results.set(b.tool_call_id, b)
  }
  for (const b of contentBlocks(m.content)) {
    if (b.type === 'text') {
      if (b.text) lines.push(b.text)
    } else if (b.type === 'tool_call') {
      const r = results.get(b.tool_call_id)
      const st = r ? (r.status === 'ok' ? '完成' : r.status === 'error' ? '失败' : '超时') : '已中断'
      lines.push(`> [工具 ${b.name} · ${st}]`)
    }
  }
  return lines.join('\n\n')
}

/** 组装 Markdown 正文：一级标题 + 元信息引用块 + 按序「## 用户 / ## AI」区分 */
export function sessionToMarkdown(session: Session, model?: string): string {
  const lines: string[] = [`# ${session.title}`, '']
  const now = new Date()
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  lines.push(`> 导出时间：${ts}`)
  const rounds = session.messages.filter((m) => m.role === 'user').length
  if (model) lines.push(`> 模型：${model} · 共 ${rounds} 轮消息`)
  lines.push('')
  for (const m of session.messages) {
    lines.push(m.role === 'user' ? '## 用户' : '## AI', '', messageBody(m), '')
  }
  return lines.join('\n').trimEnd() + '\n'
}

/** 导出当前会话。空会话返回 false（调用方 toast）；成功返回 true。 */
export function exportSession(session: Session, model?: string): boolean {
  if (session.messages.length === 0) return false
  const markdown = sessionToMarkdown(session, model)
  const now = new Date()
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`
  const filename = `${sanitizeFilename(session.title)}_${stamp}.md`
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return true
}
