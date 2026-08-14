<script setup lang="ts">
import { reactive, ref } from 'vue'
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
