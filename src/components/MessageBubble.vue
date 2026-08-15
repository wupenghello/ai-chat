<script setup lang="ts">
import { computed } from 'vue'
import type { Message } from '../stores/sessions'
import { renderMarkdown } from '../utils/markdown'

const props = defineProps<{ message: Message }>()

// AI 回复按 Markdown 渲染（流式增量：每次 onDelta 触发重渲染）
const rendered = computed(() => renderMarkdown(props.message.content))

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 降级：非安全上下文 / 剪贴板 API 不可用时用 execCommand
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

// 事件委托：代码块复制按钮在 v-html 内容里，冒泡到容器统一处理
function onCopy(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest('.code-copy') as HTMLElement | null
  if (!btn) return
  const code = btn.closest('.code-block')?.querySelector('pre code')?.textContent ?? ''
  void copyToClipboard(code).then((ok) => {
    if (!ok) return
    btn.classList.add('copied')
    btn.textContent = '已复制'
    window.setTimeout(() => {
      btn.classList.remove('copied')
      btn.textContent = '复制'
    }, 1500)
  })
}
</script>

<template>
  <div class="row" :class="message.role">
    <div v-if="message.role === 'assistant'" class="avatar ai" aria-hidden="true">
      <svg viewBox="0 0 128 128" width="16" height="16">
        <path
          fill="none"
          stroke="currentColor"
          stroke-width="14"
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M 20 98 V 36 M 108 98 V 36 M 20 36 L 64 78 L 108 36 M 64 78 C 64 102 96 102 96 82"
        />
      </svg>
    </div>
    <div class="bubble" :class="message.role">
      <!-- 用户消息保持纯文本；AI 回复走 Markdown 富文本（v-html 内容，样式见下方非 scoped 块） -->
      <span v-if="message.role === 'user'" class="content">{{ message.content }}</span>
      <div v-else class="md" v-html="rendered" @click="onCopy"></div>

      <span v-if="message.status === 'generating'" class="cursor" aria-hidden="true" />
      <span v-if="message.status === 'generating'" class="status-hint">正在生成…</span>
      <span v-else-if="message.status === 'interrupted'" class="pill interrupted">生成中断</span>
      <span v-else-if="message.status === 'stopped'" class="pill stopped">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" rx="1.5" fill="currentColor" /></svg>
        已停止生成
      </span>
    </div>
    <div v-if="message.role === 'user'" class="avatar user" aria-hidden="true">我</div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  width: 100%;
  animation: rise 0.25s ease;
}
.row.user {
  flex-direction: row-reverse;
}
.avatar {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}
.avatar.ai {
  background: var(--c-primary-l);
  color: var(--c-primary);
}
.avatar.user {
  background: #e8ebf2;
  color: var(--c-text-2);
}
.bubble {
  max-width: 80%;
  font-size: 15px;
  line-height: 1.75;
  white-space: pre-wrap;
  word-break: break-word;
}
.bubble.user {
  background: var(--c-primary);
  color: #fff;
  padding: 10px 14px;
  border-radius: 12px 12px 4px 12px;
}
.bubble.assistant {
  max-width: 100%;
  padding: 4px 0;
}
.cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: var(--c-primary);
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: blink 0.9s steps(1) infinite;
}
.status-hint {
  display: block;
  font-size: 12px;
  color: var(--c-text-3);
  margin-top: 4px;
}
.pill.interrupted {
  display: inline-block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--c-warning);
  background: #fff7e8;
  border-radius: 999px;
  padding: 2px 10px;
}
.pill.stopped {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--c-text-2);
  background: #f2f3f5;
  border-radius: 999px;
  padding: 2px 8px;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}
</style>

<!-- Markdown 富文本样式（v-html 内容不受 scoped 约束，故独立非 scoped 块；令牌对齐 design/iter-3） -->
<style>
.md {
  font-size: 15px;
  line-height: 1.75;
  color: var(--c-text-1);
}
.md p {
  margin: 0 0 8px;
}
.md p:last-child {
  margin-bottom: 0;
}
.md h1,
.md h2,
.md h3,
.md h4 {
  font-weight: 600;
  color: var(--c-text-1);
  margin: 16px 0 8px;
  line-height: 1.4;
}
.md h1 {
  font-size: 20px;
}
.md h2 {
  font-size: 18px;
}
.md h3 {
  font-size: 16px;
}
.md h4 {
  font-size: 15px;
}
.md ul,
.md ol {
  margin: 0 0 8px;
  padding-left: 24px;
}
.md li {
  margin: 2px 0;
}
.md li::marker {
  color: var(--c-text-3);
}
.md blockquote {
  border-left: 3px solid var(--c-border);
  padding: 2px 12px;
  color: var(--c-text-2);
  margin: 8px 0;
}
.md a {
  color: var(--c-primary);
  text-decoration: none;
}
.md a:hover {
  text-decoration: underline;
}
.md hr {
  border: none;
  border-top: 1px solid var(--c-border);
  margin: 12px 0;
}
.md strong {
  font-weight: 600;
}
.md code {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 13px;
  background: #f2f3f5;
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--c-text-1);
  word-break: break-all;
}
.md table {
  border-collapse: collapse;
  margin: 8px 0;
  width: 100%;
  font-size: 14px;
}
.md th,
.md td {
  border: 1px solid var(--c-border);
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
}
.md th {
  background: #fafbfc;
  font-weight: 500;
  color: var(--c-text-2);
}
.md td {
  color: var(--c-text-1);
}
.md .table-wrap {
  overflow-x: auto;
  margin: 8px 0;
}

.code-block {
  position: relative;
  margin: 12px 0;
}
.code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #23272e;
  color: #9aa4b2;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 12px 12px 0 0;
}
.code-lang {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
}
.code-block pre {
  background: #2b303a;
  color: #e6eaf0;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  padding: 12px 16px;
  border-radius: 0 0 12px 12px;
  overflow-x: auto;
  white-space: pre;
  margin: 0;
}
.code-block pre code {
  background: transparent;
  padding: 0;
  border-radius: 0;
  color: inherit;
  font-size: inherit;
  word-break: normal;
}
.code-copy {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  color: #9aa4b2;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  transition: color 0.15s ease, background 0.15s ease;
}
.code-copy:hover {
  color: #e6eaf0;
  background: rgba(255, 255, 255, 0.12);
}
/* REQ-011 新增令牌：深底成功反馈绿 #4CC38A（CEO 批准 2026-08-15） */
.code-copy.copied {
  color: var(--c-success-on-dark);
}
</style>
