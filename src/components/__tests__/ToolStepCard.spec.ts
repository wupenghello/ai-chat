import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ToolStepCard from '../ToolStepCard.vue'
import type { ToolCallBlock, ToolResultBlock } from '../../api/client'

const call: ToolCallBlock = {
  type: 'tool_call',
  tool_call_id: 'c1',
  name: 'demo_weather',
  arguments: '{"city":"北京"}',
}
const okResult: ToolResultBlock = {
  type: 'tool_result',
  tool_call_id: 'c1',
  status: 'ok',
  result: '北京：晴，最高 32°C',
  duration_ms: 412,
}

describe('ToolStepCard（CHG-007 REQ-032，design-iter-13 §3）', () => {
  it('运行中：R1 卡创建即展开，徽章「运行中」，占位「（等待结果…）」', () => {
    const w = mount(ToolStepCard, { props: { call, live: true } })
    expect(w.find('.tc-badge.running').text()).toContain('运行中')
    expect(w.find('[aria-expanded="true"]').exists()).toBe(true)
    expect(w.find('.tc-result-text').text()).toBe('（等待结果…）')
  })

  it('完成：徽章「完成」+ 结果原样渲染 + 耗时 tabular 显示', async () => {
    const w = mount(ToolStepCard, { props: { call, result: okResult, live: true } })
    expect(w.find('.tc-badge.ok').text()).toContain('完成')
    expect(w.find('.tc-duration').text()).toBe('412ms')
    // R2：终态到达且用户未操作 → 自动折叠（头部行仍承载徽章与耗时）
    expect(w.find('[aria-expanded="false"]').exists()).toBe(true)
    await w.find('.tc-head').trigger('click') // 展开为用户态，看结果区
    expect(w.find('.tc-result-text').text()).toBe('北京：晴，最高 32°C')
  })

  it('失败/超时：徽章分色文案「失败」「超时」，回合继续语义（结果区呈现原因）', () => {
    const err: ToolResultBlock = { type: 'tool_result', tool_call_id: 'c1', status: 'error', result: '缺少必填参数：city', duration_ms: 1 }
    const w1 = mount(ToolStepCard, { props: { call, result: err, live: true } })
    expect(w1.find('.tc-badge.error').text()).toContain('失败')
    const timeout: ToolResultBlock = { type: 'tool_result', tool_call_id: 'c1', status: 'timeout', result: '工具执行超时', duration_ms: 2000 }
    const w2 = mount(ToolStepCard, { props: { call, result: timeout, live: true } })
    expect(w2.find('.tc-badge.timeout').text()).toContain('超时')
  })

  it('已中断（派生态）：无结果且非生成中——占位「（回合中断，未获得结果）」，运行中徽章不留存', async () => {
    const w = mount(ToolStepCard, { props: { call, live: false } })
    expect(w.find('.tc-badge.interrupted').text()).toContain('已中断')
    await w.find('.tc-head').trigger('click')
    expect(w.find('.tc-result-text').text()).toBe('（回合中断，未获得结果）')
  })

  it('空结果（ok 但 result 为空串）：占位「（无返回内容）」', async () => {
    const empty: ToolResultBlock = { type: 'tool_result', tool_call_id: 'c1', status: 'ok', result: '', duration_ms: 3 }
    const w = mount(ToolStepCard, { props: { call, result: empty, live: true } })
    await w.find('.tc-head').trigger('click')
    expect(w.find('.tc-result-text').text()).toBe('（无返回内容）')
  })

  it('R2 用户操作过则保持用户态：手动展开后终态到达不折叠', async () => {
    const w = mount(ToolStepCard, { props: { call, live: true } })
    // 初始展开（R1）；先手动折叠再展开 → userToggled 置位
    await w.find('.tc-head').trigger('click')
    await w.find('.tc-head').trigger('click')
    expect(w.find('[aria-expanded="true"]').exists()).toBe(true)
    await w.setProps({ result: okResult })
    expect(w.find('[aria-expanded="true"]').exists()).toBe(true) // 用户态保持
  })

  it('R3 历史消息（live=false）恒折叠：折叠态下展开区不渲染', () => {
    const w = mount(ToolStepCard, { props: { call, result: okResult, live: false } })
    expect(w.find('[aria-expanded="false"]').exists()).toBe(true)
    expect(w.find('.tc-body').exists()).toBe(false)
  })

  it('头部行语义与参数原样：button 可达、arguments verbatim 入参数块', async () => {
    const w = mount(ToolStepCard, { props: { call, live: true } })
    expect(w.find('.tc-head').element.tagName).toBe('BUTTON')
    expect(w.find('.tc-args-block').text()).toBe('{"city":"北京"}')
    await w.find('.tc-head').trigger('click')
    expect(w.find('.tc-body').exists()).toBe(false)
  })
})
