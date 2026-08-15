<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useSettingsStore, type ApiProfile } from '../stores/settings'
import { useToastStore } from '../stores/toast'
import { useTheme } from '../composables/useTheme'
import ConfirmModal from './ConfirmModal.vue'

const settings = useSettingsStore()
const toast = useToastStore()

// REQ-017：设置页「外观」入口（与顶栏主题按钮同状态同存储）
const { theme, setTheme } = useTheme()

// ---- REQ-018 供应商档案：列表 + 添加/编辑模态 ----
const editing = ref(false)
const editingId = ref<string | null>(null) // 新增时为全新 id
const form = reactive<Partial<ApiProfile>>({})
const errors = ref<Partial<Record<keyof ApiProfile, string>>>({})
const confirmClear = ref(false)
const pendingDelete = ref<ApiProfile | null>(null)

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.random()}`

const profileFields: Array<{ key: keyof ApiProfile; label: string; placeholder: string; type?: string }> = [
  { key: 'name', label: '档案名称', placeholder: '如 DeepSeek、GLM' },
  { key: 'baseUrl', label: 'API 地址', placeholder: 'https://open.bigmodel.cn/api/paas/v4' },
  { key: 'model', label: '模型名', placeholder: 'glm-5.3' },
  { key: 'apiKey', label: 'API Key', placeholder: 'sk-…（仅保存在本机浏览器）', type: 'password' },
]

function hostOf(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname
  } catch {
    return '自定义'
  }
}

function openAdd() {
  editingId.value = newId()
  Object.assign(form, { name: '', baseUrl: '', model: '', apiKey: '' })
  errors.value = {}
  editing.value = true
}

function openEdit(p: ApiProfile) {
  editingId.value = p.id
  Object.assign(form, { ...p })
  errors.value = {}
  editing.value = true
}

function saveProfile() {
  if (!editingId.value) return
  errors.value = settings.saveProfile({
    id: editingId.value,
    name: form.name ?? '',
    baseUrl: form.baseUrl ?? '',
    model: form.model ?? '',
    apiKey: form.apiKey ?? '',
  })
  if (Object.keys(errors.value).length === 0) {
    editing.value = false
    toast.push('档案已保存')
  }
}

function confirmDelete() {
  if (pendingDelete.value && settings.removeProfile(pendingDelete.value.id)) toast.push('档案已删除')
  pendingDelete.value = null
}

function switchTo(p: ApiProfile) {
  settings.setActiveProfile(p.id)
  toast.push(`已切换到「${p.name}」，下一次请求生效`)
}

function clearKey() {
  settings.clearKey()
  confirmClear.value = false
  toast.push('密钥已清除，本地无残留')
}

// ---- REQ-008 系统提示词（对话设置，design-iter-2 触点一）----
const promptText = ref(settings.systemPrompt)
const promptSaved = ref(false)
let savedTimer: ReturnType<typeof setTimeout> | undefined
const promptCharCount = computed(() => promptText.value.trim().length)

function savePrompt() {
  settings.saveSystemPrompt(promptText.value) // 留空/仅空白 = 无提示词
  promptSaved.value = true
  clearTimeout(savedTimer)
  savedTimer = setTimeout(() => (promptSaved.value = false), 2000) // "已保存" 2s 淡出
}

function clearPrompt() {
  promptText.value = ''
  settings.saveSystemPrompt('') // 按留空即时保存，不弹确认（可重填，非不可逆）
  toast.push('已清除，后续对话将不使用系统提示词')
}
</script>

<template>
  <div class="settings">
    <header class="settings-header">
      <h2>设置</h2>
      <p class="hint">OpenAI 兼容接口，支持 DeepSeek、GLM 等供应商。密钥只保存在本机浏览器，不会上传到任何服务器。</p>
    </header>

    <!-- REQ-017 外观 · 主题切换（segmented，与顶栏入口同步） -->
    <div class="section-label">外观</div>
    <div class="theme-seg" role="radiogroup" aria-label="主题">
      <button
        type="button"
        class="seg-btn"
        :class="{ on: theme === 'light' }"
        role="radio"
        :aria-checked="theme === 'light'"
        @click="setTheme('light')"
      >
        浅色
      </button>
      <button
        type="button"
        class="seg-btn"
        :class="{ on: theme === 'dark' }"
        role="radio"
        :aria-checked="theme === 'dark'"
        @click="setTheme('dark')"
      >
        深色
      </button>
    </div>

    <!-- REQ-018 供应商档案：列表 + 当前生效标记 + 添加/编辑/删除 -->
    <div class="section-label">供应商档案</div>
    <div class="form">
      <div class="profile-list">
        <div
          v-for="p in settings.profiles"
          :key="p.id"
          class="profile-item"
          :class="{ current: p.id === settings.activeProfileId }"
        >
          <div class="p-info">
            <span class="p-name">{{ p.name }}</span>
            <span class="p-sub">{{ p.model }} · {{ hostOf(p.baseUrl) }}</span>
          </div>
          <span v-if="p.id === settings.activeProfileId" class="p-current">当前生效</span>
          <button v-else type="button" class="p-btn" @click="switchTo(p)">设为当前</button>
          <button type="button" class="p-icon" aria-label="编辑档案" title="编辑" @click="openEdit(p)">
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
              <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
            </svg>
          </button>
          <button
            type="button"
            class="p-icon"
            :disabled="p.id === settings.activeProfileId"
            :title="p.id === settings.activeProfileId ? '当前生效档案不可删除，请先切换到其他档案' : '删除'"
            aria-label="删除档案"
            @click="pendingDelete = p"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
              <path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm4 2v8h1.5v-8H10Zm3 0v8h1.5v-8H13Z" />
            </svg>
          </button>
        </div>
        <div v-if="settings.profiles.length === 0" class="p-empty">暂无档案，点击下方「添加档案」创建第一套供应商配置</div>
      </div>

      <div class="actions">
        <button type="button" class="btn" @click="openAdd">
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
            <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
          </svg>
          添加档案
        </button>
        <button
          v-if="settings.activeProfile?.apiKey"
          type="button"
          class="btn-text-danger"
          @click="confirmClear = true"
        >
          清除当前档案密钥
        </button>
      </div>

      <!-- REQ-008 对话设置 · 系统提示词（design-iter-2 触点一） -->
      <div class="section-label">对话设置</div>
      <label class="field" for="system-prompt">
        <span class="field-label">系统提示词<span class="optional">可选</span></span>
        <textarea
          id="system-prompt"
          v-model="promptText"
          class="prompt-ta"
          placeholder="定义 AI 的角色与回复风格，如：你是一个简洁的翻译助手，回复不超过三句话。&#10;留空则不使用系统提示词，按普通对话正常请求。"
        />
        <span class="char-count">{{ promptCharCount }} 字</span>
      </label>
      <div class="actions">
        <button type="button" class="btn btn-primary" @click="savePrompt">保存</button>
        <button v-if="settings.systemPrompt" type="button" class="btn-text-danger" @click="clearPrompt">清除</button>
        <span v-if="promptSaved" class="saved-flag">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          已保存
        </span>
      </div>
    </div>

    <!-- REQ-018 档案编辑/添加模态 -->
    <div v-if="editing" class="modal-mask" @click.self="editing = false">
      <div class="modal" role="dialog" aria-label="供应商档案">
        <h3 class="modal-title">{{ settings.profiles.some((p) => p.id === editingId) ? '编辑档案' : '添加档案' }}</h3>
        <label v-for="f in profileFields" :key="f.key" class="field">
          <span class="field-label">{{ f.label }}</span>
          <input
            v-model="form[f.key]!"
            :type="f.type ?? 'text'"
            :placeholder="f.placeholder"
            class="input"
            :class="{ invalid: errors[f.key] }"
            :aria-invalid="!!errors[f.key]"
          />
          <span v-if="errors[f.key]" class="field-error">{{ errors[f.key] }}</span>
        </label>
        <div class="actions">
          <button type="button" class="btn" @click="editing = false">取消</button>
          <button type="button" class="btn btn-primary" @click="saveProfile">保存</button>
        </div>
      </div>
    </div>

    <ConfirmModal
      :open="!!pendingDelete"
      title="删除这个档案？"
      :body="`「${pendingDelete?.name ?? ''}」的配置与密钥将一并删除（不影响其它档案与历史会话）。`"
      confirm-label="删除"
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />

    <ConfirmModal
      :open="confirmClear"
      title="清除 API 密钥？"
      body="清除后本地不再保留任何密钥残留，进行中的对话将无法调用 API，需要重新填写。"
      confirm-label="清除"
      @confirm="clearKey"
      @cancel="confirmClear = false"
    />
  </div>
</template>

<style scoped>
.settings {
  width: 560px;
  max-width: 100%;
  margin: 32px auto;
  padding: 0 24px;
}
.settings-header h2 {
  margin: 0 0 8px;
  font-size: 20px;
  color: var(--c-text-1);
}
.hint {
  margin: 0 0 24px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--c-text-3);
  background: var(--c-primary-l);
  border-radius: 8px;
  padding: 10px 12px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 20px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 12px;
  padding: 24px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text-2);
}
.input {
  height: 36px;
  border: 1px solid var(--c-border);
  border-radius: 6px;
  padding: 0 12px;
  font-size: 16px;
  color: var(--c-text-1);
  background: var(--c-surface);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.input:focus {
  border-color: var(--c-primary);
  box-shadow: 3px 3px 0 var(--c-focus-ring);
}
.input.invalid {
  border-color: var(--c-danger);
}
.field-error {
  font-size: 12px;
  color: var(--c-danger);
}
/* REQ-008 对话设置分组（design-iter-2：分组线 + 标签） */
.section-label {
  margin-top: 4px;
  padding-top: 20px;
  border-top: 1px solid var(--c-border);
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text-1);
}
.optional {
  font-size: 12px;
  font-weight: 400;
  color: var(--c-text-3);
  margin-left: 6px;
}
.prompt-ta {
  width: 100%;
  min-height: 96px;
  max-height: 240px;
  resize: vertical;
  overflow-y: auto;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 16px;
  line-height: 1.6;
  font-family: inherit;
  color: var(--c-text-1);
  background: var(--c-surface);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.prompt-ta:focus {
  border-color: var(--c-primary);
  box-shadow: 3px 3px 0 var(--c-focus-ring);
}
.prompt-ta::placeholder {
  font-size: 14px;
  color: var(--c-text-3);
}
.char-count {
  font-size: 12px;
  color: var(--c-text-3);
  text-align: right;
}
.btn-text-danger {
  height: 36px;
  padding: 0 12px;
  border: none;
  background: transparent;
  color: var(--c-danger);
  font-size: 13px;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.15s ease;
}
.btn-text-danger:hover {
  background: var(--c-danger-l);
}
.saved-flag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--c-success);
}
.actions {
  display: flex;
  gap: 8px;
}
.btn {
  height: 36px;
  padding: 0 20px;
  border-radius: 6px;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-text-1);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn:hover {
  background: var(--c-hover-bg);
}
.btn:active {
  transform: scale(0.97);
}
.btn:disabled {
  background: var(--c-disabled-bg);
  border-color: var(--c-disabled-bg);
  color: #fff;
  cursor: not-allowed;
}
.btn-primary {
  border-color: var(--c-primary);
  background: var(--c-primary-solid);
  color: #fff;
}
.btn-primary:hover {
  background: var(--c-primary-solid-h);
  border-color: var(--c-primary-h);
}
</style>

/* REQ-017 外观 segmented（design-iter-5 触点一） */
.theme-seg {
  display: inline-flex;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 8px;
}
.seg-btn {
  height: 32px;
  padding: 0 16px;
  border: none;
  background: transparent;
  color: var(--c-text-2);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.seg-btn.on {
  background: var(--c-primary-l);
  color: var(--c-primary);
  font-weight: 500;
}
/* REQ-018 供应商档案列表 + 编辑模态（design-iter-5 触点三） */
.profile-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 4px;
}
.profile-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-surface);
}
.profile-item.current {
  border-color: var(--c-primary);
  background: var(--c-primary-l);
}
.p-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.p-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.p-sub {
  font-size: 12px;
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.p-current {
  flex: none;
  font-size: 12px;
  color: var(--c-primary);
  font-weight: 500;
}
.p-btn {
  flex: none;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--c-border);
  border-radius: 6px;
  background: transparent;
  color: var(--c-text-2);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}
.p-btn:hover {
  border-color: var(--c-primary);
  color: var(--c-primary);
}
.p-icon {
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
.p-icon:hover:not(:disabled) {
  background: var(--c-hover-bg);
  color: var(--c-text-1);
}
.p-icon:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.p-empty {
  padding: 16px;
  font-size: 13px;
  color: var(--c-text-3);
  text-align: center;
  border: 1px dashed var(--c-border);
  border-radius: 8px;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: var(--c-mask);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  width: 420px;
  max-width: calc(100vw - 48px);
  background: var(--c-surface);
  border-radius: 12px;
  box-shadow: var(--shadow-3);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.modal-title {
  margin: 0;
  font-size: 16px;
  color: var(--c-text-1);
}
