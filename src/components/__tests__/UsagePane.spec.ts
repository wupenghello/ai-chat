/**
 * iter-21 T3（CHG-015 REQ-052，design-iter-21 §3/§7）：「用量与费用」分区——
 * 今日摘要行（unified/self 两态）/ 时间窗切换请求 / 每日表格渲染与合计 / 缓存缺失「—」/
 * 未配置单价列级口径 / 空态 / 加载失败 + 重试 / 样件文案 U1~U16 逐字断言。
 * 独立 mock 与夹具（沿 MemoryPane.spec / AdminTelemetry.spec 先例）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const backendMock = vi.hoisted(() => ({
  getUsageSummary: vi.fn(),
}))

vi.mock('../../api/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/backend')>()),
  backend: backendMock,
}))

import UsagePane from '../UsagePane.vue'
import type { UsageSummary } from '../../api/backend'

function summary(extra: Partial<UsageSummary> = {}): UsageSummary {
  return {
    window: { days: 7, date_from: '2026-08-16', date_to: '2026-08-22' },
    price: {
      configured: true, input_per_mtok: 2, output_per_mtok: 8,
      cache_hit_per_mtok: 0.5,
    },
    today: { mode: 'unified', daily_limit: 30, used_today: 5, cost_total: 0.0123 },
    daily: [
      {
        day: '2026-08-22', turns: 5, tokens_prompt: 12345, tokens_completion: 6789,
        cache_hit_tokens: 4200, cost_total: 0.0123,
      },
      {
        day: '2026-08-21', turns: 8, tokens_prompt: 21402, tokens_completion: 11036,
        cache_hit_tokens: null, cost_total: 0.0204,
      },
    ],
    retention_days: 90,
    ...extra,
  }
}

function mountPane(active = true) {
  return mount(UsagePane, { props: { active } })
}

beforeEach(() => {
  backendMock.getUsageSummary.mockReset()
})

describe('分区标题与文案逐字（design-iter-21 §7 U1~U3/U8~U12）', () => {
  it('pane-label「用量与费用」+ 副题 U3 逐字；表头六列逐字 U11；脚注 U12 逐字', async () => {
    backendMock.getUsageSummary.mockResolvedValue(summary())
    const w = mountPane()
    await flushPromises()
    expect(w.find('.pane-label').text()).toBe('用量与费用')
    expect(w.find('.u-sub').text()).toBe('查看你的对话用量与费用估算')
    const ths = w.findAll('table.u th').map((t) => t.text())
    expect(ths).toEqual(['日期', '回合数', '输入 tokens', '输出 tokens', '缓存命中', '费用估算'])
    expect(w.find('.u-foot').text()).toBe('仅统一 key 模式计成本；自填模式 tokens 不计成本')
  })

  it('时间窗按钮 U8/U9 逐字 + 保留期旁注 U10 逐字；默认近 7 天选中', async () => {
    backendMock.getUsageSummary.mockResolvedValue(summary())
    const w = mountPane()
    await flushPromises()
    const btns = w.findAll('.u-win button')
    expect(btns.map((b) => b.text())).toEqual(['近 7 天', '近 30 天'])
    expect(btns[0].attributes('aria-checked')).toBe('true')
    expect(w.find('.u-win .note').text()).toBe('明细保留 90 天，超期自动清理')
  })
})

describe('今日摘要行（§3.1：与 /api/quota 同源数字）', () => {
  it('unified：今日对话「5 / 30 次」+ 今日费用 ¥0.0123（4 位小数）', async () => {
    backendMock.getUsageSummary.mockResolvedValue(summary())
    const w = mountPane()
    await flushPromises()
    expect(w.findAll('.u-today .v')[0].text()).toBe('5 / 30 次')
    expect(w.findAll('.u-today .v')[1].text()).toBe('¥0.0123')
  })

  it('self 模式：今日对话 = U5「自填模式 · 无免费额度上限」逐字', async () => {
    backendMock.getUsageSummary.mockResolvedValue(
      summary({ today: { mode: 'self', daily_limit: 500, used_today: 0, cost_total: null } }),
    )
    const w = mountPane()
    await flushPromises()
    expect(w.findAll('.u-today .v')[0].text()).toBe('自填模式 · 无免费额度上限')
  })
})

describe('每日列表与合计（§3.3）', () => {
  it('行数据渲染 + 千分位 + 缓存缺失日「—」', async () => {
    backendMock.getUsageSummary.mockResolvedValue(summary())
    const w = mountPane()
    await flushPromises()
    const trs = w.findAll('table.u tbody tr')
    expect(trs[0].findAll('td')[2].text()).toBe('12,345')
    expect(trs[1].findAll('td')[4].text()).toBe('—')
  })

  it('合计行求和；缓存任一日缺失 → 合计「—」（铁律 5）', async () => {
    backendMock.getUsageSummary.mockResolvedValue(summary())
    const w = mountPane()
    await flushPromises()
    const sum = w.findAll('table.u tbody tr.sum td')
    expect(sum[1].text()).toBe('13')
    expect(sum[2].text()).toBe('33,747')
    expect(sum[4].text()).toBe('—')
    expect(sum[5].text()).toBe('¥0.0327')
  })
})

describe('时间窗切换（§3.2）', () => {
  it('切近 30 天 → 请求 days=30 + 列表刷新', async () => {
    backendMock.getUsageSummary.mockResolvedValue(summary())
    const w = mountPane()
    await flushPromises()
    expect(backendMock.getUsageSummary).toHaveBeenCalledWith(7)
    backendMock.getUsageSummary.mockResolvedValue(
      summary({ window: { days: 30, date_from: '2026-07-24', date_to: '2026-08-22' } }),
    )
    await w.findAll('.u-win button')[1].trigger('click')
    await flushPromises()
    expect(backendMock.getUsageSummary).toHaveBeenCalledWith(30)
    expect(w.findAll('.u-win button')[1].attributes('aria-checked')).toBe('true')
  })
})

describe('四分支态（§3.4）', () => {
  it('空态 U14 逐字 + 今日行照常', async () => {
    backendMock.getUsageSummary.mockResolvedValue(summary({ daily: [] }))
    const w = mountPane()
    await flushPromises()
    expect(w.find('.u-state').text()).toBe('选定时间范围内暂无用量记录')
    expect(w.find('.u-today').exists()).toBe(true)
  })

  it('未配置单价：今日费用「未配置」+ 表头注 U15 + 费用列「—」+ tokens 照常', async () => {
    backendMock.getUsageSummary.mockResolvedValue(
      summary({
        price: {
          configured: false, input_per_mtok: null,
          output_per_mtok: null, cache_hit_per_mtok: null,
        },
        today: { mode: 'unified', daily_limit: 30, used_today: 5, cost_total: null },
        daily: [
          {
            day: '2026-08-22', turns: 5, tokens_prompt: 12345, tokens_completion: 6789,
            cache_hit_tokens: 4200, cost_total: null,
          },
        ],
      }),
    )
    const w = mountPane()
    await flushPromises()
    expect(w.findAll('.u-today .v')[1].text()).toBe('未配置')
    expect(w.findAll('table.u th')[5].text()).toBe('费用估算（未配置单价）')
    expect(w.find('table.u tbody tr').findAll('td')[5].text()).toBe('—')
    expect(w.find('table.u tbody tr').findAll('td')[2].text()).toBe('12,345')
  })

  it('加载失败 U16 逐字 + 重试恢复（不弹 toast，就地呈现）', async () => {
    backendMock.getUsageSummary.mockRejectedValueOnce(new Error('network'))
    const w = mountPane()
    await flushPromises()
    expect(w.find('.u-state').text()).toContain('用量数据加载失败，请稍后重试')
    backendMock.getUsageSummary.mockResolvedValue(summary())
    await w.find('.retry').trigger('click')
    await flushPromises()
    expect(w.find('table.u').exists()).toBe(true)
  })

  it('首次加载显「加载中…」（U13）', async () => {
    backendMock.getUsageSummary.mockReturnValue(new Promise(() => {}))
    const w = mountPane()
    await flushPromises()
    expect(w.find('.u-state').text()).toBe('加载中…')
  })
})

describe('分区切入加载（§2）', () => {
  it('inactive 不加载；active 化时拉取', async () => {
    backendMock.getUsageSummary.mockResolvedValue(summary())
    const w = mountPane(false)
    await flushPromises()
    expect(backendMock.getUsageSummary).not.toHaveBeenCalled()
    await w.setProps({ active: true })
    await flushPromises()
    expect(backendMock.getUsageSummary).toHaveBeenCalledWith(7)
  })
})
