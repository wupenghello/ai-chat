import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../../api/backend', () => ({
  backend: {
    listProfiles: vi.fn(),
    createProfile: vi.fn(),
    updateProfile: vi.fn(),
    deleteProfile: vi.fn(),
    activateProfile: vi.fn(),
    clearActiveProfile: vi.fn(),
  },
}))

import { backend } from '../../api/backend'
import { useSettingsStore, validateProfileInput } from '../settings'

const mocked = vi.mocked(backend)

const SERVER_P = (id: string, name: string, active = false) => ({
  id,
  name,
  base_url: 'https://api.test',
  model: 'm1',
  api_key_masked: 'sk-****1234',
  is_active: active,
})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('validateProfileInput（REQ-014 逐字段校验，编辑 key 可空=沿用）', () => {
  it('完整输入通过（添加模式）', () => {
    const errs = validateProfileInput(
      { name: 'D', baseUrl: 'https://a.test', model: 'm', apiKey: 'sk-1' },
      false,
    )
    expect(errs).toEqual({})
  })

  it('缺任一字段报必填', () => {
    const errs = validateProfileInput({ name: '', baseUrl: '', model: '', apiKey: '' }, false)
    expect(Object.keys(errs).sort()).toEqual(['apiKey', 'baseUrl', 'model', 'name'])
  })

  it('baseUrl 非 http(s) 拒绝', () => {
    const errs = validateProfileInput(
      { name: 'D', baseUrl: 'ftp://a.test', model: 'm', apiKey: 'k' },
      false,
    )
    expect(errs.baseUrl).toContain('http(s)')
  })

  it('编辑模式：apiKey 可空（= 沿用服务端已存 key）', () => {
    const errs = validateProfileInput(
      { name: 'D', baseUrl: 'https://a.test', model: 'm', apiKey: '' },
      true,
    )
    expect(errs).toEqual({})
  })
})

describe('settings store（REQ-018 iter-7 T2：档案服务端源）', () => {
  it('boot：拉取档案列表并按 is_active 定位当前生效', async () => {
    mocked.listProfiles.mockResolvedValue([SERVER_P('a', 'A'), SERVER_P('b', 'B', true)])
    const s = useSettingsStore()
    await s.boot()
    expect(s.profiles).toHaveLength(2)
    expect(s.activeProfileId).toBe('b')
    expect(s.keyMode).toBe('custom')
    expect(s.profiles[0].apiKeyMasked).toBe('sk-****1234') // 前端只有掩码视图
    expect(s.profilesLoaded).toBe(true)
  })

  it('boot 无生效档案 → 统一 key 模式', async () => {
    mocked.listProfiles.mockResolvedValue([SERVER_P('a', 'A')])
    const s = useSettingsStore()
    await s.boot()
    expect(s.activeProfileId).toBeNull()
    expect(s.keyMode).toBe('unified')
  })

  it('saveNewProfile：校验失败不调 API；成功 POST 并入列表', async () => {
    const s = useSettingsStore()
    const errs = await s.saveNewProfile({ name: '', baseUrl: 'x', model: '', apiKey: '' })
    expect(Object.keys(errs).length).toBeGreaterThan(0)
    expect(mocked.createProfile).not.toHaveBeenCalled()

    mocked.createProfile.mockResolvedValue(SERVER_P('new', 'D'))
    const ok = await s.saveNewProfile({
      name: 'D',
      baseUrl: 'https://api.test/',
      model: 'm1',
      apiKey: 'sk-live-1234',
    })
    expect(ok).toEqual({})
    expect(mocked.createProfile).toHaveBeenCalledWith({
      name: 'D',
      base_url: 'https://api.test/', // 前端只 trim；尾斜杠归一在服务端 validator
      model: 'm1',
      api_key: 'sk-live-1234',
    })
    expect(s.profiles).toHaveLength(1)
  })

  it('saveProfileEdit：apiKey 留空 → 传空串（服务端沿用原值）', async () => {
    mocked.updateProfile.mockResolvedValue(SERVER_P('a', 'A2'))
    const s = useSettingsStore()
    s.profiles = [{ id: 'a', name: 'A', baseUrl: 'https://api.test', model: 'm1', apiKeyMasked: 'sk-****1111' }]
    const errs = await s.saveProfileEdit('a', {
      name: 'A2',
      baseUrl: 'https://api.test',
      model: 'm2',
      apiKey: '',
    })
    expect(errs).toEqual({})
    expect(mocked.updateProfile).toHaveBeenCalledWith('a', {
      name: 'A2',
      base_url: 'https://api.test',
      model: 'm2',
      api_key: '',
    })
    expect(s.profiles[0].name).toBe('A2')
  })

  it('removeProfile：服务端 409（当前生效禁删）返回 false 且列表保留', async () => {
    mocked.deleteProfile.mockRejectedValue(new Error('409'))
    const s = useSettingsStore()
    s.profiles = [{ id: 'a', name: 'A', baseUrl: '', model: '', apiKeyMasked: '' }]
    expect(await s.removeProfile('a')).toBe(false)
    expect(s.profiles).toHaveLength(1)

    mocked.deleteProfile.mockResolvedValue({ detail: 'deleted' })
    expect(await s.removeProfile('a')).toBe(true)
    expect(s.profiles).toHaveLength(0)
  })

  it('setActiveProfile / clearActiveProfile：本地态与模式联动', async () => {
    mocked.activateProfile.mockResolvedValue({ detail: 'activated' })
    mocked.clearActiveProfile.mockResolvedValue({ detail: 'cleared' })
    const s = useSettingsStore()
    s.profiles = [{ id: 'a', name: 'A', baseUrl: '', model: '', apiKeyMasked: '' }]
    await s.setActiveProfile('a')
    expect(s.activeProfileId).toBe('a')
    expect(s.keyMode).toBe('custom')
    await s.clearActiveProfile()
    expect(s.activeProfileId).toBeNull()
    expect(s.keyMode).toBe('unified')
    expect(s.profiles).toHaveLength(1) // 回退 = 档案保留（design-iter-7 §1.2）
  })
})

