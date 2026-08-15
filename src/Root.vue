<template>
  <RouterView />
</template>

<script setup lang="ts">
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'

/** 登录态从有到无（登出/401 失效）→ 跳登录页并带回跳参数（REQ-006/020） */
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

watch(
  () => auth.user,
  (user, previous) => {
    if (!user && previous && route.name !== 'login') {
      void router.push({
        name: 'login',
        query: route.fullPath === '/' ? {} : { redirect: route.fullPath },
      })
    }
  },
)
</script>
