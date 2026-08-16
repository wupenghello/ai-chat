import { markBanned, notifyUnauthorized } from './backend'

/** OpenAI 兼容对话消息（system/user/assistant） */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
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

/** REQ-014：供应商配置（来自 settings store） */
export interface ApiClientConfig {
  baseUrl: string
  model: string
  apiKey: string
}

/** REQ-002：上下文组装——系统提示词（如有）+ 最近 N 轮（1 轮 = 1 问 + 1 答） */
export function buildContext(messages: ChatMessage[], maxRounds = 20): ChatMessage[] {
  const system = messages.filter((m) => m.role === 'system')
  const rest = messages.filter((m) => m.role !== 'system')
  // 从最新往回取整"轮"：以 user 消息开头、assistant 结尾为一轮
  const kept: ChatMessage[] = []
  let rounds = 0
  for (let i = rest.length - 1; i >= 0 && rounds < maxRounds; i--) {
    kept.unshift(rest[i])
    if (rest[i].role === 'user') rounds++
  }
  // 截断后开头若是悬空的 assistant（其 user 已被截掉），丢弃到第一条 user
  const firstUser = kept.findIndex((m) => m.role === 'user')
  const aligned = firstUser > 0 ? kept.slice(firstUser) : kept
  return [...system, ...aligned]
}

function kindFromStatus(status: number): ApiErrorKind {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rateLimit'
  if (status >= 500) return 'server'
  return 'unknown'
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

export interface StreamHandlers {
  onDelta: (text: string) => void
}

/** 消费 SSE 响应体：逐 delta 回调，返回完整文本（直连与代理共用）。
    后端代理在上游中断时向流末尾补 upstream_interrupted 帧（REQ-023），转「连接中断」。 */
async function consumeSseStream(res: Response, handlers: StreamHandlers): Promise<string> {
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

  let full = ''
  for await (const data of parseSse(chunks())) {
    if (data === '[DONE]') break
    try {
      const json = JSON.parse(data)
      if (json?.upstream_interrupted) throw new ApiError('network', '连接中断')
      const delta: string | undefined = json?.choices?.[0]?.delta?.content
      if (delta) {
        full += delta
        handlers.onDelta(delta)
      }
    } catch (e) {
      if (e instanceof ApiError) throw e
      // 单帧解析失败不致命（跳过注释帧/心跳帧）
    }
  }
  return full
}

/**
 * REQ-001：流式对话。POST {baseUrl}/chat/completions（OpenAI 兼容），
 * 逐 delta 回调；任何失败以 ApiError 抛出（REQ-007 错误分类）。
 * signal：AbortSignal，用于"生成中断"（REQ-003/004）。
 */
export async function streamChat(
  config: ApiClientConfig,
  messages: ChatMessage[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<string> {
  let res: Response
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, messages, stream: true }),
      signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError('network', '网络连接失败，请检查网络或 API 地址')
  }

  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.text()
      try {
        detail = JSON.parse(body)?.error?.message ?? body.slice(0, 200)
      } catch {
        detail = body.slice(0, 200)
      }
    } catch {
      /* 忽略读取失败 */
    }
    const kind = kindFromStatus(res.status)
    // 供应商用 429 同时表示限流和余额不足（如 GLM 1113），透传具体原因，避免误导
    const msg =
      kind === 'auth'
        ? `密钥无效或未授权（${res.status}），请前往设置更新密钥`
        : kind === 'rateLimit'
          ? `请求被拒绝（${res.status}）${detail ? '：' + detail : '，请稍后重试'}`
          : kind === 'server'
            ? `服务端错误（${res.status}）${detail ? '：' + detail : ''}`
            : `请求失败（${res.status}）${detail ? '：' + detail : ''}`
    throw new ApiError(kind, msg, res.status)
  }

  return consumeSseStream(res, handlers)
}

/**
 * REQ-023（iter-7 T1）：统一 key 模式——对话请求发往后端代理（同源 /api，Cookie 自动携带），
 * 前端零密钥。错误文案由后端按 design-iter-7 §3.1 定稿下发；401 = 会话失效，走既有跳登录钩子。
 */
export async function streamChatViaProxy(
  messages: ChatMessage[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<string> {
  let res: Response
  try {
    res = await fetch('/api/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
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
      const body = (await res.json()) as { detail?: string; code?: string }
      if (body.detail) msg = body.detail
      if (body.code === 'upstream_auth') kind = 'auth'
      else if (body.code === 'upstream_rate_limited' || res.status === 429) kind = 'rateLimit'
      // REQ-025（design-iter-8 §1.5 走查 29）：在线被封禁——跳登录（横幅由 LoginView 补显）
      if (res.status === 403 && body.detail === '账号已被封禁') {
        markBanned()
        notifyUnauthorized()
      }
    } catch {
      /* 保持兜底文案 */
    }
    throw new ApiError(kind, msg, res.status)
  }

  return consumeSseStream(res, handlers)
}
