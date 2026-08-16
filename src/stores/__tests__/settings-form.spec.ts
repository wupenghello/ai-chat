import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('../../api/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/backend')>()),
  backend: {
    listProfiles: vi.fn(async () => []),
    createProfile: vi.fn(),
    updateProfile: vi.fn(),
    deleteProfile: vi.fn(),
    activateProfile: vi.fn(),
    clearActiveProfile: vi.fn(),
    getQuota: vi.fn(async () => null),
    changePassword: vi.fn(),
    deleteAccount: vi.fn(),
  },
}))
vi.mock('../../db/persistence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../db/persistence')>()),
  clearPendingOps: vi.fn(),
}))

import { ApiBackendError, backend } from '../../api/backend'
import { clearPendingOps } from '../../db/persistence'
import SettingsForm from '../../components/SettingsForm.vue'
import { useSettingsStore } from '../settings'
import { useAuthStore } from '../auth'
import { useToastStore } from '../toast'
import { useSessionsStore } from '../sessions'

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
  useAuthStore().user = { id: 1, username: '猫南北' }
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
    // 首屏无任何供应商密钥输入框（旧版三要素表单已消亡）；仅账号区改密 3 密码字段（REQ-021 新增）
    expect(w.findAll('input[type="password"]').length).toBe(3)
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
    const keyInput = w.find('.modal input[type="password"]')
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
    const inputs = w.findAll('.modal input')
    await inputs[0].setValue('GLM')
    await inputs[1].setValue('https://open.bigmodel.cn/api/paas/v4')
    await inputs[2].setValue('glm-5.3')
    await inputs[3].setValue('sk-live-abcd9999')
    await w.findAll('button').find((b) => b.text().includes('保存档案'))!.trigger('click')
    await vi.waitFor(() => {
      expect(mocked.createProfile).toHaveBeenCalled()
      expect(w.text()).toContain('sk-****1234') // 列表显示服务端掩码
    })
  })
})

describe('REQ-021 账号管理 · 修改密码（design-iter-9 §2）', () => {
  const submitBtn = (w: ReturnType<typeof mount>) => w.findAll('button').find((b) => b.text().trim() === '更新密码')!

  it('必填缺失：三项行内「必填」提示，不提交', async () => {
    const w = await mountForm()
    await submitBtn(w).trigger('click')
    expect(w.text()).toContain('必填：请输入旧密码')
    expect(w.text()).toContain('必填：请输入新密码')
    expect(w.text()).toContain('必填：请再次输入新密码')
    expect(mocked.changePassword).not.toHaveBeenCalled()
  })

  it('新密码不足 8 位：行内拦截，不提交', async () => {
    const w = await mountForm()
    const inputs = w.findAll('input[type="password"]')
    await inputs[0].setValue('mm2026')
    await inputs[1].setValue('1234567')
    await inputs[2].setValue('1234567')
    await submitBtn(w).trigger('click')
    expect(w.text()).toContain('新密码至少 8 位')
    expect(mocked.changePassword).not.toHaveBeenCalled()
  })

  it('新密码纯数字：行内拦截「需包含字母与数字」，不提交', async () => {
    const w = await mountForm()
    const inputs = w.findAll('input[type="password"]')
    await inputs[0].setValue('mm2026')
    await inputs[1].setValue('12345678')
    await inputs[2].setValue('12345678')
    await submitBtn(w).trigger('click')
    expect(w.text()).toContain('新密码需包含字母与数字')
    expect(mocked.changePassword).not.toHaveBeenCalled()
  })

  it('新密码纯字母：行内拦截「需包含字母与数字」，不提交', async () => {
    const w = await mountForm()
    const inputs = w.findAll('input[type="password"]')
    await inputs[0].setValue('mm2026')
    await inputs[1].setValue('abcdefgh')
    await inputs[2].setValue('abcdefgh')
    await submitBtn(w).trigger('click')
    expect(w.text()).toContain('新密码需包含字母与数字')
    expect(mocked.changePassword).not.toHaveBeenCalled()
  })

  it('两次不一致：确认字段行内拦截', async () => {
    const w = await mountForm()
    const inputs = w.findAll('input[type="password"]')
    await inputs[0].setValue('mm2026')
    await inputs[1].setValue('newpass123')
    await inputs[2].setValue('newpass456')
    await submitBtn(w).trigger('click')
    expect(w.text()).toContain('两次输入的密码不一致')
    expect(mocked.changePassword).not.toHaveBeenCalled()
  })

  it('新密码=旧密码：行内拦截（与后端 400 同口径）', async () => {
    const w = await mountForm()
    const inputs = w.findAll('input[type="password"]')
    await inputs[0].setValue('password123')
    await inputs[1].setValue('password123')
    await inputs[2].setValue('password123')
    await submitBtn(w).trigger('click')
    expect(w.text()).toContain('新密码不能与旧密码相同')
    expect(mocked.changePassword).not.toHaveBeenCalled()
  })

  it('旧密码错误（后端 400）：旧密码字段红描边 + 行内提示', async () => {
    mocked.changePassword.mockRejectedValue(new ApiBackendError(400, '旧密码错误'))
    const w = await mountForm()
    const inputs = w.findAll('input[type="password"]')
    await inputs[0].setValue('wrong-old')
    await inputs[1].setValue('newpass123')
    await inputs[2].setValue('newpass123')
    await submitBtn(w).trigger('click')
    await flushPromises()
    expect(w.text()).toContain('旧密码错误')
    expect(inputs[0].classes()).toContain('invalid')
    expect(useAuthStore().user).not.toBeNull()
  })

  it('成功：表单清空 + 成功横幅 + 成功绿 toast（当前设备保持登录，定夺①）', async () => {
    mocked.changePassword.mockResolvedValue({ detail: '密码已更新' })
    const w = await mountForm()
    const inputs = w.findAll('input[type="password"]')
    await inputs[0].setValue('mm2026')
    await inputs[1].setValue('newpass123')
    await inputs[2].setValue('newpass123')
    await submitBtn(w).trigger('click')
    await flushPromises()
    expect(mocked.changePassword).toHaveBeenCalledWith('mm2026', 'newpass123')
    expect((inputs[0].element as HTMLInputElement).value).toBe('')
    expect(w.text()).toContain('密码已更新')
    expect(useAuthStore().user).not.toBeNull() // 当前设备保持登录
    const items = useToastStore().items
    expect(items.some((t) => t.variant === 'success' && t.message.includes('密码已更新'))).toBe(true)
  })
})

