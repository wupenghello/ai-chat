import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import SettingsForm from '../../components/SettingsForm.vue'
import { useSettingsStore } from '../settings'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

async function fill(wrapper: ReturnType<typeof mount>, baseUrl: string, model: string, key: string) {
  await wrapper.find('input[type="text"]').setValue(baseUrl)
  await wrapper.findAll('input[type="text"]')[1].setValue(model)
  await wrapper.find('input[type="password"]').setValue(key)
}

describe('SettingsForm（REQ-014）', () => {
  it('不完整配置：显示行内错误且不持久化', async () => {
    const wrapper = mount(SettingsForm)
    await fill(wrapper, '', 'glm-5.3', 'k')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.find('.field-error').text()).toContain('必填')
    expect(localStorage.getItem('ai-chat:settings')).toBeNull()
  })

  it('完整配置：保存成功并持久化', async () => {
    const wrapper = mount(SettingsForm)
    await fill(wrapper, 'https://open.bigmodel.cn/api/paas/v4', 'glm-5.3', 'my-key')
    await wrapper.find('form').trigger('submit')
    const settings = useSettingsStore()
    expect(settings.isConfigured).toBe(true)
    expect(localStorage.getItem('ai-chat:settings')).toContain('my-key')
  })

  it('清除密钥：确认后本地无残留', async () => {
    const settings = useSettingsStore()
    settings.save({ baseUrl: 'https://x', model: 'm', apiKey: 'secret' })
    const wrapper = mount(SettingsForm)
    await wrapper.find('.btn:not(.btn-primary)').trigger('click') // 清除密钥按钮
    // ConfirmModal Teleport 到 body，从 document 取确认按钮
    const danger = document.body.querySelector('.btn-danger') as HTMLButtonElement
    danger.click()
    await wrapper.vm.$nextTick()
    expect(settings.config.apiKey).toBeUndefined()
    expect(localStorage.getItem('ai-chat:settings')).not.toContain('secret')
  })
})
