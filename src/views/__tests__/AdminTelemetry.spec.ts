/**
 * iter-15 T3（CHG-009 REQ-038）：AdminView 遥测视图（design-iter-15 §1~3 第三 tab 加法扩展）。
 * 断言面：七态渲染（正常/缺失时段/单价未配置/缓存全缺失/空窗口/加载/失败）·
 * 文案逐字（design-iter-15 §2 登记表 T1~T28 关键项）· 0 与缺失区分 · 时间窗切换重拉 ·
 * tab 加法（前两 tab 零变化）· 普通用户 DOM 无遥测节点（403 守卫之内）。
 * 独立 mock 与夹具，既有 AdminView.spec.ts 零触达（前端 305 存量零改动复跑）。
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

const ADMIN = { id: 1, username: '猫南北', is_admin: true }
const NORMAL = { id: 2, username: 'mallory', is_admin: false }

function isoDay(back: number): string {
  const d = new Date(Date.now() - back * 86400000)
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}

const TODAY = isoDay(0)

/** 正常态样件（数值虚构；口径与 design-iter-15 §4.1 响应示例一致） */
function telFixture(over: Partial<AdminTelemetry> = {}): AdminTelemetry {
  const base: AdminTelemetry = {
    window: { days: 7, date_from: isoDay(6), date_to: TODAY },
    price: { configured: true, input_per_mtok: 2, output_per_mtok: 8, cache_hit_per_mtok: 0.5 },
    today_cost: {
      day: TODAY, tokens_prompt: 182400, tokens_completion: 46200, cache_hit_tokens: 96512,
      cost_input: 0.3648, cost_output: 0.3696, cost_cache_hit: 0.048256, cost_total: 0.782656,
      self_tokens_total: 12480,
    },
    daily: [
      { day: TODAY, tokens_prompt: 182400, tokens_completion: 46200, cache_hit_tokens: 96512, cache_miss_tokens: 85888, cache_rate: 0.529082, cost_total: 0.782656, self_tokens_total: 12480 },
      { day: isoDay(1), tokens_prompt: 120000, tokens_completion: 30000, cache_hit_tokens: 40000, cache_miss_tokens: 80000, cache_rate: 0.333333, cost_total: 0.5, self_tokens_total: 0 },
      // 缓存字段整天缺失日（NULL → null；永不显 0）
      { day: isoDay(2), tokens_prompt: 1000, tokens_completion: 500, cache_hit_tokens: null, cache_miss_tokens: null, cache_rate: null, cost_total: 0.006, self_tokens_total: 300 },
    ],
    tools: [
      { tool_name: 'echo', status: 'ok', count: 5, avg_duration_ms: 6 },
      { tool_name: 'search', status: 'ok', count: 42, avg_duration_ms: 2130 },
      { tool_name: 'search', status: 'error', count: 3, avg_duration_ms: 890 },
      { tool_name: 'search', status: 'timeout', count: 1, avg_duration_ms: 10000 },
      { tool_name: 'search', status: 'cancelled', count: 1, avg_duration_ms: 120 },
    ],
    retention_days: 90,
  }
  return { ...base, ...over }
}

let wrapper: VueWrapper | null = null

async function mountView(asAdmin = true): Promise<VueWrapper> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin', name: 'admin', component: AdminView },
      { path: '/', name: 'chat', component: { template: '<div>chat</div>' } },
    ],
  })
  router.push('/admin')
  await router.isReady()
  const auth = useAuthStore()
  auth.checked = true
  auth.user = asAdmin ? ADMIN : NORMAL
  const w = mount(AdminView, { global: { plugins: [router] } })
  await flushPromises()
  wrapper = w
  return w
}

