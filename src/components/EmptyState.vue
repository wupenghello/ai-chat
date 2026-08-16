<script setup lang="ts">
import BrandMark from './BrandMark.vue'

defineProps<{ variant: 'no-session' | 'empty-session' }>()
const emit = defineEmits<{ suggest: [text: string] }>()
const suggestions = ['我叫小明', '用一段话介绍你自己', '帮我写一首关于猫的短诗']
</script>

<template>
  <div class="empty">
    <BrandMark :size="48" />
    <h2 class="empty-title">{{ variant === 'no-session' ? '欢迎使用喵喵 AI 对话' : '开始新的对话' }}</h2>
    <p class="empty-desc">
      {{
        variant === 'no-session'
          ? '开箱即用：服务端统一密钥零配置，直接输入即可对话（REQ-014 v3）；高级设置可添加自有供应商密钥'
          : '输入任何问题，AI 会记住本轮对话的上下文'
      }}
    </p>
    <div v-if="variant === 'empty-session'" class="cards">
      <button v-for="s in suggestions" :key="s" class="card" @click="emit('suggest', s)">{{ s }}</button>
    </div>
  </div>
</template>

<style scoped>
.empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  text-align: center;
}
.empty-title {
  margin: 8px 0 0;
  font-size: 20px;
  color: var(--c-text-1);
}
.empty-desc {
  margin: 0;
  font-size: 14px;
  color: var(--c-text-3);
}
.cards {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
  justify-content: center;
}
.card {
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  border-radius: 999px;
  padding: 8px 16px;
  font-size: 13px;
  color: var(--c-text-2);
  cursor: pointer;
  transition: all 0.15s ease;
}
.card:hover {
  border-color: var(--c-primary);
  color: var(--c-primary);
  background: var(--c-primary-l);
}
</style>
