<script lang="ts">
// 模块级互斥登记（§2.1：同一时刻全站至多一个菜单开着）——必须在 setup 之外，
// script setup 内的变量是每实例一份，跨实例互斥会失效
let closeCurrent: (() => void) | null = null
</script>

<script setup lang="ts">
/**
 * 通用下拉菜单（REQ-026.5，design-iter-11 §2 专章基线）：
 * 列表项「···」与账户区菜单共用。交互规格（§2.1/§2.2，走查 19~22 取证口径）：
 * - 触发钮点击开/关（toggle），aria-haspopup + aria-expanded；开菜单聚焦首可用项
 * - 外点关闭且吞掉首击（capture 拦截，不误触发底层会话/按钮）
 * - Esc 关闭 + 焦点回触发钮；Tab 关闭自然移焦
 * - ↑/↓ 循环跳过禁用项；Home/End 首/末；Enter/Space 执行
 * - 多实例互斥（模块级登记）；底层滚动即关（capture）
 * - 右对齐触发钮右缘向下展开，下方不足上翻；z-index 40（< 弹窗 100 < 内层 110）
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

export interface DropMenuItem {
  key: string
  label: string
  danger?: boolean
  disabled?: boolean
  /** 禁用原因（title 提示） */
  reason?: string
  /** 该项前渲染 1px 分隔线 */
  separator?: boolean
}

const props = defineProps<{ items: ReadonlyArray<DropMenuItem>; triggerClass?: string; triggerTitle?: string; triggerAria?: string }>()
const emit = defineEmits<{ select: [key: string] }>()

const open = ref(false)
const up = ref(false) // 下方空间不足时上翻
const rootEl = ref<HTMLElement | null>(null)
const triggerEl = ref<HTMLButtonElement | null>(null)
const menuEl = ref<HTMLElement | null>(null)

const enabledIndexes = computed(() =>
  props.items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0),
)

function focusIndex(i: number) {
  const btns = menuEl.value?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')
  if (!btns) return
  const target = [...btns].find((b) => b.dataset.idx === String(i))
  target?.focus()
}

async function openMenu() {
  if (closeCurrent && closeCurrent !== doClose) closeCurrent()
  closeCurrent = doClose
  open.value = true
  up.value = false
  await nextTick()
  // 定位（§2.1）：下方空间不足时上翻（jsdom 无布局，getBoundingClientRect 全 0 → 恒向下，单测不依赖此分支）
  const menu = menuEl.value
  const trig = triggerEl.value
  if (menu && trig && typeof document !== 'undefined') {
    const spaceBelow = window.innerHeight - trig.getBoundingClientRect().bottom
    if (spaceBelow < menu.offsetHeight + 8) up.value = true
  }
  if (enabledIndexes.value.length) focusIndex(enabledIndexes.value[0])
}

function doClose(refocus = false) {
  if (!open.value) return
  open.value = false
  if (closeCurrent === doClose) closeCurrent = null
  if (refocus) triggerEl.value?.focus()
}

function toggle() {
  if (open.value) doClose()
  else void openMenu()
}

function pick(item: DropMenuItem) {
  if (item.disabled) return
  doClose(true) // §2.2：执行后关菜单 + 焦点回触发钮
  emit('select', item.key)
}

function onMenuKey(e: KeyboardEvent) {
  const list = enabledIndexes.value
  if (!list.length) return
  const cur = (document.activeElement as HTMLElement | null)?.dataset?.idx
  const curIdx = cur !== undefined ? list.indexOf(Number(cur)) : -1
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    focusIndex(list[(curIdx + 1 + list.length) % list.length])
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    focusIndex(list[(curIdx - 1 + list.length) % list.length])
  } else if (e.key === 'Home') {
    e.preventDefault()
    focusIndex(list[0])
  } else if (e.key === 'End') {
    e.preventDefault()
    focusIndex(list[list.length - 1])
  } else if (e.key === 'Escape') {
    e.preventDefault()
    doClose(true)
  } else if (e.key === 'Enter' || e.key === ' ') {
    // 焦点项执行（§2.2 矩阵：Enter/Space 执行并关+焦点回触发钮）
    const idx = Number((document.activeElement as HTMLElement | null)?.dataset?.idx)
    const item = props.items[idx]
    if (item && !item.disabled) {
      e.preventDefault()
      pick(item)
    }
  } else if (e.key === 'Tab') {
    doClose() // 自然移焦，不 preventDefault
  }
}

