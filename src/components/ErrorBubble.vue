<script setup lang="ts">
defineProps<{ kind: string; message: string }>()
const emit = defineEmits<{ retry: [] ; goSettings: [] }>()

const titles: Record<string, string> = {
  auth: '密钥未授权',
  rateLimit: '请求过于频繁',
  server: '服务端错误',
  network: '网络连接失败',
  unknown: '请求失败',
}
</script>

<template>
  <div class="error-bubble" role="alert">
    <div class="head">
      <span class="dot" aria-hidden="true" />
      <strong>{{ titles[kind] ?? titles.unknown }}</strong>
    </div>
    <p class="msg">{{ message }}</p>
    <div class="acts">
      <button class="btn" @click="emit('retry')">重试</button>
      <button v-if="kind === 'auth'" class="btn btn-primary" @click="emit('goSettings')">前往设置更新密钥</button>
    </div>
  </div>
</template>

<style scoped>
.error-bubble {
  max-width: 76%;
  border: 1px solid var(--c-danger-l);
  background: var(--c-danger-l);
  border-radius: 12px;
  padding: 12px 16px;
}
.head {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--c-danger);
  font-size: 13px;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--c-danger-solid);
}
.msg {
  margin: 6px 0 10px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--c-text-2);
}
.acts {
  display: flex;
  gap: 8px;
}
.btn {
  height: 32px;
  padding: 0 14px;
  border-radius: 6px;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  font-size: 13px;
  color: var(--c-text-1);
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn:hover {
  background: var(--c-hover-bg);
}
.btn:active {
  transform: scale(0.96);
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
</style>
