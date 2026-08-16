<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * REQ-021 注销账号强确认模态（design-iter-9 §3.1）：
 * 密码二次确认（label「输入登录密码确认」+ 显隐）+ 生成中警告条 + 危险实底「永久注销账号」。
 * 密码为空 disabled；密码不匹配由父级回填 error 行内展示；取消 / Esc / 遮罩点击关闭不改动。
 */
const props = defineProps<{
  open: boolean
  username: string
  generating: boolean
  submitting: boolean
  error: string | null
}>()

const emit = defineEmits<{ confirm: [password: string]; cancel: [] }>()

const password = ref('')
const showPassword = ref(false)

watch(
  () => props.open,
  (v) => {
    if (v) {
      password.value = ''
      showPassword.value = false
    }
  },
)

function onKey(e: KeyboardEvent) {
  if (props.open && e.key === 'Escape' && !props.submitting) emit('cancel')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function submit() {
  if (!password.value.trim() || props.submitting) return
  emit('confirm', password.value.trim())
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="overlay" @click.self="!submitting && emit('cancel')">
        <div class="modal" role="alertdialog" aria-label="注销账号">
          <h3 class="modal-title">注销账号？</h3>
          <p class="modal-body">
            将删除账号「<b class="strong">{{ username }}</b
            >」与<b>全部云端数据</b>（会话、供应商档案、密钥等）。此操作<b>不可恢复</b>，删除后无法找回。
          </p>

          <!-- 生成中分支（REQ-021 异常分支）：注销前自动终止生成 -->
          <div v-if="generating" class="gen-warn">
            <span class="b-ico">!</span>
            <span>当前有正在生成的回复，注销前将<b>自动终止生成</b>，随后继续注销流程。</span>
          </div>

          <label class="field">
            <span class="field-label">输入登录密码确认<span class="req">*</span></span>
            <span class="field-input-wrap">
              <input
                v-model="password"
                class="field-input"
                :class="{ invalid: !!error }"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                placeholder="输入当前登录密码"
                :disabled="submitting"
                @keydown.enter.prevent="submit"
              />
              <button
                class="eye-btn"
                type="button"
                :title="showPassword ? '隐藏密码' : '显示密码'"
                :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                @click="showPassword = !showPassword"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path
                    v-if="showPassword"
                    fill="currentColor"
                    d="M12 5c5 0 9 4.5 9 7s-4 7-9 7-9-4.5-9-7 4-7 9-7Zm0 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-2a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"
                  />
                  <path
                    v-else
                    fill="currentColor"
                    d="M2.2 4.3 4.3 2.2l17.5 17.5-2.1 2.1-3.1-3.1A10 10 0 0 1 12 19c-5 0-9-4.5-9-7 0-1.2.8-2.7 2.2-4.1L2.2 4.3ZM12 7.1 16.9 12a4.9 4.9 0 0 0-6.9-6.9L7.6 3.7A10.6 10.6 0 0 1 12 3c5 0 9 4.5 9 7 0 .9-.5 2-1.4 3.2L12 5.6v1.5Z"
                  />
                </svg>
              </button>
            </span>
            <p v-if="error" class="field-error" role="alert">{{ error }}</p>
          </label>

          <div class="modal-actions">
            <button class="btn" type="button" :disabled="submitting" @click="emit('cancel')">取消</button>
            <button
              class="btn btn-danger"
              type="button"
              :disabled="!password.trim() || submitting"
              @click="submit"
            >
              {{ submitting ? '注销中…' : '永久注销账号' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: var(--c-mask);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 150;
}
.modal {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 12px;
  box-shadow: var(--shadow-3);
  width: 420px;
  max-width: calc(100vw - 32px);
  padding: 24px;
}
.modal-title {
  margin: 0 0 8px;
  font-size: 17px;
  font-weight: 600;
  color: var(--c-text-1);
}
.modal-body {
  margin: 0 0 12px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--c-text-2);
}
.strong {
  color: var(--c-text-1);
}
/* 生成中警告条（warning-l/warning 组合，design-iter-9 §3.1） */
.gen-warn {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.7;
  background: var(--c-warning-l);
  color: var(--c-warning);
  margin-bottom: 12px;
}
.b-ico {
  flex: none;
  font-weight: 600;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}
.field-label {
  font-size: 13px;
  color: var(--c-text-2);
}
.req {
  color: var(--c-danger);
  margin-left: 2px;
}
.field-input-wrap {
  position: relative;
  display: block;
}
.field-input {
  width: 100%;
  box-sizing: border-box;
  height: 36px;
  padding: 0 44px 0 12px;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-surface);
  color: var(--c-text-1);
  font-size: 16px;
}
.field-input.invalid {
  border-color: var(--c-danger);
}
.field-input:focus {
  outline: none;
  border-color: var(--c-primary);
  box-shadow: 0 0 0 3px var(--c-focus-ring);
}
.field-input:disabled {
  background: var(--c-subtle-bg);
  color: var(--c-text-3);
}
.field-error {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--c-danger);
}
.eye-btn {
  position: absolute;
  top: 0;
  right: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: var(--c-text-3);
  cursor: pointer;
  border-radius: 0 8px 8px 0;
}
.eye-btn:hover {
  color: var(--c-text-1);
  background: var(--c-hover-bg);
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.btn {
  height: 32px;
  padding: 0 16px;
  border-radius: 6px;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-text-1);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn:hover:not(:disabled) {
  background: var(--c-hover-bg);
}
.btn:active:not(:disabled) {
  transform: scale(0.96);
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-danger {
  border-color: var(--c-danger-solid);
  background: var(--c-danger-solid);
  color: #fff;
  font-weight: 600;
}
.btn-danger:hover:not(:disabled) {
  background: var(--c-danger-solid-h);
  border-color: var(--c-danger-solid-h);
}
.btn-danger:disabled {
  background: var(--c-disabled-bg);
  border-color: var(--c-disabled-bg);
  opacity: 1;
}
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}
.modal-enter-active .modal,
.modal-leave-active .modal {
  transition: transform 0.18s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .modal {
  transform: scale(0.96);
}
</style>
