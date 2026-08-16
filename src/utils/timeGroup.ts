/**
 * REQ-026.2 时间分组（design-iter-11 §1.3）：会话列表按「今天/昨天/近 7 天/更早」分组，
 * 组内无逐条时间戳。本地日期比对（沿用 iter-1 timeLabel 思路，不做时区换算）；
 * now 可注入以便跨零点边界单测（走查 12：23:59 → 00:01 从「今天」落「昨天」）。
 */
export type TimeGroupKey = 'today' | 'yesterday' | 'week' | 'earlier'

export const TIME_GROUPS: ReadonlyArray<{ key: TimeGroupKey; label: string }> = [
  { key: 'today', label: '今天' },
  { key: 'yesterday', label: '昨天' },
  { key: 'week', label: '近 7 天' },
  { key: 'earlier', label: '更早' },
]

function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function timeGroupOf(ts: number, now: number = Date.now()): TimeGroupKey {
  // 以各自当日零点做差再取整天数：DST 的 23/25 小时日由 Math.round 吸收
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000)
  if (days <= 0) return 'today' // 同日；轻微未来时间戳（时钟偏移）容错归今天
  if (days === 1) return 'yesterday'
  if (days <= 7) return 'week'
  return 'earlier'
}
