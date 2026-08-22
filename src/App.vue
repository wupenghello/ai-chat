<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useSessionsStore } from './stores/sessions'
import { useSettingsStore } from './stores/settings'
import { useToastStore } from './stores/toast'
import { useAuthStore } from './stores/auth'
import { useQuotaStore } from './stores/quota'
import { exportSession } from './utils/export'
import TheSidebar from './components/TheSidebar.vue'
import MessageList from './components/MessageList.vue'
import ComposerBox from './components/ComposerBox.vue'
import EmptyState from './components/EmptyState.vue'
import SettingsForm from './components/SettingsForm.vue'
import AppToast from './components/AppToast.vue'
import MigrationBanners from './components/MigrationBanners.vue'
import { useMigrationStore } from './stores/migration'
import type { Session } from './stores/sessions'

const sessions = useSessionsStore()
const settings = useSettingsStore()
const toast = useToastStore()
const auth = useAuthStore()
const migration = useMigrationStore()
const quota = useQuotaStore()

const settingsOpen = ref(false)
const locateAdv = ref(false)

/* ---- iter-20 T2（REQ-049，design-iter-20 §2）：≤768px 侧栏抽屉化 ----
 * 开合态 = 组件本地 ref，瞬态不持久化（零 localStorage 读写，验收 6）；
 * 视觉形态切换全在 CSS 带界媒体查询（≤768px），桌面（>768px）该状态 CSS 惰性、零影响；
 * 关闭三径（遮罩/Esc/选中会话）同一 closeDrawer 函数，零分叉。 */
const drawerOpen = ref(false)
function openDrawer() {
  drawerOpen.value = true
}
function closeDrawer() {
  drawerOpen.value = false
}
function onDrawerKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeDrawer()
}
watch(drawerOpen, (open) => {
  if (open) window.addEventListener('keydown', onDrawerKeydown)
  else window.removeEventListener('keydown', onDrawerKeydown)
})
onUnmounted(() => window.removeEventListener('keydown', onDrawerKeydown))

/** REQ-020 登出（design-iter-6 §4.2）：直接登出无确认；跳转由 Root 的登录态监听完成 */
async function logout() {
  await auth.logout()
}

onMounted(() => {
  void sessions.init().catch(() => {
    // 服务端会话加载失败（网络/后端不可用）：降级为空会话继续可用，已加载页内更改将无法保存
    toast.push('会话加载失败，请检查网络')
  })
  // REQ-018（iter-7 T2）：档案迁服务端，登录后拉取（失败降级为空列表，设置页可重试保存）
  void settings.boot().catch(() => {
    toast.push('供应商档案加载失败，请检查网络')
  })
  // iter-8 T3（REQ-022/018）：存量本地数据上云检测（登录后；无旧数据零打扰）
  void migration.detect()
  // CHG-012/REQ-047（design-iter-18 §6.2）：登录后拉取 quota → 定深度研究开关可用性
  // （refresh 内 catch 失败降级为「不确定即禁用」，无需此处再兜）
  void quota.refresh()
})

function openSettings(locateAdvanced = false) {
  locateAdv.value = locateAdvanced
  settingsOpen.value = true
}

/** REQ-047（design-iter-18 §6.2）：设置弹窗关闭后重取 quota（档案「支持工具」/密钥模式切换可能改变三与门第一项） */
function onSettingsClose() {
  settingsOpen.value = false
  void quota.refresh()
}

async function send(text: string, mode?: 'research') {
  // v3 双模式（design-iter-7 §3.1）：「未配置密钥即发送」分支消亡——
  // 无档案 = 统一 key 模式零配置可用（REQ-023），自填必填校验在档案保存时拦截
  // CHG-012/REQ-047：mode 加法透传（'research' = 深度研究回合；缺省 undefined = 普通回合）
  await sessions.send(text, mode)
}

/** REQ-013（走查 36，design-iter-11 §3.4）：导出入口迁至列表项「···」菜单，按会话导出；空会话 toast */
function exportBySession(session: Session) {
  if (session.messages.length === 0) {
    toast.push('当前会话暂无消息，未生成文件')
    return
  }
  exportSession(session, settings.config.model)
}

/** REQ-015：编辑历史消息并重新生成其后内容 */
function editMessage(id: string, text: string) {
  void sessions.editAndRegenerate(id, text)
}
</script>

