<template>
  <div class="auth-page">
    <button
      class="theme-btn"
      type="button"
      :title="theme === 'dark' ? '切换到浅色' : '切换到深色'"
      :aria-label="theme === 'dark' ? '切换到浅色' : '切换到深色'"
      @click="toggleTheme"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          v-if="theme === 'dark'"
          fill="currentColor"
          d="M12 5a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V6a1 1 0 0 1 1-1Zm0 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1Zm7-5a1 1 0 0 1-1 1h-1a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1ZM7 12a1 1 0 0 1-1 1H5a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1Zm10.07-6.07a1 1 0 0 1 0 1.41l-.7.71a1 1 0 1 1-1.42-1.42l.71-.7a1 1 0 0 1 1.41 0ZM9.05 15.95a1 1 0 0 1 0 1.41l-.71.71a1 1 0 1 1-1.41-1.42l.7-.7a1 1 0 0 1 1.42 0Zm8.02 2.12a1 1 0 0 1-1.41 0l-.71-.71a1 1 0 0 1 1.42-1.41l.7.7a1 1 0 0 1 0 1.42ZM9.05 8.05a1 1 0 0 1-1.42 0l-.7-.71a1 1 0 0 1 1.41-1.41l.71.7a1 1 0 0 1 0 1.42Z"
        />
        <path
          v-else
          fill="currentColor"
          d="M20.3 14.2a8.5 8.5 0 0 1-10.5-10.5 8.5 8.5 0 1 0 10.5 10.5Zm-1.7 1.1A6.5 6.5 0 0 1 8.7 5.9a6.5 6.5 0 1 0 9.9 9.4Z"
        />
      </svg>
    </button>

    <div class="auth-card">
      <div class="brand">
        <BrandMark />
        <h1 class="brand-title">喵喵 ai-chat</h1>
      </div>

      <!-- 表单级提示条：仅提交级/状态类（密码错误统一文案、过期、封禁、网络）；
           字段级错误（空值/规则/已占用）走 field-error 行内（design-iter-6 §3 映射表） -->
      <p v-if="banner" class="form-banner" :class="banner.kind" role="alert">
        {{ banner.text }}
        <button v-if="banner.retry" class="banner-retry" type="button" @click="submit">重试</button>
      </p>

      <form novalidate @submit.prevent="submit">
        <label class="field">
          <span class="field-label">用户名</span>
          <input
            v-model="username"
            class="field-input"
                :class="{ invalid: fieldErrors.username }"
            type="text"
            name="username"
            autocomplete="username"
            spellcheck="false"
            :disabled="loading"
            placeholder="2~32 字符，中文、字母、数字、_、-"
          />
          <p v-if="fieldErrors.username" class="field-error">{{ fieldErrors.username }}</p>
        </label>

        <label class="field">
          <span class="field-label">密码</span>
          <span class="field-input-wrap">
            <input
              v-model="password"
              class="field-input"
              :class="{ invalid: fieldErrors.password }"
              :type="showPassword ? 'text' : 'password'"
              name="password"
              :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
              :disabled="loading"
              :placeholder="mode === 'login' ? '' : '最短 8 位'"
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
          <p v-if="fieldErrors.password" class="field-error">{{ fieldErrors.password }}</p>
        </label>

        <label v-if="mode === 'register'" class="field">
          <span class="field-label">确认密码</span>
          <span class="field-input-wrap">
            <input
              v-model="confirm"
              class="field-input"
              :class="{ invalid: fieldErrors.confirm }"
              :type="showConfirm ? 'text' : 'password'"
              name="confirm-password"
              autocomplete="new-password"
              :disabled="loading"
              placeholder="再输入一次"
            />
            <button
              class="eye-btn"
              type="button"
              :title="showConfirm ? '隐藏密码' : '显示密码'"
              :aria-label="showConfirm ? '隐藏密码' : '显示密码'"
              @click="showConfirm = !showConfirm"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path
                  v-if="showConfirm"
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
          <p v-if="fieldErrors.confirm" class="field-error">{{ fieldErrors.confirm }}</p>
        </label>

        <!-- 加载态：保持实底主色 + spinner（design-iter-6 §1.3） -->
        <button class="submit-btn" :class="{ loading }" type="submit" :disabled="loading">
          <span v-if="loading" class="spinner" aria-hidden="true" />
          {{ loading ? (mode === 'login' ? '登录中…' : '注册中…') : mode === 'login' ? '登录' : '注册并进入' }}
        </button>
      </form>

      <p class="switch-line">
        {{ mode === 'login' ? '还没有账号？' : '已有账号？' }}
        <button class="switch-btn" type="button" :disabled="loading" @click="switchMode">
          {{ mode === 'login' ? '注册一个' : '去登录' }}
        </button>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BrandMark from '../components/BrandMark.vue'
import { useTheme } from '../composables/useTheme'
import { useAuthStore } from '../stores/auth'
import { ApiBackendError } from '../api/backend'

/**
 * REQ-020 登录/注册页（design-iter-6 基线）：
 * 字段级错误（空值/规则/已占用）行内提示；提交级/状态类（统一登录失败、过期、封禁、
 * 网络）走表单 banner——拒绝类红、状态类琥珀（§3 映射表）。
 * 前端校验与后端同口径（用户名 2~32 / 中文A-Za-z0-9_-、密码 ≥8 ≤128、两次一致）。
 */
const USERNAME_RE = /^[A-Za-z0-9_\-一-鿿]{2,32}$/

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { theme, toggleTheme } = useTheme()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const confirm = ref('')
const showPassword = ref(false)
const showConfirm = ref(false)
const loading = ref(false)
const banner = ref<{ kind: 'danger' | 'warning'; text: string; retry?: boolean } | null>(null)
const fieldErrors = ref<{ username?: string; password?: string; confirm?: string }>({})

