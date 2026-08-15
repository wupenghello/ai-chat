<script setup lang="ts">
import type { Message } from '../stores/sessions'

defineProps<{ message: Message }>()
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
      <span class="content">{{ message.content }}<span v-if="message.status === 'generating'" class="cursor" /></span>
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
  width: 100%; /* 占满行宽，max-width 百分比才能按内容区正确解析 */
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
  max-width: 100%; /* AI 回复占满内容列（DeepSeek 布局模式），不设气泡上限 */
  padding: 4px 0;
}
.content:empty::before {
  content: '';
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
/* REQ-010：用户主动停止 = 正常操作，用中性灰胶囊与"生成中断"警告胶囊区分 */
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
