import { defineStore } from 'pinia'

/** REQ-014：API 供应商与密钥可配置（OpenAI 兼容） */
export interface ApiConfig {
  baseUrl: string
  model: string
  apiKey: string
}

/** REQ-018：供应商档案 = 名称 + 三要素；多套档案一键切换当前生效 */
export interface ApiProfile extends ApiConfig {
  id: string
  name: string
}

/** 本地持久化的完整设置：档案列表 + 当前生效 + 系统提示词（REQ-008）；
    baseUrl/model/apiKey 为 v0.3.0 及以前的单套旧格式，加载时迁移为档案 */
interface PersistedSettings {
  baseUrl?: string
  model?: string
  apiKey?: string
  systemPrompt?: string
  profiles?: ApiProfile[]
  activeProfileId?: string
}

const STORAGE_KEY = 'ai-chat:settings'

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.random()}`

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname
  } catch {
    return '自定义'
  }
}

function loadPersisted(): PersistedSettings {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

/** 全量写入本地存储（档案与 systemPrompt 同一份 JSON，避免互相覆盖） */
function persist(data: PersistedSettings) {
  const clean: PersistedSettings = {
    profiles: data.profiles ?? [],
    activeProfileId: data.activeProfileId,
    systemPrompt: data.systemPrompt,
  }
  if (!clean.activeProfileId) delete clean.activeProfileId
  if (!clean.systemPrompt) delete clean.systemPrompt
  if ((clean.profiles?.length ?? 0) === 0 && !clean.activeProfileId && !clean.systemPrompt) {
    localStorage.removeItem(STORAGE_KEY)
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean))
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

/** 档案校验：三要素 + 名称必填（design-iter-5 待澄清已定夺） */
export function validateProfile(p: Partial<ApiProfile>): Partial<Record<keyof ApiProfile, string>> {
  const errors = validateConfig(p) as Partial<Record<keyof ApiProfile, string>>
  if (!p.name?.trim()) errors.name = '必填：档案名称（如 DeepSeek、GLM）'
  return errors
}

export const useSettingsStore = defineStore('settings', {
  state: () => {
    const p = loadPersisted()
    let profiles = Array.isArray(p.profiles) ? p.profiles : []
    let activeProfileId = p.activeProfileId ?? null
    // 旧版单套配置迁移：包装为首个档案（REQ-018 数据兼容）
    if (profiles.length === 0 && (p.baseUrl || p.model || p.apiKey)) {
      const prof: ApiProfile = {
        id: uid(),
        name: `${p.model?.trim() || '默认档案'}@${hostOf(p.baseUrl ?? '')}`,
        baseUrl: p.baseUrl ?? '',
        model: p.model ?? '',
        apiKey: p.apiKey ?? '',
      }
      profiles = [prof]
      activeProfileId = prof.id
    }
    if (activeProfileId && !profiles.some((x) => x.id === activeProfileId)) {
      activeProfileId = profiles[0]?.id ?? null
    }
    return { profiles, activeProfileId, systemPrompt: p.systemPrompt ?? '', pendingProfileEffect: false }
  },

  getters: {
    activeProfile(state): ApiProfile | null {
      return state.profiles.find((p) => p.id === state.activeProfileId) ?? null
    },
    /** 兼容消费方（sessions/chat-header）：当前生效档案的三要素，无档案为空对象 */
    config(state): Partial<ApiConfig> {
      const a = state.profiles.find((p) => p.id === state.activeProfileId)
      return a ? { baseUrl: a.baseUrl, model: a.model, apiKey: a.apiKey } : {}
    },
    isConfigured(state): boolean {
      const a = state.profiles.find((p) => p.id === state.activeProfileId)
      return !!a && Object.keys(validateConfig(a)).length === 0
    },
  },

  actions: {
    persistAll() {
      persist({ profiles: this.profiles, activeProfileId: this.activeProfileId ?? undefined, systemPrompt: this.systemPrompt })
    },

    /**
     * 更新当前档案（无档案时创建「模型@主机」命名的首个档案）。
     * 兼容 REQ-014 既有入路；校验通过才写入（REQ-014 验收）。
     */
    save(c: ApiConfig): Partial<Record<keyof ApiConfig, string>> {
      const errors = validateConfig(c)
      if (Object.keys(errors).length > 0) return errors
      const trimmed = { baseUrl: c.baseUrl.trim(), model: c.model.trim(), apiKey: c.apiKey.trim() }
      if (this.activeProfile) {
        Object.assign(this.activeProfile, trimmed)
      } else {
        const prof: ApiProfile = { id: uid(), name: `${trimmed.model}@${hostOf(trimmed.baseUrl)}`, ...trimmed }
        this.profiles.push(prof)
        this.activeProfileId = prof.id
      }
      this.persistAll()
      return {}
    },

    /** REQ-018：新增/编辑档案（按 id upsert）；首个档案自动成为当前生效 */
    saveProfile(p: ApiProfile): Partial<Record<keyof ApiProfile, string>> {
      const errors = validateProfile(p)
      if (Object.keys(errors).length > 0) return errors
      const trimmed: ApiProfile = {
        id: p.id,
        name: p.name.trim(),
        baseUrl: p.baseUrl.trim(),
        model: p.model.trim(),
        apiKey: p.apiKey.trim(),
      }
      const idx = this.profiles.findIndex((x) => x.id === p.id)
      if (idx >= 0) this.profiles.splice(idx, 1, trimmed)
      else {
        this.profiles.push(trimmed)
        if (!this.activeProfileId) this.activeProfileId = trimmed.id
      }
      this.persistAll()
      return {}
    },

    /**
     * REQ-018（CHG-002 定案）：切换当前生效档案——生成中的请求在 generate 开始时已锁定配置，
     * 天然「当前回复用旧档案跑完、下一次请求生效」，无需中断。
     */
    setActiveProfile(id: string) {
      if (!this.profiles.some((p) => p.id === id)) return
      this.activeProfileId = id
      this.persistAll()
    },

    /** REQ-018 待澄清 7：生成中切换 → 新当前档案标「待生效」，生成结束转正（瞬态，不持久化） */
    markPendingEffect() {
      this.pendingProfileEffect = true
    },
    clearPendingEffect() {
      this.pendingProfileEffect = false
    },

    /** REQ-018：删除档案；当前生效档案不可删（UI 禁用 + store 双保险），返回是否删除 */
    removeProfile(id: string): boolean {
      if (id === this.activeProfileId) return false
      this.profiles = this.profiles.filter((p) => p.id !== id)
      this.persistAll()
      return true
    },

    /**
     * REQ-008：保存系统提示词（全局单一，CEO 2026-08-15 拍板）。
     * 留空/仅空白 = 无提示词；只影响之后的轮次（组装时机在 generate）。
     */
    saveSystemPrompt(text: string) {
      this.systemPrompt = text.trim()
      this.persistAll()
    },

    /** 清除当前档案密钥：状态与本地存储一并清除，无残留（REQ-014 验收） */
    clearKey() {
      const a = this.profiles.find((p) => p.id === this.activeProfileId)
      if (a) delete (a as Partial<ApiProfile>).apiKey
      this.persistAll()
    },
  },
})
