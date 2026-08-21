import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiError, runChatTurn } from '../client'

vi.mock('../../api/backend', () => ({
  notifyUnauthorized: vi.fn(),
  markBanned: vi.fn(),
}))

import { notifyUnauthorized } from '../../api/backend'

const mockedNotifyUnauthorized = vi.mocked(notifyUnauthorized)

/**
 * iter-13 T2（CHG-007）：回合端点客户端。口径迁移登记：
 * - buildContext 组（最近 20 轮截断 3 例）退役 → 服务端组装等价 pytest 承载
 *   （backend/tests/test_turn.py test_组装等价_* / test_组装_库内已含本条消息_*）
 * - upstream_interrupted 帧例退役 → v2 后端将上游中断转为 error 事件（backend test_turn 错误映射组）
 * - HTTP 层错误映射组（401/403/502/429/504/503/网络失败）语义不变、逐例平移
 */

function sseBody(events: object[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i < events.length) {
        // 故意把一帧拆两包，验证跨包解析
        const frame = `data: ${JSON.stringify(events[i])}\n\n`
        const half = Math.floor(frame.length / 2)
        controller.enqueue(enc.encode(frame.slice(0, half)))
        controller.enqueue(enc.encode(frame.slice(half)))
        i++
      } else {
        controller.enqueue(enc.encode('data: [DONE]\n\n'))
        controller.close()
      }
    },
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

async function turn(message = 'hi', opts: { systemPrompt?: string } = {}) {
  const got: object[] = []
  const reason = await runChatTurn('s1', message, opts, { onEvent: (ev) => got.push(ev) })
  return { got, reason }
}