/** 401 失效跳转到达（main.ts 携带 expired=1）→ 显示「登录已过期」（design §4.1 闭环） */
onMounted(() => {
  if (route.query.expired === '1') {
    banner.value = { kind: 'warning', text: '登录已过期，请重新登录' }
    void router.replace({ query: { ...route.query, expired: undefined } })
  }
})

function switchMode() {
  mode.value = mode.value === 'login' ? 'register' : 'login'
  banner.value = null
  fieldErrors.value = {}
}

function fail(kind: 'danger' | 'warning', text: string, retry = false) {
  banner.value = { kind, text, retry }
}

/** 后端 422 规则错误按关键词归位到字段行内 */
function fieldFail(field: 'username' | 'password' | 'confirm', text: string) {
  fieldErrors.value = { ...fieldErrors.value, [field]: text }
}

/** 仅允许站内路径，防 open redirect（design-iter-6 §4.1） */
function redirectTarget(): string {
  const r = route.query.redirect
  return typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? r : '/'
}

function clientValidate(): boolean {
  fieldErrors.value = {}
  if (!username.value) fieldFail('username', '请输入用户名')
  if (!password.value) fieldFail('password', '请输入密码')
  if (fieldErrors.value.username || fieldErrors.value.password) return false
  if (mode.value === 'register') {
    if (!USERNAME_RE.test(username.value)) {
      fieldFail('username', '用户名需为 2~32 字符，仅限中文、字母、数字、下划线、连字符')
      return false
    }
    if (password.value.length < 8) {
      fieldFail('password', '密码最短 8 位')
      return false
    }
    if (password.value !== confirm.value) {
      fieldFail('confirm', '两次输入的密码不一致')
      return false
    }
  }
  return true
}

async function submit() {
  banner.value = null
  if (!clientValidate()) return
  loading.value = true
  try {
    if (mode.value === 'login') await auth.login(username.value, password.value)
    else await auth.register(username.value, password.value)
    // 登录成功：无 toast，直接进主界面（design-iter-6 定案 4）
    await router.push(redirectTarget())
  } catch (err) {
    if (err instanceof ApiBackendError) {
      if (err.status === 409) {
        fieldFail('username', err.message) // 用户名已存在 → 字段行内（§3 映射表）
      } else if (err.status === 422) {
        if (err.message.includes('用户名')) fieldFail('username', err.message)
        else if (err.message.includes('密码')) fieldFail('password', err.message)
        else fail('danger', err.message)
      } else if (err.status === 0 || err.status >= 500) {
        // 网络/5xx → danger + 内嵌重试（design §1.2/清单 5；经代理时后端不可达表现为 500）
        fail('danger', err.status === 0 ? '网络错误，请检查网络后重试' : '服务暂时不可用，请重试', true)
      } else {
        // 拒绝类（401 凭证错误）= danger；状态类（403 封禁 / 401 过期）= warning
        const kind =
          err.status === 403 || (err.status === 401 && err.message.includes('过期')) ? 'warning' : 'danger'
        fail(kind, err.message)
      }
    } else {
      fail('danger', '出错了，请重试')
    }
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--c-bg);
  padding: 24px;
  position: relative;
}
.theme-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: none;
  color: var(--c-text-2);
  cursor: pointer;
}
.theme-btn:hover {
  background: var(--c-hover-bg);
  color: var(--c-text-1);
}
.auth-card {
  width: 100%;
  max-width: 360px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 12px;
  box-shadow: var(--shadow-2);
  padding: 32px 28px;
}
.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
}
.brand-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--c-text-1);
}
.form-banner {
  margin: 0 0 12px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;
}
.form-banner.danger {
  background: var(--c-danger-l);
  color: var(--c-danger);
}
.form-banner.warning {
  background: var(--c-warning-l);
  color: var(--c-warning);
}
.banner-retry {
  border: none;
  background: none;
  padding: 0 0 0 4px;
  margin-left: 4px;
  font-size: 13px;
  color: inherit;
  text-decoration: underline;
  cursor: pointer;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}
.field-label {
  font-size: 13px;
  color: var(--c-text-2);
}
.field-input-wrap {
  position: relative;
  display: block;
}
.field-input {
  width: 100%;
  box-sizing: border-box;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-surface);
  color: var(--c-text-1);
  font-size: 14px;
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
.submit-btn {
  width: 100%;
  height: 38px;
  margin-top: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  border-radius: 8px;
  background: var(--c-primary-solid);
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}
.submit-btn:hover:not(:disabled) {
  background: var(--c-primary-solid-h);
}
.submit-btn:disabled {
  background: var(--c-disabled-bg);
  cursor: not-allowed;
}
/* 加载态：保持实底主色 + spinner，不退灰（design-iter-6 §1.3） */
.submit-btn.loading {
  background: var(--c-primary-solid);
  cursor: wait;
}
.spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.switch-line {
  margin: 16px 0 0;
  text-align: center;
  font-size: 13px;
  color: var(--c-text-2);
}
.switch-btn {
  border: none;
  background: none;
  padding: 0;
  color: var(--c-primary);
  font-size: 13px;
  cursor: pointer;
}
.switch-btn:hover {
  color: var(--c-primary-h);
}

/* ≤480px 移动适配（design-iter-6 定案 3 + §6.1 触控口径：输入 16px 防 iOS 聚焦缩放） */
@media (max-width: 480px) {
  .auth-card {
    padding: 24px 20px;
    box-shadow: var(--shadow-1);
  }
  .field-input {
    font-size: 16px;
  }
}
</style>
