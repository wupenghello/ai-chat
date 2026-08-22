import { computed, ref } from 'vue'

/** REQ-017：主题管理——浅/深/自动三选（自动 = 跟随系统 prefers-color-scheme，
    2026-08-23 CEO 走查定夺新增；原「跟随系统本期不做」口径就此收口）。
    选择持久化 localStorage，根节点 data-theme 覆盖令牌（tokens v1.3 机制）；
    auto 档下系统切换浅/深实时生效（模块级监听，仅 auto 档消费）。 */
export type Theme = 'light' | 'dark'
export type ThemePref = Theme | 'auto'

const KEY = 'ai-chat-theme'
const QUERY = '(prefers-color-scheme: dark)'

/** jsdom v25 未实现 window.matchMedia（useMediaQuery 先例口径）：不可用兜底浅色 */
function readSystemDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches
}

function readInitial(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dark' || v === 'auto' ? v : 'light'
  } catch {
    return 'light'
  }
}

const theme = ref<ThemePref>(readInitial())
// 系统偏好以 ref 承载（模块加载同步读一次 + 监听变更）——auto 档的响应式来源
const systemDark = ref(readSystemDark())

/** 实际生效主题：auto 档按系统当前偏好解析，浅/深档即所选值 */
const resolvedTheme = computed<Theme>(() => (theme.value === 'auto' ? (systemDark.value ? 'dark' : 'light') : theme.value))

function apply() {
  document.documentElement.dataset.theme = resolvedTheme.value
}

function setTheme(t: ThemePref) {
  theme.value = t
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* 隐私模式等：仅本次会话生效 */
  }
  apply()
}

/** 顶栏/登录页翻转钮：按「当前生效」翻转（auto 档按下 = 显式选对侧，离开 auto） */
function toggleTheme() {
  setTheme(resolvedTheme.value === 'dark' ? 'light' : 'dark')
}

export function useTheme() {
  return { theme, resolvedTheme, setTheme, toggleTheme }
}

// 系统偏好变化：仅 auto 档实时跟随（浅/深为用户显式选择，不被系统覆盖）
const mql = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null
mql?.addEventListener?.('change', (e: MediaQueryListEvent) => {
  systemDark.value = e.matches
  if (theme.value === 'auto') apply()
})

// 模块加载即应用（首屏无闪烁取决于脚本执行时机，Vite 主包同步加载可接受）
apply()