describe('runChatTurn（CHG-007 REQ-030/033：回合端点 + SSE v2 九事件）', () => {
  it('请求体 = 会话 id + 本条消息（无历史数组），事件逐帧回调', async () => {
    const spy = vi.fn().mockResolvedValue(
      new Response(
        sseBody([
          { type: 'turn.start', session_id: 's1', turn_id: 't1' },
          { type: 'text.delta', text: '你' },
          { type: 'text.delta', text: '好' },
          { type: 'turn.end', reason: 'done' },
        ]),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', spy)
    const { got, reason } = await turn()
    const [url, init] = spy.mock.calls[0]
    expect(url).toBe('/api/chat/turn')
    expect(init.credentials).toBe('same-origin')
    const body = JSON.parse(init.body)
    expect(body).toEqual({ session_id: 's1', message: 'hi' }) // 无历史数组 / 无密钥
    expect(JSON.stringify(init) + JSON.stringify(body)).not.toContain('apiKey')
    expect(got.map((e) => (e as { type: string }).type)).toEqual([
      'turn.start',
      'text.delta',
      'text.delta',
      'turn.end',
    ])
    expect(reason).toBe('done')
  })

  it('system_prompt 可选上传（REQ-008 客户端设置随回合上传，design-iter-13 §4.2 补注）', async () => {
    const spy = vi.fn().mockResolvedValue(
      new Response(sseBody([{ type: 'turn.end', reason: 'done' }]), { status: 200 }),
    )
    vi.stubGlobal('fetch', spy)
    await turn('hi', { systemPrompt: '你是助手' })
    expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({
      session_id: 's1',
      message: 'hi',
      system_prompt: '你是助手',
    })
  })

  it('工具事件透传：tool.call / tool.result 按序回调，max_steps 回合 resolve 其 reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          sseBody([
            { type: 'turn.start', session_id: 's1', turn_id: 't1' },
            { type: 'tool.call', tool_call_id: 'c1', name: 'demo_weather', arguments: '{"city":"北京"}' },
            { type: 'tool.result', tool_call_id: 'c1', status: 'ok', result: '北京：晴', duration_ms: 12 },
            { type: 'turn.end', reason: 'max_steps' },
          ]),
          { status: 200 },
        ),
      ),
    )
    const { got, reason } = await turn()
    expect(got[1]).toMatchObject({ type: 'tool.call', name: 'demo_weather' })
    expect(got[2]).toMatchObject({ type: 'tool.result', status: 'ok', result: '北京：晴' })
    expect(reason).toBe('max_steps')
  })

  it('未知事件 type 静默跳过不抛错（前向兼容，design-iter-13 §4.1）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(sseBody([{ type: 'future.event', payload: { x: 1 } }, { type: 'turn.end', reason: 'done' }]), {
          status: 200,
        }),
      ),
    )
    const { got, reason } = await turn()
    expect(reason).toBe('done')
    expect((got[0] as { type: string }).type).toBe('future.event')
  })

  it('流内 error 事件 → ApiError（REQ-007 错误体系映射）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          sseBody([
            { type: 'text.delta', text: '部分' },
            { type: 'error', code: 'upstream_auth', message: '请求失败：API 密钥无效，请检查高级设置中的供应商配置' },
          ]),
          { status: 200 },
        ),
      ),
    )
    await expect(turn()).rejects.toMatchObject({
      kind: 'auth',
      message: '请求失败：API 密钥无效，请检查高级设置中的供应商配置',
    })
  })

  it('401 → 会话失效：触发跳登录钩子 + auth 错误', async () => {
    mockedNotifyUnauthorized.mockClear()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"detail":"登录已过期，请重新登录"}', { status: 401 })))
    await expect(runChatTurn('s1', 'q', {}, { onEvent: () => {} })).rejects.toMatchObject({
      kind: 'auth',
      status: 401,
      message: '登录已过期，请重新登录',
    })
    expect(mockedNotifyUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('403 账号已被封禁（在线被封禁，design-iter-8 走查 29）→ 标记 + 跳登录钩子', async () => {
    mockedNotifyUnauthorized.mockClear()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"detail":"账号已被封禁"}', { status: 403 })))
    await expect(runChatTurn('s1', 'q', {}, { onEvent: () => {} })).rejects.toMatchObject({
      status: 403,
      message: '账号已被封禁',
    })
    expect(mockedNotifyUnauthorized).toHaveBeenCalledTimes(1)
    const { markBanned } = await import('../../api/backend')
    expect(vi.mocked(markBanned)).toHaveBeenCalledTimes(1)
  })

  it('上游 401 经代理（502 upstream_auth）→ auth + 后端定稿文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          '{"detail":"请求失败：API 密钥无效，请检查高级设置中的供应商配置","code":"upstream_auth","upstream_status":401}',
          { status: 502 },
        ),
      ),
    )
    await expect(runChatTurn('s1', 'q', {}, { onEvent: () => {} })).rejects.toMatchObject({
      kind: 'auth',
      message: '请求失败：API 密钥无效，请检查高级设置中的供应商配置',
    })
  })

  it('上游 429 透传 → rateLimit + 定稿文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"detail":"请求过于频繁，已被限流。请稍后重试","code":"upstream_rate_limited"}', { status: 429 }),
      ),
    )
    await expect(runChatTurn('s1', 'q', {}, { onEvent: () => {} })).rejects.toMatchObject({
      kind: 'rateLimit',
      message: '请求过于频繁，已被限流。请稍后重试',
    })
  })

  it('上游超时（504 upstream_timeout）→ server + 定稿文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"detail":"请求超时，请稍后重试","code":"upstream_timeout"}', { status: 504 })),
    )
    await expect(runChatTurn('s1', 'q', {}, { onEvent: () => {} })).rejects.toMatchObject({
      kind: 'server',
      message: '请求超时，请稍后重试',
    })
  })

  it('配额拦截（429 quota_exhausted 回合受理即拦）→ rateLimit + 后端文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"detail":"配额已用尽，将于明日 00:00 重置。可在高级设置使用自有密钥解锁更高配额","code":"quota_exhausted"}', {
          status: 429,
        }),
      ),
    )
    await expect(runChatTurn('s1', 'q', {}, { onEvent: () => {} })).rejects.toMatchObject({
      kind: 'rateLimit',
      status: 429,
    })
  })

  it('网络失败 → network（无法连接服务器）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const err = await runChatTurn('s1', 'q', {}, { onEvent: () => {} }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe('network')
    expect(err.message).toContain('无法连接服务器')
  })

  it('mode=research：请求体携带 mode 字段（REQ-047 验收 1 前半）', async () => {
    const spy = vi.fn().mockResolvedValue(new Response(sseBody([{ type: 'turn.end', reason: 'done' }]), { status: 200 }))
    vi.stubGlobal('fetch', spy)
    await runChatTurn('s1', '开放问题', { mode: 'research' }, { onEvent: () => {} })
    expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({
      session_id: 's1',
      message: '开放问题',
      mode: 'research',
    })
  })

  it('mode 缺省：请求体零变化（无 mode 字段——现状锚点，iter-13#42 复跑）', async () => {
    const spy = vi.fn().mockResolvedValue(new Response(sseBody([{ type: 'turn.end', reason: 'done' }]), { status: 200 }))
    vi.stubGlobal('fetch', spy)
    await runChatTurn('s1', 'hi', {}, { onEvent: () => {} })
    expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ session_id: 's1', message: 'hi' })
  })

  it('turn.end reason=time_limit：resolve 其 reason（时长护栏终态加法，REQ-047 验收 4 数据面）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(sseBody([{ type: 'turn.end', reason: 'time_limit' }]), { status: 200 })),
    )
    const { reason } = await turn()
    expect(reason).toBe('time_limit')
  })

  it('心跳注释帧（: ping）零事件产出（REQ-045 验收 2）：注释帧不进 TurnEvent，事件序不变', async () => {
    const enc = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(enc.encode(': ping\n\n'))
        controller.enqueue(enc.encode('data: {"type":"text.delta","text":"你"}\n\n'))
        controller.enqueue(enc.encode(': ping\n\n'))
        controller.enqueue(enc.encode('data: {"type":"turn.end","reason":"done"}\n\n'))
        controller.enqueue(enc.encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 200 })))
    const got: object[] = []
    const reason = await runChatTurn('s1', 'hi', {}, { onEvent: (ev) => got.push(ev) })
    expect(got.map((e) => (e as { type: string }).type)).toEqual(['text.delta', 'turn.end'])
    expect(reason).toBe('done')
  })
})
