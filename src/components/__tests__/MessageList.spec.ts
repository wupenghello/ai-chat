import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import MessageList from '../MessageList.vue'
import type { Message } from '../../stores/sessions'

/** DEF-034 修复（CHG-008 批，2026-08-18 CEO 验收反馈）：
 * 流式渲染中用户上滚即脱离跟随（程序滚动的 scroll 回声不重置 follow），
 * 脱离时出「回到底部」浮钮，回底自动恢复跟随。 */
const mk = (n: number): Message[] =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `内容${i}`, updatedAt: '2026-08-18T10:00:00+08:00' } as unknown as Message))

/** jsdom 无真实布局：以 defineProperty 模拟滚动几何 */
function geo(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight })
}

describe('MessageList 滚动跟随（DEF-034 修复）', () => {
  it('贴底时流式增量保持滚底跟随', async () => {
    const w = mount(MessageList, { props: { messages: mk(4) } })
    const el = w.find('.list').element as HTMLElement
    geo(el, 1000, 500)
    el.scrollTop = 999 // 距底 1px：贴底
    await w.setProps({ messages: [...mk(4), mk(1)[0]] }) // 流式新增（长度+1 → 强制回底）
    await nextTick()
    expect(el.scrollTop).toBe(1000) // 已滚到底
    expect(w.find('.tb-btn').exists()).toBe(false) // 无浮钮
  })

  it('用户上滚脱离跟随：增量不再拽底，浮钮出现；点按回底恢复', async () => {
    const w = mount(MessageList, { props: { messages: mk(4) } })
    const el = w.find('.list').element as HTMLElement
    geo(el, 1000, 500)
    // 用户上滚到距底 400px（>120 阈值）→ scroll 事件 → 脱离
    el.scrollTop = 100
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(w.find('.tb-btn').exists()).toBe(true) // 回到底部浮钮出现
    // 流式内容增长（contentKey 变化）→ 不再强制滚底
    const grown = mk(4)
    ;(grown[3] as { content: string }).content = '内容3' + '更长的流式增量文本'
    await w.setProps({ messages: grown })
    await nextTick()
    expect(el.scrollTop).toBe(100) // 位置保持，未被拽回底部
    // 点浮钮回底 → 恢复跟随、浮钮消失
    await w.find('.tb-btn').trigger('click')
    await nextTick()
    expect(el.scrollTop).toBe(1000)
    expect(w.find('.tb-btn').exists()).toBe(false)
  })

  it('程序滚底的 scroll 回声不重置跟随状态（旧缺陷根因）', async () => {
    const w = mount(MessageList, { props: { messages: mk(4) } })
    const el = w.find('.list').element as HTMLElement
    geo(el, 1000, 500)
    el.scrollTop = 999
    el.dispatchEvent(new Event('scroll')) // 用户贴底滚动 → follow
    await nextTick()
    // 新消息触发程序滚底：过程发出 scroll 事件（回声），follow 不得因此丢失或误判
    await w.setProps({ messages: [...mk(4), mk(1)[0]] })
    await nextTick()
    expect(el.scrollTop).toBe(1000)
    el.dispatchEvent(new Event('scroll')) // 程序滚底的回声（echo 内被忽略）
    await nextTick()
    expect(w.find('.tb-btn').exists()).toBe(false) // 仍处跟随态
  })

  it('脱离后用户滚回底部自动恢复跟随（无需点按钮）', async () => {
    const w = mount(MessageList, { props: { messages: mk(4) } })
    const el = w.find('.list').element as HTMLElement
    geo(el, 1000, 500)
    el.scrollTop = 100
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(w.find('.tb-btn').exists()).toBe(true)
    el.scrollTop = 985 // 距底 15px < 120：用户手动滚回贴底
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(w.find('.tb-btn').exists()).toBe(false)
  })
})

/** DEF-041 修复（2026-08-23 CEO 上线后反馈，DEF-034 残留竞态）：高频增量下程序滚底
 * （微任务）赶在用户滚动事件派发前拽回底部，120px 阈值实际攒不够——改为输入意图
 * 先行：向上滚轮 / 触屏下滑手势立即脱离跟随，与距底位置无关。 */
describe('MessageList 滚动跟随（DEF-041 修复：输入意图先行）', () => {
  const wheel = (deltaY: number) => {
    const e = new Event('wheel')
    Object.defineProperty(e, 'deltaY', { value: deltaY })
    return e
  }
  const touch = (type: 'touchstart' | 'touchmove', clientY: number) => {
    const e = new Event(type)
    Object.defineProperty(e, 'touches', { value: [{ clientY }] })
    return e
  }

  it('向上滚轮即时脱离（距底 <120px 也生效——竞态根因回归面），增量不再拽底', async () => {
    const w = mount(MessageList, { props: { messages: mk(4) } })
    const el = w.find('.list').element as HTMLElement
    geo(el, 1000, 500)
    el.scrollTop = 940 // 距底 60px < 120：位置判定不足以脱离
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(w.find('.tb-btn').exists()).toBe(false) // 仍跟随（DEF-034 语义）
    el.dispatchEvent(wheel(-100)) // 向上滚轮 → 意图先行脱离
    await nextTick()
    expect(w.find('.tb-btn').exists()).toBe(true)
    const grown = mk(4)
    ;(grown[3] as { content: string }).content = '内容3' + '高频流式增量文本'
    await w.setProps({ messages: grown })
    await nextTick()
    expect(el.scrollTop).toBe(940) // 位置保持，未被拽回底部
  })

  it('向下滚轮不主动脱离跟随（贴底流式继续滚底）', async () => {
    const w = mount(MessageList, { props: { messages: mk(4) } })
    const el = w.find('.list').element as HTMLElement
    geo(el, 1000, 500)
    el.scrollTop = 999
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    el.dispatchEvent(wheel(120)) // 向下滚轮 → 非回看意图
    await nextTick()
    expect(w.find('.tb-btn').exists()).toBe(false)
    await w.setProps({ messages: [...mk(4), mk(1)[0]] })
    await nextTick()
    expect(el.scrollTop).toBe(1000) // 跟随滚底
  })

  it('触屏下滑手势脱离跟随（回看方向，移动端同缺陷面）', async () => {
    const w = mount(MessageList, { props: { messages: mk(4) } })
    const el = w.find('.list').element as HTMLElement
    geo(el, 1000, 500)
    el.scrollTop = 999
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    el.dispatchEvent(touch('touchstart', 100))
    el.dispatchEvent(touch('touchmove', 160)) // 手指下滑 60px > 10：回看更早内容
    await nextTick()
    expect(w.find('.tb-btn').exists()).toBe(true)
    const grown = mk(4)
    ;(grown[3] as { content: string }).content = '内容3' + '流式增量'
    await w.setProps({ messages: grown })
    await nextTick()
    expect(el.scrollTop).toBe(999)
  })
})
