/**
 * REQ-014 v3 密钥模式卡（design-iter-7 §1.1）：免费额度行参数化（iter-8 T2，
 * GET /api/quota 数据，design-iter-7 走查 2「iter-8 参数化」兑现）。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import KeyModeCard from '../KeyModeCard.vue'

describe('免费额度行参数化（design-iter-7 走查 2 兑现，iter-8 T2）', () => {
  it('有配额数据：显示真实数值，无占位胶囊（不编造 → 有数据即真实）', () => {
    const wrapper = mount(KeyModeCard, {
      props: { mode: 'unified', quota: { daily_limit: 30, used_today: 5 } },
    })
    expect(wrapper.text()).toContain('免费额度：每日 30 次对话 · 今日已用 5')
    expect(wrapper.text()).not.toContain('占位')
  })

  it('无配额数据（后端不可达）：保持占位破折号，不显示编造数值（铁律 5 同源精神）', () => {
    const wrapper = mount(KeyModeCard, { props: { mode: 'unified' } })
    expect(wrapper.text()).toContain('每日 — 次对话')
    expect(wrapper.text()).toContain('占位')
  })
})
