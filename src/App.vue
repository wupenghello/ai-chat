<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useSessionsStore } from './stores/sessions'
import { useSettingsStore } from './stores/settings'
import { useToastStore } from './stores/toast'
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
</script>

<template>
  <div class="app">
    <TheSidebar @open-settings="openSettings" @chat="view = 'chat'" />

    <main class="main">
      <SettingsForm v-if="view === 'settings'" />

      <template v-else>
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
            @go-settings="openSettings"
          />
          <div class="composer-row">
            <ComposerBox :disabled="sessions.generating" hint="正在生成回复…" @send="send" />
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
  max-width: 760px;
  margin: 0 auto;
  padding: 0 24px;
  display: flex;
  flex-direction: column;
}
.composer-row {
  flex: none;
  padding: 16px 0 20px;
}
</style>
