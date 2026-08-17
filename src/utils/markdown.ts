import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

/**
 * REQ-011：Markdown 渲染 + XSS 净化（AI 输出视为不可信输入）。
 * 渲染管线：markdown-it（html:false 不解析内联 HTML）→ DOMPurify.sanitize → v-html。
 */
const md = new MarkdownIt({
  html: false, // 不解析原始 HTML，缩小注入面
  linkify: true,
  // breaks:true：段内单换行 → <br>（聊天语义）。与 .md { white-space: normal }（DEF-030 修复）
  // 成对配置：段内换行显式化由本项承载，块间换行符交由 normal 折叠——pre-wrap 继承曾把
  // markdown-it 输出的块间 \n 渲染成整行空行（段间距 34px = 26px 行高 + 8px 段距）
  breaks: true,
})

// 代码块：包一层深底容器 + 语言标签 + 复制按钮（结构对齐 design/iter-3 触点一）
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const lang = md.utils.escapeHtml((token.info ?? '').trim() || 'code')
  const code = md.utils.escapeHtml(token.content)
  return (
    '<div class="code-block">' +
    `<div class="code-head"><span class="code-lang">${lang}</span><button type="button" class="code-copy">复制</button></div>` +
    `<pre><code>${code}</code></pre>` +
    '</div>'
  )
}

// 表格包 .table-wrap，宽表横向滚动不撑破气泡
md.renderer.rules.table_open = () => '<div class="table-wrap"><table>'
md.renderer.rules.table_close = () => '</table></div>'

/** 渲染 Markdown 并净化，返回可直接 v-html 的安全 HTML。空文本返回空串。 */
export function renderMarkdown(text: string): string {
  if (!text) return ''
  return DOMPurify.sanitize(md.render(text))
}
