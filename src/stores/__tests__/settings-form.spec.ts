import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import SettingsForm from '../../components/SettingsForm.vue'
import { useSettingsStore } from '../settings'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('SettingsForm（REQ-014/018，iter-5 T3）', () => {
  it('不完整档案：显示行内错误且不持久化', async () => {
    const wrapper = mount(SettingsForm)
    await wrapper.find('.btn').trigger('click') // 添加档案
    const texts = wrapper.findAll('.modal input[type="text"]')
    await texts[0].setValue('') // 名称空（必填，待澄清已定夺）
    await texts[1].setValue('https://x')
    await texts[2].setValue('m')
    await wrapper.find('.modal input[type="password"]').setValue('k')
    await wrapper.find('.modal .btn-primary').trigger('click')
    expect(wrapper.find('.field-error').text()).toContain('必填')
    expect(localStorage.getItem('ai-chat:settings')).toBeNull()
  })

  it('完整档案：添加成功并持久化、成为当前生效', async () => {
    const wrapper = mount(SettingsForm)
    await wrapper.find('.btn').trigger('click')
    const texts = wrapper.findAll('.modal input[type="text"]')
    await texts[0].setValue('DeepSeek')
    await texts[1].setValue('https://api.deepseek.com/v1')
    await texts[2].setValue('deepseek-chat')
    await wrapper.find('.modal input[type="password"]').setValue('sk-1')
    await wrapper.find('.modal .btn-primary').trigger('click')
    const settings = useSettingsStore()
    expect(settings.isConfigured).toBe(true)
    expect(settings.activeProfile?.name).toBe('DeepSeek')
    expect(localStorage.getItem('ai-chat:settings')).toContain('sk-1')
    expect(wrapper.find('.p-current').text()).toBe('当前生效')
    expect(wrapper.find('.modal').exists()).toBe(false) // 模态关闭
  })

  it('多档案：「设为当前」切换生效档案', async () => {
    const settings = useSettingsStore()
    settings.saveProfile({ id: 'a', name: 'A', baseUrl: 'https://a.io', model: 'ma', apiKey: 'k1' })
    settings.saveProfile({ id: 'b', name: 'B', baseUrl: 'https://b.io', model: 'mb', apiKey: 'k2' })
    const wrapper = mount(SettingsForm)
    expect(settings.activeProfileId).toBe('a') // 首个自动生效
    await wrapper.find('.p-btn').trigger('click') // B 的「设为当前」
    expect(settings.activeProfileId).toBe('b')
    expect(settings.config.model).toBe('mb')
  })

  it('清除当前档案密钥：确认后本地无残留（REQ-014 验收沿袭）', async () => {
    const settings = useSettingsStore()
    settings.save({ baseUrl: 'https://x', model: 'm', apiKey: 'secret' })
    const wrapper = mount(SettingsForm)
    await wrapper.find('.btn-text-danger').trigger('click')
    // ConfirmModal Teleport 到 body，从 document 取确认按钮
    const danger = document.body.querySelector('.btn-danger') as HTMLButtonElement
    danger.click()
    await wrapper.vm.$nextTick()
    expect(settings.config.apiKey).toBeUndefined()
    expect(localStorage.getItem('ai-chat:settings')).not.toContain('secret')
  })
})
