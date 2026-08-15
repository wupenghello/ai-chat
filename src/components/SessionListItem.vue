<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { Session } from '../stores/sessions'
import { highlightSegments, type SearchHit } from '../utils/search'

const props = defineProps<{ session: Session; active: boolean; search?: string; hit?: SearchHit | null }>()
const emit = defineEmits<{ select: []; remove: []; rename: [title: string] }>()

const editing = ref(false)
const draft = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

// REQ-016：搜索高亮片段（标题命中 / 正文命中片段）
const titleSegs = computed(() => highlightSegments(props.session.title, props.search ?? ''))
const snippetSegs = computed(() =>
  props.hit?.type === 'body' && props.hit.snippet ? highlightSegments(props.hit.snippet, props.search ?? '') : [],
)

function timeLabel(ts: number) {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function startEdit() {
  if (props.session.corrupted) return
  draft.value = props.session.title
  editing.value = true
  void nextTick(() => inputEl.value?.focus())
}

/** 回车 / 失焦 = 保存：非空且与原标题不同才提交；空或未变则静默恢复原标题（store 不改动） */
function confirm() {
  if (!editing.value) return
  editing.value = false
  const t = draft.value.trim()
  if (t && t !== props.session.title) emit('rename', t)
}

function cancel() {
  editing.value = false
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
      <template v-if="editing">
        <input
          ref="inputEl"
          v-model="draft"
          class="edit-input"
          spellcheck="false"
          autocomplete="off"
          aria-label="重命名会话"
          @keydown.enter.stop.prevent="confirm"
          @keydown.esc.stop.prevent="cancel"
          @blur="confirm"
          @click.stop
        />
      </template>
      <template v-else>
        <span class="title" :title="session.title" @dblclick.stop="startEdit">
          <template v-if="search && hit?.type === 'title'">
            <template v-for="(seg, i) in titleSegs" :key="i">
              <mark v-if="seg.hit" class="hl">{{ seg.text }}</mark>
              <span v-else>{{ seg.text }}</span>
            </template>
          </template>
          <template v-else>{{ session.corrupted ? '无法读取的会话' : session.title }}</template>
        </span>
        <button
          v-if="!session.corrupted"
          class="rename-btn"
          aria-label="重命名"
          title="重命名"
          @click.stop="startEdit"
        >
          <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linejoin="round"
              d="M8.5 2.5l3 3L4 13H1v-3l7.5-7.5z"
            />
          </svg>
        </button>
        <span v-if="session.corrupted" class="pill broken">无法读取</span>
        <span v-else-if="session.messages.some((m) => m.status === 'interrupted')" class="pill cut">生成中断</span>
      </template>
    </div>
    <div v-if="search && hit?.type === 'body' && hit.snippet" class="hit-snippet">
      <template v-for="(seg, i) in snippetSegs" :key="i">
        <mark v-if="seg.hit" class="hl">{{ seg.text }}</mark>
        <span v-else>{{ seg.text }}</span>
      </template>
    </div>
    <div class="meta">
      <span class="time">{{ timeLabel(session.updatedAt) }}</span>
      <button v-if="!session.corrupted" class="del" aria-label="删除会话" @click.stop="emit('remove')">
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
  min-width: 0;
}
.title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--c-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rename-btn {
  flex: none;
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
.item:hover .rename-btn {
  opacity: 1;
}
.rename-btn:hover {
  color: var(--c-primary);
  background: var(--c-primary-l);
}
.edit-input {
  flex: 1;
  min-width: 0;
  width: 100%;
  height: 26px;
  padding: 0 8px;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  line-height: 26px;
  border: 1px solid var(--c-primary);
  border-radius: 6px;
  outline: none;
  color: var(--c-text-1);
  background: var(--c-surface);
}
.edit-input:focus {
  box-shadow: 0 0 0 3px rgba(51, 112, 255, 0.12);
}
/* REQ-016 搜索高亮：关键词主色高亮（mark 默认黄底重置） */
mark.hl {
  background: transparent;
  color: var(--c-primary);
  font-weight: 600;
}
.hit-snippet {
  font-size: 12px;
  color: var(--c-text-3);
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
