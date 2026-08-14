<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

const props = defineProps<{ disabled?: boolean; hint?: string }>()
const emit = defineEmits<{ send: [text: string] }>()

const text = ref('')
const el = ref<HTMLTextAreaElement | null>(null)
const canSend = computed(() => !props.disabled && text.value.trim().length > 0)

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
      :placeholder="disabled ? hint ?? '生成中…' : '输入消息，Enter 发送，Shift+Enter 换行'"
      :disabled="disabled"
      @keydown="onKey"
      @input="autosize"
    />
    <button class="send" :disabled="!canSend" aria-label="发送" @click="submit">
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
.ta:disabled {
  cursor: not-allowed;
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
</style>
