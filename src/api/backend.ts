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

/** 从 FastAPI 错误体提取人话文案：{detail: string} / {detail: {message}} 对象形状
 *  （sessions.py 409 与 chat/compact 端点先例）/ pydantic 422 的 [{msg}] */
function extractMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail
    if (typeof detail === 'string') return detail
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const msg = (detail as { message?: unknown }).message
      if (typeof msg === 'string' && msg) return msg
    }
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

/** REQ-025（iter-8 T2）：全站配额条数据 + REQ-029（iter-12 T1）统计卡三指标（design-iter-12 §4.3，定夺④）。
 *  iter-14 T2 加法扩展（design-iter-14 §6.1）：search_enabled / search_key_configured
 *  （可选——旧后端窗口期不携带时前端按默认开处理，D6 附注仅在显式 false 时呈现）。 */
export interface AdminOverview {
  day: string
  unified_used: number
  unified_daily_total: number
  /** 总用户数（含已封禁与管理员）；今日 = 服务器本地自然日、全模式合计；无记录 = 0 不估算 */
  total_users: number
  today_requests: number
  today_tokens: number
  /** admin 联网搜索整体开关（KV 落库实值，默认开） */
  search_enabled?: boolean
  /** 搜索密钥是否已配置（只报有无，不泄露 key 内容） */
  search_key_configured?: boolean
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

/** 服务端供应商档案视图（REQ-018 iter-7 T2）：key 只有掩码，明文绝不下发前端。
 *  iter-14 T2 加法扩展（design-iter-14 §6.3）：tools_enabled（可选——旧后端窗口期缺省按开处理）。 */
export interface ServerProfile {
  id: string
  name: string
  base_url: string
  model: string
  api_key_masked: string
  is_active: boolean
  /** 「支持工具」能力开关（默认开；关闭后使用此档案的对话不携带工具） */
  tools_enabled?: boolean
}

/** REQ-038（iter-15 T3）：遥测聚合响应（design-iter-15 §5 定案形状逐字）。
 *  缺失与未配置语义（铁律 5）：缓存列 NULL → null（显「缺失」，永不显 0）；
 *  单价未配置 → price.configured=false 且全部 cost_* 为 null（tokens 如实）。 */
export interface AdminTelemetry {
  window: { days: number; date_from: string; date_to: string }
  price: {
    configured: boolean
    input_per_mtok: number | null
    output_per_mtok: number | null
    cache_hit_per_mtok: number | null
  }
  today_cost: {
    day: string
    tokens_prompt: number
    tokens_completion: number
    cache_hit_tokens: number | null
    cost_input: number | null
    cost_output: number | null
    cost_cache_hit: number | null
    cost_total: number | null
    self_tokens_total: number
  }
  /** 仅列有数据日（缺失时段由前端以窗口天数比对判定）；日期降序 */
  daily: Array<{
    day: string
    tokens_prompt: number
    tokens_completion: number
    cache_hit_tokens: number | null
    cache_miss_tokens: number | null
    /** null = 该日缓存字段缺失（整天无带字段行） */
    cache_rate: number | null
    cost_total: number | null
    self_tokens_total: number
  }>
  /** GROUP BY tool_name,status；排序固定 tool_name ASC, status ASC（确定性） */
  tools: Array<{
    tool_name: string
    status: 'ok' | 'error' | 'timeout' | 'cancelled'
    count: number
    avg_duration_ms: number
  }>
  /** CHG-010/REQ-041（iter-16 T3，design-iter-16 §5.2）：压缩聚合加法键。
   *  可选——旧后端窗口期不携带时前端按空态渲染（窗口内无压缩记录）；
   *  measured=0 → reduction_rate=null（显「缺失」徽标，永不显 0/NaN，铁律 5） */
  compact?: {
    count: number
    count_ok: number
    count_failed: number
    measured: number
    tokens_before_total: number
    tokens_after_total: number
    reduction_rate: number | null
  }
  retention_days: number
}

/** CHG-010/REQ-040（iter-16 T3）：手动压缩结果（design-iter-16 §5.1 定案形状）。
 *  tokens_before 前端不呈现（定夺③：半截数字误导，效果度量归 admin 卡 E） */
export interface CompactResult {
  status: 'compacted' | 'skipped'
  tokens_before?: number | null
  reason?: 'too_short'
}

/** CHG-011/REQ-043（iter-17，design-iter-17 §4.1）：记忆条目出参——
 * source_session_title = 组装时读会话档 title，会话已删 → null（UI 落 M11 分支）；
 * 手工编辑后 source_session_id/model 归零（UI 落 M12 分支）。entries 顺序 = 注入组装顺序 */
export interface MemoryEntry {
  id: number
  content: string
  source_session_id: string | null
  source_session_title: string | null
  model: string | null
  created_at: string
  updated_at: string
}

export interface MemoryState {
  entries: MemoryEntry[]
  memory_enabled: boolean
  /** 组装时点逐字同源取值（「看到的就是注入的」，前端零本地拼装）；停用/无条目 → null */
  injection_preview: string | null
}

export interface ProfilePayload {
  name: string
  base_url: string
  model: string
  api_key: string
  /** 可选布尔（§6.3）：新建缺省 true / 编辑传值覆盖（api_key「留空 = 沿用」同精神） */
  tools_enabled?: boolean
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
  // CHG-010/REQ-040（iter-16 T3，design-iter-16 §5.1）：手动压缩——四语义 200 compacted /
  // 200 skipped too_short / 409 session_generating（detail.message 逐字呈现）/ 502·504 失败
  compactSession: (session_id: string) =>
    request<CompactResult>('POST', '/api/chat/compact', { session_id }),
  // REQ-025（iter-8 T2）+ REQ-029（iter-12 T1/T2）：管理后台（非管理员一律 403，服务端为安全边界）
  adminUsers: () => request<AdminUserRow[]>('GET', '/api/admin/users'), // 无参数 = 纯列表全量（§4.1 兼容形态，用量筛选下拉数据源）
  adminOverview: () => request<AdminOverview>('GET', '/api/admin/overview'),
  // REQ-038（iter-15 T3）：遥测聚合（design-iter-15 §5；days 整数 1~90，越界/非整数后端 422）
  adminTelemetry: (days: number) =>
    request<AdminTelemetry>('GET', `/api/admin/telemetry?days=${days}`),
  // iter-14 T3（design-iter-14 §6.1 定夺⑥）：admin 联网搜索开关写入（下一回合生效；非 admin 403 / 非 422 由后端承载）
  adminUpdateSearchEnabled: (searchEnabled: boolean) =>
    request<{ search_enabled: boolean }>('PUT', '/api/admin/settings', { search_enabled: searchEnabled }),
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
  // CHG-011/REQ-043（iter-17 T2/T3，design-iter-17 §4 口径定案）：记忆管理四端点——
  // GET 一次取全（列表+停用状态+注入预览单一链路）/ PUT 条目（来源归零，422 服务端唯一权威校验）
  // / DELETE 条目 / PUT settings 整体停用；跨用户操作一律 404 memory_not_found（归属隔离）
  getMemory: () => request<MemoryState>('GET', '/api/memory'),
  updateMemoryEntry: (id: number, content: string) =>
    request<MemoryEntry>('PUT', `/api/memory/${id}`, { content }),
  deleteMemoryEntry: (id: number) =>
    request<{ detail: string }>('DELETE', `/api/memory/${id}`),
  setMemoryEnabled: (memory_enabled: boolean) =>
    request<{ memory_enabled: boolean }>('PUT', '/api/memory/settings', { memory_enabled }),
}
