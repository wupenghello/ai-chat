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

// 流式追加时自动滚底（DEF-034 修复，2026-08-18 CEO 验收反馈）：
// 程序滚动的 scroll 回声不重置 follow（否则用户滚轮抬升未过阈值即被下一次增量拽回底）；
// 用户滚动时距底 > 120px 即脱离跟随，回到底部自动恢复，另出「回到底部」浮钮
function nearBottom() {
  const n = el.value
  return !n || n.scrollHeight - n.scrollTop - n.clientHeight < 120
}
let echo = false // 程序滚动的回声标记
const follow = ref(true) // 模板可见（回底浮钮 v-if），须响应式
function onScroll() {
  if (echo) return
  follow.value = nearBottom()
}
// DEF-041（2026-08-23 CEO 上线后反馈，DEF-034 残留竞态）：高频增量下程序滚底（微任务）
// 会赶在用户滚动事件派发前把位置拽回底，120px 距离阈值实际攒不够、脱离跟随不可达。
// 修复：从输入事件识别意图——向上滚轮 / 触屏下滑（回看方向手势）立即脱离跟随，
// 先行于任何位置判定；回底恢复仍由 onScroll 距底判定承载
function onWheel(e: WheelEvent) {
  if (e.deltaY < 0) follow.value = false
}
let touchStartY = 0
function onTouchStart(e: TouchEvent) {
  touchStartY = e.touches[0]?.clientY ?? 0
}
function onTouchMove(e: TouchEvent) {
  const y = e.touches[0]?.clientY ?? touchStartY
  if (y - touchStartY > 10) follow.value = false // 手指下滑 = 回看更早内容
}
async function stick() {
  const n = el.value
  if (!n) return
  echo = true
  n.scrollTop = n.scrollHeight
  await nextTick()
  echo = false
}
function toBottom() {
  follow.value = true
  void stick()
}
// CHG-007（iter-13 T2）：content 为 string | Block[]——blocks 消息序列化后拼接作 watch 键
function contentKey(m: Message): string {
  return typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
}
watch(
  () => props.messages.map(contentKey).join(''),
  async () => {
    if (!follow.value) return
    await nextTick()
    await stick()
  },
)
watch(
  () => props.messages.length,
  async () => {
    follow.value = true // 新消息（用户发送/新回合）= 明确回底，恢复跟随
    await nextTick()
    await stick()
  },
)
</script>

<template>
  <div
    ref="el"
    class="list"
    @scroll.passive="onScroll"
    @wheel.passive="onWheel"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
  >
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
    <!-- DEF-034：脱离跟随时的回底浮钮（零高度 sticky 槽，不占文档流） -->
    <div v-if="!follow" class="tb-slot">
      <button type="button" class="tb-btn" @click="toBottom">↓ 回到底部</button>
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
.tb-slot {
  position: sticky;
  bottom: 12px;
  height: 0;
  display: flex;
  justify-content: flex-end;
  pointer-events: none;
}
.tb-btn {
  pointer-events: auto;
  margin-right: 18px;
  transform: translateY(-100%);
  padding: 6px 14px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-full);
  background: var(--c-surface);
  color: var(--c-text-2);
  font-size: 12px;
  box-shadow: var(--shadow-1);
  cursor: pointer;
}
.tb-btn:hover {
  color: var(--c-text-1);
  border-color: var(--c-text-3);
}
.row-wrap {
  width: 100%;
  display: flex;
}
.row-wrap.user {
  justify-content: flex-end;
}
</style>
