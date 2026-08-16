<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useSessionsStore } from './stores/sessions'
import { useSettingsStore } from './stores/settings'
import { useToastStore } from './stores/toast'
import { useAuthStore } from './stores/auth'
import { exportSession } from './utils/export'
import { useTheme } from './composables/useTheme'
import TheSidebar from './components/TheSidebar.vue'
import MessageList from './components/MessageList.vue'
import ComposerBox from './components/ComposerBox.vue'
import EmptyState from './components/EmptyState.vue'
import SettingsForm from './components/SettingsForm.vue'
import AppToast from './components/AppToast.vue'
import MigrationBanners from './components/MigrationBanners.vue'
import { useMigrationStore } from './stores/migration'

const sessions = useSessionsStore()

// REQ-017：顶栏主题切换入口（与设置页「外观」同状态同存储）
const { theme, toggleTheme } = useTheme()
const settings = useSettingsStore()
const toast = useToastStore()
const auth = useAuthStore()
const migration = useMigrationStore()

const view = ref<'chat' | 'settings'>('chat')

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
})

const locateAdv = ref(false) // 错误气泡「前往高级设置」入口：打开设置页并定位高级设置区（走查 15）

function openSettings(locateAdvanced = false) {
  locateAdv.value = locateAdvanced
  view.value = 'settings'
}

async function send(text: string) {
  // v3 双模式（design-iter-7 §3.1）：「未配置密钥即发送」分支消亡——
  // 无档案 = 统一 key 模式零配置可用（REQ-023），自填必填校验在档案保存时拦截
  await sessions.send(text)
}

/** REQ-013：导出当前会话为 Markdown 文件；空会话不生成，toast 提示 */
function exportCurrent() {
  const session = sessions.active
  if (!session) return
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
  <div class="app">
    <TheSidebar @open-settings="openSettings" @chat="view = 'chat'" @logout="logout" />

    <main class="main">
      <!-- iter-8 T3（design-iter-8 §2.1/定夺 ②）：主界面顶部全局提示条区（无旧数据零渲染） -->
      <MigrationBanners />
      <SettingsForm v-if="view === 'settings'" :locate-adv="locateAdv" />

      <template v-else>
        <div class="chat">
          <header v-if="sessions.active" class="chat-header">
            <div class="chat-title">
              <span class="title-text">{{ sessions.active.title }}</span>
              <span class="title-sub">模型：{{ settings.config.model ?? '未设置' }}</span>
            </div>
            <!-- REQ-017：主题切换（icon-only ghost，月亮=当前浅色可切深色） -->
            <button
              class="theme-btn"
              :title="theme === 'dark' ? '切换到浅色' : '切换到深色'"
              :aria-label="theme === 'dark' ? '切换到浅色' : '切换到深色'"
              @click="toggleTheme"
            >
              <svg v-if="theme === 'light'" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path fill="currentColor" d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.11-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.14-9.8c-.44-.07-.9-.1-1.35-.1z" />
              </svg>
              <svg v-else viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path fill="currentColor" d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.79-1.8-1.41 1.41zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z" />
              </svg>
            </button>
            <button class="export-btn" title="导出会话" @click="exportCurrent">
              <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M7 2v7M4.5 6.5L7 9l2.5-2.5M2.5 11.5h9"
                />
              </svg>
              导出
            </button>
          </header>
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
                @send="send"
                @stop="sessions.stopGeneration()"
              />
            </div>
          </div>
        </div>
      </template>
    </main>

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
html,
body,
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
}
.chat {
  height: 100%;
  display: flex;
  flex-direction: column;
}
/* REQ-013：顶栏（会话标题 + 导出入口），对齐 design/iter-3 触点四 */
.chat-header {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--c-border);
  background: var(--c-surface);
}
.chat-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.title-text {
  font-size: 15px;
  font-weight: 600;
  color: var(--c-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.title-sub {
  font-size: 12px;
  color: var(--c-text-3);
}
.export-btn {
  flex: none;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  font-size: 13px;
  color: var(--c-text-2);
  background: var(--c-surface);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
/* REQ-017 主题切换：icon-only ghost 32px（design-iter-5 触点一） */
.theme-btn {
  flex: none;
  width: 32px;
  height: 32px;
  padding: 0;
  justify-content: center;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  color: var(--c-text-2);
  background: var(--c-surface);
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.theme-btn:hover {
  border-color: var(--c-primary);
  color: var(--c-primary);
  background: var(--c-primary-l);
}
.export-btn:hover {
  border-color: var(--c-primary);
  color: var(--c-primary);
  background: var(--c-primary-l);
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
</style>
