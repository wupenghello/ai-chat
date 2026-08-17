<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { Message } from '../stores/sessions'
import { contentBlocks, contentText } from '../api/client'
import MessageBubble from './MessageBubble.vue'
import ErrorBubble from './ErrorBubble.vue'

const props = defineProps<{ messages: Message[] }>()
const emit = defineEmits<{ retry: [id: string]; goSettings: []; edit: [id: string, text: string]; toggleVersion: [forkId: string] }>()

/** design-iter-13 条 32：错误回合已生成的文本与工具步骤保留（与错误气泡共存形态）；
 *  存量空内容错误消息仅错误气泡（REQ-007 形态零回退） */
function hasKeptContent(m: Message): boolean {
  if (contentText(m.content).trim()) return true
  return contentBlocks(m.content).some((b) => b.type === 'tool_call')
}

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
// CHG-007（iter-13 T2）：content 为 string | Block[]——blocks 消息序列化后拼接作 watch 键
function contentKey(m: Message): string {
  return typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
}
watch(
  () => props.messages.map(contentKey).join(''),
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
        <template v-if="m.status === 'error'">
          <!-- 条 32 共存：错误前已生成内容保留渲染（含工具步骤），错误气泡随其后 -->
          <div v-if="hasKeptContent(m)" class="row-wrap assistant">
            <MessageBubble
              :message="m"
              :following-count="messages.length - i - 1"
              @edit="(id, text) => emit('edit', id, text)"
              @toggle-version="(forkId) => emit('toggleVersion', forkId)"
            />
          </div>
          <ErrorBubble
            :kind="m.error?.kind ?? 'unknown'"
            :message="m.error?.message ?? '未知错误'"
            @retry="emit('retry', m.id)"
            @go-settings="emit('goSettings')"
          />
        </template>
        <div v-else class="row-wrap" :class="m.role">
          <MessageBubble
            :message="m"
            :following-count="messages.length - i - 1"
            @edit="(id, text) => emit('edit', id, text)"
            @toggle-version="(forkId) => emit('toggleVersion', forkId)"
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
  scrollbar-color: var(--c-scrollbar) transparent;
}
.list::-webkit-scrollbar {
  width: 6px;
}
.list::-webkit-scrollbar-thumb {
  background: var(--c-scrollbar);
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
