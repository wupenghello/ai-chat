import { describe, expect, it } from 'vitest'
import { TIME_GROUPS, timeGroupOf } from '../timeGroup'

/** 走查 12（design-iter-11 §1.3）：分组判定与跨零点边界——T1 单测门槛 */
function at(base: number, dayOffset: number, h: number, m: number): number {
  const d = new Date(base)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

describe('timeGroupOf 时间分组（REQ-026.2）', () => {
  const now = at(0, 10, 12, 0) // 某日 12:00 作「现在」

  it('同日不同时刻都归「今天」（含凌晨 00:30）', () => {
    expect(timeGroupOf(at(0, 10, 11, 59), now)).toBe('today')
    expect(timeGroupOf(at(0, 10, 0, 30), now)).toBe('today')
    expect(timeGroupOf(now, now)).toBe('today')
  })

  it('昨天：昨日任意时刻归「昨天」', () => {
    expect(timeGroupOf(at(0, 9, 23, 59), now)).toBe('yesterday')
    expect(timeGroupOf(at(0, 9, 0, 5), now)).toBe('yesterday')
  })

  it('跨零点：23:59 的会话在 00:01 视角下从「今天」落「昨天」', () => {
    const midnight = at(0, 11, 0, 1) // 次日 00:01
    const ts = at(0, 10, 23, 59) // 昨晚 23:59
    expect(timeGroupOf(ts, at(0, 10, 23, 59, ))).toBe('today') // 当晚视角：今天
    expect(timeGroupOf(ts, midnight)).toBe('yesterday') // 跨零点视角：昨天
  })

  it('近 7 天：2~7 天前归「近 7 天」，第 8 天起归「更早」', () => {
    expect(timeGroupOf(at(0, 8, 12, 0), now)).toBe('week') // 2 天前
    expect(timeGroupOf(at(0, 3, 12, 0), now)).toBe('week') // 7 天前
    expect(timeGroupOf(at(0, 2, 23, 59), now)).toBe('earlier') // 8 天前（边界外）
    expect(timeGroupOf(at(0, -30, 12, 0), now)).toBe('earlier')
  })

  it('轻微未来时间戳（时钟偏移容错）归「今天」', () => {
    expect(timeGroupOf(now + 5 * 60_000, now)).toBe('today')
  })

  it('组序与文案：今天/昨天/近 7 天/更早（走查 11）', () => {
    expect(TIME_GROUPS.map((g) => g.label)).toEqual(['今天', '昨天', '近 7 天', '更早'])
  })
})
