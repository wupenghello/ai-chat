/**
 * design-iter-12 §1~§3（REQ-029 iter-12 T2，REQ-025 零回退复验）：
 * 403 态 / 概览统计卡四指标与三态 / 用户搜索（防抖/Enter/清除/空态/高亮）/
 * 双列表分页（页码/边界/单页隐藏/窗口折叠） / 排序后端化 / 封禁与调配额（沿用） /
 * 用量筛选 + distinct_days 缺失标注。
 * 挂真实 vue-router（memory history）与真实 Pinia，仅 mock backend API。
 * 既有 REQ-025 用例按 design-iter-12 定夺⑤登记适配为新载体断言（spec 适配 ≠ 口径回退，
 * 复验以 design-iter-12 §7.2 条 7/8/9 为准）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

const backendMock = vi.hoisted(() => ({
  adminUsers: vi.fn(),
  adminUsersPage: vi.fn(),
  adminOverview: vi.fn(),
  adminUsagePage: vi.fn(),
  banUser: vi.fn(),
  unbanUser: vi.fn(),
  setUserQuota: vi.fn(),
}))

vi.mock('../../api/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/backend')>()),
  backend: backendMock,
}))

import AdminView from '../AdminView.vue'
import { useAuthStore } from '../../stores/auth'
import { useToastStore } from '../../stores/toast'

const ADMIN = { id: 1, username: '猫南北', is_admin: true }
const NORMAL = { id: 2, username: 'spam-bot', is_admin: false }

const usersFixture = [
  {
    id: 1, username: '猫南北', is_admin: true, banned: false,
    created_at: '2026-08-16 09:00:00', mode: 'unified',
    quota_override: null, daily_limit: 30, used_today: 3,
  },
  {
    id: 2, username: 'spam-bot', is_admin: false, banned: false,
    created_at: '2026-08-16 10:00:00', mode: 'self',
    quota_override: 200, daily_limit: 200, used_today: 200,
  },
]

function usersPageFixture(items = usersFixture, total = items.length, offset = 0) {
  return { items, total, limit: 20, offset }
}

function overviewFixture(used: number) {
  return {
    day: '2026-08-16', unified_used: used, unified_daily_total: 2000,
    total_users: 47, today_requests: 86, today_tokens: 412530,
  }
}

function usagePageFixture(items: Array<{ day: string; user_id: number; username: string; requests: number; tokens: number }>, distinctDays = new Set(items.map((r) => r.day)).size) {
  return { items, total: items.length, limit: 20, offset: 0, distinct_days: distinctDays }
}

let wrapper: VueWrapper | null = null

async function mountView(asAdmin = true): Promise<{ w: VueWrapper; router: Router }> {
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
  return { w, router }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  backendMock.adminUsers.mockResolvedValue(usersFixture)
  backendMock.adminUsersPage.mockResolvedValue(usersPageFixture())
  backendMock.adminOverview.mockResolvedValue(overviewFixture(100))
  backendMock.adminUsagePage.mockResolvedValue(usagePageFixture([]))
  backendMock.banUser.mockResolvedValue({ detail: 'ok' })
  backendMock.unbanUser.mockResolvedValue({ detail: 'ok' })
  backendMock.setUserQuota.mockResolvedValue({ user_id: 2, quota_override: 5 })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('403 态与入口（design-iter-12 §5.2 / REQ-025 零回退）', () => {
  it('普通用户：渲染 403 卡，不发起任何后台请求', async () => {
    const { w } = await mountView(false)
    expect(w.text()).toContain('无权访问（403）')
    expect(w.text()).toContain('此页面不会展示任何后台数据')
    expect(backendMock.adminUsersPage).not.toHaveBeenCalled()
    expect(backendMock.adminUsers).not.toHaveBeenCalled()
    expect(backendMock.adminOverview).not.toHaveBeenCalled()
    expect(backendMock.adminUsagePage).not.toHaveBeenCalled()
  })

  it('403 卡「返回主界面」跳 /', async () => {
    const { w, router } = await mountView(false)
    await w.find('.btn-primary').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
  })
})

describe('概览统计卡（design-iter-12 §1.2，定夺④⑤）', () => {
  it('四卡指标与数值：总用户数 / 今日请求 / 今日 token / 统一 key 用量 + 进度条', async () => {
    const { w } = await mountView()
    const cards = w.findAll('.stat-card')
    expect(cards).toHaveLength(4)
    expect(cards[0].text()).toContain('总用户数')
    expect(cards[0].text()).toContain('47')
    expect(cards[0].text()).toContain('含已封禁与管理员')
    expect(cards[1].text()).toContain('今日请求')
    expect(cards[1].text()).toContain('86')
    expect(cards[2].text()).toContain('今日 token')
    expect(cards[2].text()).toContain('412,530')
    expect(cards[3].text()).toContain('统一 key 每日用量')
    expect(cards[3].text()).toContain('100 / 2,000 次')
    expect(cards[3].text()).toContain('剩余 1,900 次')
    const fill = w.find('.s-fill')
    expect(fill.attributes('style')).toContain('width: 5%')
    expect(fill.classes()).not.toContain('near')
  })

  it('全站配额三态（定夺⑤新载体）：常态条退役入卡 / ≥80% 琥珀 / 熔断红，警示条文案逐字沿用', async () => {
    const { w: w1 } = await mountView()
    expect(w1.find('.site-bar').exists()).toBe(false) // 常态：警示条不渲染，数值由卡 4 承载
    w1.unmount()

    backendMock.adminOverview.mockResolvedValue(overviewFixture(1600))
    const { w: w2 } = await mountView()
    expect(w2.find('.site-bar').classes()).toContain('near')
    expect(w2.find('.site-bar').text()).toContain('统一 key 每日总量 2,000 · 今日已用 1,600（已接近上限，请关注消耗）')
    expect(w2.find('.s-fill').classes()).toContain('near')
    w2.unmount()

    backendMock.adminOverview.mockResolvedValue(overviewFixture(2000))
    const { w: w3 } = await mountView()
    expect(w3.find('.site-bar').classes()).toContain('burst')
    expect(w3.find('.site-bar').text()).toContain('已暂停全站新对话请求，明日 00:00 自动恢复；自填 key 用户不受影响')
    expect(w3.find('.s-fill').classes()).toContain('burst')
  })
})

describe('用户列表（design-iter-12 §2，REQ-025 六列与治理零回退）', () => {
  it('管理员：加载用户列表，六列全字段', async () => {
    const { w } = await mountView()
    expect(backendMock.adminUsersPage).toHaveBeenCalledWith({ limit: 20, offset: 0 })
    const ths = w.findAll('thead th').map((t) => t.text())
    expect(ths).toEqual(['用户名', '注册时间', '状态', '密钥模式', '配额', '操作'])
    expect(w.text()).toContain('猫南北')
    expect(w.text()).toContain('spam-bot')
    expect(w.text()).toContain('管理员')
    expect(w.text()).toContain('统一 key')
    expect(w.text()).toContain('自填 key')
  })

  it('档位徽标区分默认档与覆盖；用尽显示「今日已用尽」', async () => {
    const { w } = await mountView()
    const tiers = w.findAll('.pill.tier').map((t) => t.text())
    expect(tiers).toEqual(['免费档', '自定义 200'])
    expect(w.findAll('.pill.tier')[1].classes()).toContain('custom')
    expect(w.text()).toContain('今日 3/30')
    expect(w.text()).toContain('今日已用尽')
  })

  it('管理员行「封禁」禁用 + title 阻止', async () => {
    const { w } = await mountView()
    const banBtns = w.findAll('button.mini.danger')
    expect(banBtns).toHaveLength(2) // 管理员行（禁用）+ 普通行（可用）
    expect(banBtns[0].attributes('disabled')).toBeDefined()
    expect(banBtns[0].attributes('title')).toBe('管理员本人不可封禁')
    expect(banBtns[1].attributes('disabled')).toBeUndefined()
  })

  it('封禁：确认模态 danger 实底 → 生效后列表与统计卡重载 + toast', async () => {
    const { w } = await mountView()
    // 注意：disabled 属性 getAttribute 返回 ''（假值），须以 DOM property 判定
    const btn = w.findAll('button.mini').find((b) => b.text() === '封禁' && !(b.element as HTMLButtonElement).disabled)
    await btn!.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('封禁该用户？')
    expect(document.body.textContent).toContain('云端数据保留')
    const confirm = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '确认封禁',
    )
    await confirm!.dispatchEvent(new Event('click'))
    await flushPromises()
    expect(backendMock.banUser).toHaveBeenCalledWith(2)
    expect(backendMock.adminUsersPage).toHaveBeenCalledTimes(2) // 列表重载（§2.1：含统计卡）
    expect(backendMock.adminOverview).toHaveBeenCalledTimes(2)
    expect(useToastStore().items.some((t) => t.message.includes('已封禁 spam-bot'))).toBe(true)
  })

  it('封禁用户显示解封按钮，直接生效无确认', async () => {
    backendMock.adminUsersPage.mockResolvedValue(
      usersPageFixture([{ ...usersFixture[0] }, { ...usersFixture[1], banned: true }]),
    )
    const { w } = await mountView()
    expect(w.text()).toContain('已封禁')
    expect(w.findAll('.used')[1].text()).toBe('—') // 封禁用户计数冻结显示「—」（iter-8#13）
    const unbanBtn = w.findAll('button.mini').find((b) => b.text() === '解封')
    await unbanBtn!.trigger('click')
    await flushPromises()
    expect(backendMock.unbanUser).toHaveBeenCalledWith(2)
  })

  it('拉取失败：错误 banner + 重试（保留当前 tab）', async () => {
    backendMock.adminUsersPage.mockRejectedValue(new Error('网络错误，请检查网络后重试'))
    const { w } = await mountView()
    expect(w.find('.err-banner').text()).toContain('网络错误')
    backendMock.adminUsersPage.mockResolvedValue(usersPageFixture())
    await w.find('.err-banner button').trigger('click')
    await flushPromises()
    expect(w.find('table').exists()).toBe(true)
  })
})

describe('用户搜索（design-iter-12 §2.1）', () => {
  it('防抖 300ms 触发；Enter 立即；清除重置回第 1 页', async () => {
    vi.useFakeTimers()
    try {
      const { w } = await mountView()
      const input = w.find('.u-search input')
      await input.setValue('spam')
      expect(backendMock.adminUsersPage).toHaveBeenCalledTimes(1) // 防抖内不触发（仅初始加载）
      await vi.advanceTimersByTimeAsync(300)
      await flushPromises()
      expect(backendMock.adminUsersPage).toHaveBeenLastCalledWith({ search: 'spam', limit: 20, offset: 0 })

      await input.setValue('sp')
      await input.trigger('keydown.enter') // Enter 立即，不等防抖
      await flushPromises()
      expect(backendMock.adminUsersPage).toHaveBeenLastCalledWith({ search: 'sp', limit: 20, offset: 0 })

      await w.find('.u-clear').trigger('click') // 清除 = 重置（无 search 参数）
      await flushPromises()
      expect(backendMock.adminUsersPage).toHaveBeenLastCalledWith({ limit: 20, offset: 0 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('搜索命中主色高亮（mark.hl，沿 REQ-016 语法）', async () => {
    backendMock.adminUsersPage.mockResolvedValue(usersPageFixture([usersFixture[1]]))
    const { w } = await mountView()
    const input = w.find('.u-search input')
    await input.setValue('spam')
    await input.trigger('keydown.enter')
    await flushPromises()
    const mark = w.find('.uname mark.hl')
    expect(mark.text()).toBe('spam')
    expect(w.find('.uname').text()).toBe('spam-bot')
  })

  it('搜索空态：未找到匹配空盒 + 副注 + 清除搜索动作（非错误态）', async () => {
    backendMock.adminUsersPage.mockResolvedValue(usersPageFixture([], 0))
    const { w } = await mountView()
    const input = w.find('.u-search input')
    await input.setValue('nobody')
    await input.trigger('keydown.enter')
    await flushPromises()
    expect(w.text()).toContain('找到 0 个用户')
    expect(w.text()).toContain('未找到匹配「nobody」的用户')
    expect(w.text()).toContain('用户名搜索大小写不敏感')
    expect(w.find('.u-empty').exists()).toBe(true)
    expect(w.find('.tbl-card').exists()).toBe(false)
    await w.findAll('button').find((b) => b.text() === '清除搜索')!.trigger('click')
    await flushPromises()
    expect(w.find('.u-empty').exists()).toBe(false)
  })
})

describe('用户分页（design-iter-12 §2.1，定夺②③）', () => {
  const users45 = Array.from({ length: 45 }, (_, i) => ({
    id: i + 1,
    username: `u${String(i + 1).padStart(2, '0')}`,
    is_admin: i === 0,
    banned: false,
    created_at: '2026-08-16 10:00:00',
    mode: 'unified' as const,
    quota_override: null,
    daily_limit: 30,
    used_today: 0,
  }))
  const pageAt = (offset: number) =>
    usersPageFixture(users45.slice(offset, offset + 20), 45, Math.min(offset, 40))

  it('翻页：页码渲染/当前页高亮/边界禁用/offset 正确传递', async () => {
    backendMock.adminUsersPage.mockImplementation(async (p: { offset?: number }) =>
      pageAt(p.offset ?? 0),
    )
    const { w } = await mountView()
    expect(w.text()).toContain('共 45 个用户 · 3 页')
    const pager = w.find('.pager')
    const labels = pager.findAll('button').map((b) => b.text())
    expect(labels).toEqual(['‹', '1', '2', '3', '›'])
    expect(pager.findAll('button')[1].classes()).toContain('on')
    expect(pager.findAll('button')[0].attributes('disabled')).toBeDefined() // 首页边界
    expect(pager.findAll('button')[4].attributes('disabled')).toBeUndefined()

    await pager.findAll('button')[2].trigger('click') // 第 2 页
    await flushPromises()
    expect(backendMock.adminUsersPage).toHaveBeenLastCalledWith({ limit: 20, offset: 20 })
    expect(w.find('.pager').findAll('button')[2].classes()).toContain('on')

    // 末页：下一页禁用（信封 offset 回写后当前页 = 3）
    await w.findAll('.pg-btn')[3].trigger('click')
    await flushPromises()
    expect(w.find('.pager').findAll('button')[4].attributes('disabled')).toBeDefined()
  })

  it('单页隐藏分页控件，仅保留「共 N 个用户」（定夺③）', async () => {
    const { w } = await mountView() // 默认 fixture total 2 ≤ 20
    expect(w.find('.pager').exists()).toBe(false)
    expect(w.text()).toContain('共 2 个用户')
    expect(w.text()).not.toContain('· 1 页')
  })

  it('页码 >7 页窗口折叠「…」（§2.1）', async () => {
    backendMock.adminUsersPage.mockImplementation(async () =>
      usersPageFixture(users45.slice(0, 20), 200, 0),
    )
    const { w } = await mountView()
    const pagerTexts = w.find('.pager').findAll('.pg-btn, .pg-ellipsis').map((el) => el.text())
    expect(pagerTexts).toEqual(['‹', '1', '2', '…', '9', '10', '›'])
  })
})

describe('调配额模态（design-iter-12 §2 治理沿用，REQ-025 零回退）', () => {
  async function openQuotaModal(w: VueWrapper) {
    const btn = w.findAll('button.mini').filter((b) => b.text() === '调配额')[1] // spam 行
    await btn!.trigger('click')
    await flushPromises()
  }

  it('正整数校验：小数不入库，行内错误文案', async () => {
    const { w } = await mountView()
    await openQuotaModal(w)
    expect(document.body.textContent).toContain('调整配额')
    const radios = [...document.querySelectorAll('input[type="radio"]')]
    const custom = radios.at(-1) as HTMLInputElement
    custom.checked = true
    await custom.dispatchEvent(new Event('change'))
    const input = document.querySelector('.q-num') as HTMLInputElement
    input.value = '1.5'
    await input.dispatchEvent(new Event('input'))
    const save = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '保存',
    )
    await save!.dispatchEvent(new Event('click'))
    await flushPromises()
    expect(document.body.textContent).toContain('请输入正整数（≥1），不能用小数或留空')
    expect(backendMock.setUserQuota).not.toHaveBeenCalled()
  })

  it('合法 N 保存：覆盖入参与 toast；默认档 = null', async () => {
    const { w } = await mountView()
    await openQuotaModal(w)
    const radios = [...document.querySelectorAll('input[type="radio"]')]
    const custom = radios.at(-1) as HTMLInputElement
    custom.checked = true
    await custom.dispatchEvent(new Event('change'))
    const input = document.querySelector('.q-num') as HTMLInputElement
    input.value = '5'
    await input.dispatchEvent(new Event('input'))
    const save = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '保存',
    )
    await save!.dispatchEvent(new Event('click'))
    await flushPromises()
    expect(backendMock.setUserQuota).toHaveBeenCalledWith(2, 5)
    expect(useToastStore().items.some((t) => t.message.includes('自下一次请求生效'))).toBe(true)
  })
})

describe('用量列表（design-iter-12 §3，筛选沿用 + 排序后端化定夺⑥）', () => {
  const usageFixture = [
    { day: '2026-08-15', user_id: 1, username: '猫南北', requests: 10, tokens: 100 },
    { day: '2026-08-16', user_id: 2, username: 'spam-bot', requests: 3, tokens: 30 },
    { day: '2026-08-16', user_id: 1, username: '猫南北', requests: 7, tokens: 70 },
  ]

  async function openUsageTab(w: VueWrapper) {
    const tab = w.findAll('.adm-tabs button').find((b) => b.text() === '用量列表')
    await tab!.trigger('click')
  }

  it('默认日期降序（服务端序直渲染）；列头点击带 sort_key/sort_dir 且 offset 重置 0', async () => {
    backendMock.adminUsagePage.mockResolvedValue(usagePageFixture(usageFixture))
    const { w } = await mountView()
    expect(backendMock.adminUsagePage).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort_key: 'day', sort_dir: 'desc', limit: 20, offset: 0 }),
    )
    await openUsageTab(w)
    const usagePanel = w.findAll('.panel')[1] // 用户表 v-show 隐藏但仍在 DOM，按面板作用域
    const firstDays = usagePanel.findAll('tbody tr').map((r) => r.find('td').text())
    expect(firstDays).toEqual(['2026-08-15', '2026-08-16', '2026-08-16']) // 服务端返回序直渲染

    // 点击「请求数」列头 → 请求带 sort_key=requests / sort_dir=desc / offset=0（定夺⑥）
    const byReq = [...usageFixture].sort((a, b) => b.requests - a.requests)
    backendMock.adminUsagePage.mockResolvedValue(usagePageFixture(byReq))
    const reqHeader = usagePanel.findAll('th').find((t) => t.text().startsWith('请求数'))
    await reqHeader!.trigger('click')
    await flushPromises()
    expect(backendMock.adminUsagePage).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort_key: 'requests', sort_dir: 'desc', offset: 0 }),
    )
    const reqCells = w.findAll('.panel')[1].findAll('tbody tr').map((r) => r.findAll('td')[2].text())
    expect(reqCells).toEqual(['10', '7', '3'])
    expect(w.text()).toContain('共 3 条')
  })

  it('筛选变化触发重查且 offset 重置 0，用户下拉含「全部用户」（全量数据源）', async () => {
    backendMock.adminUsagePage.mockResolvedValue(usagePageFixture(usageFixture))
    const { w } = await mountView()
    await openUsageTab(w)
    const select = w.findAll('.panel')[1].find('.adm-toolbar select')
    expect(select.text()).toContain('全部用户')
    expect(select.text()).toContain('猫南北') // 下拉选项来自纯列表全量（§4.1 兼容形态）
    await select.setValue('2')
    expect(backendMock.adminUsagePage).toHaveBeenLastCalledWith(
      expect.objectContaining({ user_id: 2, offset: 0 }),
    )
  })

  it('缺失时段：信封 distinct_days 与窗口天数比对 → 琥珀行「不估算补齐」（§3.1/§4.2）', async () => {
    // 默认窗口 = 最近 7 天；信封 distinct_days=1 → 缺失标注（全窗口判定不受分页影响）
    const today = new Date()
    const z = (n: number) => String(n).padStart(2, '0')
    const iso = `${today.getFullYear()}-${z(today.getMonth() + 1)}-${z(today.getDate())}`
    backendMock.adminUsagePage.mockResolvedValue(
      usagePageFixture([{ day: iso, user_id: 1, username: '猫南北', requests: 1, tokens: 10 }], 1),
    )
    const { w } = await mountView()
    await openUsageTab(w)
    expect(w.find('.gap-note').text()).toContain('仅显示已有数据（不估算补齐）')
  })

  it('空态：新用户/新部署说明；计数 0 且无分页控件', async () => {
    const { w } = await mountView()
    await openUsageTab(w)
    const usagePanel = w.findAll('.panel')[1]
    expect(w.text()).toContain('暂无用量数据')
    expect(w.text()).toContain('共 0 条')
    expect(usagePanel.find('.tbl-card').exists()).toBe(false)
    expect(usagePanel.find('.page-row').exists()).toBe(false)
  })
})
