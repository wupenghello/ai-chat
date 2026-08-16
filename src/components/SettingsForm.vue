<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useSettingsStore, type ProfileInput } from '../stores/settings'
import { useToastStore } from '../stores/toast'
import { useTheme } from '../composables/useTheme'
import { useSessionsStore } from '../stores/sessions'
import { useAuthStore } from '../stores/auth'
import { ApiBackendError, backend, type QuotaStatus } from '../api/backend'
import { clearPendingOps } from '../db/persistence'
import ConfirmModal from './ConfirmModal.vue'
import KeyModeCard from './KeyModeCard.vue'
import DeleteAccountModal from './DeleteAccountModal.vue'

const settings = useSettingsStore()
const toast = useToastStore()
const sessions = useSessionsStore()
const auth = useAuthStore()

/** 「前往高级设置」入口（走查 15）：经错误气泡进入设置页时滚动定位到高级设置区 */
const props = defineProps<{ locateAdv?: boolean }>()
watch(
  () => props.locateAdv,
  (v) => {
    if (v) advSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  },
)

// REQ-018 待澄清 7：生成中切换档案/回退 → 「待生效」胶囊，全部生成结束自动转正
watch(
  () => sessions.isAnyGenerating,
  (g) => {
    if (!g) settings.clearPendingEffect()
  },
)
// REQ-017：设置页「外观」入口（与顶栏主题按钮同状态同存储）
const { theme, setTheme } = useTheme()

// iter-8 T2（REQ-024/014）：免费额度行参数化（GET /api/quota）——取不到保持占位，不编造数值
const quota = ref<QuotaStatus | null>(null)
onMounted(async () => {
  try {
    quota.value = await backend.getQuota()
  } catch {
    /* 后端不可达：KeyModeCard 维持占位态 */
  }
})

// ---- REQ-018 供应商档案（iter-7 T2：存服务端）+ REQ-014 v3 模式卡 ----
const editing = ref(false)
const editingId = ref<string | null>(null) // null = 添加（id 由服务端生成）
const form = reactive<ProfileInput>({ name: '', baseUrl: '', model: '', apiKey: '' })
const errors = ref<Partial<Record<keyof ProfileInput, string>>>({})
const pendingDelete = ref<{ id: string; name: string } | null>(null)
const advSection = ref<HTMLElement | null>(null) // 错误气泡「前往高级设置」定位目标

const isEdit = computed(() => !!editingId.value && settings.profiles.some((p) => p.id === editingId.value))

function hostOf(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname
  } catch {
    return '自定义'
  }
}

function openAdd() {
  editingId.value = null
  Object.assign(form, { name: '', baseUrl: '', model: '', apiKey: '' })
  errors.value = {}
  editing.value = true
}

function openEdit(p: { id: string; name: string; baseUrl: string; model: string }) {
  editingId.value = p.id
  // 密钥不回显（design-iter-7 §2.2 安全条款）：留空 = 沿用服务端已存 key
  Object.assign(form, { name: p.name, baseUrl: p.baseUrl, model: p.model, apiKey: '' })
  errors.value = {}
  editing.value = true
}

async function saveProfile() {
  try {
    errors.value =
      editingId.value && isEdit.value
        ? await settings.saveProfileEdit(editingId.value, { ...form })
        : await settings.saveNewProfile({ ...form })
  } catch (e) {
    toast.push((e as Error).message || '保存失败，请重试')
    return
  }
  if (Object.keys(errors.value).length === 0) {
    editing.value = false
    toast.push('档案已保存')
  }
}

async function confirmDelete() {
  if (pendingDelete.value) {
    const ok = await settings.removeProfile(pendingDelete.value.id)
    toast.push(ok ? '档案已删除' : '当前生效档案不可删除')
  }
  pendingDelete.value = null
}

async function switchTo(p: { id: string; name: string }) {
  if (sessions.isAnyGenerating) settings.markPendingEffect()
  try {
    await settings.setActiveProfile(p.id)
    toast.push(
      sessions.isAnyGenerating
        ? `已切换到「${p.name}」：当前回复将用原配置完成，自下一次请求生效`
        : `已切换到「${p.name}」，下一次请求生效`,
    )
  } catch (e) {
    toast.push((e as Error).message || '切换失败，请重试')
  }
}

