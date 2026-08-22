<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionsStore, type Session } from '../stores/sessions'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'
import { ApiBackendError, backend } from '../api/backend'
import { matchSession, type SearchHit } from '../utils/search'
import { TIME_GROUPS, timeGroupOf, type TimeGroupKey } from '../utils/timeGroup'
import { useMediaQuery } from '../composables/useMediaQuery'
import BrandMark from './BrandMark.vue'
import SessionListItem from './SessionListItem.vue'
import ConfirmModal from './ConfirmModal.vue'
import DropdownMenu, { type DropMenuItem } from './DropdownMenu.vue'

/**
 * REQ-026（design-iter-11 §1 基线）：侧栏重构——单行列表 + 时间分组（今天/昨天/近 7 天/更早）+
 * 底部账户区（首字头像 + 用户名 +「···」菜单：设置/管理后台/登出）+ 收起 rail（56px，localStorage 持久化）。
 * 移除：常驻设置按钮、密钥模式标签、盾牌 icon、登出 icon、逐条时间戳（design-iter-11 §1.4 走查 14）。
 * CHG-010/REQ-040（iter-16 T3，design-iter-16 §2/§3/§5.1）：手动压缩入口——列表项「···」菜单
 * 加法项触发 POST /api/chat/compact；执行中 pill 会话级标识 + 菜单项禁用防重复；四终态 toast
 * 文案逐字对照登记表 C5~C8；前端零预判本地 generating（409 服务端唯一判定，定夺④）；
 * 切换会话不 abort 在途请求（会话级轻操作，data 面 client.ts/sessions.ts 零改动）。
 */
const sessions = useSessionsStore()
const auth = useAuthStore()
const toast = useToastStore()
const router = useRouter()
const emit = defineEmits<{ openSettings: []; chat: []; logout: []; export: [session: Session] }>()

/* iter-20 T2（REQ-049，design-iter-20 §2.3）：≤768px 抽屉化——
 * isMobile = CSS 同源媒体特性（max-width:768px）的 JS 消费面（仅模板级 rail 抑制）；
 * drawerOpen 由 App 持有（瞬态 ref 零持久化），本组件只挂 class 承载平移动画。
 * ≤768px 零 rail 口径：collapsed（桌面 localStorage 收起态）在移动断点被抑制不渲染——
 * collapsed 键本身零读写变化，桌面 rail 态零污染（REQ-049 验收 6）。 */
defineProps<{ drawerOpen?: boolean }>()
const isMobile = useMediaQuery('(max-width: 768px)')
const showRail = computed(() => collapsed.value && !isMobile.value)

const pendingDelete = ref<Session | null>(null)

/* ---- REQ-040 手动压缩：会话级执行中态 + 四终态 toast（§5.1 前端消费规则逐字） ---- */
const compactingIds = ref<Record<string, boolean>>({})

async function compactSession(session: Session) {
  if (compactingIds.value[session.id]) return // 防重复点击（菜单项禁用之外的兜底守卫）
  compactingIds.value = { ...compactingIds.value, [session.id]: true }
  try {
    const res = await backend.compactSession(session.id)
    if (res.status === 'skipped') {
      toast.push('当前会话无需压缩：历史还短') // C6
    } else {
      // C5 success 变体（绿字，✓ 前缀调用方拼入——沿 SettingsForm 先例）；不带 token 数字（定夺③）
      toast.push('✓ 上下文压缩完成：中段历史已摘要，聊天记录不受影响', undefined, undefined, 'success')
    }
  } catch (e) {
    if (e instanceof ApiBackendError && e.status === 409) {
      toast.push(e.message) // C8 = 服务端 message 逐字（前端直接呈现，两路径同文）
    } else {
      toast.push('压缩失败，请稍后再试') // C7 固定文案兜底（404/422/5xx/网络共用一句）
    }
  } finally {
    const next = { ...compactingIds.value }
    delete next[session.id]
    compactingIds.value = next
  }
}

/* ---- 收起/展开（REQ-026.4，走查 16~18）：rail 56px，状态 localStorage 持久化 ---- */
const COLLAPSED_KEY = 'mm-sidebar-collapsed'
const collapsed = ref(typeof localStorage !== 'undefined' && localStorage.getItem(COLLAPSED_KEY) === '1')
watch(collapsed, (v) => {
  if (v) localStorage.setItem(COLLAPSED_KEY, '1')
  else localStorage.removeItem(COLLAPSED_KEY)
})

