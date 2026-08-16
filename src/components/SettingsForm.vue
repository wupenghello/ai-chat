<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
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

/**
 * REQ-028（design-iter-11 §4，定夺⑤ R1 拆分）：设置弹窗化——720px 模态 = 左导航 168px 五分区
 * （外观/密钥模式/高级设置/对话设置/账号，role=tablist 方向键可切）+ 右分区面板（一次只显示一个，v-show 切分区不丢表单状态）；
 * 关闭三方式（Esc/遮罩/关闭钮）+ 未保存条件拦截（定夺⑥：提示词有改动或改密字段非空才拦）；
 * 「前往高级设置」（错误气泡 locateAdv / 模式卡跨分区链接）= 分区直达 + 标题高亮。
 * 表单字段与保存逻辑沿整页版零改动（「只改容器不改逻辑」）。
 */
const props = defineProps<{ open: boolean; locateAdv?: boolean }>()
const emit = defineEmits<{ close: [] }>()

const TABS = [
  { key: 'appearance', label: '外观' },
  { key: 'mode', label: '密钥模式' },
  { key: 'adv', label: '高级设置' },
  { key: 'chat', label: '对话设置' },
  { key: 'account', label: '账号' },
] as const
type PaneKey = (typeof TABS)[number]['key']
const pane = ref<PaneKey>('appearance')
const advSection = ref<HTMLElement | null>(null) // 「前往高级设置」分区直达 + 高亮目标
const closeBtn = ref<HTMLButtonElement | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | undefined
let openerEl: HTMLElement | null = null

function flashAdv() {
  advSection.value?.classList.remove('flash')
  void nextTick(() => advSection.value?.classList.add('flash'))
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => advSection.value?.classList.remove('flash'), 1600)
}

function showPane(key: PaneKey, focusNav = false) {
  pane.value = key
  if (focusNav) {
    void nextTick(() => {
      const btn = document.querySelector(`.sm-nav [data-pane="${key}"]`) as HTMLButtonElement | null
      btn?.focus()
    })
  }
}

function onNavKey(e: KeyboardEvent, idx: number) {
  let j = -1
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') j = (idx + 1) % TABS.length
  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') j = (idx - 1 + TABS.length) % TABS.length
  else return
  e.preventDefault()
  showPane(TABS[j].key, true)
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      openerEl = (document.activeElement as HTMLElement) ?? null
      if (props.locateAdv) showPane('adv')
      void nextTick(() => closeBtn.value?.focus())
    } else {
      // 关闭后焦点回触发入口（账户「···」或错误气泡按钮，§4.2）
      openerEl?.focus?.()
      openerEl = null
    }
  },
  { immediate: true }, // App 常驻挂载组件、同帧置 open+locateAdv：挂载即开也要直达
)
// 错误气泡场景：open 与 locateAdv 同帧设置时 watch(open) 已处理；单独翻转 locateAdv 亦直达
watch(
  () => props.locateAdv,
  (v) => {
    if (v && props.open) showPane('adv')
  },
)
watch(pane, (k) => {
  if (k === 'adv' && props.locateAdv) flashAdv()
})

/** 未保存判定（定夺⑥）：显式保存字段——提示词 textarea 值 ≠ 已保存值，或改密三字段任一非空 */
function isDirty() {
  return promptText.value !== settings.systemPrompt || !!(oldPwd.value || newPwd.value || confirmPwd.value)
}

const dirtyConfirm = ref(false)

function attemptClose() {
  if (!props.open) return
  if (isDirty()) dirtyConfirm.value = true
  else close()
}
function close() {
  dirtyConfirm.value = false
  // 焦点回触发入口须在 emit（→ App v-if 卸载本组件）之前同步执行
  openerEl?.focus?.({ preventScroll: true })
  emit('close')
}

/** 弹窗层 Esc：内层模态（档案编辑/注销/删除确认/未保存确认）各自处理时让行 */
function onModalKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (editing.value || deleteOpen.value || pendingDelete.value || dirtyConfirm.value) return
  attemptClose()
}

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

