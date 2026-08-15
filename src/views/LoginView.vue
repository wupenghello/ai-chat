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

      <!-- 表单级提示条（form-banner，既有 danger/warning 令牌组合） -->
      <p v-if="banner" class="form-banner" :class="banner.kind" role="alert">{{ banner.text }}</p>

      <form novalidate @submit.prevent="submit">
        <label class="field">
          <span class="field-label">用户名</span>
          <input
            v-model="username"
            class="field-input"
            type="text"
            name="username"
            autocomplete="username"
            spellcheck="false"
            :disabled="loading"
            placeholder="2~32 字符，中文、字母、数字、_、-"
          />
        </label>

        <label class="field">
          <span class="field-label">密码</span>
          <span class="field-input-wrap">
            <input
              v-model="password"
              class="field-input"
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
        </label>

        <label v-if="mode === 'register'" class="field">
          <span class="field-label">确认密码</span>
          <input
            v-model="confirm"
            class="field-input"
            type="password"
            name="confirm-password"
            autocomplete="new-password"
            :disabled="loading"
            placeholder="再输入一次"
          />
        </label>

        <button class="submit-btn" type="submit" :disabled="loading">
          {{ loading ? '请稍候…' : mode === 'login' ? '登录' : '注册并进入' }}
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
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BrandMark from '../components/BrandMark.vue'
import { useTheme } from '../composables/useTheme'
import { useAuthStore } from '../stores/auth'
import { ApiBackendError } from '../api/backend'

/**
 * REQ-020 登录/注册页（design-iter-6 基线）：
 * 登录失败统一「用户名或密码错误」（danger）；过期/封禁为状态类（warning）；
 * 前端校验与后端同口径（用户名 2~32 / 中文A-Za-z0-9_-、密码 ≥8、两次一致）。
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
const loading = ref(false)
const banner = ref<{ kind: 'danger' | 'warning'; text: string } | null>(null)

function switchMode() {
  mode.value = mode.value === 'login' ? 'register' : 'login'
  banner.value = null
}

function fail(kind: 'danger' | 'warning', text: string) {
  banner.value = { kind, text }
}

/** 仅允许站内路径，防 open redirect（design-iter-6 §4.1） */
function redirectTarget(): string {
  const r = route.query.redirect
  return typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? r : '/'
}

async function submit() {
  banner.value = null
  // —— 前端校验（与后端同口径；注册页三项，登录页只查空值）——
  if (!username.value || !password.value) {
    fail('danger', '请输入用户名和密码')
    return
  }
  if (mode.value === 'register') {
    if (!USERNAME_RE.test(username.value)) {
      fail('danger', '用户名需为 2~32 字符，仅限中文、字母、数字、下划线、连字符')
      return
    }
    if (password.value.length < 8) {
      fail('danger', '密码最短 8 位')
      return
    }
    if (password.value !== confirm.value) {
      fail('danger', '两次输入的密码不一致')
      return
    }
  }
  loading.value = true
  try {
    if (mode.value === 'login') await auth.login(username.value, password.value)
    else await auth.register(username.value, password.value)
    // 登录成功：无 toast，直接进主界面（design-iter-6 定案 4）
    await router.push(redirectTarget())
  } catch (err) {
    if (err instanceof ApiBackendError) {
      // 拒绝类（401/409/422）= danger；状态类（403 封禁/401 过期）= warning
      const kind = err.status === 403 || (err.status === 401 && mode.value === 'login' && err.message.includes('过期'))
        ? 'warning'
        : 'danger'
      fail(kind, err.message)
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
.field-input:focus {
  outline: none;
  border-color: var(--c-primary);
  box-shadow: 0 0 0 3px var(--c-focus-ring);
}
.field-input:disabled {
  background: var(--c-subtle-bg);
  color: var(--c-text-3);
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

/* ≤480px 移动适配（design-iter-6 定案 3：仅登录/注册页正式承诺） */
@media (max-width: 480px) {
  .auth-card {
    padding: 24px 20px;
    box-shadow: var(--shadow-1);
  }
}
</style>
