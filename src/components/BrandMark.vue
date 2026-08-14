<script setup lang="ts">
/** 品牌位：方案 C 标志（字母 M 藏猫耳与尾巴）+ 可选"喵喵"文字，组合规则见 design-system/logo/README.md */
withDefaults(defineProps<{ size?: number; withText?: boolean }>(), { size: 24, withText: false })
</script>

<template>
  <div class="brand">
    <svg
      :width="size"
      :height="size"
      viewBox="0 0 128 128"
      role="img"
      aria-label="喵喵标志"
      class="brand-mark"
    >
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="13"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M 20 98 V 36 M 108 98 V 36 M 20 36 L 64 78 L 108 36 M 64 78 C 64 102 96 102 96 82"
      />
    </svg>
    <span v-if="withText" class="brand-name">喵喵</span>
  </div>
</template>

<style scoped>
.brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.brand-mark {
  color: var(--c-primary);
  flex: none;
}
.brand-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--c-text-1);
}
</style>
