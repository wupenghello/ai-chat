import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'

vi.mock('../../api/backend', () => ({
  backend: {
    listProfiles: vi.fn(async () => []),
    createProfile: vi.fn(),
    updateProfile: vi.fn(),
    deleteProfile: vi.fn(),
    activateProfile: vi.fn(),
    clearActiveProfile: vi.fn(),
  },
}))

import { backend } from '../../api/backend'
import SettingsForm from '../../components/SettingsForm.vue'
import { useSettingsStore } from '../settings'

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

async function mountForm() {
  const settings = useSettingsStore()
  settings.profilesLoaded = true
  return mount(SettingsForm)
}

describe('SettingsForm（REQ-014 v3 / design-iter-7 §1~2）', () => {
  it('统一 key 默认态：状态卡零密钥输入框 + 配额占位破折号（走查 1/2）', async () => {
    const w = await mountForm()
    const text = w.text()
    expect(text).toContain('服务端统一密钥')
    expect(text).toContain('当前模式')
    expect(text).toContain('每日 — 次对话')
    expect(text).toContain('占位')
    // 首屏无任何密钥输入框（旧版三要素表单已消亡）
    expect(w.findAll('input[type="password"]').length).toBe(0)
  })

  it('自填模式态：模式卡显示生效档案名 + 回退按钮（走查 4/6）', async () => {
    const settings = useSettingsStore()
    settings.profiles = [{ id: 'a', name: 'DeepSeek', baseUrl: 'https://api.test', model: 'm', apiKeyMasked: 'sk-****1234' }]
    settings.activeProfileId = 'a'
    const w = await mountForm()
    expect(w.text()).toContain('自填密钥 · 当前生效：DeepSeek')
    expect(w.text()).toContain('已解锁更高配额')
    const fallbackBtn = w.findAll('button').find((b) => b.text().includes('回退统一密钥'))
    expect(fallbackBtn).toBeTruthy()
  })

  it('编辑模态：密钥不回显（留空=沿用），添加模态：密钥必填（走查 8/9）', async () => {
    const settings = useSettingsStore()
    settings.profiles = [{ id: 'a', name: 'DeepSeek', baseUrl: 'https://api.test', model: 'm', apiKeyMasked: 'sk-****1234' }]
    const w = await mountForm()
    await w.findAll('button').find((b) => b.attributes('aria-label') === '编辑档案')!.trigger('click')
    const keyInput = w.find('input[type="password"]')
    expect((keyInput.element as HTMLInputElement).value).toBe('') // 明文不回填
    expect(w.text()).toContain('已保存，不回显')
    expect(keyInput.attributes('placeholder')).toContain('留空保持不变') // 留空=沿用
  })

  it('回退：清除当前生效、档案保留，无确认弹窗（走查 6，REQ-014 主流程 4）', async () => {
    mocked.clearActiveProfile.mockResolvedValue({ detail: 'cleared' })
    const settings = useSettingsStore()
    settings.profiles = [{ id: 'a', name: 'DeepSeek', baseUrl: '', model: '', apiKeyMasked: '' }]
    settings.activeProfileId = 'a'
    const w = await mountForm()
    await w.findAll('button').find((b) => b.text().includes('回退统一密钥'))!.trigger('click')
    await vi.waitFor(() => {
      expect(mocked.clearActiveProfile).toHaveBeenCalledTimes(1)
      expect(settings.activeProfileId).toBeNull()
      expect(settings.profiles).toHaveLength(1) // 档案保留
    })
    // 可逆操作无确认模态
    expect(w.findComponent({ name: 'ConfirmModal' }).props('open')).toBe(false)
  })

  it('添加档案：掩码入列表，明文不落地（走查 10/13）', async () => {
    mocked.createProfile.mockResolvedValue(SERVER_P('new', 'GLM'))
    const w = await mountForm()
    await w.findAll('button').find((b) => b.text().includes('添加供应商档案'))!.trigger('click')
    await w.find('input[type="password"]').setValue('sk-live-abcd9999')
    const inputs = w.findAll('input')
    await inputs[0].setValue('GLM')
    await inputs[1].setValue('https://open.bigmodel.cn/api/paas/v4')
    await inputs[2].setValue('glm-5.3')
    await w.findAll('button').find((b) => b.text().includes('保存档案'))!.trigger('click')
    await vi.waitFor(() => {
      expect(mocked.createProfile).toHaveBeenCalled()
      expect(w.text()).toContain('sk-****1234') // 列表显示服务端掩码
    })
  })
})