/** REQ-014 主流程 4：回退统一密钥——清除当前生效（档案保留），可逆操作无确认弹窗 */
async function fallback() {
  if (sessions.isAnyGenerating) settings.markPendingEffect()
  try {
    await settings.clearActiveProfile()
    toast.push(
      sessions.isAnyGenerating
        ? '已回退统一密钥模式：当前回复将用原配置完成，自下一次请求生效'
        : '已回退统一密钥模式，自下一次请求生效',
    )
  } catch (e) {
    toast.push((e as Error).message || '操作失败，请重试')
  }
}

function gotoAdv() {
  advSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// ---- REQ-008 系统提示词（对话设置，design-iter-2 触点一）----
const promptText = ref(settings.systemPrompt)
const promptSaved = ref(false)
let savedTimer: ReturnType<typeof setTimeout> | undefined
const promptCharCount = computed(() => promptText.value.trim().length)

function savePrompt() {
  settings.saveSystemPrompt(promptText.value) // 留空/仅空白 = 无提示词
  promptSaved.value = true
  clearTimeout(savedTimer)
  savedTimer = setTimeout(() => (promptSaved.value = false), 2000) // "已保存" 2s 淡出
}

function clearPrompt() {
  promptText.value = ''
  settings.saveSystemPrompt('') // 按留空即时保存，不弹确认（可复填，非不可逆）
  toast.push('已清除，后续对话将不使用系统提示词')
}

// ---- REQ-021 账号管理（design-iter-9 §2~3）----
// 修改密码：3 字段 + 行内校验 + 旧密码错误 + 成功反馈（当前设备保持登录，定夺①）
const oldPwd = ref('')
const newPwd = ref('')
const confirmPwd = ref('')
const showOld = ref(false)
const showNew = ref(false)
const showConfirm = ref(false)
const pwdErrors = ref<{ old?: string; next?: string; confirm?: string }>({})
const pwdSuccess = ref(false)
const pwdSubmitting = ref(false)

function validateChangePassword(): boolean {
  const errs: { old?: string; next?: string; confirm?: string } = {}
  if (!oldPwd.value.trim()) errs.old = '必填：请输入旧密码'
  if (!newPwd.value) errs.next = '必填：请输入新密码'
  if (!confirmPwd.value) errs.confirm = '必填：请再次输入新密码'
  if (errs.old || errs.next || errs.confirm) {
    pwdErrors.value = errs
    return false
  }
  // 后端同口径：8~128 位且含字母+数字（CEO 定夺「升级为含字母+数字」，register 与改密统一）
  if (newPwd.value.length < 8) errs.next = '新密码至少 8 位'
  else if (newPwd.value.length > 128) errs.next = '新密码最多 128 位'
  else if (!/[a-zA-Z]/.test(newPwd.value) || !/\d/.test(newPwd.value)) errs.next = '新密码需包含字母与数字'
  else if (newPwd.value === oldPwd.value) errs.next = '新密码不能与旧密码相同'
  if (confirmPwd.value !== newPwd.value) errs.confirm = '两次输入的密码不一致'
  pwdErrors.value = errs
  return Object.keys(errs).length === 0
}

async function submitChangePassword() {
  pwdErrors.value = {}
  pwdSuccess.value = false
  if (!validateChangePassword()) return
  pwdSubmitting.value = true
  try {
    await backend.changePassword(oldPwd.value.trim(), newPwd.value)
    oldPwd.value = ''
    newPwd.value = ''
    confirmPwd.value = ''
    pwdSuccess.value = true
    toast.push('✓ 密码已更新，其他设备已退出登录', undefined, undefined, 'success')
  } catch (e) {
    if (e instanceof ApiBackendError) {
      if (e.status === 400) {
        if (e.message.includes('旧密码')) pwdErrors.value = { ...pwdErrors.value, old: e.message }
        else if (e.message.includes('相同')) pwdErrors.value = { ...pwdErrors.value, next: e.message }
        else toast.push(e.message)
      } else if (e.status === 422) {
        pwdErrors.value = { ...pwdErrors.value, next: e.message }
      } else {
        toast.push(e.message || '更新失败，请重试')
      }
    } else {
      toast.push('更新失败，请重试')
    }
  } finally {
    pwdSubmitting.value = false
  }
}

// 注销账号：危险区 + 密码二次确认强模态 + 生成中终止 + 成功后清本地/跳登录
const deleteOpen = ref(false)
const deleteSubmitting = ref(false)
const deleteError = ref<string | null>(null)

function openDelete() {
  deleteError.value = null
  deleteOpen.value = true
}
function cancelDelete() {
  deleteOpen.value = false
  deleteError.value = null
}
async function confirmDeleteAccount(password: string) {
  // REQ-021 异常分支：生成中注销前自动终止生成（取消走 cancelDelete，不打断）
  if (sessions.isAnyGenerating) sessions.abortAllGenerations()
  deleteSubmitting.value = true
  deleteError.value = null
  try {
    await backend.deleteAccount(password)
    // 成功：清除本地凭据与暂存队列（防跨账号泄漏）→ 跳登录（Root 监听 user→null 完成）+ 成功绿 toast
    clearPendingOps()
    toast.push('✓ 账号已删除，再见', undefined, undefined, 'success')
    deleteOpen.value = false
    auth.clearSession()
  } catch (e) {
    const err = e as ApiBackendError
    if (err?.status === 400) deleteError.value = err.message // 「密码不正确，账号与数据未发生任何变更」
    else deleteError.value = err?.message || '注销失败，请重试'
  } finally {
    deleteSubmitting.value = false
  }
}
</script>

<template>
  <div class="settings">
    <header class="settings-header">
      <h2>设置</h2>
      <p class="hint">对话默认使用服务端统一密钥（零配置）；可在高级设置添加自有供应商密钥，密钥仅存服务端。</p>
    </header>

    <!-- REQ-017 外观 · 主题切换（segmented，与顶栏入口同步） -->
    <div class="section-label">外观</div>
    <div class="theme-seg" role="radiogroup" aria-label="主题">
      <button
        type="button"
        class="seg-btn"
        :class="{ on: theme === 'light' }"
        role="radio"
        :aria-checked="theme === 'light'"
        @click="setTheme('light')"
      >
        浅色
      </button>
      <button
        type="button"
        class="seg-btn"
        :class="{ on: theme === 'dark' }"
        role="radio"
        :aria-checked="theme === 'dark'"
        @click="setTheme('dark')"
      >
        深色
      </button>
    </div>

    <!-- REQ-014 v3 密钥模式卡（design-iter-7 §1）：统一 key 态 ↔ 自填态 -->
    <div class="section-label">密钥模式</div>
    <KeyModeCard
      :mode="settings.keyMode"
      :active-profile-name="settings.activeProfile?.name"
      :quota="quota"
      @fallback="fallback"
      @goto-adv="gotoAdv"
    />

    <!-- REQ-018 高级设置 · 自填供应商密钥（档案存服务端，design-iter-7 §2） -->
    <div ref="advSection" class="section-label">高级设置 · 自填供应商密钥</div>
    <div class="form">
      <p class="adv-intro">
        填写自有 Base URL / 模型名 / API Key，解锁更高配额。<b>密钥仅存服务端</b>（受保护存储），登录后任意设备可见；浏览器本地不存储任何密钥。
      </p>
      <div class="profile-list">
        <div
          v-for="p in settings.profiles"
          :key="p.id"
          class="profile-item"
          :class="{ current: p.id === settings.activeProfileId }"
        >
          <div class="p-info">
            <span class="p-name">{{ p.name }}</span>
            <span class="p-sub">{{ hostOf(p.baseUrl) }} · {{ p.model }} · {{ p.apiKeyMasked }}</span>
          </div>
          <span
            v-if="p.id === settings.activeProfileId"
            class="p-current"
            :title="settings.pendingProfileEffect && sessions.isAnyGenerating ? '待生效（本轮完成后）' : '当前生效'"
          >{{ settings.pendingProfileEffect && sessions.isAnyGenerating ? '↻ 待生效' : '当前生效' }}</span>
          <button v-else type="button" class="p-btn" @click="switchTo(p)">设为当前</button>
          <button type="button" class="p-icon" aria-label="编辑档案" title="编辑" @click="openEdit(p)">
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
              <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
            </svg>
          </button>
          <button
            type="button"
            class="p-icon"
            :disabled="p.id === settings.activeProfileId"
            :title="p.id === settings.activeProfileId ? '当前生效的档案不可删除，请先切换到其他档案或回退统一密钥' : '删除'"
            aria-label="删除档案"
            @click="pendingDelete = { id: p.id, name: p.name }"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
              <path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm4 2v8h1.5v-8H10Zm3 0v8h1.5v-8H13Z" />
            </svg>
          </button>
        </div>
        <div v-if="settings.profiles.length === 0" class="p-empty">暂无档案，点击下方「添加供应商档案」创建第一套自有配置</div>
      </div>

      <div class="actions">
        <button type="button" class="btn" @click="openAdd">
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
            <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
          </svg>
          添加供应商档案
        </button>
      </div>
      <p class="adv-hint">「设为当前」即切换为<b>自填模式</b>，下一次请求生效；<b>当前生效的档案不可删除</b>，请先切换到其他档案或回退统一密钥。</p>

      <!-- REQ-008 对话设置 · 系统提示词（design-iter-2 触点一） -->
      <div class="section-label">对话设置</div>
      <label class="field" for="system-prompt">
        <span class="field-label">系统提示词<span class="optional">可选</span></span>
        <textarea
          id="system-prompt"
          v-model="promptText"
          class="prompt-ta"
          placeholder="定义 AI 的角色与回复风格，如：你是一个简洁的翻译助手，回复不超过三句话。&#10;留空则不使用系统提示词，按普通对话正常请求。"
        />
        <span class="char-count">{{ promptCharCount }} 字</span>
      </label>
      <div class="actions">
        <button type="button" class="btn btn-primary" @click="savePrompt">保存</button>
        <button v-if="settings.systemPrompt" type="button" class="btn-text-danger" @click="clearPrompt">清除</button>
        <span v-if="promptSaved" class="saved-flag">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          已保存
        </span>
      </div>
    </div>

    <!-- REQ-021 账号管理（design-iter-9 §2~3）：设置页「账号」区块，置页尾 -->
    <div class="section-label">账号</div>

    <!-- 修改密码 -->
    <div class="pwd-form">
      <label class="field">
        <span class="field-label">旧密码<span class="req">*</span></span>
        <span class="field-input-wrap">
          <input
            v-model="oldPwd"
            class="input pw-input"
            :class="{ invalid: pwdErrors.old }"
            :type="showOld ? 'text' : 'password'"
            autocomplete="current-password"
            placeholder="输入当前登录密码"
          />
          <button class="eye-btn" type="button" :title="showOld ? '隐藏密码' : '显示密码'" :aria-label="showOld ? '隐藏密码' : '显示密码'" @click="showOld = !showOld">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path v-if="showOld" fill="currentColor" d="M12 5c5 0 9 4.5 9 7s-4 7-9 7-9-4.5-9-7 4-7 9-7Zm0 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-2a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" />
              <path v-else fill="currentColor" d="M2.2 4.3 4.3 2.2l17.5 17.5-2.1 2.1-3.1-3.1A10 10 0 0 1 12 19c-5 0-9-4.5-9-7 0-1.2.8-2.7 2.2-4.1L2.2 4.3ZM12 7.1 16.9 12a4.9 4.9 0 0 0-6.9-6.9L7.6 3.7A10.6 10.6 0 0 1 12 3c5 0 9 4.5 9 7 0 .9-.5 2-1.4 3.2L12 5.6v1.5Z" />
            </svg>
          </button>
        </span>
        <span v-if="pwdErrors.old" class="field-error">{{ pwdErrors.old }}</span>
      </label>

      <label class="field">
        <span class="field-label">新密码<span class="req">*</span></span>
        <span class="field-input-wrap">
          <input
            v-model="newPwd"
            class="input pw-input"
            :class="{ invalid: pwdErrors.next }"
            :type="showNew ? 'text' : 'password'"
            autocomplete="new-password"
            placeholder="至少 8 位，最多 128 位"
          />
          <button class="eye-btn" type="button" :title="showNew ? '隐藏密码' : '显示密码'" :aria-label="showNew ? '隐藏密码' : '显示密码'" @click="showNew = !showNew">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path v-if="showNew" fill="currentColor" d="M12 5c5 0 9 4.5 9 7s-4 7-9 7-9-4.5-9-7 4-7 9-7Zm0 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-2a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" />
              <path v-else fill="currentColor" d="M2.2 4.3 4.3 2.2l17.5 17.5-2.1 2.1-3.1-3.1A10 10 0 0 1 12 19c-5 0-9-4.5-9-7 0-1.2.8-2.7 2.2-4.1L2.2 4.3ZM12 7.1 16.9 12a4.9 4.9 0 0 0-6.9-6.9L7.6 3.7A10.6 10.6 0 0 1 12 3c5 0 9 4.5 9 7 0 .9-.5 2-1.4 3.2L12 5.6v1.5Z" />
            </svg>
          </button>
        </span>
        <span v-if="pwdErrors.next" class="field-error">{{ pwdErrors.next }}</span>
        <span v-else class="field-hint">至少 8 位，需包含字母与数字；不得与旧密码相同</span>
      </label>

      <label class="field">
        <span class="field-label">确认新密码<span class="req">*</span></span>
        <span class="field-input-wrap">
          <input
            v-model="confirmPwd"
            class="input pw-input"
            :class="{ invalid: pwdErrors.confirm }"
            :type="showConfirm ? 'text' : 'password'"
            autocomplete="new-password"
            placeholder="再次输入新密码"
          />
          <button class="eye-btn" type="button" :title="showConfirm ? '隐藏密码' : '显示密码'" :aria-label="showConfirm ? '隐藏密码' : '显示密码'" @click="showConfirm = !showConfirm">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path v-if="showConfirm" fill="currentColor" d="M12 5c5 0 9 4.5 9 7s-4 7-9 7-9-4.5-9-7 4-7 9-7Zm0 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-2a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" />
              <path v-else fill="currentColor" d="M2.2 4.3 4.3 2.2l17.5 17.5-2.1 2.1-3.1-3.1A10 10 0 0 1 12 19c-5 0-9-4.5-9-7 0-1.2.8-2.7 2.2-4.1L2.2 4.3ZM12 7.1 16.9 12a4.9 4.9 0 0 0-6.9-6.9L7.6 3.7A10.6 10.6 0 0 1 12 3c5 0 9 4.5 9 7 0 .9-.5 2-1.4 3.2L12 5.6v1.5Z" />
            </svg>
          </button>
        </span>
        <span v-if="pwdErrors.confirm" class="field-error">{{ pwdErrors.confirm }}</span>
      </label>

      <div v-if="pwdSuccess" class="ok-banner">
        <span class="ob-ico">✓</span>
        <span><span class="ob-title">密码已更新。</span>除当前设备外的其他设备已退出登录，需重新登录后再使用。</span>
      </div>

      <button class="btn btn-primary pwd-submit" type="button" :disabled="pwdSubmitting" @click="submitChangePassword">
        {{ pwdSubmitting ? '更新中…' : '更新密码' }}
      </button>
    </div>

    <!-- 注销危险区 -->
    <div class="danger-zone">
      <div class="dz-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style="flex:none;">
          <path fill="none" stroke="currentColor" stroke-width="1.6" d="M12 3l7 2.6v5.6c0 4.4-3 8.3-7 9.8-4-1.5-7-5.4-7-9.8V5.6L12 3z" />
          <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" />
        </svg>
        注销账号
      </div>
      <div class="dz-desc">将删除账号与<b>全部云端数据</b>（会话、供应商档案、密钥等），此操作<b>不可恢复</b>。</div>
      <div class="dz-actions"><button class="btn btn-danger dz-btn" type="button" @click="openDelete">注销账号</button></div>
    </div>

    <DeleteAccountModal
      :open="deleteOpen"
      :username="auth.user?.username ?? ''"
      :generating="sessions.isAnyGenerating"
      :submitting="deleteSubmitting"
      :error="deleteError"
      @confirm="confirmDeleteAccount"
      @cancel="cancelDelete"
    />

    <!-- REQ-018 档案添加/编辑模态（design-iter-7 §2.2：编辑时密钥不回显，留空=沿用） -->
    <div v-if="editing" class="modal-mask" @click.self="editing = false">
      <div class="modal" role="dialog" aria-label="供应商档案">
        <h3 class="modal-title">{{ isEdit ? '编辑供应商档案' : '添加供应商档案' }}</h3>
        <p class="modal-intro">按 OpenAI 兼容协议填写三项；<b>密钥仅存服务端</b>（受保护存储），浏览器本地不保留。</p>
        <label class="field">
          <span class="field-label">档案名称<span class="req">*</span></span>
          <input v-model="form.name" type="text" placeholder="如：DeepSeek / GLM / 公司中转" class="input" :class="{ invalid: errors.name }" :aria-invalid="!!errors.name" />
          <span v-if="errors.name" class="field-error">{{ errors.name }}</span>
          <span v-else class="field-hint">列表中显示，用于区分多套档案</span>
        </label>
        <label class="field">
          <span class="field-label">Base URL<span class="req">*</span></span>
          <input v-model="form.baseUrl" type="text" placeholder="https://api.deepseek.com" class="input" :class="{ invalid: errors.baseUrl }" :aria-invalid="!!errors.baseUrl" />
          <span v-if="errors.baseUrl" class="field-error">{{ errors.baseUrl }}</span>
        </label>
        <label class="field">
          <span class="field-label">模型名<span class="req">*</span></span>
          <input v-model="form.model" type="text" placeholder="deepseek-chat" class="input" :class="{ invalid: errors.model }" :aria-invalid="!!errors.model" />
          <span v-if="errors.model" class="field-error">{{ errors.model }}</span>
        </label>
        <label class="field">
          <span class="field-label">API Key<template v-if="isEdit">（已保存，不回显）</template><span class="req">*</span></span>
          <input
            v-model="form.apiKey"
            type="password"
            :placeholder="isEdit ? '留空保持不变；输入新值则覆盖' : 'sk-…'"
            class="input"
            :class="{ invalid: errors.apiKey }"
            :aria-invalid="!!errors.apiKey"
          />
          <span v-if="errors.apiKey" class="field-error">{{ errors.apiKey }}</span>
          <span v-else class="field-hint">{{ isEdit ? '出于安全，已保存的密钥不回显；留空 = 沿用原密钥' : '填写后仅上传服务端保存，界面不再回显明文' }}</span>
        </label>
        <div class="actions">
          <button type="button" class="btn" @click="editing = false">取消</button>
          <button type="button" class="btn btn-primary" @click="saveProfile">{{ isEdit ? '保存修改' : '保存档案' }}</button>
        </div>
      </div>
    </div>

    <ConfirmModal
      :open="!!pendingDelete"
      title="删除这个档案？"
      :body="`「${pendingDelete?.name ?? ''}」的配置与密钥将一并从服务端删除（不影响其它档案与历史会话）。`"
      confirm-label="删除"
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </div>
</template>

<style scoped>
.settings {
  width: 560px;
  max-width: 100%;
  margin: 32px auto;
  padding: 0 24px;
}
.settings-header h2 {
  margin: 0 0 8px;
  font-size: 20px;
  color: var(--c-text-1);
}
.hint {
  margin: 0 0 24px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--c-text-3);
  background: var(--c-primary-l);
  border-radius: 8px;
  padding: 10px 12px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 20px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 12px;
  padding: 24px;
}
.adv-intro {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--c-text-3);
}
.adv-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--c-text-3);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text-2);
}
.req {
  color: var(--c-danger);
  margin-left: 4px;
}
.input {
  height: 36px;
  border: 1px solid var(--c-border);
  border-radius: 6px;
  padding: 0 12px;
  font-size: 16px;
  color: var(--c-text-1);
  background: var(--c-surface);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.input:focus {
  border-color: var(--c-primary);
  box-shadow: 3px 3px 0 var(--c-focus-ring);
}
.input.invalid {
  border-color: var(--c-danger);
}
.field-error {
  font-size: 12px;
  color: var(--c-danger);
}
.field-hint {
  font-size: 12px;
  color: var(--c-text-3);
}
/* REQ-008 对话设置分组（design-iter-2：分组线 + 标签） */
.section-label {
  margin-top: 4px;
  padding-top: 20px;
  border-top: 1px solid var(--c-border);
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text-1);
  scroll-margin-top: 16px; /* 「前往高级设置」定位后不贴顶 */
}
.optional {
  font-size: 12px;
  font-weight: 400;
  color: var(--c-text-3);
  margin-left: 6px;
}
.prompt-ta {
  width: 100%;
  min-height: 96px;
  max-height: 240px;
  resize: vertical;
  overflow-y: auto;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 16px;
  line-height: 1.6;
  font-family: inherit;
  color: var(--c-text-1);
  background: var(--c-surface);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.prompt-ta:focus {
  border-color: var(--c-primary);
  box-shadow: 3px 3px 0 var(--c-focus-ring);
}
.prompt-ta::placeholder {
  font-size: 14px;
  color: var(--c-text-3);
}
.char-count {
  font-size: 12px;
  color: var(--c-text-3);
  text-align: right;
}
.btn-text-danger {
  height: 36px;
  padding: 0 12px;
  border: none;
  background: transparent;
  color: var(--c-danger);
  font-size: 13px;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.15s ease;
}
.btn-text-danger:hover {
  background: var(--c-danger-l);
}
.saved-flag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--c-success);
}
.actions {
  display: flex;
  gap: 8px;
}
.btn {
  height: 36px;
  padding: 0 20px;
  border-radius: 6px;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-text-1);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn:hover {
  background: var(--c-hover-bg);
}
.btn:active {
  transform: scale(0.97);
}
.btn:disabled {
  background: var(--c-disabled-bg);
  border-color: var(--c-disabled-bg);
  color: #fff;
  cursor: not-allowed;
}
.btn-primary {
  border-color: var(--c-primary);
  background: var(--c-primary-solid);
  color: #fff;
}
.btn-primary:hover {
  background: var(--c-primary-solid-h);
  border-color: var(--c-primary-h);
}

