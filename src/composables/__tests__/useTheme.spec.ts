import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** REQ-017 主题管理单测（iter-10 T1③，iter-5 QA 观察项 4 同族）。
    useTheme 的初始值在模块加载时读取 localStorage 并立即应用到根节点，
    故各用例经 resetModules + 动态 import 取全新模块实例隔离初始态。
    2026-08-23 三档化（auto = 跟随系统）：jsdom v25 未实现 window.matchMedia，
    系统偏好用例经 vi.stubGlobal 注入可控 mql（沿 useMediaQuery 测试口径）。 */

const KEY = 'ai-chat-theme'

async function freshUseTheme() {
  vi.resetModules()
  return await import('../useTheme')
}

/** 可控 matchMedia 桩：flip(next) 同步翻转 matches 并派发 change 事件 */
function stubMatchMedia(matches: boolean) {
  const listeners: Array<(e: { matches: boolean }) => void> = []
  const dark = {
    matches,
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.push(cb),
    removeEventListener: () => {},
  }
  vi.stubGlobal('matchMedia', (q: string) =>
    q === '(prefers-color-scheme: dark)' ? dark : { matches: false, addEventListener: () => {}, removeEventListener: () => {} },
  )
  return {
    flip(next: boolean) {
      dark.matches = next
      for (const cb of listeners) cb({ matches: next })
    },
  }
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('初始读取（模块加载时）', () => {
  it('无存储值 → 默认浅色，且加载即应用到根节点（首屏机制）', async () => {
    const { useTheme } = await freshUseTheme()
    const { theme } = useTheme()
    expect(theme.value).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('存储值为 dark → 按值初始化为深色并应用', async () => {
    localStorage.setItem(KEY, 'dark')
    const { useTheme } = await freshUseTheme()
    const { theme } = useTheme()
    expect(theme.value).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('存储值为非法值（非 dark）→ 回退默认浅色', async () => {
    localStorage.setItem(KEY, 'blue')
    const { useTheme } = await freshUseTheme()
    const { theme } = useTheme()
    expect(theme.value).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

describe('setTheme：切换 + 持久化 + DOM 应用', () => {
  it('切到深色：ref 更新、localStorage 写入、data-theme 落根', async () => {
    const { useTheme } = await freshUseTheme()
    const { theme, setTheme } = useTheme()
    setTheme('dark')
    expect(theme.value).toBe('dark')
    expect(localStorage.getItem(KEY)).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('深色切回浅色：三处同步更新（往返一致）', async () => {
    localStorage.setItem(KEY, 'dark')
    const { useTheme } = await freshUseTheme()
    const { theme, setTheme } = useTheme()
    setTheme('light')
    expect(theme.value).toBe('light')
    expect(localStorage.getItem(KEY)).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

describe('toggleTheme：浅↔暗翻转', () => {
  it('默认浅色：toggle → 暗 → 再 toggle → 浅（状态/持久化/DOM 三处同步）', async () => {
    const { useTheme } = await freshUseTheme()
    const { theme, toggleTheme } = useTheme()
    expect(theme.value).toBe('light')
    toggleTheme()
    expect(theme.value).toBe('dark')
    expect(localStorage.getItem(KEY)).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    toggleTheme()
    expect(theme.value).toBe('light')
    expect(localStorage.getItem(KEY)).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

describe('自动档（2026-08-23 三档化：auto = 跟随系统）', () => {
  it('存储值为 auto → 初始化 auto；无 matchMedia（jsdom 兜底）解析为浅色落根', async () => {
    localStorage.setItem(KEY, 'auto')
    const { useTheme } = await freshUseTheme()
    const { theme, resolvedTheme } = useTheme()
    expect(theme.value).toBe('auto')
    expect(resolvedTheme.value).toBe('light')
    expect(localStorage.getItem(KEY)).toBe('auto') // 档位原样持久化（不落解析值）
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('系统深色：auto 初始化即解析深色落根；显式浅色档不被系统事件翻动', async () => {
    const sys = stubMatchMedia(true)
    localStorage.setItem(KEY, 'auto')
    const { useTheme } = await freshUseTheme()
    const { resolvedTheme, setTheme } = useTheme()
    expect(resolvedTheme.value).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    setTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    sys.flip(true) // 系统再派发：显式档位不跟随
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('auto 档下系统浅↔深切换实时生效（change 监听）', async () => {
    const sys = stubMatchMedia(false)
    const { useTheme } = await freshUseTheme()
    const { theme, setTheme } = useTheme()
    setTheme('auto')
    expect(document.documentElement.dataset.theme).toBe('light')
    sys.flip(true)
    expect(theme.value).toBe('auto') // 档位不变，仅解析结果变
    expect(document.documentElement.dataset.theme).toBe('dark')
    sys.flip(false)
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('toggleTheme 在 auto 档：按当前生效值翻转 → 显式选对侧（离开 auto）', async () => {
    stubMatchMedia(true)
    localStorage.setItem(KEY, 'auto')
    const { useTheme } = await freshUseTheme()
    const { theme, toggleTheme } = useTheme()
    toggleTheme()
    expect(theme.value).toBe('light')
    expect(localStorage.getItem(KEY)).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('auto 持久化往返：写入 auto 后新模块实例读回 auto', async () => {
    const { useTheme } = await freshUseTheme()
    useTheme().setTheme('auto')
    expect(localStorage.getItem(KEY)).toBe('auto')
    const again = await freshUseTheme()
    expect(again.useTheme().theme.value).toBe('auto')
  })
})
