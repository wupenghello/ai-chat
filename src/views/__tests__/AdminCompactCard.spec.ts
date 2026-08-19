/**
 * iter-16 T3（CHG-010 REQ-041 admin 面，design-iter-16 §4 卡 E）：遥测视图压缩卡——
 * 位置（双卡并排区与卡 D 之间全宽）· 标题区 C9/C10 逐字 · 次数列 C11 + sub 模板 ·
 * 降幅列 C12 + NN.N% + sub C13 · 缺失态 C14 徽标（永不显 0/NaN）· 空态 C15 ·
 * 成本口径注记 C16 · 合法 0 降幅如实 · compact 键缺失（旧后端窗口期）按空态。
 * 独立 mock 与夹具，既有 AdminTelemetry.spec.ts 零触达（沿其先例体例）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

const backendMock = vi.hoisted(() => ({
  adminUsers: vi.fn(),
  adminUsersPage: vi.fn(),
  adminOverview: vi.fn(),
  adminUsagePage: vi.fn(),
  adminUpdateSearchEnabled: vi.fn(),
  banUser: vi.fn(),
  unbanUser: vi.fn(),
  setUserQuota: vi.fn(),
  adminTelemetry: vi.fn(),
}))

vi.mock('../../api/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/backend')>()),
  backend: backendMock,
}))

import AdminView from '../AdminView.vue'
import { useAuthStore } from '../../stores/auth'
import type { AdminTelemetry } from '../../api/backend'

function isoDay(back: number): string {
  const d = new Date(Date.now() - back * 86400000)
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}

const TODAY = isoDay(0)
type Compact = NonNullable<AdminTelemetry['compact']>

/** 样件：design-iter-16 §3 卡 E 正常态数值（全虚构，铁律 5） */
function compactNormal(): Compact {
  return {
    count: 12, count_ok: 10, count_failed: 2, measured: 8,
    tokens_before_total: 384000, tokens_after_total: 122880,
    reduction_rate: 0.68,
  }
}

function telFixture(compact?: Compact): AdminTelemetry {
  return {
    window: { days: 7, date_from: isoDay(6), date_to: TODAY },
    price: { configured: true, input_per_mtok: 2, output_per_mtok: 8, cache_hit_per_mtok: 0.5 },
    today_cost: {
      day: TODAY, tokens_prompt: 182400, tokens_completion: 46200, cache_hit_tokens: 96512,
      cost_input: 0.3648, cost_output: 0.3696, cost_cache_hit: 0.048256, cost_total: 0.782656,
      self_tokens_total: 12480,
    },
    daily: [
      { day: TODAY, tokens_prompt: 182400, tokens_completion: 46200, cache_hit_tokens: 96512, cache_miss_tokens: 85888, cache_rate: 0.529082, cost_total: 0.782656, self_tokens_total: 12480 },
    ],
    tools: [{ tool_name: 'search', status: 'ok', count: 42, avg_duration_ms: 2130 }],
    ...(compact ? { compact } : {}),
    retention_days: 90,
  }
}

let wrapper: VueWrapper | null = null

async function mountTel(compact?: Compact): Promise<VueWrapper> {
  backendMock.adminTelemetry.mockResolvedValue(telFixture(compact))
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin', name: 'admin', component: AdminView }],
  })
  router.push('/admin')
  await router.isReady()
  const auth = useAuthStore()
  auth.checked = true
  auth.user = { id: 1, username: '猫南北', is_admin: true }
  const w = mount(AdminView, { global: { plugins: [router] } })
  await flushPromises()
  await w.findAll('.adm-tabs button').find((b) => b.text() === '遥测')!.trigger('click')
  await flushPromises()
  wrapper = w
  return w
}

/** 卡 E = 面板序列第 4 张 tel-card（A / B / C / E / D） */
function cardE(w: VueWrapper) {
  return w.findAll('.tel-card')[3]
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  backendMock.adminUsers.mockResolvedValue([])
  backendMock.adminUsersPage.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 })
  backendMock.adminOverview.mockResolvedValue({
    day: TODAY, unified_used: 100, unified_daily_total: 2000,
    total_users: 1, today_requests: 1, today_tokens: 1,
  })
  backendMock.adminUsagePage.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0, distinct_days: 0 })
  backendMock.adminUpdateSearchEnabled.mockResolvedValue({ search_enabled: true })
  backendMock.banUser.mockResolvedValue({ detail: 'ok' })
  backendMock.unbanUser.mockResolvedValue({ detail: 'ok' })
  backendMock.setUserQuota.mockResolvedValue({ user_id: 2, quota_override: 5 })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('卡 E 位置与标题区（design-iter-16 §4.1，走查条 34/35）', () => {
  it('位于双卡并排区与卡 D 之间（全宽第 4 卡）；标题 C9 + 副题 C10 逐字', async () => {
    const w = await mountTel(compactNormal())
    const cards = w.findAll('.tel-card')
    expect(cards).toHaveLength(5) // A / B / C / E / D
    expect(cards[0].find('.tc-head').text()).toBe('每日成本估算')
    expect(cardE(w).find('.tc-head').text()).toBe('上下文压缩') // C9
    expect(cards.at(-1)!.find('.tc-head').text()).toBe('按日成本明细')
    // 卡 E 不属双卡并排区（全宽）
    expect(w.findAll('.tel-2col .tel-card')).toHaveLength(2)
    expect(cardE(w).find('.tc-sub').text()).toBe(
      '压缩 = 中段历史摘要（自动阈值触发 + 手动触发）；降幅仅统计压缩前后均测得的压缩') // C10
    expect(cardE(w).find('.ce-ico').exists()).toBe(true) // 14px 压缩/收拢形 icon
  })
})

