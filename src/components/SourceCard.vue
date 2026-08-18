<script setup lang="ts">
/**
 * 引用来源卡（iter-14 T3，design-iter-14 §2「原型即需求」本体，REQ-035 主流程 4 / REQ-032 验收 4）。
 *
 * 次级面板家族新成员：subtle-bg + 1px border + 圆角 10px（工具步骤卡同族）。
 * 无状态机、无运行中态：卡只在 tool.result(sources) 到达时出现，出生即终态（默认折叠）。
 * 条目字段归一化（§2.3）：title/url 必有；site_name/date_published/snippet 可选，缺字段不塌——
 * 无 site_name 显 hostname、无日期连分隔点省略、无 snippet 紧凑形态。
 * 全部 textContent 直排（不进 Markdown 管线，防注入——沿「工具内容不进管线」口径）。
 * 条数防御：渲染前 slice(0, 5)，头部 N = 实际渲染条数（后端 5 条封顶的兜底）。
 */
import { ref } from 'vue'
import type { SourceItem } from '../api/client'

const props = defineProps<{ sources: SourceItem[] }>()

const open = ref(false) // 默认折叠（§2.2 定夺⑧）：无运行中态可转，无自动折叠规则；历史消息恒折叠

const items = () => props.sources.slice(0, 5)

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

const titleOf = (s: SourceItem) => s.title || hostOf(s.url)
/** 元信息行：site_name · date_published（缺失项连同分隔点一并省略；都缺 → hostname 兜底） */
function metaOf(s: SourceItem): string {
  const segs = [s.site_name || hostOf(s.url), s.date_published].filter(Boolean)
  return segs.join(' · ')
}
</script>

<template>
  <div class="source-card">
    <button type="button" class="sc-head" :aria-expanded="open" @click="open = !open">
      <svg class="sc-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linejoin="round"
          d="M7 3h10a1 1 0 0 1 1 1v17l-6-4.2L6 21V4a1 1 0 0 1 1-1z"
        />
      </svg>
      <span class="sc-name">引用来源</span><span class="sc-count"> · {{ items().length }} 条</span>
      <svg class="sc-chevron" :class="{ flip: open }" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
        <path fill="currentColor" d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
      </svg>
    </button>
    <div v-if="open" class="sc-body">
      <div v-for="(s, i) in items()" :key="i" class="src-item">
        <div class="src-title">
          <a :href="s.url" target="_blank" rel="noopener noreferrer">{{ titleOf(s) }}</a>
        </div>
        <div v-if="metaOf(s)" class="src-meta">{{ metaOf(s) }}</div>
        <div v-if="s.snippet" class="src-snip">{{ s.snippet }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 容器（§2.2）：次级面板家族——subtle-bg + border + 10px 圆角（同工具步骤卡）；段间 8px 由外层 gap 承载 */
.source-card {
  background: var(--c-subtle-bg);
  border: 1px solid var(--c-border);
  border-radius: 10px;
  margin: 4px 0;
  overflow: hidden;
}
/* 头部行（常显可点击）：行高 ≥36px（padding 7px 12px）；「引用来源 · N 条」= 名称 + count 两段拼接 */
.sc-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 7px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  font: inherit;
  text-align: left;
  color: var(--c-text-1);
  transition: background 0.15s ease;
}
.sc-head:hover {
  background: var(--c-hover-bg);
}
.sc-head:focus-visible {
  outline: 2px solid var(--c-focus-ring);
  outline-offset: -2px;
  border-radius: 10px;
}
.sc-icon {
  color: var(--c-text-3);
  flex: none;
}
.sc-name {
  flex: none;
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text-1);
}
.sc-count {
  flex: none;
  font-size: 12px;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}
.sc-chevron {
  margin-left: auto;
  color: var(--c-text-3);
  flex: none;
  transition: transform 0.15s ease;
}
.sc-chevron.flip {
  transform: rotate(180deg);
}
/* 展开区（§2.2）：padding 0 12px 12px；不限高（5 条封顶全展示）；条目间 1px 分隔（首条无） */
.sc-body {
  padding: 0 12px 12px;
}
.src-item {
  padding: 8px 0;
}
.src-item + .src-item {
  border-top: 1px solid var(--c-border);
}
/* 条目标题（§2.3）：13px/500 主色链接，textContent 直排不进管线 */
.src-title {
  font-size: 13px;
  font-weight: 500;
}
.src-title a {
  color: var(--c-primary);
  text-decoration: none;
}
.src-title a:hover {
  color: var(--c-primary-h);
  text-decoration: underline;
}
.src-title a:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--c-focus-ring);
  border-radius: 4px;
}
/* 元信息行：12px text-3、上距 2px（site_name · date_published，缺失降级） */
.src-meta {
  margin-top: 2px;
  font-size: 12px;
  color: var(--c-text-3);
}
/* 片段行：12px/1.5 text-2、上距 4px、两行 line-clamp（超长不破卡，全文看原站） */
.src-snip {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--c-text-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
