<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { Session } from '../stores/sessions'
import { highlightSegments, type SearchHit } from '../utils/search'
import DropdownMenu, { type DropMenuItem } from './DropdownMenu.vue'

/**
 * REQ-026.1（design-iter-11 §1.2，R1 grid 单行）：列表项单行化——仅标题（ellipsis + title），
 * hover 右侧浮现「···」，下拉菜单承载 重命名 / 删除（导出会话项随 REQ-027 T2 落地）。
 * 无逐条时间戳（REQ-026.2 时间分组由 TheSidebar 渲染组头）。
 */
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

const menuItems = computed<DropMenuItem[]>(() => [
  {
    key: 'rename',
    label: '重命名',
    disabled: props.session.corrupted,
    reason: '无法读取的会话不可重命名',
  },
  { key: 'remove', label: '删除', danger: true, separator: true },
])

function onMenuSelect(key: string) {
  if (key === 'rename') startEdit()
  else if (key === 'remove') emit('remove')
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
      <span class="title" :title="session.corrupted ? '无法读取的会话' : session.title" @dblclick.stop="startEdit">
        <template v-if="search && hit?.type === 'title'">
          <template v-for="(seg, i) in titleSegs" :key="i">
            <mark v-if="seg.hit" class="hl">{{ seg.text }}</mark>
            <span v-else>{{ seg.text }}</span>
          </template>
        </template>
        <template v-else>{{ session.corrupted ? '无法读取的会话' : session.title }}</template>
      </span>
      <span v-if="session.corrupted" class="pill broken">无法读取</span>
      <span v-else-if="session.messages.some((m) => m.status === 'interrupted')" class="pill cut">生成中断</span>
      <DropdownMenu :items="menuItems" trigger-aria="会话操作" @select="onMenuSelect" />
    </template>
    <div v-if="!editing && search && hit?.type === 'body' && hit.snippet" class="hit-snippet">
      <template v-for="(seg, i) in snippetSegs" :key="i">
        <mark v-if="seg.hit" class="hl">{{ seg.text }}</mark>
        <span v-else>{{ seg.text }}</span>
      </template>
    </div>
  </li>
</template>

<style scoped>
/* R1（design-iter-11 §1.2 修订）：grid 三列 minmax(0,1fr)/auto/auto——标题列强制收缩省略，
   pill 与「···」恒居右同排不换行；搜索摘要跨全列占第二行 */
.item {
  list-style: none;
  border-radius: 8px;
  padding: 6px 10px;
  min-height: 34px;
  cursor: pointer;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  column-gap: 6px;
  row-gap: 2px;
  transition: background 0.15s ease;
  position: relative;
}
.item:hover {
  background: var(--c-hover-bg);
}
.item.active {
  background: var(--c-primary-l);
}
.item.active .title {
  color: var(--c-primary);
}
.item.corrupted {
  cursor: not-allowed;
}
.item.corrupted .title {
  color: var(--c-text-3);
}
.title {
  grid-column: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--c-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 「···」触发钮：28px r-sm，hover 行时浮现（design-iter-11 §1.2 走查 5） */
.item :deep(.dd-trigger) {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
}
.item:hover :deep(.dd-trigger),
.item :deep(.dd-trigger:focus-visible),
.item :deep(.dd-trigger[aria-expanded='true']) {
  opacity: 1;
}
.item :deep(.dd-trigger:hover) {
  background: var(--c-hover-bg);
  color: var(--c-text-1);
}
.edit-input {
  grid-column: 1 / -1;
  min-width: 0;
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
  box-shadow: 0 0 0 3px var(--c-focus-ring);
}
/* REQ-016 搜索高亮：关键词主色高亮（mark 默认黄底重置） */
mark.hl {
  background: transparent;
  color: var(--c-primary);
  font-weight: 600;
}
.hit-snippet {
  grid-column: 1 / -1;
  font-size: 12px;
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pill {
  grid-column: 2;
  font-size: 11px;
  border-radius: 999px;
  padding: 1px 8px;
}
.pill.broken {
  color: var(--c-text-3);
  background: var(--c-hover-bg);
}
.pill.cut {
  color: var(--c-warning);
  background: var(--c-warning-l);
}
</style>