async function openTel(w: VueWrapper) {
  await w.findAll('.adm-tabs button').find((b) => b.text() === '遥测')!.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  backendMock.adminUsers.mockResolvedValue([])
  backendMock.adminUsersPage.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 })
  backendMock.adminOverview.mockResolvedValue({
    day: TODAY, unified_used: 100, unified_daily_total: 2000,
    total_users: 47, today_requests: 86, today_tokens: 412530,
  })
  backendMock.adminUsagePage.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0, distinct_days: 0 })
  backendMock.adminUpdateSearchEnabled.mockResolvedValue({ search_enabled: true })
  backendMock.banUser.mockResolvedValue({ detail: 'ok' })
  backendMock.unbanUser.mockResolvedValue({ detail: 'ok' })
  backendMock.setUserQuota.mockResolvedValue({ user_id: 2, quota_override: 5 })
  backendMock.adminTelemetry.mockResolvedValue(telFixture())
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('遥测 tab 加法扩展（design-iter-15 §2，零回退纪律）', () => {
  it('第三 tab「遥测」T1；前两 tab 文案零变化；radiogroup 语义沿用；挂载不拉取（进入才拉）', async () => {
    const w = await mountView()
    const tabs = w.findAll('.adm-tabs button')
    expect(tabs.map((t) => t.text())).toEqual(['用户列表', '用量列表', '遥测'])
    expect(w.find('.adm-tabs').attributes('role')).toBe('radiogroup')
    expect(tabs[0].attributes('role')).toBe('radio')
    expect(tabs[0].attributes('aria-checked')).toBe('true')
    expect(backendMock.adminTelemetry).not.toHaveBeenCalled() // 惰性：进入 tab 才拉取
    await openTel(w)
    expect(backendMock.adminTelemetry).toHaveBeenCalledWith(7) // 默认近 7 天
    expect(tabs[2].attributes('aria-checked')).toBe('true')
    expect(tabs[2].classes()).toContain('on')
  })

  it('切回用户列表：用户面板正常渲染（前两 tab 行为零变化），遥测面板保留 DOM（v-show）', async () => {
    const w = await mountView()
    await openTel(w)
    await w.findAll('.adm-tabs button').find((b) => b.text() === '用户列表')!.trigger('click')
    await flushPromises()
    expect(w.find('.u-toolbar').isVisible()).toBe(true)
    expect(w.findAll('.panel').length).toBe(3) // 三面板均在 DOM（v-show 切换）
  })

  it('普通用户：403 态 DOM 无遥测 tab、零遥测请求（在既有 403 守卫之内）', async () => {
    const w = await mountView(false)
    expect(w.text()).toContain('无权访问（403）')
    expect(w.findAll('.adm-tabs button')).toHaveLength(0)
    expect(w.text()).not.toContain('遥测')
    expect(backendMock.adminTelemetry).not.toHaveBeenCalled()
  })
})

