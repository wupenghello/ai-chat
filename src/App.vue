<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useSessionsStore } from './stores/sessions'
import { useSettingsStore } from './stores/settings'
import { useToastStore } from './stores/toast'
import { exportSession } from './utils/export'
import TheSidebar from './components/TheSidebar.vue'
import MessageList from './components/MessageList.vue'
import ComposerBox from './components/ComposerBox.vue'
import EmptyState from './components/EmptyState.vue'
import SettingsForm from './components/SettingsForm.vue'
import AppToast from './components/AppToast.vue'

const sessions = useSessionsStore()
const settings = useSettingsStore()
const toast = useToastStore()

const view = ref<'chat' | 'settings'>('chat')

onMounted(() => {
  void sessions.init().catch(() => {
    // IndexedDB 不可用（隐私模式等）：降级为纯内存会话，提示用户
    toast.push('本地存储不可用，会话将不会保存')
  })
})

function openSettings() {
  view.value = 'settings'
}

async function send(text: string) {
  if (!settings.isConfigured) {
    // REQ-007：未配置密钥即发送 → 不发请求，引导设置页
    toast.push('尚未配置 API 密钥', { label: '前往设置', to: 'settings' })
    return
  }
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
    <TheSidebar @open-settings="openSettings" @chat="view = 'chat'" />

    <main class="main">
      <SettingsForm v-if="view === 'settings'" />

      <template v-else>
        <div class="chat">
          <header v-if="sessions.active" class="chat-header">
            <div class="chat-title">
              <span class="title-text">{{ sessions.active.title }}</span>
              <span class="title-sub">模型：{{ settings.config.model ?? '未设置' }}</span>
            </div>
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
            @go-settings="openSettings"
            @edit="editMessage"
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
/* 设计令牌（design/iter-1 定稿，飞书蓝白系） */
:root {
  --c-primary: #3370ff;
  --c-primary-h: #2e5fdf;
  --c-primary-a: #2860d8;
  --c-primary-l: #f0f4ff;
  --c-bg: #f5f6f7;
  --c-surface: #ffffff;
  --c-border: #e5e6eb;
  --c-text-1: #1f2329;
  --c-text-2: #646a73;
  --c-text-3: #8f959e;
  --c-error: #d93025;
  --c-warning: #b45309;
  --c-success: #1a9e5c;
  --c-success-on-dark: #4cc38a;
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
