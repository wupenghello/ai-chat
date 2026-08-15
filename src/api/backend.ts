/**
 * 后端（backend/）API 封装 —— REQ-020/022 走此模块。
 *
 * 同源部署：dev 由 Vite proxy 转发 /api → localhost:8000，生产由反代转发；
 * 会话凭证为 HttpOnly Cookie（2026-08-15 CEO 定案），前端零 token 管理。
 * 任何请求收到 401 → 通知 auth store 失效并跳登录（REQ-006/020）。
 */

export class ApiBackendError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/** 401 时的统一跳转钩子，由应用入口注册（stores/auth 不直接 import router，避免循环依赖） */
let onUnauthorized: (() => void) | null = null

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

/** 从 FastAPI 错误体提取人话文案：{detail: string} 或 pydantic 422 的 [{msg}] */
function extractMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail) && detail.length > 0) {
      const msg = (detail[0] as { msg?: string })?.msg ?? ''
      return msg.replace(/^Value error,\s*/, '') || fallback
    }
  }
  return fallback
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiBackendError(0, '网络错误，请检查网络后重试')
  }
  if (res.status === 401) {
    onUnauthorized?.()
    throw new ApiBackendError(401, extractMessage(await res.json().catch(() => null), '登录已过期，请重新登录'))
  }
  if (!res.ok) {
    throw new ApiBackendError(res.status, extractMessage(await res.json().catch(() => null), `请求失败（${res.status}）`))
  }
  return (await res.json()) as T
}

export interface AuthUser {
  id: number
  username: string
}

export const backend = {
  register: (username: string, password: string) =>
    request<AuthUser>('POST', '/api/auth/register', { username, password }),
  login: (username: string, password: string) =>
    request<AuthUser>('POST', '/api/auth/login', { username, password }),
  logout: () => request<{ detail: string }>('POST', '/api/auth/logout'),
  me: () => request<AuthUser>('GET', '/api/auth/me'),
}
