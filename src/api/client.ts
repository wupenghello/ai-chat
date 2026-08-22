import { markBanned, notifyUnauthorized } from './backend'

/**
 * CHG-007（iter-13 T2）：回合端点客户端 + blocks 消息模型。
 *
 * - 上下文组装迁服务端（REQ-033）：buildContext / streamChatViaProxy 读路径退役，
 *   发送/编辑重建/重新生成统一走 POST /api/chat/turn（SSE 协议 v2 九事件，
 *   design-iter-13 §4）；旧透传端点仅服务端保留（老客户端窗口期），前端不再调用。
 * - 未知事件 type 静默跳过（parseSse 前向兼容原则沿用，为 B/C/D 期留扩展位）。
 */

/** 文本段（Markdown 管线，REQ-011 改写：仅 text 段进 Markdown） */
export interface TextBlock {
  type: 'text'
  text: string
}
/** 工具调用段（arguments 为 JSON 字符串原样，零转换） */
export interface ToolCallBlock {
  type: 'tool_call'
  tool_call_id: string
  name: string
  arguments: string
}
/**
 * 引用来源条目（iter-14 T3，design-iter-14 §2.1/§6.4）：title/url 必有，其余可选——
 * 搜索 API 归一化形状；textContent 直排消费（不进 Markdown 管线），未知字段忽略。
 */
export interface SourceItem {
  title: string
  url: string
  snippet?: string
  site_name?: string
  date_published?: string
}
/** 工具结果段（result 为网关截断后文本，前端原样渲染；sources 为可选来源数组——引用卡数据面） */
export interface ToolResultBlock {
  type: 'tool_result'
  tool_call_id: string
  status: 'ok' | 'error' | 'timeout'
  result: string
  duration_ms?: number
  /** 仅 ok 且非空携带（后端 §6.4）；老会话无此字段 → 无引用卡 */
  sources?: SourceItem[]
}
export type Block = TextBlock | ToolCallBlock | ToolResultBlock

/** v1 消息 content 为 string；v2 起 assistant 消息为 Block[]（至少一段，design-iter-13 §2 写侧） */
export type MessageContent = string | Block[]

/** 读时归一化（REQ-032：v1 ⇒ 单文本段，进同一渲染管线——逐字零回退） */
export function contentBlocks(content: MessageContent): Block[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content
}

/** 文本段提取（复制/导出/搜索共用适配层：工具参数与结果不入，design-iter-13 §2 适配面） */
export function contentText(content: MessageContent): string {
  return contentBlocks(content)
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n')
}

/** SSE 协议 v2 事件（CHG-007 4.1 事件表；未知 type 以宽类型承载、消费方静默跳过） */
export type TurnEvent =
  | { type: 'turn.start'; session_id: string; turn_id: string }
  | { type: 'text.delta'; text: string }
  | { type: 'tool.call'; tool_call_id: string; name: string; arguments: string }
  | { type: 'tool.result'; tool_call_id: string; status: 'ok' | 'error' | 'timeout'; result: string; duration_ms: number; sources?: SourceItem[] }
  | { type: 'turn.step'; step: number; max_steps: number }
  | { type: 'usage'; requests: number; tokens: number }
  | { type: 'turn.end'; reason: 'done' | 'max_steps' | 'aborted' | 'time_limit' | 'error' }
  | { type: 'error'; code: string; message: string }
  | { type: string; [key: string]: unknown }

export type TurnEndReason = 'done' | 'max_steps' | 'aborted' | 'time_limit'

export interface TurnHandlers {
  onEvent: (ev: TurnEvent) => void
}

export type ApiErrorKind = 'auth' | 'rateLimit' | 'server' | 'network' | 'unknown'

export class ApiError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** 解析 SSE 流。chunks：逐段推送的文本（模拟真实网络的分包边界） */
async function* parseSse(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let buffer = ''
  for await (const chunk of chunks) {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('data:')) yield trimmed.slice(5).trim()
    }
  }
  if (buffer.trim().startsWith('data:')) yield buffer.trim().slice(5).trim()
}

