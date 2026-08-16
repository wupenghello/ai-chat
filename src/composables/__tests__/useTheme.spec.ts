import { beforeEach, describe, expect, it, vi } from 'vitest'

/** REQ-017 主题管理单测（iter-10 T1③，iter-5 QA 观察项 4 同族）。
    useTheme 的初始值在模块加载时读取 localStorage 并立即应用到根节点，
    故各用例经 resetModules + 动态 import 取全新模块实例隔离初始态。 */

const KEY = 'ai-chat-theme'

async function freshUseTheme() {
  vi.resetModules()
  return await import('../useTheme')
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
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
