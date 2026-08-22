/**
 * iter-20 T2 首步 spike 落盘（plan 风险②处置）：本项目 vitest jsdom（v25）未实现
 * window.matchMedia——useMediaQuery 特性检测兜底 false（= 桌面口径，既有用例零回退）；
 * 有实现时消费初始 matches。移动/触屏态模拟由用例侧 vi.stubGlobal 承载（见 MobileShell/ComposerTouch）。
 */
import { describe, expect, it, vi } from 'vitest'
import { useMediaQuery } from '../useMediaQuery'

describe('useMediaQuery（iter-20 T2 spike 口径）', () => {
  it('jsdom 无 matchMedia 实现 → 兜底 false（桌面口径）；有实现 → 消费初始 matches', () => {
    expect((window as unknown as { matchMedia?: unknown }).matchMedia).toBeUndefined() // 环境取证（spike 结论）
    expect(useMediaQuery('(max-width: 768px)').value).toBe(false)

    const impl = (q: string) => ({
      matches: q === '(hover: none)',
      media: q,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })
    vi.stubGlobal('matchMedia', impl)
    expect(useMediaQuery('(hover: none)').value).toBe(true)
    expect(useMediaQuery('(max-width: 768px)').value).toBe(false)
    vi.unstubAllGlobals()
  })
})
