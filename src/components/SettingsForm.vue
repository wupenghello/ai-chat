<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useSettingsStore, type ProfileInput } from '../stores/settings'
import { useToastStore } from '../stores/toast'
import { useTheme } from '../composables/useTheme'
import { useSessionsStore } from '../stores/sessions'
import ConfirmModal from './ConfirmModal.vue'
import KeyModeCard from './KeyModeCard.vue'

const settings = useSettingsStore()
const toast = useToastStore()
const sessions = useSessionsStore()

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
</style>