describe('正常态渲染（文案逐字对照 design-iter-15 §2 登记表）', () => {
  it('工具行：T24 时间窗三段逐字 + 默认近 7 天选中；T25 保留期注记（retention_days 供数）', async () => {
    const w = await mountView()
    await openTel(w)
    const seg = w.findAll('.win-seg button')
    expect(seg.map((b) => b.text())).toEqual(['近 7 天', '近 14 天', '近 30 天'])
    expect(seg[0].classes()).toContain('on')
    expect(seg[0].attributes('aria-checked')).toBe('true')
    expect(w.find('.retention-note').text()).toBe('遥测明细保留 90 天，超期数据自动清理')
  })

  it('卡 A：T2/T3 标题副题；T4 大数值 = 后端值 4 位小数截显（不做前端再计算）+ 右侧注', async () => {
    const w = await mountView()
    await openTel(w)
    const card = w.findAll('.tel-card')[0]
    expect(card.find('.tc-head').text()).toBe('每日成本估算')
    expect(card.find('.tc-sub').text()).toBe('仅统一 key 模式计成本；自填模式 tokens 不计成本')
    expect(card.find('.tc-big-label').text()).toBe('今日成本估算')
    expect(card.find('.tc-big').text()).toBe('¥0.7827') // 0.782656 → 4 位小数显示
    expect(card.find('.tc-big-sub').text()).toBe(`${TODAY} · 统一 key`)
    const labels = card.findAll('.bd-label').map((e) => e.text())
    expect(labels).toEqual(['输入', '输出', '缓存命中']) // T5
    expect(card.findAll('.bd-tokens')[0].text()).toBe('182,400 tokens')
    expect(card.findAll('.bd-cost')[0].text()).toBe('¥0.3648')
  })

  it('卡 A 单价行：T6 label + T7 值格式（¥N / 1M tokens ×3）+ T8 说明；无编辑入口', async () => {
    const w = await mountView()
    await openTel(w)
    const card = w.findAll('.tel-card')[0]
    const kv = card.findAll('.kv-row')[0]
    expect(kv.find('.kv-label').text()).toBe('单价（只读）')
    expect(kv.find('.kv-val').text()).toBe('输入 ¥2 / 1M tokens · 输出 ¥8 / 1M tokens · 缓存命中 ¥0.5 / 1M tokens')
    expect(kv.find('.kv-note').text()).toBe('单价由 backend/.env 三变量 AI_CHAT_PRICE_* 注入，admin 只读')
    // admin 只读存在性断言：全卡无输入框/保存类按钮（无单价编辑入口）
    expect(card.findAll('input')).toHaveLength(0)
    expect(card.findAll('textarea')).toHaveLength(0)
  })

  it('卡 A 自填行：T9 逐字（含「用户自带密钥」五字）+「不计成本」徽标', async () => {
    const w = await mountView()
    await openTel(w)
    const self = w.findAll('.tel-card')[0].findAll('.kv-row')[1]
    // 自填 tokens = 窗口 Σself_tokens_total（12480+0+300，沿设计稿原型口径）
    expect(self.text()).toContain('自填模式（用户自带密钥）：tokens 12,780 · 不计成本')
    expect(self.text()).toContain('用户自带密钥')
    const badge = self.find('.pill.nocost')
    expect(badge.text()).toBe('不计成本')
  })

  it('卡 B：T12/T13/T14 逐字；窗口合计命中率 = Σhit/(Σhit+Σmiss) 格式 NN.N%', async () => {
    const w = await mountView()
    await openTel(w)
    const cards = w.findAll('.tel-2col .tel-card')
    const cardB = cards[0]
    expect(cardB.find('.tc-head').text()).toBe('缓存命中率')
    expect(cardB.find('.tc-sub').text()).toBe('命中率 = Σ缓存命中 tokens ÷（Σ命中 + Σ未命中）· 仅统计上游返回缓存字段的调用')
    expect(cardB.find('.tc-big-label').text()).toBe('窗口合计命中率')
    // (96512+40000)/(96512+85888+40000+80000) = 136512/302400 ≈ 45.1%（缺失日不参与）
    expect(cardB.find('.tc-big').text()).toBe('45.1%')
    const ths = cardB.findAll('thead th').map((t) => t.text())
    expect(ths).toEqual(['日期', '缓存命中 tokens', '未命中 tokens', '命中率'])
  })

  it('卡 C：T16/T17 说明逐字；T18 表头；T19 状态徽标四态；后端排序直渲染', async () => {
    const w = await mountView()
    await openTel(w)
    const cardC = w.findAll('.tel-2col .tel-card')[1]
    expect(cardC.find('.tc-head').text()).toBe('工具用量')
    expect(cardC.find('.tc-sub').text()).toBe('按工具名 × 状态聚合；search 为当前唯一生产工具（本视图即搜索用量面板）')
    expect(cardC.findAll('thead th').map((t) => t.text())).toEqual(['工具名', '状态', '次数', '平均耗时'])
    const pills = cardC.findAll('.pill')
    expect(pills.map((p) => p.text())).toEqual(['成功', '成功', '失败', '超时', '已取消'])
    expect(pills[0].classes()).toContain('st-ok')
    expect(pills[2].classes()).toContain('st-error')
    expect(pills[3].classes()).toContain('st-timeout')
    expect(pills[4].classes()).toContain('st-cancelled')
    expect(cardC.findAll('tbody tr')[1].text()).toContain('search')
    expect(cardC.findAll('tbody tr')[1].text()).toContain('42')
    expect(cardC.findAll('tbody tr')[1].text()).toContain('2,130 ms')
  })

  it('卡 D：T21 标题；T22 六列表头逐字（自填列名括号六字不差）；缺失时段 T23 琥珀行', async () => {
    const w = await mountView()
    await openTel(w)
    const cardD = w.findAll('.tel-card').at(-1)!
    expect(cardD.find('.tc-head').text()).toBe('按日成本明细')
    expect(cardD.findAll('thead th').map((t) => t.text())).toEqual([
      '日期', '输入 tokens', '输出 tokens', '缓存命中 tokens', '成本估算', '自填 tokens（不计成本）',
    ])
    // 3 数据日 < 7 天窗口 → 缺失时段琥珀行（不估算补齐）
    expect(cardD.find('.gap-note').text()).toBe('部分时段无统计数据：仅显示已有数据（不估算补齐）')
    expect(cardD.findAll('tbody tr')).toHaveLength(3) // 无数据日不造空行
  })
})