/* REQ-017 外观 segmented（design-iter-5 触点一） */
.theme-seg {
  display: inline-flex;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 8px;
}
.seg-btn {
  height: 32px;
  padding: 0 16px;
  border: none;
  background: transparent;
  color: var(--c-text-2);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.seg-btn.on {
  background: var(--c-primary-l);
  color: var(--c-primary);
  font-weight: 500;
}
/* REQ-018 档案列表（design-iter-5 §3 基线 + iter-7 掩码 meta） */
.profile-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 4px;
}
.profile-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-surface);
}
.profile-item.current {
  border-color: var(--c-primary);
  background: var(--c-primary-l);
}
.p-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.p-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.p-sub {
  font-size: 12px;
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.p-current {
  flex: none;
  font-size: 12px;
  color: var(--c-primary);
  font-weight: 500;
}
.p-btn {
  flex: none;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--c-border);
  border-radius: 6px;
  background: transparent;
  color: var(--c-text-2);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}
.p-btn:hover {
  border-color: var(--c-primary);
  color: var(--c-primary);
}
.p-icon {
  flex: none;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--c-text-3);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
}
.p-icon:hover:not(:disabled) {
  background: var(--c-hover-bg);
  color: var(--c-text-1);
}
.p-icon:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.p-empty {
  padding: 16px;
  font-size: 13px;
  color: var(--c-text-3);
  text-align: center;
  border: 1px dashed var(--c-border);
  border-radius: 8px;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: var(--c-mask);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  width: 440px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  background: var(--c-surface);
  border-radius: 12px;
  box-shadow: var(--shadow-3);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.modal-title {
  margin: 0;
  font-size: 16px;
  color: var(--c-text-1);
}
.modal-intro {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--c-text-3);
}

