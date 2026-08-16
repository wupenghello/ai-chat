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

/** 401 失效通知：流式端点（client.ts streamChatViaProxy）复用同一钩子（REQ-023） */
export function notifyUnauthorized(): void {
  onUnauthorized?.()
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

/** 在线被封禁标记（design-iter-8 §1.5 走查 29）：403 banned 时写入，LoginView 读取后清除断横幅 */
const BANNED_FLAG = 'ai-chat-banned'

export function markBanned(): void {
  try {
    sessionStorage.setItem(BANNED_FLAG, '1')
  } catch {
    /* 隐私模式：仅完成跳转 */
  }
}

/** 通用请求（backend API 各模块复用；401 统一走失效跳转） */
export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
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
    const raw = await res.json().catch(() => null)
    // REQ-025（走查 29）：在线被封禁——下一次请求即失效登录态并跳登录页（横幅由 LoginView 补显）
    if (res.status === 403 && extractMessage(raw, '') === '账号已被封禁') {
      markBanned()
      onUnauthorized?.()
    }
    throw new ApiBackendError(res.status, extractMessage(raw, `请求失败（${res.status}）`))
  }
  return (await res.json()) as T
}

/** LoginView 用：读取并清除封禁标记（在线被封禁到达登录页时补显横幅） */
export function takeBannedFlag(): boolean {
  try {
    if (sessionStorage.getItem(BANNED_FLAG) === '1') {
      sessionStorage.removeItem(BANNED_FLAG)
      return true
    }
  } catch {
    /* 隐私模式 */
  }
  return false
}

export interface AuthUser {
  id: number
  username: string
  /** REQ-025（iter-8 T2）：首个注册用户为管理员；/admin 入口与后台接口门禁依据 */
  is_admin?: boolean
}

/** REQ-024/014（iter-8）：当前用户配额口径（KeyModeCard 参数化，design-iter-7 走查 2 兑现） */
export interface QuotaStatus {
  mode: 'unified' | 'self'
  daily_limit: number
  used_today: number
  reset_at: string
}

/** REQ-025（iter-8 T2）：管理后台——用户列表行（design-iter-8 §1.2 六列） */
export interface AdminUserRow {
  id: number
  username: string
  is_admin: boolean
  banned: boolean
  created_at: string
  mode: 'unified' | 'self'
  quota_override: number | null
  daily_limit: number
  used_today: number
}

/** REQ-025（iter-8 T2）：按用户按日用量行（mode 合并聚合，design-iter-8 §1.4 四列） */
export interface AdminUsageRow {
  day: string
  user_id: number
  username: string
  requests: number
  tokens: number
}

/** REQ-025（iter-8 T2）：全站配额条数据 + REQ-029（iter-12 T1）统计卡三指标（design-iter-12 §4.3，定夺④） */
export interface AdminOverview {
  day: string
  unified_used: number
  unified_daily_total: number
  /** 总用户数（含已封禁与管理员）；今日 = 服务器本地自然日、全模式合计；无记录 = 0 不估算 */
  total_users: number
  today_requests: number
  today_tokens: number
}

/** REQ-029（iter-12 T1）：用户列表分页信封（design-iter-12 §4.1，定夺①——传参才返回） */
export interface AdminUsersPage {
  items: AdminUserRow[]
  total: number
  limit: number
  offset: number
}

/** REQ-029（iter-12 T1）：用量列表分页信封（§4.2——distinct_days 为缺失时段全窗口判定数据源） */
export interface AdminUsagePage {
  items: AdminUsageRow[]
  total: number
  limit: number
  offset: number
  distinct_days: number
}

/** 服务端供应商档案视图（REQ-018 iter-7 T2）：key 只有掩码，明文绝不下发前端 */
export interface ServerProfile {
  id: string
  name: string
  base_url: string
  model: string
  api_key_masked: string
  is_active: boolean
}