describe('单价未配置态（定夺⑥：tokens 如实、成本「—」、warning 提示）', () => {
  function nopriceFixture(): AdminTelemetry {
    const base = telFixture()
    return telFixture({
      price: { configured: false, input_per_mtok: null, output_per_mtok: null, cache_hit_per_mtok: null },
      today_cost: { ...base.today_cost, cost_input: null, cost_output: null, cost_cache_hit: null, cost_total: null },
      daily: base.daily.map((d) => ({ ...d, cost_total: null })),
    })
  }

  it('成本位全「—」+ T10 提示逐字 + T11 单价行值；不出现任何成本数字（铁律 5 变异断言）', async () => {
    backendMock.adminTelemetry.mockResolvedValue(nopriceFixture())
    const w = await mountView()
    await openTel(w)
    const cardA = w.findAll('.tel-card')[0]
    expect(cardA.find('.tc-big').text()).toBe('—')
    expect(cardA.findAll('.bd-cost').map((e) => e.text())).toEqual(['—', '—', '—'])
    expect(cardA.find('.warn-hint').text()).toBe('单价未配置：请在 backend/.env 配置 AI_CHAT_PRICE_INPUT / AI_CHAT_PRICE_OUTPUT / AI_CHAT_PRICE_CACHE_HIT 并重启后端，即可启用每日成本估算')
    expect(cardA.find('.kv-row .kv-miss').text()).toBe('单价三变量未配置')
    // 变异断言：卡 A 内无任何 ¥ 数字残留；tokens 如实显示不隐藏
    expect(cardA.text()).not.toMatch(/¥\s*\d/)
    expect(cardA.text()).toContain('182,400 tokens')
    // 卡 D 成本列「—」；tokens 列如实
    const cardD = w.findAll('.tel-card').at(-1)!
    const costCells = cardD.findAll('tbody tr').map((r) => r.findAll('td')[4].text())
    expect(costCells).toEqual(['—', '—', '—'])
    // 命中率/工具用量区不受影响
    expect(w.find('.tel-2col .tel-card .tc-big').text()).toBe('45.1%')
  })

  it('今日无遥测行：大数值「—」+ 右侧注「今日暂无遥测行」（不显 ¥0）', async () => {
    backendMock.adminTelemetry.mockResolvedValue(telFixture({
      daily: [{ day: isoDay(1), tokens_prompt: 10, tokens_completion: 5, cache_hit_tokens: 2, cache_miss_tokens: 8, cache_rate: 0.2, cost_total: 0.0001, self_tokens_total: 0 }],
    }))
    const w = await mountView()
    await openTel(w)
    const cardA = w.findAll('.tel-card')[0]
    expect(cardA.find('.tc-big').text()).toBe('—')
    expect(cardA.find('.tc-big-sub').text()).toBe(`${TODAY} · 今日暂无遥测行`)
  })
})

describe('缓存缺失语义（0 与缺失严格区分，铁律 5）', () => {
  it('缓存字段全缺失：窗口合计位「缺失」徽标（不显 0%/NaN）；按日行「—」+ 缺失徽标', async () => {
    const base = telFixture()
    backendMock.adminTelemetry.mockResolvedValue(telFixture({
      daily: base.daily.map((d) => ({ ...d, cache_hit_tokens: null, cache_miss_tokens: null, cache_rate: null })),
    }))
    const w = await mountView()
    await openTel(w)
    const cardB = w.findAll('.tel-2col .tel-card')[0]
    expect(cardB.find('.tc-big').exists()).toBe(false) // 不显数值
    expect(cardB.find('.tc-big-row .pill.miss').text()).toBe('缺失')
    expect(cardB.text()).not.toContain('0.0%')
    expect(cardB.text()).not.toContain('NaN')
    const rows = cardB.findAll('tbody tr')
    expect(rows[0].findAll('td')[1].text()).toBe('—')
    expect(rows[0].find('.pill.miss').text()).toBe('缺失')
    // 卡 D 缓存列「—」+ title 说明
    const cardD = w.findAll('.tel-card').at(-1)!
    const hitCell = cardD.findAll('tbody tr')[0].findAll('td')[3]
    expect(hitCell.text()).toBe('—')
    expect(hitCell.attributes('title')).toBe('上游未返回缓存字段')
  })

  it('合法 0 值如实显 0（首现 miss 日 hit=0）：与缺失徽标视觉语言不同', async () => {
    backendMock.adminTelemetry.mockResolvedValue(telFixture({
      daily: [
        { day: TODAY, tokens_prompt: 100, tokens_completion: 50, cache_hit_tokens: 0, cache_miss_tokens: 183, cache_rate: 0, cost_total: 0.001, self_tokens_total: 0 },
        { day: isoDay(1), tokens_prompt: 100, tokens_completion: 50, cache_hit_tokens: null, cache_miss_tokens: null, cache_rate: null, cost_total: 0.001, self_tokens_total: 0 },
      ],
    }))
    const w = await mountView()
    await openTel(w)
    const cardB = w.findAll('.tel-2col .tel-card')[0]
    const rows = cardB.findAll('tbody tr')
    expect(rows[0].findAll('td')[1].text()).toBe('0') // 合法 0 如实
    expect(rows[0].findAll('td')[3].text()).toBe('0.0%')
    expect(rows[1].findAll('td')[1].text()).toBe('—') // 缺失不显 0
    expect(rows[1].find('.pill.miss').exists()).toBe(true)
  })
})