/* ---- REQ-021 账号管理（design-iter-9 §2~3）---- */
.pwd-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 420px;
}
.field-input-wrap {
  position: relative;
  display: block;
}
.pw-input {
  width: 100%;
  box-sizing: border-box;
  padding-right: 44px; /* 行尾眼睛按钮留白 */
}
.eye-btn {
  position: absolute;
  top: 0;
  right: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: var(--c-text-3);
  cursor: pointer;
  border-radius: 0 6px 6px 0;
}
.eye-btn:hover {
  color: var(--c-text-1);
  background: var(--c-hover-bg);
}
.pwd-submit {
  width: 100%;
}
/* 成功横幅（subtle-bg 底 + success 描边/标题，design-iter-9 §2.2） */
.ok-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.7;
  background: var(--c-subtle-bg);
  border: 1px solid var(--c-success);
  color: var(--c-text-2);
}
.ok-banner .ob-ico {
  flex: none;
  color: var(--c-success);
  font-weight: 600;
}
.ok-banner .ob-title {
  color: var(--c-success);
  font-weight: 600;
}
/* 注销危险区（danger-l 底 + danger 描边/文字 + 危险实底按钮，design-iter-9 §3.1） */
.danger-zone {
  max-width: 420px;
  border: 1px solid var(--c-danger);
  border-radius: 8px;
  background: var(--c-danger-l);
  padding: 14px 16px;
  margin-top: 20px;
}
.dz-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-danger);
  display: flex;
  align-items: center;
  gap: 6px;
}
.dz-desc {
  font-size: 12px;
  color: var(--c-danger);
  opacity: 0.92;
  line-height: 1.7;
  margin-top: 4px;
}
.dz-actions {
  margin-top: 12px;
}
.btn-danger {
  border-color: var(--c-danger-solid);
  background: var(--c-danger-solid);
  color: #fff;
  font-weight: 600;
}
.btn-danger:hover {
  background: var(--c-danger-solid-h);
  border-color: var(--c-danger-solid-h);
}
</style>
