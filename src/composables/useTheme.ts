import { ref } from 'vue'

/** REQ-017：主题管理——浅/深二选（跟随系统本期不做，待澄清已定夺），
    选择持久化 localStorage，根节点 data-theme 覆盖令牌（tokens v1.3 机制） */
export type Theme = 'light' | 'dark'

const KEY = 'ai-chat-theme'

function readInitial(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

const theme = ref<Theme>(readInitial())

function apply(t: Theme) {
  document.documentElement.dataset.theme = t
}

export function useTheme() {
  function setTheme(t: Theme) {
    theme.value = t
    try {
      localStorage.setItem(KEY, t)
    } catch {
      /* 隐私模式等：仅本次会话生效 */
    }
    apply(t)
  }
  function toggleTheme() {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }
  return { theme, setTheme, toggleTheme }
}

// 模块加载即应用（首屏无闪烁取决于脚本执行时机，Vite 主包同步加载可接受）
apply(theme.value)