/** 流内 error 事件 → REQ-007 错误体系（design-iter-7 §3.1 同源文案由后端下发，前端原样呈现） */
function errorKindOf(code: string): ApiErrorKind {
  if (code === 'upstream_auth') return 'auth'
  if (code === 'upstream_rate_limited') return 'rateLimit'
  return 'server'
}

/**
 * 发起服务端回合（REQ-030~033）：请求体 = 本条消息 + 会话 id（+ 可选 system_prompt，
 * REQ-008 客户端设置随回合上传——design-iter-13 §4.2 基线后补注），无历史数组。
 *
 * CHG-012/REQ-046（iter-18 T3）：opts.mode 加法可选字段——缺省不传 = 请求体零变化
 * （现状锚点）；'research' = deep-research 回合（请求体携带 mode 字段）。
 * CHG-018/REQ-055（直派批次）：opts.depth 加法可选字段——'light'/'deep' 变更深研
 * 档位（护栏/文案/报告上限按档）；缺省不传 = 后端按 standard（请求体零变化）。
 * resolve 于 turn.end（done/max_steps/aborted/time_limit）；流内 error 事件与 HTTP 层错误
 * 抛 ApiError（已生成文本与工具步骤由调用方保留——store 侧 aiMsg 已累积的 blocks 不回滚）。
 */
export async function runChatTurn(
  sessionId: string,
  message: string,
  opts: {
    systemPrompt?: string
    mode?: 'research'
    depth?: 'light' | 'standard' | 'deep'
  },
  handlers: TurnHandlers,
  signal?: AbortSignal,
): Promise<TurnEndReason> {
  let res: Response
  try {
    res = await fetch('/api/chat/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        message,
        ...(opts.systemPrompt ? { system_prompt: opts.systemPrompt } : {}),
        ...(opts.mode ? { mode: opts.mode } : {}),
        ...(opts.depth ? { depth: opts.depth } : {}),
      }),
      credentials: 'same-origin',
      signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError('network', '无法连接服务器，请检查网络后重试')
  }

  if (res.status === 401) {
    notifyUnauthorized()
    throw new ApiError('auth', '登录已过期，请重新登录', 401)
  }

  if (!res.ok) {
    let kind: ApiErrorKind = res.status >= 500 ? 'server' : 'unknown'
    let msg = `请求失败（${res.status}）`
    try {
      const body = (await res.json()) as { detail?: string | { message?: string }; code?: string }
      if (typeof body.detail === 'string') msg = body.detail
      else if (body.detail && typeof body.detail === 'object' && body.detail.message) msg = body.detail.message
      if (body.code === 'upstream_auth') kind = 'auth'
      else if (body.code === 'upstream_rate_limited' || res.status === 429) kind = 'rateLimit'
      // REQ-025（design-iter-8 §1.5 走查 29）：在线被封禁——跳登录（横幅由 LoginView 补显）
      if (res.status === 403 && msg === '账号已被封禁') {
        markBanned()
        notifyUnauthorized()
      }
    } catch {
      /* 保持兜底文案 */
    }
    throw new ApiError(kind, msg, res.status)
  }

  if (!res.body) throw new ApiError('unknown', '响应无内容')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  async function* chunks(): AsyncGenerator<string> {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        yield decoder.decode(value, { stream: true })
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
      throw new ApiError('network', '连接中断')
    }
  }

  let reason: TurnEndReason | null = null
  for await (const data of parseSse(chunks())) {
    if (data === '[DONE]') break
    try {
      const ev = JSON.parse(data) as TurnEvent
      if (ev?.type === 'error') {
        const err = ev as { type: 'error'; code: string; message: string }
        throw new ApiError(errorKindOf(err.code), err.message)
      }
      handlers.onEvent(ev)
      if (ev.type === 'turn.end') {
        const r = (ev as { reason: string }).reason
        if (r === 'done' || r === 'max_steps' || r === 'aborted' || r === 'time_limit') reason = r
        break
      }
    } catch (e) {
      if (e instanceof ApiError) throw e
      // 单帧解析失败不致命（跳过注释帧/心跳帧）
    }
  }
  return reason ?? 'done' // 流异常截断而无 turn.end：按现状「连接中断」语义由调用方兜底标注
}
