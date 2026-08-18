<script setup lang="ts">
/**
 * 工具步骤卡（CHG-007 REQ-032，design-iter-13 §3「原型即需求」本体）。
 *
 * 次级面板家族：subtle-bg + 1px border；头部行常显可点击（button 语义，aria-expanded）。
 * 徽章五态（§3.1）：运行中（spinner）/ 完成 ✓ / 失败 ✕ / 超时 ⏱ / 已中断（派生：无匹配
 * 结果且非生成中——运行中徽章不得冻结留存历史）。折叠规则（R1 于 2026-08-18 经 CEO
 * 指示修订，登记 design-iter-14 §12）：R1' 卡创建即折叠（含运行中，徽章示进度）；
 * R2 终态保持折叠；R3 历史消息恒折叠。展开/收起一律由用户。
 */
import { ref, watch } from 'vue'
import type { ToolCallBlock, ToolResultBlock } from '../api/client'

const props = defineProps<{
  call: ToolCallBlock
  result?: ToolResultBlock
  /** 所属消息生成中（R3：历史消息恒折叠） */
  live: boolean
}>()

const open = ref(false) // R1'（2026-08-18 CEO 指示修订）：卡创建即折叠，运行中不展开（头部行徽章已示进度）；展开/收起由用户
const userToggled = ref(false)

function toggle() {
  userToggled.value = true
  open.value = !open.value
}

// R2：终态到达（result 出现）或回合结束（live 翻 false）且用户未操作过 → 自动折叠；
// immediate：历史消息以终态直接挂载（R3）时初始即折叠，不等变更
watch(
  () => [props.result, props.live] as const,
  () => {
    if (!userToggled.value && (props.result || !props.live)) open.value = false
  },
  { immediate: true },
)

type Badge = 'running' | 'ok' | 'error' | 'timeout' | 'interrupted'
function badgeOf(): Badge {
  if (props.result) return props.result.status === 'ok' ? 'ok' : props.result.status
  return props.live ? 'running' : 'interrupted'
}
const badge = ref<Badge>(badgeOf())
watch(
  () => [props.result, props.live] as const,
  () => {
    badge.value = badgeOf()
  },
  { immediate: true },
)

const badgeText: Record<Badge, string> = {
  running: '运行中',
  ok: '完成',
  error: '失败',
  timeout: '超时',
  interrupted: '已中断',
}

const durationText = () => (props.result?.duration_ms != null ? `${props.result.duration_ms}ms` : '')

/** 参数摘要：arguments 原样（verbatim），CSS ellipsis 截断（§3.2 头部行） */
const argsSummary = () => props.call.arguments

/** 结果区占位三串（§3.3，逐字断言面）：等待 / 无返回 / 回合中断 */
function resultBody(): string {
  if (props.result) return props.result.result || '（无返回内容）'
  return props.live ? '（等待结果…）' : '（回合中断，未获得结果）'
}
</script>

<template>
  <div class="tool-card">
    <button type="button" class="tc-head" :aria-expanded="open" @click="toggle">
      <svg class="tc-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 10.41V7h-2v6.71l4.71 2.91 1-1.66z" />
      </svg>
      <span class="tc-name">{{ call.name }}</span>
      <span class="tc-args">{{ argsSummary() }}</span>
      <span v-if="durationText()" class="tc-duration">{{ durationText() }}</span>
      <span class="tc-badge" :class="badge">
        <svg v-if="badge === 'running'" class="tc-spinner" width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="42 15" />
        </svg>
        <svg v-else-if="badge === 'ok'" width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" /></svg>
        <svg v-else-if="badge === 'error'" width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" /></svg>
        <svg v-else-if="badge === 'timeout'" width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 10.41V7h-2v6.71l4.71 2.91 1-1.66z" /></svg>
        <svg v-else width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 11h14v2H5z" /></svg>
        {{ badgeText[badge] }}
      </span>
      <svg class="tc-chevron" :class="{ flip: open }" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
        <path fill="currentColor" d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
      </svg>
    </button>
    <div v-if="open" class="tc-body">
      <div class="tc-label">参数</div>
      <pre class="tc-args-block">{{ call.arguments }}</pre>
      <div class="tc-label">结果</div>
      <div class="tc-result" :class="result ? result.status : 'none'"><pre class="tc-result-text">{{ resultBody() }}</pre></div>
    </div>
  </div>
</template>

<style scoped>
/* 次级面板（design-iter-13 §3）：subtle-bg + border；段间 8px / 消息间 20px 由外层 gap 承载 */
.tool-card {
  background: var(--c-subtle-bg);
  border: 1px solid var(--c-border);
  border-radius: 10px;
  margin: 8px 0;
  overflow: hidden;
}
.tc-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  font: inherit;
  color: var(--c-text-1);
  min-width: 0;
}
.tc-head:focus-visible {
  outline: 2px solid var(--c-focus-ring);
  outline-offset: -2px;
  border-radius: 10px;
}
.tc-icon {
  color: var(--c-text-3);
  flex: none;
}
.tc-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
  flex: none;
}
.tc-args {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}
.tc-duration {
  font-size: 12px;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
  flex: none;
}
/* 徽章（§3.1 四态 + 派生中断态）：20px 胶囊 · 12px/500；暗色由令牌覆盖自动生效 */
.tc-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  flex: none;
}
.tc-badge.running {
  color: var(--c-primary);
  background: var(--c-primary-l);
}
.tc-badge.ok {
  color: var(--c-success);
  background: var(--c-surface);
  border: 1px solid var(--c-success);
}
.tc-badge.error {
  color: var(--c-danger);
  background: var(--c-danger-l);
}
.tc-badge.timeout {
  color: var(--c-warning);
  background: var(--c-warning-l);
}
.tc-badge.interrupted {
  color: var(--c-text-2);
  background: var(--c-hover-bg);
}
.tc-spinner {
  animation: tc-spin 0.9s linear infinite;
}
@keyframes tc-spin {
  to {
    transform: rotate(360deg);
  }
}
.tc-chevron {
  color: var(--c-text-3);
  flex: none;
  transition: transform 0.15s ease;
}
.tc-chevron.flip {
  transform: rotate(180deg);
}
.tc-body {
  padding: 0 10px 10px;
}
.tc-label {
  font-size: 12px;
  color: var(--c-text-3);
  margin: 6px 0 4px;
}
/* 参数块（§3.3）：mono · arguments 原样（零转换）· 超长横向滚动 */
.tc-args-block {
  margin: 0;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  padding: 8px 10px;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--c-text-1);
  white-space: pre;
  overflow-x: auto;
  scrollbar-width: thin;
}
/* 结果卡（§3.3）：左缘 3px 语义色条 · max-height 200px 内滚 · 细滚动条 */
.tc-result {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-left-width: 3px;
  border-radius: 8px;
  max-height: 200px;
  overflow-y: auto;
  scrollbar-width: thin;
}
.tc-result.ok {
  border-left-color: var(--c-success);
}
.tc-result.error {
  border-left-color: var(--c-danger);
}
.tc-result.timeout {
  border-left-color: var(--c-warning);
}
.tc-result.none {
  border-left-color: var(--c-border);
}
.tc-result-text {
  margin: 0;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--c-text-1);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
}
</style>