// 外点关闭 + 吞掉首击（capture）；触发钮自身的点击走 toggle，不算外点。
// 例外：点击目标是另一个下拉菜单（.dd）的触发区时放行——「开新关旧」一步完成（§2.1 互斥），
// 吞掉它会导致需要点两次才能切换菜单。
function onDocClick(e: MouseEvent) {
  if (!open.value) return
  const t = e.target as HTMLElement | null
  if (!t) return
  if (rootEl.value?.contains(t)) return
  if (t.closest('.dd')) return
  e.stopImmediatePropagation()
  e.preventDefault()
  doClose()
}

// 底层滚动即关（scroll 不冒泡，capture 于 window 可捕获后代滚动容器）
function onScrollClose(e: Event) {
  if (!open.value) return
  if (menuEl.value?.contains(e.target as Node)) return
  doClose()
}

function bindDoc() {
  document.addEventListener('click', onDocClick, true)
  window.addEventListener('scroll', onScrollClose, true)
}
function unbindDoc() {
  document.removeEventListener('click', onDocClick, true)
  window.removeEventListener('scroll', onScrollClose, true)
}

// 面板内点击不冒泡到触发容器（避免 toggle）
function onMenuClick(e: MouseEvent) {
  e.stopPropagation()
}

watch(open, (v) => (v ? bindDoc() : unbindDoc()))
onBeforeUnmount(() => {
  unbindDoc()
  if (closeCurrent === doClose) closeCurrent = null
})
</script>

<template>
  <span ref="rootEl" class="dd" @keydown="onMenuKey">
    <button
      ref="triggerEl"
      type="button"
      class="dd-trigger"
      :class="triggerClass"
      :title="triggerTitle ?? triggerAria"
      :aria-label="triggerAria ?? triggerTitle"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click.stop="toggle"
    >
      <slot name="trigger">
        <svg viewBox="0 0 14 14" width="16" height="16" aria-hidden="true">
          <circle cx="3" cy="7" r="1.5" fill="currentColor" />
          <circle cx="7" cy="7" r="1.5" fill="currentColor" />
          <circle cx="11" cy="7" r="1.5" fill="currentColor" />
        </svg>
      </slot>
    </button>
    <div v-if="open" ref="menuEl" class="dd-menu" :class="{ up }" role="menu" @click="onMenuClick">
      <template v-for="(item, i) in items" :key="item.key">
        <div v-if="item.separator" class="dd-sep" role="separator" />
        <button
          type="button"
          role="menuitem"
          :data-idx="i"
          class="dd-item"
          :class="{ danger: item.danger, disabled: item.disabled }"
          :disabled="item.disabled"
          :aria-disabled="item.disabled || undefined"
          :title="item.disabled ? item.reason : undefined"
          @click="pick(item)"
        >
          {{ item.label }}
        </button>
      </template>
    </div>
  </span>
</template>

<style scoped>
.dd {
  position: relative;
  display: inline-flex;
}
.dd-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: var(--c-text-3);
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}
.dd-trigger:focus-visible {
  box-shadow: 0 0 0 3px var(--c-focus-ring);
  border-radius: 6px;
}
/* 面板（§2.3/走查 6）：surface + border + shadow-2 + r-md，min-width 148px，项 32px/13px */
.dd-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 40;
  min-width: 148px;
  padding: 4px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  box-shadow: var(--shadow-2);
  display: flex;
  flex-direction: column;
  animation: ddin 0.15s ease;
}
.dd-menu.up {
  top: auto;
  bottom: calc(100% + 4px);
  animation: none;
}
@keyframes ddin {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
}
.dd-sep {
  height: 1px;
  background: var(--c-border);
  margin: 4px 8px;
}
.dd-item {
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: none;
  font-size: 13px;
  font-family: inherit;
  color: var(--c-text-1);
  text-align: left;
  cursor: pointer;
}
.dd-item:hover:not(.disabled),
.dd-item:focus-visible {
  background: var(--c-hover-bg);
  outline: none;
}
.dd-item.danger {
  color: var(--c-danger);
}
.dd-item.disabled {
  color: var(--c-text-3);
  cursor: not-allowed;
}
</style>
