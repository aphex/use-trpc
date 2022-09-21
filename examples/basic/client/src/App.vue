<script setup lang="ts">
  import { reactive, ref } from 'vue'

  import type { Router } from '../../server/'
  // Import the public package if copying this example
  // import { useTRPC } from 'use-trpc'
  import { useTRPC } from '../../../../src/'

  // We bring in this composable from vueuse to help with our loading indicator
  // as our demo is all on local host we need to force a delay to see the loading indicator
  import { refThrottled } from '@vueuse/core'

  const { useQuery, useSubscription, isExecuting, executions } = useTRPC<Router>({
    url: `/trpc`, // note the vite.config.ts proxy helping us with cors issues here
    wsUrl: `ws://localhost:8080/`,
  })

  // Throttle loading states to avoid flicker when loading
  const loading = refThrottled(isExecuting, 750)
  const messages = refThrottled(executions, 750)

  const {
    data: userCountData,
    subscribe,
    unsubscribe,
    subscribed,
  } = useSubscription('uptime', { initialData: { start: 0, uptime: 0 } })

  const id = ref(0)
  const { data } = useQuery('getUser', reactive({ id }), { msg: 'Loading User', immediate: true })

  useQuery('getUser', reactive({ id: 1 }))
</script>

<template>
  <transition name="slide">
    <div class="loading" v-if="loading">{{ messages[0] }}</div>
  </transition>

  <div class="row">
    <div class="subscribed-indicator" :class="{ subscribed }"></div>
    <p>{{ userCountData?.uptime }}seconds</p>
  </div>

  <div class="row">
    <button @click="subscribe">Subscribe</button>
    <button @click="unsubscribe">Unsubscribe</button>
  </div>
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

  .row {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.25rem;
  }

  .subscribed-indicator {
    width: 0.25rem;
    height: 0.25rem;
    border-radius: 50%;
    background-color: red;
  }
  .subscribed-indicator.subscribed {
    background-color: green;
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
