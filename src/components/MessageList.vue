<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { Message } from '../stores/sessions'
import MessageBubble from './MessageBubble.vue'
import ErrorBubble from './ErrorBubble.vue'

const props = defineProps<{ messages: Message[] }>()
const emit = defineEmits<{ retry: [id: string]; goSettings: [] }>()

const el = ref<HTMLElement | null>(null)

// 流式追加时自动滚底（用户手动上滚时不打扰：距底 > 120px 则不跟随）
function nearBottom() {
  const n = el.value
  return !n || n.scrollHeight - n.scrollTop - n.clientHeight < 120
}
let follow = true
function onScroll() {
  follow = nearBottom()
}
watch(
  () => props.messages.map((m) => m.content).join(''),
  async () => {
    if (!follow) return
    await nextTick()
    if (el.value) el.value.scrollTop = el.value.scrollHeight
  },
)
watch(
  () => props.messages.length,
  async () => {
    follow = true
    await nextTick()
    if (el.value) el.value.scrollTop = el.value.scrollHeight
  },
)
</script>

<template>
  <div ref="el" class="list" @scroll.passive="onScroll">
    <template v-for="m in messages" :key="m.id">
      <ErrorBubble
        v-if="m.status === 'error'"
        :kind="m.error?.kind ?? 'unknown'"
        :message="m.error?.message ?? '未知错误'"
        @retry="emit('retry', m.id)"
        @go-settings="emit('goSettings')"
      />
      <div v-else class="row-wrap" :class="m.role">
        <MessageBubble :message="m" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 12px 24px 0; /* 右侧 12px 让滚动条不贴消息 */
  scroll-behavior: smooth;
  scrollbar-width: thin;
  scrollbar-color: #d5d9e0 transparent;
}
.list::-webkit-scrollbar {
  width: 6px;
}
.list::-webkit-scrollbar-thumb {
  background: #d5d9e0;
  border-radius: 999px;
}
.list::-webkit-scrollbar-track {
  background: transparent;
}
.row-wrap {
  width: 100%;
  display: flex;
}
.row-wrap.user {
  justify-content: flex-end;
}
</style>
