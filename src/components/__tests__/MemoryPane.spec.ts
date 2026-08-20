/**
 * iter-17 T3（CHG-011 REQ-043，design-iter-17 §2/§3/§4.6）：「AI 的记忆」分区七态——
 * 列表/行内编辑/删除确认/停用灰显冻结/注入预览逐字同源/空态/加载失败；样件文案逐字
 * 断言（M 登记表）；零乐观更新（写后重取 GET）；预览前端零本地拼装（injection_preview
 * 逐字渲染）；REQ-043 验收 2~4 vitest 面（编辑/删除闭环 + 整体停用 + 注入可见）。
 * 独立 mock 与夹具（沿 TheSidebarCompact.spec / AdminTelemetry.spec 先例）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'

const backendMock = vi.hoisted(() => ({
  getMemory: vi.fn(),
  updateMemoryEntry: vi.fn(),
  deleteMemoryEntry: vi.fn(),
  setMemoryEnabled: vi.fn(),
}))

vi.mock('../../api/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/backend')>()),
  backend: backendMock,
}))

import MemoryPane from '../MemoryPane.vue'
import { useToastStore } from '../../stores/toast'
import type { MemoryState } from '../../api/backend'

const PREVIEW =
  '<user_memory>\n以下是关于用户的长期记忆（自动从历史对话抽取），回复时作为用户背景参考：\n' +
  '1. 偏好简洁中文\n2. 周报三段式\n</user_memory>'

function state(extra: Partial<MemoryState> = {}): MemoryState {
  return {
    entries: [
      {
        id: 1, content: '偏好简洁中文', source_session_id: 's1',
        source_session_title: '迭代计划流程设计', model: 'deepseek-chat',
        created_at: '2026-08-20 21:04:11', updated_at: '2026-08-20 21:04:11',
      },
      {
        id: 2, content: '周报三段式', source_session_id: null,
        source_session_title: null, model: null,
        created_at: '2026-08-20 21:04:11', updated_at: '2026-08-20 22:00:00',
      },
    ],
    memory_enabled: true,
    injection_preview: PREVIEW,
    ...extra,
  }
}

function mountPane() {
  return mount(MemoryPane, { props: { active: true }, global: { plugins: [activePinia] } })
}

let activePinia: ReturnType<typeof createPinia>
beforeEach(() => {
  vi.clearAllMocks()
  activePinia = createPinia()
  setActivePinia(activePinia) // 与 mount 插件同实例（toast store 断言同源）
  backendMock.getMemory.mockResolvedValue(state())
})

describe('列表态（M 登记表逐字 + 元信息三分支）', () => {
  it('分区标题/说明/列表头/计数逐字', async () => {
    const w = mountPane()
    await flushPromises()
    expect(w.text()).toContain('AI 的记忆')
    expect(w.text()).toContain('记忆由对话自动沉淀，AI 在回复时参考；你的修改自下一回合起生效。')
    expect(w.text()).toContain('记忆条目')
    expect(w.text()).toContain('共 2 条')
    expect(w.find('.mlh-count').attributes('title')).toBe('上限 30 条，自动抽取超限时按上限截断')
  })

  it('元信息三分支：自动抽取有会话名 / 手工编辑（来源归零）', async () => {
    const w = mountPane()
    await flushPromises()
    const metas = w.findAll('.mi-meta').map((m) => m.text())
    expect(metas[0]).toBe('自动抽取 ·「迭代计划流程设计」· 更新于 2026-08-20')
    expect(metas[1]).toBe('手工编辑 · 更新于 2026-08-20')
  })

  it('元信息分支：来源会话已删（title null → M11）', async () => {
    backendMock.getMemory.mockResolvedValue(state({
      entries: [{
        id: 3, content: '记忆样件', source_session_id: 's-gone',
        source_session_title: null, model: 'deepseek-chat',
        created_at: '2026-08-20 21:04:11', updated_at: '2026-08-20 21:04:11',
      }],
    }))
    const w = mountPane()
    await flushPromises()
    expect(w.find('.mi-meta').text()).toBe('自动抽取 · 更新于 2026-08-20')
  })
})

describe('注入预览（定夺⑨逐字同源 + null 分支铁律 5）', () => {
  it('默认折叠；展开后逐字渲染服务端 injection_preview（前端零拼装）', async () => {
    const w = mountPane()
    await flushPromises()
    expect(w.find('.mp-code').exists()).toBe(false) // 默认折叠
    await w.find('.mp-head').trigger('click')
    expect(w.find('.mp-code').text()).toBe(PREVIEW) // 逐字同源
    expect(w.text()).toContain('注入内容预览')
    expect(w.text()).toContain('所见即所注：以下文本在每个回合组装时逐字注入对话开头')
  })

  it('停用分支显 M24 停用句（不呈现注入物）', async () => {
    backendMock.getMemory.mockResolvedValue(state({ memory_enabled: false, injection_preview: null }))
    const w = mountPane()
    await flushPromises()
    await w.find('.mp-head').trigger('click')
    expect(w.find('.mp-null').text()).toBe('记忆已停用，记忆内容不会注入对话。重新启用即恢复注入。')
  })

  it('空条目分支显 M25 空句', async () => {
    backendMock.getMemory.mockResolvedValue(state({ entries: [], injection_preview: null }))
    const w = mountPane()
    await flushPromises()
    await w.find('.mp-head').trigger('click')
    expect(w.find('.mp-null').text()).toBe('暂无记忆条目，暂无注入内容。')
  })
})

describe('空态（M26/M27 逐字）', () => {
  it('entries 空 → 虚线框空态（开关行正常在位）', async () => {
    backendMock.getMemory.mockResolvedValue(state({ entries: [], injection_preview: null }))
    const w = mountPane()
    await flushPromises()
    expect(w.text()).toContain('暂无记忆')
    expect(w.text()).toContain('记忆在对话中自动沉淀：对话结束后，AI 自动抽取关于你的身份、偏好与约定等值得记住的信息。')
    expect(w.find('.mem-switch-row').exists()).toBe(true)
  })
})

describe('加载失败态（M28/M29 + 重试可重入）', () => {
  it('GET 失败 → 失败框 + 重试；开关/列表/预览不渲染；重试成功恢复', async () => {
    backendMock.getMemory.mockRejectedValueOnce(new Error('network'))
    const w = mountPane()
    await flushPromises()
    expect(w.text()).toContain('记忆加载失败，请检查网络')
    expect(w.find('.mem-switch-row').exists()).toBe(false)
    expect(w.find('.mem-list').exists()).toBe(false)
    expect(w.find('.mem-preview').exists()).toBe(false)

    backendMock.getMemory.mockResolvedValue(state())
    await w.find('.mem-retry').trigger('click')
    await flushPromises()
    expect(w.find('.mem-list').exists()).toBe(true)
  })

  it('重试失败停留失败态（不重复 toast）', async () => {
    backendMock.getMemory.mockRejectedValue(new Error('network'))
    const toast = useToastStore()
    const w = mountPane()
    await flushPromises()
    await w.find('.mem-retry').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('记忆加载失败，请检查网络')
    expect(toast.items.length).toBe(0)
  })
})

describe('行内编辑（REQ-043 验收 2 vitest 面）', () => {
  it('编辑 → 保存 PUT → toast M30 逐字 + 重取 GET（来源转手工分支由服务端真态承载）', async () => {
    backendMock.updateMemoryEntry.mockResolvedValue({})
    const toast = useToastStore()
    const w = mountPane()
    await flushPromises()
    await w.findAll('.mi-icon')[0].trigger('click') // 编辑第一条
    expect(w.find('.mi-ta').exists()).toBe(true)
    await w.find('.mi-ta').setValue('改写后的记忆内容')
    await w.find('.mi-btn-save').trigger('click')
    await flushPromises()
    expect(backendMock.updateMemoryEntry).toHaveBeenCalledWith(1, '改写后的记忆内容')
    expect(toast.items[0].message).toBe('✓ 记忆已保存，下一回合生效')
    expect(toast.items[0].variant).toBe('success')
    expect(backendMock.getMemory).toHaveBeenCalledTimes(2) // 初始 + 写后重取
  })

  it('trim 为空 → 保存禁用；Esc 取消还原（cancelEditing 暴露）', async () => {
    const w = mountPane()
    await flushPromises()
    await w.findAll('.mi-icon')[0].trigger('click')
    await w.find('.mi-ta').setValue('   ')
    expect((w.find('.mi-btn-save').element as HTMLButtonElement).disabled).toBe(true)
    expect(w.vm.cancelEditing()).toBe(true)
    await flushPromises()
    expect(w.find('.mi-ta').exists()).toBe(false)
    expect(w.vm.cancelEditing()).toBe(false) // 非编辑态返回 false（Esc 链不吞）
  })

  it('保存失败 → toast M34 + 重取 GET 恢复服务端真态', async () => {
    backendMock.updateMemoryEntry.mockRejectedValue(new Error('boom'))
    const toast = useToastStore()
    const w = mountPane()
    await flushPromises()
    await w.findAll('.mi-icon')[0].trigger('click')
    await w.find('.mi-ta').setValue('x')
    await w.find('.mi-btn-save').trigger('click')
    await flushPromises()
    expect(toast.items[0].message).toBe('保存失败，请重试')
    expect(backendMock.getMemory).toHaveBeenCalledTimes(2)
    expect(w.find('.mi-ta').exists()).toBe(false)
  })
})

describe('删除确认（REQ-043 验收 2 vitest 面 + M19~M21 逐字）', () => {
  it('删除 → ConfirmModal 文案逐字 → DELETE → toast M31 + 重取', async () => {
    backendMock.deleteMemoryEntry.mockResolvedValue({ detail: 'deleted' })
    const toast = useToastStore()
    const w = mountPane()
    await flushPromises()
    await w.findAll('.mi-icon-del')[0].trigger('click')
    const modal = w.findComponent({ name: 'ConfirmModal' })
    expect(modal.props('title')).toBe('删除这条记忆？')
    expect(modal.props('body')).toBe('删除后 AI 将不再参考这条记忆，此操作不可撤销。')
    expect(modal.props('confirmLabel')).toBe('删除')
    modal.vm.$emit('confirm')
    await flushPromises()
    expect(backendMock.deleteMemoryEntry).toHaveBeenCalledWith(1)
    expect(toast.items[0].message).toBe('✓ 记忆已删除，下一回合生效')
    expect(backendMock.getMemory).toHaveBeenCalledTimes(2)
  })

  it('删除失败 → toast M35 + 重取', async () => {
    backendMock.deleteMemoryEntry.mockRejectedValue(new Error('boom'))
    const toast = useToastStore()
    const w = mountPane()
    await flushPromises()
    await w.findAll('.mi-icon-del')[0].trigger('click')
    w.findComponent({ name: 'ConfirmModal' }).vm.$emit('confirm')
    await flushPromises()
    expect(toast.items[0].message).toBe('删除失败，请重试')
  })
})

describe('整体停用（REQ-043 验收 3 vitest 面 + 灰显冻结）', () => {
  it('停用 → PUT settings → toast M32 逐字（白字态）+ 重取', async () => {
    backendMock.setMemoryEnabled.mockResolvedValue({ memory_enabled: false })
    backendMock.getMemory
      .mockResolvedValueOnce(state())
      .mockResolvedValueOnce(state({ memory_enabled: false, injection_preview: null }))
    const toast = useToastStore()
    const w = mountPane()
    await flushPromises()
    await w.findComponent({ name: 'ToggleSwitch' }).vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(backendMock.setMemoryEnabled).toHaveBeenCalledWith(false)
    expect(toast.items[0].message).toBe('记忆已停用：AI 将不再参考任何记忆')
    expect(toast.items[0].variant).toBeUndefined() // 停用为白字态（非 success）
  })

  it('停用态：通知条 M6 逐字 + 列表灰显 + 操作钮冻结 + 预览停用句', async () => {
    backendMock.getMemory.mockResolvedValue(state({ memory_enabled: false, injection_preview: null }))
    const w = mountPane()
    await flushPromises()
    expect(w.text()).toContain('记忆已停用：AI 不再参考任何记忆，也不再进行新的沉淀。已有记忆保留，重新启用即恢复。')
    expect(w.find('.mem-list').classes()).toContain('off')
    const btns = w.findAll('.mi-icon')
    expect(btns.every((b) => (b.element as HTMLButtonElement).disabled)).toBe(true)
    // 停用态点击编辑无反应（操作冻结双保险）
    await btns[0].trigger('click')
    expect(w.find('.mi-ta').exists()).toBe(false)
  })

  it('重新启用 → toast M33 success 绿字', async () => {
    backendMock.getMemory.mockResolvedValue(state({ memory_enabled: false, injection_preview: null }))
    backendMock.setMemoryEnabled.mockResolvedValue({ memory_enabled: true })
    const toast = useToastStore()
    const w = mountPane()
    await flushPromises()
    await w.findComponent({ name: 'ToggleSwitch' }).vm.$emit('update:modelValue', true)
    await flushPromises()
    expect(toast.items[0].message).toBe('✓ 记忆已重新启用，下一回合生效')
    expect(toast.items[0].variant).toBe('success')
  })

  it('开关失败 → toast M36 + 重取回滚开关位（零乐观更新）', async () => {
    backendMock.setMemoryEnabled.mockRejectedValue(new Error('boom'))
    const toast = useToastStore()
    const w = mountPane()
    await flushPromises()
    await w.findComponent({ name: 'ToggleSwitch' }).vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(toast.items[0].message).toBe('操作失败，请重试')
    expect(backendMock.getMemory).toHaveBeenCalledTimes(2) // 重取 = 服务端真态回滚
    expect(w.findComponent({ name: 'ToggleSwitch' }).props('modelValue')).toBe(true)
  })
})

describe('注入序与顺序纪律', () => {
  it('entries 顺序 = 注入顺序（前端不排序：列表序号与预览编号一一对应）', async () => {
    backendMock.getMemory.mockResolvedValue(state({
      entries: [
        { id: 9, content: '乙', source_session_id: null, source_session_title: null, model: null, created_at: '2026-08-21 10:00:00', updated_at: '2026-08-21 10:00:00' },
        { id: 3, content: '甲', source_session_id: null, source_session_title: null, model: null, created_at: '2026-08-20 09:00:00', updated_at: '2026-08-20 09:00:00' },
      ],
      injection_preview: '<user_memory>\nx\n1. 乙\n2. 甲\n</user_memory>',
    }))
    const w = mountPane()
    await flushPromises()
    const idxs = w.findAll('.mi-idx').map((n) => n.text())
    expect(idxs).toEqual(['1', '2']) // 按数组序编号，不按 id/时间重排
    expect(w.findAll('.mi-content').map((n) => n.text())).toEqual(['乙', '甲'])
  })
})
