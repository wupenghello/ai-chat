import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiError, buildContext, streamChat, type ChatMessage } from '../client'

const cfg = { baseUrl: 'https://api.test/v4', model: 'glm-5.3', apiKey: 'k' }

function sseBody(deltas: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i < deltas.length) {
        // 故意把一帧拆两包，验证跨包解析
        const frame = `data: ${deltas[i]}\n\n`
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

describe('streamChat（REQ-001 流式 + REQ-007 错误分类）', () => {
  it('逐 delta 回调并返回完整文本', async () => {
    const deltas = [
      '{"choices":[{"delta":{"content":"你"}}]}',
      '{"choices":[{"delta":{"content":"好"}}]}',
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(sseBody(deltas), { status: 200 })))
    const got: string[] = []
    const full = await streamChat(cfg, [{ role: 'user', content: 'hi' }], { onDelta: (d) => got.push(d) })
    expect(got).toEqual(['你', '好'])
    expect(full).toBe('你好')
  })

  it('401 → auth 错误（引导设置页）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad key', { status: 401 })))
    await expect(streamChat(cfg, [], { onDelta: () => {} })).rejects.toMatchObject({
      kind: 'auth',
      status: 401,
    })
  })

  it('429 → rateLimit；500 → server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"error":{"code":"1113","message":"余额不足"}}', { status: 429 })),
    )
    const err = await streamChat(cfg, [], { onDelta: () => {} }).catch((e) => e)
    expect(err.kind).toBe('rateLimit')
    expect(err.message).toContain('余额不足') // 供应商具体原因透传给用户
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })))
    await expect(streamChat(cfg, [], { onDelta: () => {} })).rejects.toMatchObject({ kind: 'server' })
  })

  it('网络失败 → network（人话文案）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const err = await streamChat(cfg, [], { onDelta: () => {} }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe('network')
    expect(err.message).toContain('网络')
  })

  it('base URL 尾部斜杠被正确处理', async () => {
    const spy = vi.fn().mockResolvedValue(new Response(sseBody(['{"choices":[{"delta":{"content":"x"}}]}']), { status: 200 }))
    vi.stubGlobal('fetch', spy)
    await streamChat({ ...cfg, baseUrl: 'https://api.test/v4///' }, [], { onDelta: () => {} })
    expect(spy.mock.calls[0][0]).toBe('https://api.test/v4/chat/completions')
  })
})

describe('buildContext（REQ-002 最近 20 轮截断）', () => {
  function history(rounds: number): ChatMessage[] {
    const msgs: ChatMessage[] = [{ role: 'system', content: 'sys' }]
    for (let i = 1; i <= rounds; i++) {
      msgs.push({ role: 'user', content: `问${i}` }, { role: 'assistant', content: `答${i}` })
    }
    return msgs
  }

  it('30 轮历史仅携带最近 20 轮，且系统提示词保留', () => {
    const out = buildContext(history(30))
    expect(out[0]).toEqual({ role: 'system', content: 'sys' })
    expect(out).toHaveLength(41) // 1 system + 20 轮 × 2
    expect(out[1].content).toBe('问11') // 第 11~30 轮
    expect(out.at(-1)!.content).toBe('答30')
  })

  it('不足 20 轮时全量携带', () => {
    expect(buildContext(history(3))).toHaveLength(7)
  })

  it('截断后不以悬空 assistant 开头', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      ...history(20).slice(1), // 20 轮
    ]
    const out = buildContext(msgs)
    expect(out.find((m) => m.role !== 'system')!.role).toBe('user')
  })
})