describe('REQ-021 账号管理 · 注销（design-iter-9 §3）', () => {
  it('密码二次确认成功：deleteAccount 调用 + 清本地凭据/暂存队列 + 成功绿 toast', async () => {
    mocked.deleteAccount.mockResolvedValue({ detail: '账号已删除' })
    const w = await mountForm()
    const modal = w.findComponent({ name: 'DeleteAccountModal' })
    expect(modal.props('open')).toBe(false)
    await w.find('.dz-btn').trigger('click')
    expect(modal.props('open')).toBe(true)
    modal.vm.$emit('confirm', 'mm2026')
    await flushPromises()
    expect(mocked.deleteAccount).toHaveBeenCalledWith('mm2026')
    expect(clearPendingOps).toHaveBeenCalled()
    expect(useAuthStore().user).toBeNull() // 清除凭据 → Root 监听跳 /login
    expect(useToastStore().items.some((t) => t.variant === 'success' && t.message.includes('账号已删除'))).toBe(true)
  })

  it('密码不匹配（后端 400）：错误回填模态、账号与数据不变', async () => {
    mocked.deleteAccount.mockRejectedValue(new ApiBackendError(400, '密码不正确，账号与数据未发生任何变更'))
    const w = await mountForm()
    const modal = w.findComponent({ name: 'DeleteAccountModal' })
    await w.find('.dz-btn').trigger('click')
    modal.vm.$emit('confirm', 'wrong-pwd')
    await flushPromises()
    expect(useAuthStore().user).not.toBeNull()
    expect(modal.props('error')).toBe('密码不正确，账号与数据未发生任何变更')
    expect(modal.props('open')).toBe(true)
  })

  it('生成中注销：先终止全部生成再继续注销流程（不打断取消）', async () => {
    mocked.deleteAccount.mockResolvedValue({ detail: '账号已删除' })
    const sessions = useSessionsStore()
    sessions.controllers['s1'] = new AbortController()
    const spy = vi.spyOn(sessions, 'abortAllGenerations')
    const w = await mountForm()
    const modal = w.findComponent({ name: 'DeleteAccountModal' })
    await w.find('.dz-btn').trigger('click')
    expect(modal.props('generating')).toBe(true)
    modal.vm.$emit('confirm', 'mm2026')
    await flushPromises()
    expect(spy).toHaveBeenCalled()
    expect(mocked.deleteAccount).toHaveBeenCalledWith('mm2026')
    spy.mockRestore()
  })
})
