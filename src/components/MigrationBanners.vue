<script setup lang="ts">
import { computed } from 'vue'
import { useMigrationStore, type MigKind } from '../stores/migration'

/**
 * 存量数据上云提示条（iter-8 T3，design-iter-8 §2/§3）：会话条与档案条同屏堆叠、
 * 各自独立状态机与动作（密钥上传与会话迁移分开确认——定夺 ②）。
 * 文案 = 设计稿定稿逐字（§2.1/2.2/3.1/3.2）。
 */
const mig = useMigrationStore()

interface KindCopy {
  what: string
  prompt: (n: number) => string
  doing: string
  done: (n: number) => string
  fail: string
}

const COPY: Record<MigKind, KindCopy> = {
  sessions: {
    what: '本地会话',
    prompt: (n) =>
      `检测到本浏览器存有旧版本的 ${n} 个本地会话，导入云端后可在多设备继续使用。导入为新增，不覆盖云端已有会话；导入后本地数据转为只读备份，30 天后自动清除。`,
    doing: '正在导入本地会话…',
    done: (n) =>
      `已导入 ${n} 个会话。本地旧数据已转为只读备份（不再参与同步），30 天后自动清除；云端会话列表即时可见。`,
    fail: '导入失败：无法连接服务器。本地数据未受任何影响，可重试；已完成的会话不会重复导入。',
  },
  profiles: {
    what: '供应商档案',
    prompt: (n) =>
      `检测到本浏览器存有旧版本保存的 ${n} 套供应商档案，导入云端后可在多设备使用。密钥仅在点击导入后上传——未经你的确认不会上传；导入为新增，不覆盖云端已有档案；导入完成后本地不再保存任何档案与密钥数据。`,
    doing: '正在导入供应商档案…',
    done: (n) =>
      `已导入 ${n} 套供应商档案。本地已不再保存任何档案与密钥数据；可在设置页高级设置中查看与管理（密文掩码显示）。`,
    fail: '导入失败：无法连接服务器。本地档案与密钥未受任何影响、未上传，可重试。',
  },
}

// kinds 必须是 computed：store 的 dismiss/knowDone 是整对象替换（freshBanner），
// setup 时一次性捕获的引用会在替换后滞留旧对象，导致提示条不从界面消失（DEF-019）
const kinds = computed<{ kind: MigKind; banner: typeof mig.sessions; run(): Promise<void>; cancel(): void }[]>(() => [
  { kind: 'sessions', banner: mig.sessions, run: () => mig.importSessions(), cancel: () => mig.cancelSessions() },
  { kind: 'profiles', banner: mig.profiles, run: () => mig.importProfiles(), cancel: () => mig.cancelProfiles() },
])

const visible = computed(() => kinds.value.filter((k) => k.banner.state !== 'none'))
</script>

<template>
  <div v-if="visible.length" class="mig-zone" data-testid="migration-banners">
    <div v-for="k in visible" :key="k.kind" class="mig-banner" :class="k.banner.state === 'done' ? 'ok' : k.banner.state === 'fail' ? 'err' : 'warn'">
      <!-- 提示态 -->
      <template v-if="k.banner.state === 'prompt'">
        <span class="mb-ico" aria-hidden="true" />
        <div class="mb-main">{{ COPY[k.kind].prompt(k.banner.total) }}</div>
        <div class="mb-acts">
          <button type="button" class="mb-btn" @click="mig.dismiss(k.kind)">暂不导入</button>
          <button type="button" class="mb-btn-solid" @click="k.run()">导入到云端</button>
        </div>
      </template>

      <!-- 进行中（可取消） -->
      <template v-else-if="k.banner.state === 'doing'">
        <span class="mb-spin" aria-hidden="true" />
        <div class="mb-main">
          {{ COPY[k.kind].doing }}
          <span class="mb-num">{{ k.banner.done }} / {{ k.banner.total }}</span>
          <div class="mb-prog"><div class="fill" :style="{ width: `${k.banner.total ? Math.round((k.banner.done / k.banner.total) * 100) : 0}%` }" /></div>
        </div>
        <div class="mb-acts">
          <button type="button" class="mb-btn" @click="k.cancel()">取消</button>
        </div>
      </template>

      <!-- 完成 -->
      <template v-else-if="k.banner.state === 'done'">
        <span class="mb-ico ok" aria-hidden="true" />
        <div class="mb-main">
          <span class="mb-t">{{ COPY[k.kind].done(k.banner.total) }}</span>
        </div>
        <div class="mb-acts">
          <button type="button" class="mb-btn" @click="mig.knowDone(k.kind)">知道了</button>
        </div>
      </template>

      <!-- 失败（可重试 / 暂不导入） -->
      <template v-else-if="k.banner.state === 'fail'">
        <span class="mb-ico" aria-hidden="true" />
        <div class="mb-main">{{ COPY[k.kind].fail }}</div>
        <div class="mb-acts">
          <button type="button" class="mb-btn" @click="mig.dismiss(k.kind)">暂不导入</button>
          <button type="button" class="mb-btn-danger" @click="k.run()">重试</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.mig-zone {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px 0;
}
.mig-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.7;
}
.mig-banner.warn {
  background: var(--c-warning-l);
  color: var(--c-warning);
}
.mig-banner.ok {
  background: var(--c-subtle-bg);
  color: var(--c-text-2);
  border: 1px solid var(--c-success);
}
.mig-banner.err {
  background: var(--c-danger-l);
  color: var(--c-danger);
}
.mb-ico {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-style: normal;
  background: currentColor;
  margin-top: 3px;
  position: relative;
}
.mb-ico::before {
  content: '!';
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}
.mb-ico.ok::before {
  content: '✓';
}
.mb-main {
  flex: 1;
  min-width: 0;
}
.mb-t {
  color: var(--c-success);
  font-weight: 600;
  margin-right: 4px;
}
.mb-num {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.mb-prog {
  height: 4px;
  border-radius: 999px;
  background: var(--c-hover-bg);
  margin-top: 6px;
  overflow: hidden;
}
.mb-prog .fill {
  height: 100%;
  border-radius: 999px;
  background: var(--c-primary-solid);
  transition: width 0.15s ease;
}
.mb-spin {
  flex: none;
  width: 16px;
  height: 16px;
  margin-top: 4px;
  border-radius: 50%;
  border: 2px solid var(--c-border);
  border-top-color: currentColor;
  animation: mig-spin 0.7s linear infinite;
}
@keyframes mig-spin {
  to {
    transform: rotate(360deg);
  }
}
.mb-acts {
  flex: none;
  display: flex;
  gap: 8px;
  align-items: center;
  align-self: center;
}
.mb-btn {
  height: 28px;
  padding: 0 12px;
  border: 1px solid currentColor;
  border-radius: 6px;
  background: none;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}
.mb-btn:hover {
  opacity: 0.8;
}
.mb-btn-solid {
  height: 28px;
  padding: 0 12px;
  border: none;
  border-radius: 6px;
  background: var(--c-primary-solid);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}
.mb-btn-solid:hover {
  background: var(--c-primary-solid-h);
}
.mb-btn-danger {
  height: 28px;
  padding: 0 12px;
  border: none;
  border-radius: 6px;
  background: var(--c-danger-solid);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}
.mb-btn-danger:hover {
  filter: brightness(0.92);
}
</style>
