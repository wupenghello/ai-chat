<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useSettingsStore, type ApiConfig } from '../stores/settings'
import { useToastStore } from '../stores/toast'
import ConfirmModal from './ConfirmModal.vue'

const settings = useSettingsStore()
const toast = useToastStore()

const form = reactive<Partial<ApiConfig>>({
  baseUrl: settings.config.baseUrl ?? '',
  model: settings.config.model ?? '',
  apiKey: settings.config.apiKey ?? '',
})

const errors = ref<Partial<Record<keyof ApiConfig, string>>>({})
const confirmClear = ref(false)

function save() {
  errors.value = settings.save({
    baseUrl: form.baseUrl ?? '',
    model: form.model ?? '',
    apiKey: form.apiKey ?? '',
  })
  if (Object.keys(errors.value).length === 0) {
    toast.push('配置已保存')
  }
}

function clearKey() {
  settings.clearKey()
  form.apiKey = ''
  confirmClear.value = false
  toast.push('密钥已清除，本地无残留')
}

const fields: Array<{ key: keyof ApiConfig; label: string; placeholder: string; type?: string }> = [
  { key: 'baseUrl', label: 'API 地址', placeholder: 'https://open.bigmodel.cn/api/paas/v4' },
  { key: 'model', label: '模型名', placeholder: 'glm-5.3' },
  { key: 'apiKey', label: 'API Key', placeholder: 'sk-…（仅保存在本机浏览器）', type: 'password' },
]

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

    <form class="form" novalidate @submit.prevent="save">
      <label v-for="f in fields" :key="f.key" class="field">
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
        <button type="submit" class="btn btn-primary">保存</button>
        <button
          v-if="settings.config.apiKey"
          type="button"
          class="btn"
          @click="confirmClear = true"
        >
          清除密钥
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
    </form>

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
  box-shadow: 3px 3px 0 rgba(51, 112, 255, 0.12);
}
.input.invalid {
  border-color: var(--c-error);
}
.field-error {
  font-size: 12px;
  color: var(--c-error);
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
  box-shadow: 3px 3px 0 rgba(51, 112, 255, 0.12);
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
  color: var(--c-error);
  font-size: 13px;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.15s ease;
}
.btn-text-danger:hover {
  background: #fdecea;
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
  background: #f2f3f5;
}
.btn:active {
  transform: scale(0.97);
}
.btn:disabled {
  background: #c9cfdb;
  border-color: #c9cfdb;
  color: #fff;
  cursor: not-allowed;
}
.btn-primary {
  border-color: var(--c-primary);
  background: var(--c-primary);
  color: #fff;
}
.btn-primary:hover {
  background: var(--c-primary-h);
  border-color: var(--c-primary-h);
}
</style>
