<script setup lang="ts">
  import { reactive, ref } from 'vue'

  import type { Router } from '../../server/'
  import { useTRPC } from 'use-trpc'
  import { refThrottled } from '@vueuse/core'

  const { useQuery, isExecuting, executions } = useTRPC<Router>({
    url: `/trpc`,
  })

  // Throttle loading states to avoid flicker when loading
  const loading = refThrottled(isExecuting, 750)
  const messages = refThrottled(executions, 750)

  const id = ref(0)
  const { data } = useQuery('getUser', reactive({ id }), { msg: 'Loading User', immediate: true })
</script>

<template>
  <transition name="slide">
    <div class="loading" v-if="loading">{{ messages[0] }}</div>
  </transition>
  <pre>{{ data }}</pre>
  <button @click="id = Math.round(Math.random() * 500)">Get User</button>
</template>

<style scoped>
  .slide-enter-active {
    transition: all 0.3s ease-out;
  }

  .slide-leave-active {
    transition: all 0.8s cubic-bezier(1, 0.5, 0.8, 1);
  }

  .slide-enter-from,
  .slide-leave-to {
    transform: translateY(-10vh);
    opacity: 0;
  }

  .loading {
    font-family: sans-serif;
    position: absolute;
    font-size: 0.75rem;
    font-weight: bold;
    top: 0;
    right: 0;
    padding: 0.75rem;
    background: rgb(86, 168, 24);
    color: white;
    text-transform: uppercase;
  }
</style>