describe('空窗口 / 工具空态 / 加载 / 失败', () => {
  it('空窗口：T28 空盒（非错误态）；工具行与时间窗保留可切换', async () => {
    backendMock.adminTelemetry.mockResolvedValue(telFixture({ daily: [], tools: [], today_cost: { day: TODAY, tokens_prompt: 0, tokens_completion: 0, cache_hit_tokens: 0, cost_input: 0, cost_output: 0, cost_cache_hit: 0, cost_total: 0, self_tokens_total: 0 } }))
    const w = await mountView()
    await openTel(w)
    expect(w.find('.tel-empty').exists()).toBe(true)
    expect(w.text()).toContain('窗口内无遥测数据')
    expect(w.text()).toContain('——新部署或尚无对话的日子属正常现象')
    expect(w.findAll('.tel-card')).toHaveLength(0)
    expect(w.findAll('.win-seg button')).toHaveLength(3) // 工具行保留
  })

  it('卡 C 空态：有 llm 行零 tool 行 → T20「窗口内无工具调用记录」', async () => {
    backendMock.adminTelemetry.mockResolvedValue(telFixture({ tools: [] }))
    const w = await mountView()
    await openTel(w)
    const cardC = w.findAll('.tel-2col .tel-card')[1]
    expect(cardC.find('.tc-empty').text()).toBe('窗口内无工具调用记录')
    expect(cardC.find('table').exists()).toBe(false)
  })

  it('加载态：spinner + T26「正在加载遥测数据…」', async () => {
    let resolve!: (v: unknown) => void
    backendMock.adminTelemetry.mockReturnValue(new Promise((r) => { resolve = r }))
    const w = await mountView()
    await w.findAll('.adm-tabs button').find((b) => b.text() === '遥测')!.trigger('click')
    await flushPromises()
    expect(w.find('.state-hint').exists()).toBe(true)
    expect(w.find('.state-hint').text()).toContain('正在加载遥测数据…')
    expect(w.find('.spinner').exists()).toBe(true)
    resolve(telFixture())
    await flushPromises()
    expect(w.find('.tc-head').text()).toBe('每日成本估算')
  })

  it('失败态：T27 banner + 重试；重试保留当前时间窗选择（不清状态）', async () => {
    backendMock.adminTelemetry.mockRejectedValue(new Error('请求失败（500）'))
    const w = await mountView()
    await w.findAll('.adm-tabs button').find((b) => b.text() === '遥测')!.trigger('click')
    await flushPromises()
    expect(w.find('.err-banner').text()).toContain('遥测数据加载失败')
    // 先切 14 天（失败中的窗口切换仍生效并重拉）
    backendMock.adminTelemetry.mockRejectedValue(new Error('请求失败（500）'))
    await w.findAll('.win-seg button')[1].trigger('click')
    await flushPromises()
    expect(backendMock.adminTelemetry).toHaveBeenLastCalledWith(14)
    // 重试：保留 14 天选择
    backendMock.adminTelemetry.mockResolvedValue(telFixture({ window: { days: 14, date_from: isoDay(13), date_to: TODAY } }))
    await w.find('.err-banner button').trigger('click')
    await flushPromises()
    expect(backendMock.adminTelemetry).toHaveBeenLastCalledWith(14)
    expect(w.find('.tc-head').text()).toBe('每日成本估算')
    expect(w.findAll('.win-seg button')[1].classes()).toContain('on')
  })
})

describe('时间窗切换（行为·交互位置：仅重载遥测面板）', () => {
  it('切换近 14 天：adminTelemetry(14) 重拉；不触发其他面板请求；tab 停留遥测', async () => {
    const w = await mountView()
    await openTel(w)
    const usersCalls = backendMock.adminUsersPage.mock.calls.length
    const overviewCalls = backendMock.adminOverview.mock.calls.length
    backendMock.adminTelemetry.mockResolvedValue(telFixture({ window: { days: 14, date_from: isoDay(13), date_to: TODAY } }))
    await w.findAll('.win-seg button')[1].trigger('click')
    await flushPromises()
    expect(backendMock.adminTelemetry).toHaveBeenLastCalledWith(14)
    expect(backendMock.adminUsersPage.mock.calls.length).toBe(usersCalls)
    expect(backendMock.adminOverview.mock.calls.length).toBe(overviewCalls)
    expect(w.find('.retention-note').exists()).toBe(true)
    expect(w.findAll('.adm-tabs button')[2].classes()).toContain('on')
  })
})