const searchInputEl = ref<HTMLInputElement | null>(null)

function expandAndFocusSearch() {
  collapsed.value = false
  void nextTick(() => searchInputEl.value?.focus())
}

function onNew() {
  searchText.value = '' // 走查 2：点击新建会话并清空搜索
  sessions.createSession() // 生成中新建 = 中断并标注（store 内处理）
  emit('chat')
}

/* ---- REQ-026.2 时间分组（§1.3）：组内 updatedAt 倒序；空组不渲染 ---- */
const grouped = computed(() => {
  const by: Record<TimeGroupKey, Session[]> = { today: [], yesterday: [], week: [], earlier: [] }
  for (const s of sessions.sessions) by[timeGroupOf(s.updatedAt)].push(s)
  for (const g of TIME_GROUPS) by[g.key].sort((a, b) => b.updatedAt - a.updatedAt)
  return by
})

/* ---- REQ-016 会话搜索：标题命中优先；空关键词恢复完整分组列表 ---- */
const searchText = ref('')
const query = computed(() => searchText.value.trim().toLowerCase())

const filtered = computed<Array<{ session: Session; hit: SearchHit | null }>>(() => {
  if (!query.value) return sessions.sessions.map((s) => ({ session: s, hit: null }))
  return sessions.sessions
    .map((s) => ({ session: s, hit: matchSession(s, query.value) }))
    .filter((x): x is { session: Session; hit: SearchHit } => x.hit !== null)
    .sort((a, b) => {
      if (a.hit.type === 'title' && b.hit.type === 'body') return -1
      if (a.hit.type === 'body' && b.hit.type === 'title') return 1
      return b.session.updatedAt - a.session.updatedAt
    })
})

/* ---- 账户区「···」菜单（§1.4 走查 15）：设置 / 管理后台（仅管理员渲染）/ 登出 ---- */
const accountItems = computed<DropMenuItem[]>(() => {
  const items: DropMenuItem[] = [{ key: 'settings', label: '设置' }]
  if (auth.user?.is_admin) items.push({ key: 'admin', label: '管理后台' })
  items.push({ key: 'logout', label: '登出', separator: true }) // 可逆操作，非 danger（§1.4）
  return items
})

function onAccountSelect(key: string) {
  if (key === 'settings') emit('openSettings')
  else if (key === 'admin') router.push('/admin')
  else if (key === 'logout') emit('logout')
}

const avatarChar = computed(() => (auth.user?.username ?? '未').charAt(0))
</script>