describe('系统提示词（REQ-008）与本地存储边界（iter-7 T2）', () => {
  it('保存并 trim；仅空白 = 留空；localStorage 只写 systemPrompt', () => {
    const s = useSettingsStore()
    s.saveSystemPrompt('  你是翻译助手  ')
    expect(s.systemPrompt).toBe('你是翻译助手')
    expect(JSON.parse(localStorage.getItem('ai-chat:settings')!)).toEqual({
      systemPrompt: '你是翻译助手',
    })
    s.saveSystemPrompt('   ')
    expect(s.systemPrompt).toBe('')
    expect(localStorage.getItem('ai-chat:settings')).toBeNull()
  })

  it('旧版本存于 localStorage 的档案字段：停读、不被清除（存量上云 iter-8 导入）', () => {
    localStorage.setItem(
      'ai-chat:settings',
      JSON.stringify({
        profiles: [{ id: 'old', name: '旧档案', baseUrl: 'https://x', model: 'm', apiKey: 'sk-old-key' }],
        activeProfileId: 'old',
        systemPrompt: '旧提示词',
      }),
    )
    const s = useSettingsStore()
    expect(s.profiles).toEqual([]) // 停读
    expect(s.activeProfileId).toBeNull()
    expect(s.systemPrompt).toBe('旧提示词') // 提示词仍本地
    // 保存新提示词不吞掉旧档案字段（iter-8 导入的数据源）
    s.saveSystemPrompt('新提示词')
    const raw = JSON.parse(localStorage.getItem('ai-chat:settings')!)
    expect(raw.systemPrompt).toBe('新提示词')
    expect(raw.profiles).toHaveLength(1)
    expect(raw.profiles[0].apiKey).toBe('sk-old-key')
  })

  it('新 store 实例可读回提示词（刷新后仍生效）', () => {
    const s = useSettingsStore()
    s.saveSystemPrompt('跨刷新')
    const s2 = useSettingsStore()
    expect(s2.systemPrompt).toBe('跨刷新')
  })
})

describe('档案待生效标注（REQ-018 待澄清 7）', () => {
  it('生成中切换置待生效，生成结束清除；瞬态不入持久化', () => {
    const s = useSettingsStore()
    s.markPendingEffect()
    expect(s.pendingProfileEffect).toBe(true)
    s.clearPendingEffect()
    expect(s.pendingProfileEffect).toBe(false)
    expect(localStorage.getItem('ai-chat:settings')).toBeNull()
  })
})
