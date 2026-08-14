<script setup lang="ts">
import type { Session } from '../stores/sessions'

defineProps<{ session: Session; active: boolean }>()
const emit = defineEmits<{ select: []; remove: [] }>()

function timeLabel(ts: number) {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}
</script>

<template>
  <li
    class="item"
    :class="{ active, corrupted: session.corrupted }"
    role="button"
    tabindex="0"
    @click="emit('select')"
    @keydown.enter="emit('select')"
  >
    <div class="info">
      <span class="title">{{ session.corrupted ? '无法读取的会话' : session.title }}</span>
      <span v-if="session.corrupted" class="pill broken">无法读取</span>
      <span v-else-if="session.messages.some((m) => m.status === 'interrupted')" class="pill cut">生成中断</span>
    </div>
    <div class="meta">
      <span class="time">{{ timeLabel(session.updatedAt) }}</span>
      <button
        v-if="!session.corrupted"
        class="del"
        aria-label="删除会话"
        @click.stop="emit('remove')"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            fill="currentColor"
            d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm4 2v8h1.5v-8H10Zm3 0v8h1.5v-8H13Z"
          />
        </svg>
      </button>
    </div>
  </li>
</template>

<style scoped>
.item {
  list-style: none;
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: background 0.15s ease;
  position: relative;
}
.item:hover {
  background: #f2f3f5;
}
.item.active {
  background: var(--c-primary-l);
}
.item.active .title {
  color: var(--c-primary);
}
.item.corrupted {
  opacity: 0.55;
  cursor: not-allowed;
}
.info {
  display: flex;
  align-items: center;
  gap: 6px;
}
.title {
  font-size: 13px;
  color: var(--c-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pill {
  flex: none;
  font-size: 11px;
  border-radius: 999px;
  padding: 1px 8px;
}
.pill.broken {
  color: var(--c-text-3);
  background: #f2f3f5;
}
.pill.cut {
  color: var(--c-warning);
  background: #fff7e8;
}
.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.time {
  font-size: 12px;
  color: var(--c-text-3);
}
.del {
  opacity: 0;
  border: none;
  background: none;
  color: var(--c-text-3);
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  display: flex;
  transition: all 0.15s ease;
}
.item:hover .del {
  opacity: 1;
}
.del:hover {
  color: var(--c-error);
  background: #fdecea;
}
</style>
