/**
 * iter-20 T2（REQ-049/051）：断点/触屏 CSS 契约断言——
 * jsdom 无布局引擎，几何面（验收 1/2/4 的像素级）由 T3 走查脚本（真实 Chrome）承载；
 * 本文件断言「规则面收敛」：全部新增规则必须落在带界媒体查询内（max-width 上界 /
 * hover:none），桌面（>768px 且 hover:hover）规则面零触碰 + 关键几何值逐字（44px/92%/12px/
 * min(80vw, 264px)/.15s/--c-mask）——REQ-051 验收 2 热区尺寸与 REQ-049 验收 5 的 CSS 口径面。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

/** 截取某个 @media 块（自声明起至下一个 @media 或 style 尾） */
const mediaBlock = (src: string, query: string) => {
  const start = src.indexOf(`@media (${query})`)
  expect(start, `缺少 @media (${query}) 块`).toBeGreaterThanOrEqual(0)
  const rest = src.slice(start + query.length + 8)
  const next = rest.indexOf('@media')
  return next === -1 ? rest : rest.slice(0, next)
}

describe('REQ-051 触屏常显与 44px 命中区（CSS 契约）', () => {
  it('MessageBubble：hover:none 下操作栏常显（opacity:1）+ ::after 热区扩至 44px（视觉 24px 不变）', () => {
    const block = mediaBlock(read('../MessageBubble.vue'), 'hover: none')
    expect(block).toContain('.action-btn')
    expect(block).toContain('opacity: 1')
    expect(block).toContain('::after')
    expect(block).toContain('calc((100% - 44px) / 2)')
    // 桌面 hover 浮现规则在媒体查询外原样保留（零触碰）
    expect(read('../MessageBubble.vue')).toContain('.msg-col:hover .action-btn')
  })

  it('SessionListItem：hover:none 下「···」常显 + ::after 热区扩至 44px（视觉 28px 不变）；桌面 hover 规则保留', () => {
    const block = mediaBlock(read('../SessionListItem.vue'), 'hover: none')
    expect(block).toContain('.dd-trigger')
    expect(block).toContain('opacity: 1')
    expect(block).toContain('::after')
    expect(block).toContain('calc((100% - 44px) / 2)')
    expect(read('../SessionListItem.vue')).toContain('.item:hover :deep(.dd-trigger)')
  })

  it('ComposerBox：≤480px 发送钮视觉 44×44（停止钮高 44）；≤768px 透明热区扩至 44（视觉不变）', () => {
    const src = read('../ComposerBox.vue')
    const b480 = mediaBlock(src, 'max-width: 480px')
    expect(b480).toContain('width: 44px')
    expect(b480).toContain('height: 44px')
    const b768 = mediaBlock(src, 'max-width: 768px')
    expect(b768).toContain('::after')
    expect(b768).toContain('calc((100% - 44px) / 2)')
  })
})

describe('REQ-049 断点收窄与抽屉形态（CSS 契约）', () => {
  it('MessageBubble ≤480px：用户气泡 max-width 放宽至 92%（验收 4 不溢出口径）；桌面 80% 保留', () => {
    const src = read('../MessageBubble.vue')
    const block = mediaBlock(src, 'max-width: 480px')
    expect(block).toContain('max-width: 92%')
    // 桌面基线值在媒体查询外逐字保留（零触碰）
    expect(src.slice(0, src.indexOf('@media'))).toContain('max-width: 80%')
  })

  it('App：≤480px composer-row padding 12px（验收 5 上限）；≤768px 顶条 48px/44×44 入口钮 + 遮罩 --c-mask/.15s', () => {
    const src = read('../../App.vue')
    const b480 = mediaBlock(src, 'max-width: 480px')
    expect(b480).toContain('padding: 12px')
    const b768 = mediaBlock(src, 'max-width: 768px')
    expect(b768).toContain('height: 48px')
    expect(b768).toContain('width: 44px')
    expect(b768).toContain('height: 44px')
    expect(b768).toContain('var(--c-mask)') // 既有令牌，零新增
    expect(b768).toContain('0.15s ease')
    // 顶条/遮罩缺省零渲染（>768px display:none），桌面规则面零触碰
    expect(src).toMatch(/\.mobile-topbar,\s*\n\.drawer-mask\s*\{\s*display: none;/)
  })

  it('TheSidebar ≤768px：fixed overlay 平移抽屉（min(80vw, 264px) + translateX + .15s）+ 收起钮断点内隐藏', () => {
    const src = read('../TheSidebar.vue')
    const block = mediaBlock(src, 'max-width: 768px')
    expect(block).toContain('position: fixed')
    expect(block).toContain('min(80vw, 264px)')
    expect(block).toContain('translateX(-100%)')
    expect(block).toContain('z-index: 40')
    expect(block).toContain('0.15s ease')
    expect(block).toContain('.brand-row .icon-btn')
    expect(block).toContain('display: none')
    // 桌面 264px 基线在媒体查询外逐字保留（REQ-026 零回退）
    expect(src.slice(0, src.indexOf('@media'))).toContain('width: 264px')
  })
})