export interface ProfilePayload {
  name: string
  base_url: string
  model: string
  api_key: string
}

export const backend = {
  register: (username: string, password: string) =>
    request<AuthUser>('POST', '/api/auth/register', { username, password }),
  login: (username: string, password: string) =>
    request<AuthUser>('POST', '/api/auth/login', { username, password }),
  logout: () => request<{ detail: string }>('POST', '/api/auth/logout'),
  me: () => request<AuthUser>('GET', '/api/auth/me'),
  // REQ-021（iter-9 T1 后端）：改密（验证旧密码，更新后其他设备 token 失效）+ 注销（密码二次确认，级联删除）
  changePassword: (old_password: string, new_password: string) =>
    request<{ detail: string }>('POST', '/api/auth/change-password', { old_password, new_password }),
  deleteAccount: (password: string) =>
    request<{ detail: string }>('POST', '/api/auth/delete-account', { password }),
  // REQ-018（iter-7 T2）：档案 CRUD + 模式切换（设为当前/回退统一密钥）
  listProfiles: () => request<ServerProfile[]>('GET', '/api/profiles'),
  createProfile: (p: ProfilePayload) => request<ServerProfile>('POST', '/api/profiles', p),
  updateProfile: (id: string, p: ProfilePayload) =>
    request<ServerProfile>('PUT', `/api/profiles/${id}`, p),
  deleteProfile: (id: string) => request<{ detail: string }>('DELETE', `/api/profiles/${id}`),
  activateProfile: (id: string) =>
    request<{ detail: string }>('POST', `/api/profiles/${id}/activate`),
  clearActiveProfile: () => request<{ detail: string }>('DELETE', '/api/profiles/active'),
  // REQ-024/014（iter-8 T1 后端、T2 前端接入）：当前用户配额口径
  getQuota: () => request<QuotaStatus>('GET', '/api/quota'),
  // REQ-025（iter-8 T2）+ REQ-029（iter-12 T1/T2）：管理后台（非管理员一律 403，服务端为安全边界）
  adminUsers: () => request<AdminUserRow[]>('GET', '/api/admin/users'), // 无参数 = 纯列表全量（§4.1 兼容形态，用量筛选下拉数据源）
  adminOverview: () => request<AdminOverview>('GET', '/api/admin/overview'),
  adminUsersPage: (params: { search?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams()
    if (params.search != null) q.set('search', params.search)
    if (params.limit != null) q.set('limit', String(params.limit))
    if (params.offset != null) q.set('offset', String(params.offset))
    return request<AdminUsersPage>('GET', `/api/admin/users?${q.toString()}`)
  },
  adminUsagePage: (params: {
    user_id?: number
    date_from?: string
    date_to?: string
    sort_key?: 'day' | 'requests' | 'tokens'
    sort_dir?: 'asc' | 'desc'
    limit?: number
    offset?: number
  }) => {
    const q = new URLSearchParams()
    if (params.user_id != null) q.set('user_id', String(params.user_id))
    if (params.date_from) q.set('date_from', params.date_from)
    if (params.date_to) q.set('date_to', params.date_to)
    if (params.sort_key) q.set('sort_key', params.sort_key)
    if (params.sort_dir) q.set('sort_dir', params.sort_dir)
    if (params.limit != null) q.set('limit', String(params.limit))
    if (params.offset != null) q.set('offset', String(params.offset))
    return request<AdminUsagePage>('GET', `/api/admin/usage?${q.toString()}`)
  },
  banUser: (id: number) => request<{ detail: string }>('POST', `/api/admin/users/${id}/ban`),
  unbanUser: (id: number) => request<{ detail: string }>('POST', `/api/admin/users/${id}/unban`),
  setUserQuota: (id: number, dailyLimit: number | null) =>
    request<{ user_id: number; quota_override: number | null }>(
      'PUT',
      `/api/admin/users/${id}/quota`,
      { daily_limit: dailyLimit },
    ),
}
