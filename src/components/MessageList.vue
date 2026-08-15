<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { Message } from '../stores/sessions'
import MessageBubble from './MessageBubble.vue'
import ErrorBubble from './ErrorBubble.vue'

const props = defineProps<{ messages: Message[] }>()
const emit = defineEmits<{ retry: [id: string]; goSettings: []; edit: [id: string, text: string] }>()

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
    <div class="list-col">
      <template v-for="(m, i) in messages" :key="m.id">
        <ErrorBubble
          v-if="m.status === 'error'"
          :kind="m.error?.kind ?? 'unknown'"
          :message="m.error?.message ?? '未知错误'"
          @retry="emit('retry', m.id)"
          @go-settings="emit('goSettings')"
        />
        <div v-else class="row-wrap" :class="m.role">
          <MessageBubble
            :message="m"
            :following-count="messages.length - i - 1"
            @edit="(id, text) => emit('edit', id, text)"
          />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 滚动区横贯主区域（负 margin 破出内容列的 padding），滚动条贴近窗口右缘，
   文字列窄栏居中——对齐 chat.deepseek.com 的布局模式 */
.list {
  flex: 1;
  overflow-y: auto;
  padding: 24px 12px; /* 左右对称，滚动条与文字两侧间距一致 */
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
.list-col {
  width: 100%;
  max-width: 712px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.row-wrap {
  width: 100%;
  display: flex;
}
.row-wrap.user {
  justify-content: flex-end;
}
</style>