<template>
  <aside class="sidebar" :class="{ rail: showRail, 'drawer-open': drawerOpen }">
    <template v-if="!showRail">
      <div class="brand-row">
        <BrandMark :size="24" with-text />
        <button
          class="icon-btn"
          type="button"
          title="收起侧栏"
          aria-label="收起侧栏"
          @click="collapsed = true"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6" />
            <line x1="9" y1="4" x2="9" y2="20" stroke="currentColor" stroke-width="1.6" />
            <path d="M12.5 10.5l3 1.5-3 1.5z" fill="currentColor" />
          </svg>
        </button>
      </div>

      <button class="new-btn" @click="onNew">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
        </svg>
        新建会话
      </button>

      <div class="search-box">
        <svg class="search-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            fill="currentColor"
            d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14Z"
          />
        </svg>
        <input
          ref="searchInputEl"
          v-model="searchText"
          class="search-input"
          type="text"
          placeholder="搜索会话"
          spellcheck="false"
          autocomplete="off"
          aria-label="搜索会话"
        />
        <button v-if="searchText" class="search-clear" aria-label="清除搜索" @click="searchText = ''">
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <path
              fill="currentColor"
              d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.7 2.89 18.29 9.17 12 2.89 5.71 4.3 4.29l6.29 6.3 6.3-6.3 1.41 1.42Z"
            />
          </svg>
        </button>
      </div>

      <ul class="session-list">
        <template v-if="!query">
          <template v-for="g in TIME_GROUPS" :key="g.key">
            <template v-if="grouped[g.key].length">
              <li class="group-label" aria-hidden="true">{{ g.label }}</li>
              <SessionListItem
                v-for="session in grouped[g.key]"
                :key="session.id"
                :session="session"
                :active="session.id === sessions.activeId"
                :compacting="!!compactingIds[session.id]"
                @select="sessions.switchTo(session.id); emit('chat')"
                @remove="pendingDelete = session"
                @rename="(title) => sessions.renameSession(session.id, title)"
                @export="emit('export', session)"
                @compact="compactSession(session)"
              />
            </template>
          </template>
        </template>
        <template v-else>
          <SessionListItem
            v-for="{ session, hit } in filtered"
            :key="session.id"
            :session="session"
            :active="session.id === sessions.activeId"
            :search="query"
            :hit="hit"
            :compacting="!!compactingIds[session.id]"
            @select="sessions.switchTo(session.id); emit('chat')"
            @remove="pendingDelete = session"
            @rename="(title) => sessions.renameSession(session.id, title)"
            @export="emit('export', session)"
            @compact="compactSession(session)"
          />
          <li v-if="filtered.length === 0" class="no-result">无匹配会话</li>
        </template>
      </ul>

      <!-- REQ-026.3 账户区（§1.4 走查 14）：首字头像 + 用户名 +「···」菜单 -->
      <div class="acct">
        <DropdownMenu
          :items="accountItems"
          trigger-class="acct-trigger"
          trigger-aria="账户操作"
          @select="onAccountSelect"
        >
          <template #trigger>
            <span class="avatar" aria-hidden="true">{{ avatarChar }}</span>
            <span class="acct-name" :title="auth.user?.username">{{ auth.user?.username ?? '未登录' }}</span>
            <svg viewBox="0 0 14 14" width="16" height="16" aria-hidden="true">
              <circle cx="3" cy="7" r="1.5" fill="currentColor" />
              <circle cx="7" cy="7" r="1.5" fill="currentColor" />
              <circle cx="11" cy="7" r="1.5" fill="currentColor" />
            </svg>
          </template>
        </DropdownMenu>
      </div>
    </template>

    <!-- REQ-026.4 rail（§1.5 走查 16/17）：56px 窄条——展开/新建/搜索 + 底部头像 -->
    <template v-else>
      <button class="rail-btn" type="button" title="展开侧栏" aria-label="展开侧栏" @click="collapsed = false">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6" />
          <line x1="9" y1="4" x2="9" y2="20" stroke="currentColor" stroke-width="1.6" />
          <path d="M6.5 10.5l-3 1.5 3 1.5z" fill="currentColor" />
        </svg>
      </button>
      <button class="rail-btn" type="button" title="新建会话" aria-label="新建会话" @click="onNew">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
        </svg>
      </button>
      <button class="rail-btn" type="button" title="搜索会话（展开侧栏）" aria-label="搜索会话（展开侧栏）" @click="expandAndFocusSearch">
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <path
            fill="currentColor"
            d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14Z"
          />
        </svg>
      </button>
      <div class="rail-sp" />
      <button class="rail-avatar" type="button" title="展开侧栏" aria-label="展开侧栏" @click="collapsed = false">
        {{ avatarChar }}
      </button>
    </template>

    <ConfirmModal
      :open="!!pendingDelete"
      title="删除这个会话？"
      :body="`「${pendingDelete?.title ?? ''}」的全部消息将一并删除，无法恢复。`"
      confirm-label="删除"
      @confirm="pendingDelete && sessions.removeSession(pendingDelete.id); pendingDelete = null"
      @cancel="pendingDelete = null"
    />
  </aside>
</template>

