/**
 * DEF-042 回归面（2026-08-23 CEO 上线后反馈）：设置弹窗分区样式一致性——
 * 跨组件复用 class（pane-label/field-label/field-hint）在 scoped 边界外吃不到
 * 定义、回落浏览器默认 16px/400（MemoryPane〔iter-17〕实发；UsagePane〔iter-21〕
 * 自定义正确）。jsdom 无样式引擎，本文件沿 MobileCssContract 先例断言「源码契约」：
 * 三处分区标题字号字重一致 + MemoryPane 复用 class 显式对齐；视觉面由真实 Chrome
 * 取证承载（scripts/e2e-def042-style-audit.mjs 计算样式逐分区比对）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

/** 提取 scoped 样式内某选择器规则块的声明串（自选择器起至下一个顶级选择器） */
const rule = (src: string, selector: string) => {
  const i = src.indexOf(selector)
  expect(i, `缺少规则 ${selector}`).toBeGreaterThanOrEqual(0)
  const rest = src.slice(i)
  const m = rest.match(/\{([^}]*)\}/)
  return m ? m[1] : ''
}

describe('设置分区样式一致性（DEF-042 契约）', () => {
  it('分区标题跨组件同一字号字重：SettingsForm/UsagePane/MemoryPane 均为 14px/600', () => {
    const sf = rule(read('../SettingsForm.vue'), '.section-label')
    expect(sf).toContain('font-size: 14px')
    expect(sf).toContain('font-weight: 600')
    const up = rule(read('../UsagePane.vue'), '.pane-label')
    expect(up).toContain('font-size: 14px')
    expect(up).toContain('font-weight: 600')
    const mp = rule(read('../MemoryPane.vue'), '.section-label.pane-label')
    expect(mp).toContain('font-size: 14px')
    expect(mp).toContain('font-weight: 600')
  })

  it('MemoryPane 复用 class 显式对齐 SettingsForm 同名规则（scoped 边界自持）', () => {
    const label = rule(read('../MemoryPane.vue'), '.field-label')
    expect(label).toContain('font-size: 13px')
    expect(label).toContain('font-weight: 500')
    const hint = rule(read('../MemoryPane.vue'), '.field-hint')
    expect(hint).toContain('font-size: 12px')
    // 对照源：SettingsForm 同名规则值逐字一致（防两处漂移）
    expect(rule(read('../SettingsForm.vue'), '.field-label')).toContain('font-size: 13px')
    expect(rule(read('../SettingsForm.vue'), '.field-hint')).toContain('font-size: 12px')
  })
})
