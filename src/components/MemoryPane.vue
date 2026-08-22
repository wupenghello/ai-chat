<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { backend, type MemoryEntry, type MemoryState } from '../api/backend'
import { useToastStore } from '../stores/toast'
import ConfirmModal from './ConfirmModal.vue'
import ToggleSwitch from './ToggleSwitch.vue'

/**
 * 「AI 的记忆」设置分区（CHG-011 REQ-043，iter-17 T3；design-iter-17 §2 七态全量）。
 *
 * 布局序（定夺①）：标题+说明 → 停用开关行 → 记忆列表 → 注入预览（折叠置底）。
 * 铁律级纪律（定夺⑨）：注入预览恒为服务端 injection_preview 字段逐字渲染，前端零本地
 * 拼装（「看到的就是注入的」——组装时点同源单一链路）；停用/空态预览不呈现注入物。
 * 零乐观更新：所有写操作成功后重取 GET 整分区刷新，状态真值唯一来源服务端。
 * Esc：编辑态 Esc = 取消还原（SettingsForm onModalKey 链加法插入点，经 cancelEditing
 * 暴露）；关闭弹窗 = 编辑态取消，不参与 dirty 判定（定夺⑧，REQ-028 拦截链零变化）。
 */
const props = defineProps<{ active: boolean }>()

const toast = useToastStore()

type Phase = 'loading' | 'failed' | 'ready'
const phase = ref<Phase>('loading')
const state = ref<MemoryState | null>(null)
const loadedOnce = ref(false)

async function load(): Promise<boolean> {
  phase.value = loadedOnce.value ? phase.value : 'loading'
  try {
    state.value = await backend.getMemory()
    phase.value = 'ready'
    loadedOnce.value = true
    return true
  } catch {
    phase.value = 'failed'
    return false
  }
}

// 分区切入 = GET（design §4.6）；可重入（重试同路径，成功即恢复列表态）
watch(
  () => props.active,
  (v) => {
    if (v) void load()
  },
  { immediate: true },
)

const retrying = ref(false)
async function retry() {
  retrying.value = true
  try {
    await load() // 失败停留失败态，不重复 toast（沿 retryBoot 先例）
  } finally {
    retrying.value = false
  }
}

const entries = computed<MemoryEntry[]>(() => state.value?.entries ?? [])
const enabled = computed(() => state.value?.memory_enabled ?? true)
const preview = computed(() => state.value?.injection_preview ?? null)

// ---- 整体停用开关（定夺④：灰显 + 操作冻结；零乐观更新） ----
const switchBusy = ref(false)
async function toggleEnabled() {
  if (switchBusy.value || !state.value) return
  const next = !enabled.value
  switchBusy.value = true
  try {
    await backend.setMemoryEnabled(next)
    toast.push(
      next ? '✓ 记忆已重新启用，下一回合生效' : '记忆已停用：AI 将不再参考任何记忆',
      undefined,
      undefined,
      next ? 'success' : undefined,
    )
    await load()
  } catch {
    toast.push('操作失败，请重试')
    await load() // 重取回滚开关位（服务端真值唯一来源）
  } finally {
    switchBusy.value = false
  }
}

// ---- 行内编辑（定夺②：textarea + 150 字计数；保存禁用 = trim 空） ----
const editingId = ref<number | null>(null)
const editDraft = ref('')
const editSaving = ref(false)
const editTa = ref<HTMLTextAreaElement | null>(null)

/** 函数式 ref：textarea 位于 v-for 分支内，具名 ref 会被收集为数组；函数式恒得元素本体 */
function bindEditTa(el: unknown) {
  editTa.value = el instanceof HTMLTextAreaElement ? el : null
}

function startEdit(e: MemoryEntry) {
  if (!enabled.value) return // 停用态操作冻结
  editingId.value = e.id
  editDraft.value = e.content
  void nextTick(() => editTa.value?.focus())
}

/** SettingsForm Esc 链加法插入点：编辑中 → 取消还原并吞掉 Esc（返回 true） */
function cancelEditing(): boolean {
  if (editingId.value === null) return false
  editingId.value = null
  editDraft.value = ''
  return true
}

