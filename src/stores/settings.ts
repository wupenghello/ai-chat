import { defineStore } from 'pinia'

/** REQ-014：API 供应商与密钥可配置（OpenAI 兼容） */
export interface ApiConfig {
  baseUrl: string
  model: string
  apiKey: string
}

const STORAGE_KEY = 'ai-chat:settings'

function loadPersisted(): Partial<ApiConfig> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

/** 逐字段校验：返回各字段错误文案；全空对象表示通过 */
export function validateConfig(c: Partial<ApiConfig>): Partial<Record<keyof ApiConfig, string>> {
  const errors: Partial<Record<keyof ApiConfig, string>> = {}
  if (!c.baseUrl?.trim()) errors.baseUrl = '必填：API 地址（如 https://open.bigmodel.cn/api/paas/v4）'
  else if (!/^https?:\/\//.test(c.baseUrl.trim())) errors.baseUrl = '必须以 http(s):// 开头'
  if (!c.model?.trim()) errors.model = '必填：模型名（如 glm-5.3）'
  if (!c.apiKey?.trim()) errors.apiKey = '必填：API Key'
  return errors
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({ config: loadPersisted() as Partial<ApiConfig> }),
  getters: {
    isConfigured: (s) => Object.keys(validateConfig(s.config)).length === 0,
  },
  actions: {
    /** 校验通过才写入并持久化；不完整配置不入库（REQ-014 验收） */
    save(c: ApiConfig): Partial<Record<keyof ApiConfig, string>> {
      const errors = validateConfig(c)
      if (Object.keys(errors).length > 0) return errors
      this.config = { baseUrl: c.baseUrl.trim(), model: c.model.trim(), apiKey: c.apiKey.trim() }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config))
      return {}
    },
    /** 清除密钥：状态与本地存储一并清除，无残留（REQ-014 验收） */
    clearKey() {
      delete this.config.apiKey
      const remaining = { ...this.config }
      if (Object.keys(remaining).length === 0) localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining))
    },
  },
})
