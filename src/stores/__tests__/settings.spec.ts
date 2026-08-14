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