async function saveEdit() {
  const id = editingId.value
  const content = editDraft.value.trim()
  if (id === null || !content || content.length > 150 || editSaving.value) return
  editSaving.value = true
  try {
    await backend.updateMemoryEntry(id, content)
    toast.push('✓ 记忆已保存，下一回合生效', undefined, undefined, 'success')
    editingId.value = null
    await load() // 重取整分区：条目来源转「手工编辑」分支、预览同源刷新
  } catch {
    toast.push('保存失败，请重试')
    editingId.value = null
    await load()
  } finally {
    editSaving.value = false
  }
}

// ---- 删除确认（定夺③：ConfirmModal 现状组件照搬） ----
const pendingDelete = ref<MemoryEntry | null>(null)
async function confirmDelete() {
  const target = pendingDelete.value
  pendingDelete.value = null
  if (!target) return
  try {
    await backend.deleteMemoryEntry(target.id)
    toast.push('✓ 记忆已删除，下一回合生效', undefined, undefined, 'success')
    await load()
  } catch {
    toast.push('删除失败，请重试')
    await load()
  }
}

// ---- 注入预览（定夺⑤：折叠 + 代码块样式） ----
const previewOpen = ref(false)

function dayOf(ts: string): string {
  return ts.slice(0, 10) // 'YYYY-MM-DD HH:MM:SS' → YYYY-MM-DD
}

function metaOf(e: MemoryEntry): string {
  // 三分支（定夺⑥：来源 + 日期，不显模型）：手工编辑（PUT 后来源归零）→ M12；
  // 自动抽取有会话名 → M10；来源会话已删 → M11
  if (!e.source_session_id) return `手工编辑 · 更新于 ${dayOf(e.updated_at)}`
  if (e.source_session_title) {
    return `自动抽取 ·「${e.source_session_title}」· 更新于 ${dayOf(e.updated_at)}`
  }
  return `自动抽取 · 更新于 ${dayOf(e.updated_at)}`
}

defineExpose({ cancelEditing })
</script>