/** 模式卡「在高级设置中添加自有密钥」跨分区跳转（§4.3：分区直达 + 高亮） */
function gotoAdv() {
  showPane('adv')
  flashAdv()
}

/** iter-10 T1①：boot 失败后的重试入口——boot 可重入，成功即恢复档案列表（无需刷新页面） */
const bootRetrying = ref(false)
async function retryBoot() {
  bootRetrying.value = true
  try {
    await settings.boot()
    toast.push('供应商档案已加载')
  } catch {
    toast.push('供应商档案加载失败，请检查网络')
  } finally {
    bootRetrying.value = false
  }
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
  <!-- REQ-028：设置弹窗（720px 左右分栏，z-100；挂在 .app 根下避开 .main overflow 裁剪） -->
  <div v-if="open" class="settings-mask" @click.self="attemptClose" @keydown="onModalKey">
    <div class="settings-modal" role="dialog" aria-modal="true" aria-label="设置">
      <header class="sm-head">
        <div class="sm-title">设置</div>
        <button ref="closeBtn" type="button" class="icon-btn sm-close" title="关闭设置" aria-label="关闭设置" @click="attemptClose">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
        </button>
      </header>

      <div class="sm-body">
        <nav class="sm-nav" role="tablist" aria-label="设置分区">
          <button
            v-for="(t, i) in TABS"
            :key="t.key"
            type="button"
            role="tab"
            :data-pane="t.key"
            :aria-selected="pane === t.key"
            :class="{ on: pane === t.key }"
            @click="showPane(t.key)"
            @keydown="onNavKey($event, i)"
          >
            {{ t.label }}
          </button>
        </nav>

        <!-- 分区一：外观（REQ-017 唯一入口，与全局同状态同存储） -->
        <div v-show="pane === 'appearance'" class="sm-pane" role="tabpanel">
          <div class="section-label pane-label">外观</div>
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
        </div>

        <!-- 分区二：密钥模式（REQ-014 v3 模式卡，design-iter-7 §1） -->
        <div v-show="pane === 'mode'" class="sm-pane" role="tabpanel">
          <div class="section-label pane-label">密钥模式</div>
          <p class="mode-note">对话默认使用服务端统一密钥（零配置）；可在「高级设置」添加自有供应商密钥，密钥仅存服务端。</p>
          <KeyModeCard
            :mode="settings.keyMode"
            :active-profile-name="settings.activeProfile?.name"
            :quota="quota"
            @fallback="fallback"
            @goto-adv="gotoAdv"
          />
        </div>

        <!-- 分区三：高级设置 · 自填供应商密钥（REQ-018，design-iter-7 §2；locateAdvanced 直达目标） -->
        <div v-show="pane === 'adv'" class="sm-pane" role="tabpanel">
          <div ref="advSection" class="section-label pane-label">高级设置 · 自填供应商密钥</div>
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
        <!-- iter-10 T1①：boot 失败 → 档案区「重试」（boot 可重入），优先于空列表占位 -->
        <div v-if="settings.bootFailed" class="p-empty">
          档案加载失败，请检查网络
          <button type="button" class="p-btn retry-btn" :disabled="bootRetrying" @click="retryBoot">
            {{ bootRetrying ? '重试中…' : '重试' }}
          </button>
        </div>
        <div v-else-if="settings.profiles.length === 0" class="p-empty">暂无档案，点击下方「添加供应商档案」创建第一套自有配置</div>
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
          </div>
        </div>

        <!-- 分区四：对话设置 · 系统提示词（REQ-008，design-iter-2 触点一） -->
        <div v-show="pane === 'chat'" class="sm-pane" role="tabpanel">
          <div class="section-label pane-label">对话设置</div>
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

        <!-- 分区五：账号（REQ-021，design-iter-9 §2~3）：改密 + 注销危险区 -->
        <div v-show="pane === 'account'" class="sm-pane" role="tabpanel">
          <div class="section-label pane-label">账号</div>

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
      </div>
      </div>

      <!-- 内层模态（§4.4 层叠：注销/档案编辑 z-110、未保存确认 z-120） -->
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

    <!-- 定夺⑥：未保存条件拦截确认（最上层 z-120） -->
    <div v-if="dirtyConfirm" class="modal-mask dirty-mask" @click.self="dirtyConfirm = false">
      <div class="modal" role="alertdialog" aria-label="未保存的修改确认">
        <h3 class="modal-title">有未保存的修改</h3>
        <p class="modal-intro">关闭后将丢失未保存的修改（系统提示词 / 密码输入）。确定要关闭设置吗？</p>
        <div class="actions">
          <button type="button" class="btn" @click="dirtyConfirm = false">取消</button>
          <button type="button" class="btn btn-danger" @click="close">直接关闭</button>
        </div>
      </div>
    </div>
    </div>
  </div>
</template>

<style scoped>
/* ---- REQ-028 设置弹窗（design-iter-11 §4.2：720px × ≤80vh 左右分栏，z-100）---- */
.settings-mask {
  position: fixed;
  inset: 0;
  background: var(--c-mask);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  animation: smask-in 0.15s ease;
}
@keyframes smask-in {
  from {
    opacity: 0;
  }
}
.settings-modal {
  position: relative;
  width: 720px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 12px;
  box-shadow: var(--shadow-3);
  overflow: hidden;
  animation: smodal-in 0.15s ease;
}
@keyframes smodal-in {
  from {
    opacity: 0;
    transform: scale(0.98);
  }
}
.sm-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px 14px 24px;
  border-bottom: 1px solid var(--c-border);
}
.sm-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--c-text-1);
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--c-text-3);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.icon-btn:hover {
  background: var(--c-hover-bg);
  color: var(--c-text-1);
}
.icon-btn:focus-visible {
  box-shadow: 0 0 0 3px var(--c-focus-ring);
  outline: none;
}
.sm-close {
  margin-left: auto;
}
/* 左导航 168px（定夺⑤ R1 拆分）：subtle 底 + 右缘分隔；选中 primary-l 主色 */
.sm-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.sm-nav {
  flex: none;
  width: 168px;
  border-right: 1px solid var(--c-border);
  background: var(--c-subtle-bg);
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}
.sm-nav button {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 12px;
  border: none;
  border-radius: 8px;
  background: none;
  font-size: 13px;
  font-family: inherit;
  color: var(--c-text-2);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease, color 0.15s ease;
}
.sm-nav button:hover {
  background: var(--c-hover-bg);
  color: var(--c-text-1);
}
.sm-nav button:focus-visible {
  box-shadow: 0 0 0 3px var(--c-focus-ring);
  outline: none;
}
.sm-nav button.on {
  background: var(--c-primary-l);
  color: var(--c-primary);
  font-weight: 500;
}
/* 分区面板：一次只显示一个（v-show），各自独立滚动 */
.sm-pane {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 16px 24px 24px;
  scrollbar-width: thin;
  scrollbar-color: var(--c-scrollbar) transparent;
}
.pane-label {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}
.mode-note {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--c-text-3);
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
/* REQ-008 对话设置分组（design-iter-2：分组线 + 标签）；「前往高级设置」分区直达高亮（§4.3） */
.section-label {
  margin-top: 4px;
  padding-top: 20px;
  border-top: 1px solid var(--c-border);
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text-1);
}
.section-label.flash {
  background: var(--c-primary-l);
  border-radius: 6px;
  transition: background 1.2s ease;
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
/* iter-10 T1①：boot 失败重试按钮（居中独占一行） */
.p-empty .retry-btn {
  display: flex;
  margin: 8px auto 0;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: var(--c-mask);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 110; /* §4.4：内层模态高于设置弹窗（100） */
}
/* 定夺⑥ 未保存确认：最上层（< ConfirmModal/DeleteAccount 150 < toast 200） */
.dirty-mask {
  z-index: 120;
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
