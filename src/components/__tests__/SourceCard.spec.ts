import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SourceCard from '../SourceCard.vue'
import type { SourceItem } from '../../api/client'

/**
 * 引用来源卡（design-iter-14 §2「原型即需求」本体，REQ-035 主流程 4 / REQ-032 验收 4）：
 * 默认折叠、头部逐字「引用来源 · N 条」（D3）、条目五字段归一化（缺字段不塌）、
 * 条数防御 slice(0,5)、textContent 直排不进管线（防注入）。
 */

/** Tavily 型（§2.3）：长片段、无 site_name、部分带日期 */
const TAVILY: SourceItem[] = [
  { title: '结果一', url: 'https://platform.example.com/docs/v3-2', snippet: '长摘要'.repeat(30) },
  { title: '结果二', url: 'https://api-docs.example.com/pricing', snippet: '短片段', date_published: '2026-08-16' },
]
/** 博查型（§2.3）：site_name + date_published 富元数据 + 短片段 */
const BOCHA: SourceItem[] = [
  {
    title: 'DeepSeek 发布 V3.2',
    url: 'https://www.example-news.cn/tech/deepseek-v3-2',
    site_name: '科技日报网',
    date_published: '2026-08-12',
    snippet: '官方称代码生成与推理能力显著提升。',
  },
  { title: 'API 降价', url: 'https://www.example-fin.cn/api/price', site_name: '财联讯', snippet: '输入降 30%。' },
]

describe('SourceCard 头部与折叠（§2.2，D3 逐字）', () => {
  it('头部文案逐字「引用来源 · 2 条」（「·」两侧各一空格，N = 实际条数）', () => {
    const w = mount(SourceCard, { props: { sources: TAVILY } })
    expect(w.find('.sc-head').text()).toBe('引用来源 · 2 条')
  })

  it('默认折叠（出生即终态，无展开期）：aria-expanded=false，展开区不渲染', () => {
    const w = mount(SourceCard, { props: { sources: TAVILY } })
    expect(w.find('.sc-head').attributes('aria-expanded')).toBe('false')
    expect(w.find('.sc-body').exists()).toBe(false)
  })

  it('头部行 button 语义：点击展开（aria 翻转 + 条目渲染），再点折叠', async () => {
    const w = mount(SourceCard, { props: { sources: TAVILY } })
    expect(w.find('.sc-head').element.tagName).toBe('BUTTON') // Enter/Space 原生
    await w.find('.sc-head').trigger('click')
    expect(w.find('.sc-head').attributes('aria-expanded')).toBe('true')
    expect(w.find('.sc-body').exists()).toBe(true)
    expect(w.findAll('.src-item')).toHaveLength(2)
    await w.find('.sc-head').trigger('click')
    expect(w.find('.sc-head').attributes('aria-expanded')).toBe('false')
    expect(w.find('.sc-body').exists()).toBe(false)
  })

  it('条数防御：6 条 → 头部 N=5、仅渲染 5 条（前端 slice(0,5) 兜底，§2.1）', async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ title: `t${i}`, url: `https://e.example.com/${i}` }))
    const w = mount(SourceCard, { props: { sources: six } })
    expect(w.find('.sc-head').text()).toBe('引用来源 · 5 条')
    await w.find('.sc-head').trigger('click')
    expect(w.findAll('.src-item')).toHaveLength(5)
  })
})

describe('SourceCard 条目字段与归一化（§2.3，缺字段不塌）', () => {
  const openCard = async (sources: SourceItem[]) => {
    const w = mount(SourceCard, { props: { sources } })
    await w.find('.sc-head').trigger('click')
    return w
  }

  it('博查型富元数据：site_name · date_published 元信息行完整；标题链接规格', async () => {
    const w = await openCard(BOCHA)
    const first = w.findAll('.src-item')[0]
    const a = first.find('.src-title a')
    expect(a.text()).toBe('DeepSeek 发布 V3.2')
    expect(a.attributes('href')).toBe('https://www.example-news.cn/tech/deepseek-v3-2')
    expect(a.attributes('target')).toBe('_blank')
    expect(a.attributes('rel')).toBe('noopener noreferrer')
    expect(first.find('.src-meta').text()).toBe('科技日报网 · 2026-08-12')
    expect(first.find('.src-snip').text()).toBe('官方称代码生成与推理能力显著提升。')
  })

  it('Tavily 型：无 site_name → hostname 兜底；无日期 → 连分隔点一并省略', async () => {
    const w = await openCard(TAVILY)
    const items = w.findAll('.src-item')
    expect(items[0].find('.src-meta').text()).toBe('platform.example.com') // 无 siteName 无日期 → 仅 hostname
    expect(items[1].find('.src-meta').text()).toBe('api-docs.example.com · 2026-08-16') // hostname 兜底 + 日期
  })

  it('缺 snippet → 紧凑形态不渲染片段行；缺 title → hostname 兜底标题（元信息行 hostname 兜底同现）', async () => {
    // title 契约上必有（后端归一化保证），此处以防御面构造缺 title 形状验证前端兜底（§2.3 降级表）
    const w = await openCard([{ url: 'https://docs.example.com/guide' } as SourceItem])
    const item = w.find('.src-item')
    expect(item.find('.src-title a').text()).toBe('docs.example.com') // title 缺 → hostname
    expect(item.find('.src-meta').text()).toBe('docs.example.com') // site_name 缺 → hostname 兜底（§2.3 降级表）
    expect(item.find('.src-snip').exists()).toBe(false) // 无 snippet → 紧凑形态，无空块
  })

  it('防注入（§2.3/REQ-011 管线边界）：title/snippet 含标记文本原样直排，不渲染为元素', async () => {
    const evil: SourceItem[] = [
      {
        title: '<script>alert(1)</script>',
        url: 'https://evil.example.com/x',
        snippet: '<img src=x onerror=alert(2)>注入文本',
        site_name: '<b>假站名</b>',
        date_published: '2026-08-01',
      },
    ]
    const w = await openCard(evil)
    const item = w.find('.src-item')
    expect(item.find('.src-title script').exists()).toBe(false)
    expect(item.find('.src-title img').exists()).toBe(false)
    expect(item.find('.src-snip img').exists()).toBe(false)
    expect(item.find('.src-snip').text()).toBe('<img src=x onerror=alert(2)>注入文本') // 文本直排
    expect(item.find('.src-meta b').exists()).toBe(false)
    expect(item.find('.src-meta').text()).toBe('<b>假站名</b> · 2026-08-01')
  })
})
