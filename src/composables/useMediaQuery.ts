import { onMounted, onUnmounted, ref, type Ref } from 'vue'

/**
 * iter-20 T2（design-iter-20 §2.1/§3，REQ-049/051）：CSS 媒体特性的 JS 消费面——
 * 仅用于「模板/DOM 内容级」切换（抽屉 rail 抑制、placeholder/hint 触控口径），
 * 布局形态切换一律 CSS 媒体查询（桌面规则面零触碰）。
 *
 * 口径（T2 首步 spike 定案，2026-08-22 实测：jsdom v25 未实现 window.matchMedia）：
 * - 断点/hover 判定全部带界（max-width / hover:none），桌面（>768px 且 hover:hover）恒 false；
 * - matchMedia 不可用（jsdom/极端环境）兜底 false = 桌面口径，既有 378 用例零回退；
 * - 测试模拟 = vi.stubGlobal('matchMedia', q => ({ matches: map[q], ... }))（vitest 标准手段）。
 */
export function useMediaQuery(query: string): Ref<boolean> {
  const matches = ref(false)
  const mql =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null
  if (mql) matches.value = mql.matches

  const onChange = (e: MediaQueryListEvent) => {
    matches.value = e.matches
  }

  onMounted(() => {
    mql?.addEventListener?.('change', onChange)
  })
  onUnmounted(() => {
    mql?.removeEventListener?.('change', onChange)
  })
  return matches
}
