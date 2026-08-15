import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore, validateConfig } from '../settings'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('validateConfig（REQ-014 逐字段校验）', () => {
  const ok: ApiConfigLike = {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.3',
    apiKey: 'k',
  }
  type ApiConfigLike = { baseUrl: string; model: string; apiKey: string }

  it('完整配置通过', () => {
    expect(Object.keys(validateConfig(ok))).toHaveLength(0)
  })

  it('缺任一字段报必填', () => {
    expect(validateConfig({ ...ok, apiKey: ' ' })).toHaveProperty('apiKey')
    expect(validateConfig({ ...ok, model: '' })).toHaveProperty('model')
  })

  it('baseUrl 非 http(s) 拒绝', () => {
    expect(validateConfig({ ...ok, baseUrl: 'ftp://x' })).toHaveProperty('baseUrl')
  })
})

describe('settings store（REQ-014 持久化与清除）', () => {
  it('不完整配置不写入（无残留）', () => {
    const s = useSettingsStore()
    const errors = s.save({ baseUrl: '', model: 'glm-5.3', apiKey: 'k' })
    expect(errors).toHaveProperty('baseUrl')
    expect(s.isConfigured).toBe(false)
    expect(localStorage.getItem('ai-chat:settings')).toBeNull()
  })

  it('完整配置保存并持久化，isConfigured 为真', () => {
    const s = useSettingsStore()
    expect(Object.keys(s.save({ baseUrl: 'https://x', model: 'm', apiKey: 'k' }))).toHaveLength(0)
    expect(s.isConfigured).toBe(true)
    expect(localStorage.getItem('ai-chat:settings')).toContain('"apiKey":"k"')
  })

  it('清除密钥后本地无残留', () => {
    const s = useSettingsStore()
    s.save({ baseUrl: 'https://x', model: 'm', apiKey: 'secret' })
    s.clearKey()
    expect(s.config.apiKey).toBeUndefined()
    expect(localStorage.getItem('ai-chat:settings')).not.toContain('secret')
  })
})

describe('系统提示词（REQ-008，iter-2 T3）', () => {
  it('保存并 trim；仅空白字符 = 留空', () => {
    const s = useSettingsStore()
    s.saveSystemPrompt('  你是翻译助手。 ')
    expect(s.systemPrompt).toBe('你是翻译助手。')
    s.saveSystemPrompt('   ')
    expect(s.systemPrompt).toBe('')
  })

  it('与 API 配置共存持久化，互不覆盖；新 store 实例可读回（刷新后仍生效）', () => {
    const s = useSettingsStore()
    s.save({ baseUrl: 'https://x', model: 'm', apiKey: 'k' })
    s.saveSystemPrompt('只用英文回复')
    expect(localStorage.getItem('ai-chat:settings')).toContain('"systemPrompt":"只用英文回复"')

    // 之后再保存 API 配置，不丢系统提示词
    s.save({ baseUrl: 'https://y', model: 'm2', apiKey: 'k2' })
    expect(localStorage.getItem('ai-chat:settings')).toContain('"systemPrompt":"只用英文回复"')

    const s2 = useSettingsStore() // 模拟重新加载
    expect(s2.systemPrompt).toBe('只用英文回复')
    expect(s2.config.baseUrl).toBe('https://y')
  })
})
