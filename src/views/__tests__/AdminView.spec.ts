/**
 * design-iter-8 §1（REQ-025 iter-8 T2）：管理后台——403 态 / 六列 / 全站条三态 /
 * 封禁（确认模态 + 管理员行禁用）/ 调配额（正整数校验不入库）/ 用量排序与缺失标注。
 * 挂真实 vue-router（memory history）与真实 Pinia，仅 mock backend API。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

const backendMock = vi.hoisted(() => ({
  adminUsers: vi.fn(),
  adminOverview: vi.fn(),
  adminUsage: vi.fn(),
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

function overviewFixture(used: number) {
  return { day: '2026-08-16', unified_used: used, unified_daily_total: 2000 }
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
  backendMock.adminOverview.mockResolvedValue(overviewFixture(100))
  backendMock.adminUsage.mockResolvedValue([])
  backendMock.banUser.mockResolvedValue({ detail: 'ok' })
  backendMock.unbanUser.mockResolvedValue({ detail: 'ok' })
  backendMock.setUserQuota.mockResolvedValue({ user_id: 2, quota_override: 5 })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('403 态与入口（design-iter-8 §1.5 / 定夺 ③）', () => {
  it('普通用户：渲染 403 卡，不发起任何后台请求', async () => {
    const { w } = await mountView(false)
    expect(w.text()).toContain('无权访问（403）')
    expect(w.text()).toContain('此页面不会展示任何后台数据')
    expect(backendMock.adminUsers).not.toHaveBeenCalled()
    expect(backendMock.adminUsage).not.toHaveBeenCalled()
  })

  it('403 卡「返回主界面」跳 /', async () => {
    const { w, router } = await mountView(false)
    await w.find('.btn-primary').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
  })
})

describe('用户列表（design-iter-8 §1.2）', () => {
  it('管理员：加载用户与全站条，六列全字段', async () => {
    const { w } = await mountView()
    expect(backendMock.adminUsers).toHaveBeenCalledTimes(1)
    expect(backendMock.adminOverview).toHaveBeenCalledTimes(1)
    const ths = w.findAll('thead th').map((t) => t.text())
    expect(ths).toEqual(['用户名', '注册时间', '状态', '密钥模式', '配额', '操作'])
    expect(w.text()).toContain('猫南北')
    expect(w.text()).toContain('spam-bot')
    expect(w.text()).toContain('管理员')
    expect(w.text()).toContain('统一 key')
    expect(w.text()).toContain('自填 key')
    expect(w.text()).toContain('统一 key 每日总量 2,000 · 今日已用 100')
  })

  it('档位徽标区分默认档与覆盖；用尽显示「今日已用尽」', async () => {
    const { w } = await mountView()
    const tiers = w.findAll('.pill.tier').map((t) => t.text())
    expect(tiers).toEqual(['免费档', '自定义 200'])
    expect(w.findAll('.pill.tier')[1].classes()).toContain('custom')
    expect(w.text()).toContain('今日 3/30')
    expect(w.text()).toContain('今日已用尽')
  })

  it('全站配额条三态：常态 / ≥80% 琥珀 / 熔断红 + 暂停文案', async () => {
    const { w: w1 } = await mountView()
    expect(w1.find('.site-bar').classes()).not.toContain('near')
    w1.unmount()

    backendMock.adminOverview.mockResolvedValue(overviewFixture(1600))
    const { w: w2 } = await mountView()
    expect(w2.find('.site-bar').classes()).toContain('near')
    w2.unmount()

    backendMock.adminOverview.mockResolvedValue(overviewFixture(2000))
    const { w: w3 } = await mountView()
    expect(w3.find('.site-bar').classes()).toContain('burst')
    expect(w3.text()).toContain('已暂停全站新对话请求，明日 00:00 自动恢复；自填 key 用户不受影响')
  })

  it('管理员行「封禁」禁用 + title 阻止', async () => {
    const { w } = await mountView()
    const banBtns = w.findAll('button.mini.danger')
    expect(banBtns).toHaveLength(2) // 管理员行（禁用）+ 普通行（可用）
    expect(banBtns[0].attributes('disabled')).toBeDefined()
    expect(banBtns[0].attributes('title')).toBe('管理员本人不可封禁')
    expect(banBtns[1].attributes('disabled')).toBeUndefined()
  })

  it('封禁：确认模态 danger 实底 → 生效后重载 + toast', async () => {
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
    expect(backendMock.adminUsers).toHaveBeenCalledTimes(2) // 生效后重载
    expect(useToastStore().items.some((t) => t.message.includes('已封禁 spam-bot'))).toBe(true)
  })

  it('封禁用户显示解封按钮，直接生效无确认', async () => {
    backendMock.adminUsers.mockResolvedValue([
      { ...usersFixture[0] },
      { ...usersFixture[1], banned: true },
    ])
    const { w } = await mountView()
    expect(w.text()).toContain('已封禁')
    expect(w.findAll('.used')[1].text()).toBe('—') // 封禁用户计数冻结显示「—」（走查 13）
    const unbanBtn = w.findAll('button.mini').find((b) => b.text() === '解封')
    await unbanBtn!.trigger('click')
    await flushPromises()
    expect(backendMock.unbanUser).toHaveBeenCalledWith(2)
  })

  it('拉取失败：错误 banner + 重试（保留当前 tab）', async () => {
    backendMock.adminUsers.mockRejectedValue(new Error('网络错误，请检查网络后重试'))
    const { w } = await mountView()
    expect(w.find('.err-banner').text()).toContain('网络错误')
    backendMock.adminUsers.mockResolvedValue(usersFixture)
    await w.find('.err-banner button').trigger('click')
    await flushPromises()
    expect(w.find('table').exists()).toBe(true)
  })
})

describe('调配额模态（design-iter-8 §1.3）', () => {
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

describe('用量列表（design-iter-8 §1.4）', () => {
  const usageFixture = [
    { day: '2026-08-15', user_id: 1, username: '猫南北', requests: 10, tokens: 100 },
    { day: '2026-08-16', user_id: 2, username: 'spam-bot', requests: 3, tokens: 30 },
    { day: '2026-08-16', user_id: 1, username: '猫南北', requests: 7, tokens: 70 },
  ]

  function toISODate(d: Date): string {
    const z = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
  }

  it('默认日期降序；列头点击切排序', async () => {
    backendMock.adminUsage.mockResolvedValue(usageFixture)
    const { w } = await mountView()
    const tab = w.findAll('.adm-tabs button').find((b) => b.text() === '用量列表')
    await tab!.trigger('click')
    const usagePanel = w.findAll('.panel')[1] // 用户表 v-show 隐藏但仍在 DOM，按面板作用域
    const firstDays = usagePanel.findAll('tbody tr').map((r) => r.find('td').text())
    expect(firstDays).toEqual(['2026-08-16', '2026-08-16', '2026-08-15'])
    // 点击「请求数」列头 → 按请求数降序
    const reqHeader = usagePanel.findAll('th').find((t) => t.text().startsWith('请求数'))
    await reqHeader!.trigger('click')
    const reqCells = usagePanel.findAll('tbody tr').map((r) => r.findAll('td')[2].text())
    expect(reqCells).toEqual(['10', '7', '3'])
    expect(w.text()).toContain('3 条')
  })

  it('筛选变化触发重查，用户下拉含「全部用户」', async () => {
    backendMock.adminUsage.mockResolvedValue(usageFixture)
    const { w } = await mountView()
    const tab = w.findAll('.adm-tabs button').find((b) => b.text() === '用量列表')
    await tab!.trigger('click')
    const select = w.findAll('.panel')[1].find('.adm-toolbar select')
    expect(select.text()).toContain('全部用户')
    await select.setValue('2')
    expect(backendMock.adminUsage).toHaveBeenLastCalledWith(
      expect.objectContaining({ user_id: 2 }),
    )
  })

  it('窗口内有数据但不连续：琥珀行标注「不估算补齐」', async () => {
    // 默认窗口 = 最近 7 天；仅返回一天数据 → 缺失标注
    const today = toISODate(new Date())
    backendMock.adminUsage.mockResolvedValue([
      { day: today, user_id: 1, username: '猫南北', requests: 1, tokens: 10 },
    ])
    const { w } = await mountView()
    const tab = w.findAll('.adm-tabs button').find((b) => b.text() === '用量列表')
    await tab!.trigger('click')
    expect(w.find('.gap-note').text()).toContain('仅显示已有数据（不估算补齐）')
  })

  it('空态：新用户/新部署说明', async () => {
    backendMock.adminUsage.mockResolvedValue([])
    const { w } = await mountView()
    const tab = w.findAll('.adm-tabs button').find((b) => b.text() === '用量列表')
    await tab!.trigger('click')
    expect(w.text()).toContain('暂无用量数据')
  })
})