<style scoped>
.sidebar {
  width: 264px;
  flex: none;
  height: 100%;
  display: flex;
  flex-direction: column;
  /* REQ-021 基调反转（CEO 2026-08-16）：侧栏灰底 --c-bg（参考 DeepSeek 管理页） */
  background: var(--c-bg);
  border-right: 1px solid var(--c-border);
  padding: 16px 12px;
  gap: 12px;
}
/* REQ-026.4 rail（§1.5 走查 16）：56px 窄条 */
.sidebar.rail {
  width: 56px;
  padding: 12px 10px;
  gap: 8px;
  align-items: stretch;
}
.brand-row {
  height: 28px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 2px;
}
.brand-row .icon-btn {
  margin-left: auto;
}
.icon-btn {
  flex: none;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
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
.new-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: var(--c-primary-solid);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.new-btn:hover {
  background: var(--c-primary-solid-h);
}
.new-btn:active {
  transform: scale(0.98);
}
/* REQ-016 搜索框（沿现状，走查 3） */
.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 8px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.search-box:focus-within {
  border-color: var(--c-primary);
  box-shadow: 0 0 0 3px var(--c-focus-ring);
}
.search-icon {
  flex: none;
  color: var(--c-text-3);
}
.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  color: var(--c-text-1);
  font-family: inherit;
}
.search-input::placeholder {
  color: var(--c-text-3);
}
.search-clear {
  flex: none;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--c-text-3);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
}
.search-clear:hover {
  background: var(--c-avatar-bg);
  color: var(--c-text-1);
}
.no-result {
  list-style: none;
  padding: 16px 12px;
  font-size: 12px;
  color: var(--c-text-3);
  text-align: center;
}
.session-list {
  flex: 1;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
/* REQ-026.2 组头（走查 11）：12px text-3 */
.group-label {
  list-style: none;
  flex: none;
  font-size: 12px;
  color: var(--c-text-3);
  padding: 12px 10px 4px;
}
.session-list .group-label:first-child {
  padding-top: 4px;
}
/* REQ-026.3 账户区（§1.4 走查 14）。R2 修复：DropdownMenu 包裹 span（.dd）须 flex:1 拉满——
   否则 span 按内容收缩、width:100% 的触发钮失效，头像+用户名+「···」全挤左侧（CEO 走查反馈） */
.acct :deep(.dd) {
  flex: 1;
  min-width: 0;
  display: flex;
}
.acct {
  flex: none;
  border-top: 1px solid var(--c-border);
  padding-top: 10px;
  min-height: 44px;
  display: flex;
  align-items: center;
}
.acct :deep(.acct-trigger) {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 6px 8px;
  border-radius: 8px;
  color: var(--c-text-2);
  transition: background 0.15s ease, color 0.15s ease;
}
.acct :deep(.acct-trigger:hover),
.acct :deep(.acct-trigger:focus-visible),
.acct :deep(.acct-trigger[aria-expanded='true']) {
  background: var(--c-hover-bg);
  color: var(--c-text-1);
}
.acct :deep(.acct-trigger > svg) {
  margin-left: auto;
  flex: none;
  color: var(--c-text-3);
}
.avatar {
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: var(--c-avatar-bg);
  color: var(--c-text-2);
  font-size: 12px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
}
.acct-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text-2);
}
/* rail 图标钮（走查 16）：36px r-md hover-bg */
.rail-btn {
  flex: none;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: none;
  color: var(--c-text-3);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.rail-btn:hover {
  background: var(--c-hover-bg);
  color: var(--c-text-1);
}
.rail-sp {
  flex: 1;
}
.rail-avatar {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: none;
  background: var(--c-avatar-bg);
  color: var(--c-text-2);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.rail-avatar:hover {
  background: var(--c-hover-bg);
}

/* ---- iter-20 T2（REQ-049，design-iter-20 §2.3）：≤768px 抽屉态 ----
 * fixed overlay 原样平移（264px，<330px 视口取 min(80vw, 264px)），非挤压正文；
 * translateX + visibility .15s ease（tokens 唯一动效值）；rail 收起钮在断点内隐藏
 * （移动端 collapsed 被 showRail 抑制，收起钮不可达 = 不污染 mm-sidebar-collapsed）；
 * >768px 本块零生效，桌面 264px/rail 56px 逐像素零变化（媒体查询带界）。 */
@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 40;
    width: min(80vw, 264px);
    transform: translateX(-100%);
    visibility: hidden;
    transition:
      transform 0.15s ease,
      visibility 0.15s ease;
  }
  .sidebar.drawer-open {
    transform: translateX(0);
    visibility: visible;
  }
  .brand-row .icon-btn {
    display: none;
  }
}
</style>
