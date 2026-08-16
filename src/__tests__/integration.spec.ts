/**
 * 集成路径自动化用例（iter-2 T1，tailoring.md 改进项 C）
 *
 * 背景：iter-1 的 27 个单测覆盖 store/组件逻辑，但"发送→不刷新页面流式渲染"这类
 * 真实组件树路径无自动化用例，Pinia 响应式代理真 bug（发消息不刷新）由 CEO 试用才发现。
 * 本文件挂载完整 App.vue（真实 Pinia + 真实组件树），仅 mock IndexedDB 与网络层
 * （api/client.streamChat），断言 DOM 行为。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import App from '../App.vue'
import { useSettingsStore } from '../stores/settings'
import { useAuthStore } from '../stores/auth'

vi.mock('../db/persistence', () => ({
  loadSessions: vi.fn(async () => []),
  saveSession: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
}))

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  streamChatViaProxy: vi.fn(),
}))

import { streamChatViaProxy, type StreamHandlers } from '../api/client'

const mockedStream = vi.mocked(streamChatViaProxy)

/** 挂起式流式 mock：delta 手动推送，finish 手动收尾——模拟真实网络的分包与耗时 */
function gatedStream() {
  let delta!: (t: string) => void
  let finish!: () => void
  const promise = new Promise<string>((res) => (finish = () => res('完整回复')))
  mockedStream.mockImplementation((_m, h: StreamHandlers) => {
    delta = (t) => h.onDelta(t)
    return promise
  })
  return { push: (t: string) => delta(t), finish: () => finish() }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  setActivePinia(createPinia())
  const settings = useSettingsStore()
  settings.systemPrompt = ''
  useAuthStore().user = { id: 1, username: 'tester' }
})

async function mountApp() {
  const wrapper = mount(App)
  await flushPromises() // onMounted init 完成
  return wrapper
}

async function sendFromComposer(wrapper: ReturnType<typeof mount>, text: string) {
  const ta = wrapper.find('.composer textarea')
  await ta.setValue(text)
  await ta.trigger('keydown', { key: 'Enter' })
  await flushPromises()
}

describe('集成路径：发送消息 → 不刷新页面流式渲染（REQ-001 × Bug#6 回归）', () => {
  it('用户消息立即渲染；AI 内容逐段追加、DOM 实时更新；完成后光标移除', async () => {
    const stream = gatedStream()
    const wrapper = await mountApp()

    await sendFromComposer(wrapper, '你好，介绍一下流式输出')
    expect(wrapper.find('.bubble.user').text()).toBe('你好，介绍一下流式输出')

    // 流式内容逐段追加，DOM 实时可见——全程无页面刷新
    stream.push('流式第')
    await flushPromises()
    expect(wrapper.find('.bubble.assistant').text()).toContain('流式第')
    stream.push('一段内容')
    await flushPromises()
    expect(wrapper.find('.bubble.assistant').text()).toContain('流式第一段内容')
    expect(wrapper.find('.cursor').exists()).toBe(true) // 生成中光标闪烁

    stream.finish()
    await flushPromises()
    expect(wrapper.find('.cursor').exists()).toBe(false) // 完成，光标移除
  })
})

describe('集成路径：生成中切换会话后台继续、切回可见（CHG-001 × REQ-010 走查 21）', () => {
  it('切走期间后台流式仍在累积；切回可见全部内容并恢复停止按钮态', async () => {
    const stream = gatedStream()
    const wrapper = await mountApp()

    // 两个空会话：先建 B，再建 A（新会话在前，A 即当前）
    await wrapper.find('.new-btn').trigger('click')
    await wrapper.find('.new-btn').trigger('click')

    await sendFromComposer(wrapper, '慢问题')
    stream.push('后台部分')
    await flushPromises()
    expect(wrapper.find('.bubble.assistant').text()).toContain('后台部分')

    // 切到 B：A 的消息不可见；B 非生成中，无停止按钮
    await wrapper.findAll('.item')[1].trigger('click')
    await flushPromises()
    expect(wrapper.find('.bubble.assistant').exists()).toBe(false)
    expect(wrapper.find('.stop').exists()).toBe(false)

    // 停留在 B 期间，A 的后台流继续接收
    stream.push('继续收到')
    await flushPromises()
    expect(wrapper.find('.bubble.assistant').exists()).toBe(false)

    // 切回 A：后台期间收到的内容全部可见，停止按钮态恢复
    await wrapper.findAll('.item')[0].trigger('click')
    await flushPromises()
    expect(wrapper.find('.bubble.assistant').text()).toContain('后台部分继续收到')
    expect(wrapper.find('.stop').exists()).toBe(true)

    stream.finish()
    await flushPromises()
    expect(wrapper.find('.stop').exists()).toBe(false) // 完成后回到发送态
  })
})