<template>
  <div class="mem-pane">
    <div class="section-label pane-label">AI 的记忆</div>
    <p class="mem-note">记忆由对话自动沉淀，AI 在回复时参考；你的修改自下一回合起生效。</p>

    <!-- 加载失败态：仅标题/说明 + 失败框；开关/列表/预览均不渲染（状态未知不渲染控制件） -->
    <div v-if="phase === 'failed'" class="mem-failed">
      记忆加载失败，请检查网络
      <button type="button" class="btn mem-retry" :disabled="retrying" @click="retry">
        {{ retrying ? '重试中…' : '重试' }}
      </button>
    </div>

    <template v-else-if="phase === 'ready' && state">
      <!-- 停用开关行（tools-field 家族）：分区级总闸置顶 -->
      <div class="mem-switch-row">
        <div class="msr-info">
          <span class="field-label">AI 参考记忆</span>
          <span class="field-hint">开启后，AI 在每个回合回复时参考下方记忆</span>
        </div>
        <ToggleSwitch
          :model-value="enabled"
          :disabled="switchBusy"
          label="AI 参考记忆开关"
          @update:model-value="toggleEnabled"
        />
      </div>

      <!-- 停用通知条（语义非错误：warning 族） -->
      <div v-if="!enabled" class="mem-off-banner">
        记忆已停用：AI 不再参考任何记忆，也不再进行新的沉淀。已有记忆保留，重新启用即恢复。
      </div>

      <!-- 列表态 / 空态 -->
      <div v-if="entries.length > 0" class="mem-list" :class="{ off: !enabled }">
        <div class="mem-list-head">
          <span class="mlh-title">记忆条目</span>
          <span class="mlh-count" title="上限 30 条，自动抽取超限时按上限截断">共 {{ entries.length }} 条</span>
        </div>
        <div
          v-for="(e, i) in entries"
          :key="e.id"
          class="mem-item"
          :class="{ editing: editingId === e.id }"
        >
          <span class="mi-idx">{{ i + 1 }}</span>
          <template v-if="editingId === e.id">
            <div class="mi-edit">
              <textarea
                :ref="bindEditTa"
                v-model="editDraft"
                class="mi-ta"
                maxlength="150"
              />
              <!-- Esc 统一走 SettingsForm 遮罩层 onModalKey 链（cancelEditing 暴露面）：
                   textarea 本地不挂 keydown.esc——双重消费会导致「取消编辑后连带关闭弹窗」 -->
              <div class="mi-edit-foot">
                <span class="mi-count" :class="{ over: editDraft.trim().length >= 150 }">
                  {{ editDraft.trim().length }} / 150
                </span>
                <span v-if="editDraft.trim().length >= 150" class="mi-over">最多 150 字</span>
                <span class="mi-edit-actions">
                  <button type="button" class="mi-btn" @click="cancelEditing">取消</button>
                  <button
                    type="button"
                    class="mi-btn mi-btn-save"
                    :disabled="editSaving || !editDraft.trim()"
                    @click="saveEdit"
                  >保存</button>
                </span>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="mi-body">
              <div class="mi-content">{{ e.content }}</div>
              <div class="mi-meta">{{ metaOf(e) }}</div>
            </div>
            <button
              type="button"
              class="mi-icon"
              :disabled="!enabled"
              title="编辑记忆"
              aria-label="编辑记忆"
              @click="startEdit(e)"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
              </svg>
            </button>
            <button
              type="button"
              class="mi-icon mi-icon-del"
              :disabled="!enabled"
              title="删除记忆"
              aria-label="删除记忆"
              @click="pendingDelete = e"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                <path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm4 2v8h1.5v-8H10Zm3 0v8h1.5v-8H13Z" />
              </svg>
            </button>
          </template>
        </div>
      </div>
      <div v-else class="mem-empty">
        <div class="me-title">暂无记忆</div>
        <div class="me-desc">记忆在对话中自动沉淀：对话结束后，AI 自动抽取关于你的身份、偏好与约定等值得记住的信息。</div>
      </div>

      <!-- 注入预览（折叠置底；内容恒为服务端 injection_preview 逐字，前端零拼装） -->
      <div class="mem-preview">
        <button
          type="button"
          class="mp-head"
          :aria-expanded="previewOpen ? 'true' : 'false'"
          @click="previewOpen = !previewOpen"
        >
          <svg class="mp-chev" :class="{ open: previewOpen }" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="mp-title">注入内容预览</span>
          <span class="mp-sub">所见即所注：以下文本在每个回合组装时逐字注入对话开头</span>
        </button>
        <div v-if="previewOpen" class="mp-body">
          <pre v-if="preview" class="mp-code">{{ preview }}</pre>
          <p v-else-if="!enabled" class="mp-null">记忆已停用，记忆内容不会注入对话。重新启用即恢复注入。</p>
          <p v-else class="mp-null">暂无记忆条目，暂无注入内容。</p>
        </div>
      </div>
    </template>

    <ConfirmModal
      :open="!!pendingDelete"
      title="删除这条记忆？"
      body="删除后 AI 将不再参考这条记忆，此操作不可撤销。"
      confirm-label="删除"
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </div>
</template>

<style scoped>
/* DEF-042（2026-08-23 CEO 上线后反馈）：以下三组 class 名复用自 SettingsForm，但
 * scoped 样式不跨组件边界——本组件内原先吃不到定义、回落浏览器默认 16px/400，
 * 整个分区比其他分区大一号（分区标题/开关行标签/提示）。此处显式对齐
 * SettingsForm 同名规则值（沿 UsagePane 自定义 pane-label 的先例）：
 * pane-label 14px/600、field-label 13px/500、field-hint 12px/text-3 */