<template>
  <div class="app" :class="{ 'drawer-open': drawerOpen }">
    <TheSidebar
      :drawer-open="drawerOpen"
      @open-settings="openSettings"
      @logout="logout"
      @export="exportBySession"
      @chat="closeDrawer"
    />

    <!-- ≤768px 抽屉遮罩（REQ-049，design-iter-20 §2.3）：--c-mask 既有令牌，常驻 DOM 承载 .15s fade，
         仅媒体查询内可见可点（关闭态 opacity:0 + pointer-events:none）；>768px display:none -->
    <div class="drawer-mask" aria-hidden="true" @click="closeDrawer"></div>

    <main class="main">
      <!-- iter-20 T2（REQ-049，design-iter-20 §2.2）：≤768px 移动顶条——44×44 汉堡入口钮（M44）+ 当前会话名；
           >768px 整条 display:none 不渲染视觉面（CSS 带界，桌面零触碰） -->
      <div class="mobile-topbar">
        <button
          class="drawer-btn"
          type="button"
          aria-label="打开会话列表"
          title="打开会话列表"
          :aria-expanded="drawerOpen"
          @click="drawerOpen ? closeDrawer() : openDrawer()"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <line x1="4" y1="6" x2="20" y2="6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            <line x1="4" y1="18" x2="20" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </button>
        <span class="topbar-title">{{ sessions.active?.title ?? '' }}</span>
      </div>
      <!-- iter-8 T3（design-iter-8 §2.1/定夺 ②）：主界面顶部全局提示条区（无旧数据零渲染） -->
      <MigrationBanners />
      <!-- REQ-027 走查 34/35（design-iter-11 §3.4 定夺⑦）：顶栏整体移除——
           无标题栏/无模型副标题（去误导）/无主题钮（REQ-017 收敛至设置外观区）/无导出钮（迁列表菜单） -->
      <div class="chat">
        <EmptyState
          v-if="!sessions.active || sessions.active.messages.length === 0"
          :variant="sessions.sessions.length === 0 ? 'no-session' : 'empty-session'"
          @suggest="send"
        />
        <MessageList
          v-else
          :messages="sessions.active.messages"
          @retry="(id) => sessions.retry(id)"
          @go-settings="openSettings(true)"
          @edit="editMessage"
          @toggle-version="(forkId) => sessions.toggleVersion(forkId)"
        />
        <div class="composer-row">
          <div class="composer-col">
            <ComposerBox
              :generating="sessions.isGenerating(sessions.activeId)"
              :research-available="quota.researchAvailable"
              @send="send"
              @stop="sessions.stopGeneration()"
            />
          </div>
        </div>
      </div>
    </main>

    <!-- REQ-028：设置弹窗（叠加于聊天现场之上，关闭即回对话现场）。
         v-if 卸载重建：每次打开都是干净表单态——「直接关闭将丢弃」的承诺由卸载兑现（常驻挂载会残留草稿） -->
    <SettingsForm v-if="settingsOpen" :open="settingsOpen" :locate-adv="locateAdv" @close="onSettingsClose" />

    <AppToast @navigate="(to) => to === 'settings' && openSettings()" />
  </div>
</template>

<style>
/* 设计令牌（design-system tokens v1.3）：组件一律引用语义令牌，禁止裸色值；
   主题切换只覆盖根变量（REQ-017）；--c-error→--c-danger 统一命名（iter-4 复盘遗留） */