describe('正常态双大数值（走查条 36/37/38）', () => {
  it('次数列：label C11 + 大数值（含失败行）+ sub 模板「成功 N · 失败 N」+ title 注记', async () => {
    const w = await mountTel(compactNormal())
    const cell = cardE(w).findAll('.ce-cell')[0]
    expect(cell.find('.bd-label').text()).toBe('窗口压缩次数') // C11
    expect(cell.find('.tc-big').text()).toBe('12')
    expect(cell.find('.tc-big-sub').text()).toBe('成功 10 · 失败 2')
    expect(cell.attributes('title')).toBe('失败含超时行；失败行只计次数、不计降幅')
  })

  it('降幅列：label C12 + NN.N%（后端值直显不做前端再计算）+ sub C13 + title 公式逐字', async () => {
    const w = await mountTel(compactNormal())
    const cell = cardE(w).findAll('.ce-cell')[1]
    expect(cell.find('.bd-label').text()).toBe('平均降幅') // C12
    expect(cell.find('.tc-big').text()).toBe('68.0%')      // 0.68 → NN.N%
    expect(cell.find('.tc-big-sub').text()).toBe('已测得 8 / 成功 10') // C13 模板
    expect(cell.attributes('title')).toBe('平均降幅 = 1 − Σ压缩后 tokens ÷ Σ压缩前 tokens')
  })

  it('成本口径注记 kv-row 逐字 C16（走查条 41）', async () => {
    const w = await mountTel(compactNormal())
    const kv = cardE(w).find('.kv-row')
    expect(kv.find('.kv-label').text()).toBe('成本与配额口径')
    expect(kv.find('.kv-val').text()).toBe('摘要调用 tokens 计入每日成本估算（按输入计价）· 手动压缩不计回合')
  })
})

describe('缺失态与空态（铁律 5：永不显 0/NaN，走查条 39/40）', () => {
  it('缺失态：有压缩行零测得行 → 降幅位「缺失」徽标 C14；次数如实；sub 显「已测得 0 / 成功 N」', async () => {
    const w = await mountTel({
      count: 3, count_ok: 2, count_failed: 1, measured: 0,
      tokens_before_total: 0, tokens_after_total: 0, reduction_rate: null,
    })
    const ce = cardE(w)
    expect(ce.findAll('.ce-cell')[0].find('.tc-big').text()).toBe('3') // 次数如实
    const rateCell = ce.findAll('.ce-cell')[1]
    expect(rateCell.find('.tc-big').exists()).toBe(false) // 不显数值
    expect(rateCell.find('.pill.miss').text()).toBe('缺失') // C14
    expect(ce.text()).not.toContain('0.0%')               // 永不显 0
    expect(ce.text()).not.toContain('NaN')
    expect(rateCell.find('.tc-big-sub').text()).toBe('已测得 0 / 成功 2') // 缺失原因自释
  })

  it('合法 0 降幅如实显 0.0%（压缩前后同规模；与缺失徽标视觉语言不同——变异断言）', async () => {
    const w = await mountTel({
      count: 1, count_ok: 1, count_failed: 0, measured: 1,
      tokens_before_total: 8000, tokens_after_total: 8000, reduction_rate: 0,
    })
    const rateCell = cardE(w).findAll('.ce-cell')[1]
    expect(rateCell.find('.tc-big').text()).toBe('0.0%')
    expect(rateCell.find('.pill.miss').exists()).toBe(false)
  })

  it('空态：窗口零 compress 行 → 空文案 C15 替换大数值行；kv-row 注记保留', async () => {
    const w = await mountTel({
      count: 0, count_ok: 0, count_failed: 0, measured: 0,
      tokens_before_total: 0, tokens_after_total: 0, reduction_rate: null,
    })
    const ce = cardE(w)
    expect(ce.find('.ce-empty').text()).toBe('窗口内无压缩记录') // C15
    expect(ce.find('.ce-grid').exists()).toBe(false)
    expect(ce.find('.kv-row').exists()).toBe(true) // 注记保留
  })

  it('compact 键缺失（旧后端窗口期）→ 按空态口径渲染（可选键兼容）', async () => {
    const w = await mountTel(undefined)
    expect(cardE(w).find('.ce-empty').text()).toBe('窗口内无压缩记录')
  })
})

describe('空窗口口径演进（compress 行同为遥测行）', () => {
  it('仅压缩行无 llm/tool 行：面板不视空（卡 E 承载），空盒 T28 不渲染', async () => {
    backendMock.adminTelemetry.mockResolvedValue({
      ...telFixture(undefined),
      daily: [], tools: [],
      today_cost: { day: TODAY, tokens_prompt: 0, tokens_completion: 0, cache_hit_tokens: 0, cost_input: 0, cost_output: 0, cost_cache_hit: 0, cost_total: 0, self_tokens_total: 0 },
      compact: { count: 2, count_ok: 2, count_failed: 0, measured: 1, tokens_before_total: 9000, tokens_after_total: 4000, reduction_rate: 0.555556 },
    })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/admin', name: 'admin', component: AdminView }],
    })
    router.push('/admin')
    await router.isReady()
    const auth = useAuthStore()
    auth.checked = true
    auth.user = { id: 1, username: '猫南北', is_admin: true }
    const w = mount(AdminView, { global: { plugins: [router] } })
    await flushPromises()
    await w.findAll('.adm-tabs button').find((b) => b.text() === '遥测')!.trigger('click')
    await flushPromises()
    wrapper = w
    expect(w.find('.tel-empty').exists()).toBe(false) // 有 compress 行 ≠ 空窗口
    expect(cardE(w).findAll('.ce-cell')[0].find('.tc-big').text()).toBe('2')
    expect(cardE(w).findAll('.ce-cell')[1].find('.tc-big').text()).toBe('55.6%')
  })
})