.section-label.pane-label {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text-1);
}
.field-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text-2);
}
.field-hint {
  font-size: 12px;
  color: var(--c-text-3);
}
.mem-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mem-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--c-text-3);
}
/* 加载失败态（p-empty 家族：1px dashed + text-3） */
.mem-failed {
  padding: 16px;
  font-size: 13px;
  color: var(--c-text-3);
  text-align: center;
  border: 1px dashed var(--c-border);
  border-radius: 8px;
}
.mem-retry {
  display: flex;
  margin: 8px auto 0;
}
/* 停用开关行（tools-field 家族：padding 12 + border + r-md + subtle-bg 底） */
.mem-switch-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-subtle-bg);
}
.mem-switch-row .msr-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
/* 停用通知条（warning 族，语义非错误） */
.mem-off-banner {
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.7;
  background: var(--c-warning-l);
  color: var(--c-warning);
}
/* 列表 */
.mem-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mem-list.off {
  opacity: 0.45; /* 停用态灰显（定夺④），操作钮另 disabled */
}
.mem-list-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.mlh-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text-2);
}
.mlh-count {
  font-size: 12px;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}
/* 条目卡（profile-item 家族参数）：序号列 20px + 内容列 + 操作列 */
.mem-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-surface);
}
.mem-item.editing {
  border-color: var(--c-primary);
}
.mi-idx {
  flex: none;
  width: 20px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.mi-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mi-content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--c-text-1);
  white-space: pre-wrap;
  word-break: break-word;
}
.mi-meta {
  font-size: 12px;
  color: var(--c-text-3);
}
.mi-icon {
  flex: none;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--c-text-3);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
}
.mi-icon:hover:not(:disabled) {
  background: var(--c-hover-bg);
  color: var(--c-text-1);
}
.mi-icon-del:hover:not(:disabled) {
  background: var(--c-danger-l);
  color: var(--c-danger);
}
.mi-icon:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
/* 行内编辑（prompt-ta 家族收窄） */
.mi-edit {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mi-ta {
  width: 100%;
  min-height: 64px;
  max-height: 180px;
  resize: vertical;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.6;
  font-family: inherit;
  color: var(--c-text-1);
  background: var(--c-surface);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.mi-ta:focus {
  border-color: var(--c-primary);
  box-shadow: 3px 3px 0 var(--c-focus-ring);
}
.mi-edit-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mi-count {
  font-size: 12px;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}
.mi-count.over {
  color: var(--c-danger);
}
.mi-over {
  font-size: 12px;
  color: var(--c-danger);
}
.mi-edit-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
.mi-btn {
  height: 26px;
  padding: 0 12px;
  border: 1px solid var(--c-border);
  border-radius: 6px;
  background: transparent;
  color: var(--c-text-2);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}
.mi-btn:hover {
  border-color: var(--c-primary);
  color: var(--c-primary);
}
.mi-btn-save {
  border-color: var(--c-primary);
  background: var(--c-primary-solid);
  color: #fff;
}
.mi-btn-save:hover {
  background: var(--c-primary-solid-h);
  border-color: var(--c-primary-h);
  color: #fff;
}
.mi-btn-save:disabled {
  background: var(--c-disabled-bg);
  border-color: var(--c-disabled-bg);
  color: #fff;
  cursor: not-allowed;
}
/* 空态（p-empty 家族） */
.mem-empty {
  padding: 16px;
  border: 1px dashed var(--c-border);
  border-radius: 8px;
  text-align: center;
}
.me-title {
  font-size: 13px;
  color: var(--c-text-3);
}
.me-desc {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--c-text-3);
}
/* 注入预览（折叠；代码块族令牌） */
.mem-preview {
  border: 1px solid var(--c-border);
  border-radius: 8px;
  overflow: hidden;
}
.mp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;
}
.mp-head:hover {
  background: var(--c-hover-bg);
}
.mp-chev {
  flex: none;
  color: var(--c-text-3);
  transition: transform 0.15s ease;
}
.mp-chev.open {
  transform: rotate(180deg);
}
.mp-title {
  flex: none;
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text-1);
}
.mp-sub {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mp-body {
  border-top: 1px solid var(--c-border);
  padding: 12px;
}
.mp-code {
  margin: 0;
  max-height: 220px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--c-scrollbar) transparent;
  background: var(--c-code-bg);
  color: var(--c-code-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  border-radius: 6px;
  padding: 10px 12px;
}
.mp-null {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--c-text-3);
}
</style>
