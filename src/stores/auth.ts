import { defineStore } from 'pinia'
import { ref } from 'vue'
import { backend, setUnauthorizedHandler, type AuthUser } from '../api/backend'

/**
 * REQ-020 登录态：auth.user 非空即已登录；checked 标记启动探测已完成（路由守卫用）。
 * token 在 HttpOnly Cookie 中，前端不持有、不管理。
 */
export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const checked = ref(false)

  /** 应用启动/刷新时探测登录态（「刷新页面仍保持登录态」验收的机制） */
  async function boot() {
    try {
      user.value = await backend.me()
    } catch {
      user.value = null
    } finally {
      checked.value = true
    }
  }

  /** 任意请求 401：登录态失效（REQ-006 异常分支——跳转由入口注册的 handler 完成） */
  function invalidate() {
    user.value = null
  }

  async function login(username: string, password: string) {
    user.value = await backend.login(username, password)
  }

  async function register(username: string, password: string) {
    // REQ-020 主流程：注册成功直接登录
    user.value = await backend.register(username, password)
  }

  async function logout() {
    try {
      await backend.logout()
    } catch {
      // 后端不可达也必须完成本地清理与跳转（登出为用户主动的非关键操作）
    } finally {
      user.value = null
    }
  }

  return { user, checked, boot, invalidate, login, register, logout }
})

/** 供应用入口注册 401 跳转（store 不 import router，避免视图组件循环依赖） */
export function wireUnauthorizedRedirect(redirect: () => void) {
  setUnauthorizedHandler(redirect)
}