:root {
  --c-primary: #3370ff;
  --c-primary-h: #2e5fdf;
  --c-primary-a: #2860d8;
  --c-primary-l: #f0f4ff;
  --c-primary-solid: #3370ff;
  --c-primary-solid-h: #2e5fdf;
  --c-primary-solid-a: #2860d8;
  --c-bg: #f5f6f7;
  --c-surface: #ffffff;
  --c-border: #e5e6eb;
  --c-text-1: #1f2329;
  --c-text-2: #646a73;
  --c-text-3: #8f959e;
  --c-hover-bg: #f2f3f5;
  --c-disabled-bg: #c9cfdb;
  --c-subtle-bg: #fafbfc;
  --c-avatar-bg: #e8ebf2;
  --c-scrollbar: #d5d9e0;
  --c-toast-bg: #23272e;
  --c-toast-border: #23272e;
  --c-primary-on-dark: #a3bcff;
  --c-mask: rgba(31, 35, 41, 0.4);
  --c-focus-ring: rgba(51, 112, 255, 0.12);
  --c-danger: #d93025;
  --c-danger-l: #fdecea;
  --c-danger-solid: #d93025;
  --c-danger-solid-h: #b7251c;
  --c-warning: #b45309;
  --c-warning-l: #fff7e8;
  --c-success: #1a9e5c;
  --c-success-on-dark: #4cc38a;
  --c-code-head: #23272e;
  --c-code-bg: #2b303a;
  --c-code-head-text: #9aa4b2;
  --c-code-text: #e6eaf0;
  --shadow-1: 0 1px 2px rgba(31, 35, 41, 0.06);
  --shadow-2: 0 4px 16px rgba(31, 35, 41, 0.1);
  --shadow-3: 0 12px 40px rgba(31, 35, 41, 0.16);
}
[data-theme='dark'] {
  --c-primary: #5c8dff;
  --c-primary-h: #7aa4ff;
  --c-primary-a: #4c84ff;
  --c-primary-l: #1d2740;
  --c-primary-solid: #3370ff;
  --c-primary-solid-h: #4c84ff;
  --c-primary-solid-a: #3d78ff;
  --c-bg: #131417;
  --c-surface: #1e2026;
  --c-border: #33363e;
  --c-text-1: #e6eaf0;
  --c-text-2: #a2a9b6;
  --c-text-3: #808896;
  --c-hover-bg: #262930;
  --c-disabled-bg: #3d414a;
  --c-subtle-bg: #24272e;
  --c-avatar-bg: #33363e;
  --c-scrollbar: #3a3e46;
  --c-toast-bg: #2a2d34;
  --c-toast-border: #33363e;
  --c-mask: rgba(0, 0, 0, 0.55);
  --c-focus-ring: rgba(92, 141, 255, 0.25);
  --c-danger: #ff8073;
  --c-danger-l: #361b18;
  --c-danger-solid: #d93025;
  --c-danger-solid-h: #b7251c;
  --c-warning: #eda23b;
  --c-warning-l: #38290f;
  --c-success: #4cc38a;
  --c-success-on-dark: #4cc38a;
  --c-code-head: #141518;
  --c-code-bg: #191b20;
  --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.4);
  --shadow-2: 0 4px 16px rgba(0, 0, 0, 0.45);
  --shadow-3: 0 12px 40px rgba(0, 0, 0, 0.6);
}

* {
  box-sizing: border-box;
}
/* 2026-08-23 CEO 走查：按住拖动整页可上下左右晃动（Safari/PWA 橡皮筋 + 滚动链）——
   应用壳（.app 100% 高 + 内部各自滚动区）自管全部滚动，html/body 固定不滚不弹 */
html,
body {
  height: 100%;
  overflow: hidden;
  overscroll-behavior: none;
}
#app {
  height: 100%;
}
body {
  margin: 0;
  background: var(--c-bg);
  color: var(--c-text-1);
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
}

.app {
  height: 100%;
  display: flex;
}
.main {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain; /* 滚到头不外溢成整页拖拽 */
  /* REQ-021 基调反转（CEO 2026-08-16）：正文白底 --c-surface（侧栏灰底见 TheSidebar） */
  background: var(--c-surface);
}
.chat {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.composer-row {
  flex: none;
  width: 100%;
  padding: 16px 24px 20px;
}
.composer-col {
  max-width: 712px;
  margin: 0 auto;
}

/* ---- iter-20 T2（REQ-049，design-iter-20 §2.2/§2.3/§3）：移动端顶条 + 抽屉遮罩 + ≤480px 收窄 ----
 * 全部收敛在带界媒体查询内（max-width），缺省（>768px）零渲染零影响——桌面规则面零触碰；
 * 零新增设计令牌（复用 --c-surface/--c-border/--c-text/--c-hover-bg/--c-mask 既有值）。 */
.mobile-topbar,
.drawer-mask {
  display: none;
}
@media (max-width: 768px) {
  .mobile-topbar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    height: 48px;
    padding: 0 12px 0 4px;
    background: var(--c-surface);
    border-bottom: 1px solid var(--c-border);
  }
  /* M44 入口钮：44×44 视觉即热区（REQ-049 描述「触发钮 ≥44px」） */
  .drawer-btn {
    flex: none;
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--c-text-2);
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .drawer-btn:hover {
    background: var(--c-hover-bg);
  }
  .drawer-btn:focus-visible {
    box-shadow: 0 0 0 3px var(--c-focus-ring);
  }
  .topbar-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 500;
    color: var(--c-text-1);
  }
  /* 遮罩：--c-mask 既有令牌（浅/暗双主题），z-index 低于侧栏抽屉（TheSidebar 内 40） */
  .drawer-mask {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 39;
    background: var(--c-mask);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
  }
  .app.drawer-open .drawer-mask {
    opacity: 1;
    pointer-events: auto;
  }
}
/* ≤480px 正文收窄（design-iter-20 §3）：composer-row 左右 padding 12px（REQ-049 验收 5 上限） */
@media (max-width: 480px) {
  .composer-row {
    padding: 12px;
  }
}
</style>
