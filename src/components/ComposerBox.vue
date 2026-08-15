<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

const props = defineProps<{ generating?: boolean; hint?: string }>()
const emit = defineEmits<{ send: [text: string]; stop: [] }>()

const text = ref('')
const el = ref<HTMLTextAreaElement | null>(null)
const canSend = computed(() => !props.generating && text.value.trim().length > 0)

async function autosize() {
  await nextTick()
  const t = el.value
  if (!t) return
  t.style.height = 'auto'
  t.style.height = Math.min(t.scrollHeight, 160) + 'px'
}

function submit() {
  if (!canSend.value) return
  emit('send', text.value)
  text.value = ''
  void autosize()
}

function onStop() {
  if (props.generating) emit('stop') // 边界：流恰好结束（已非生成态）时忽略，no-op
}

function onKey(e: KeyboardEvent) {
  if (e.isComposing) return // 中文输入法选词回车不发送
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <div class="composer">
    <textarea
      ref="el"
      v-model="text"
      rows="1"
      class="ta"
      :placeholder="
        generating ? hint ?? 'AI 正在生成，Enter 暂不可发送…' : '输入消息，Enter 发送，Shift+Enter 换行'
      "
      @keydown="onKey"
      @input="autosize"
    />
    <!-- REQ-010：生成中发送按钮原位切换为停止按钮；输入框保持可输入（草稿不丢），Enter 不发送 -->
    <button v-if="generating" class="stop" aria-label="停止生成" @click="onStop">
      <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
        <rect width="10" height="10" rx="1.5" fill="currentColor" />
      </svg>
      停止
    </button>
    <button v-else class="send" :disabled="!canSend" aria-label="发送" @click="submit">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path fill="currentColor" d="M3 20.5 22 12 3 3.5 3 10l13 2-13 2z" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 12px;
  padding: 10px 10px 10px 16px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.composer:focus-within {
  border-color: var(--c-primary);
  box-shadow: 3px 3px 0 rgba(51, 112, 255, 0.12);
}
.ta {
  flex: 1;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  font-size: 15px;
  line-height: 1.6;
  color: var(--c-text-1);
  max-height: 160px;
  font-family: inherit;
}
.ta::placeholder {
  color: var(--c-text-3);
}
.send {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: none;
  background: var(--c-primary);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.send:hover:not(:disabled) {
  background: var(--c-primary-h);
}
.send:active:not(:disabled) {
  transform: scale(0.94);
}
.send:disabled {
  background: #c9cfdb;
  cursor: not-allowed;
}
/* REQ-010：停止按钮（design-iter-2 已基线：红实底 + 白字 + 方块图标） */
.stop {
  flex: none;
  height: 36px;
  padding: 0 16px;
  border: none;
  border-radius: 8px;
  background: var(--c-error);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background 0.15s ease, transform 0.1s ease;
}
.stop:hover {
  background: #b7251c;
}
.stop:active {
  background: #b7251c;
  transform: scale(0.94);
}
</style>
