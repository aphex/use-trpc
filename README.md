<div align="center">
  <h2 align="center">use-tRPC</h1>
  <p>Vue composable utility for tRPC v10</p>
</div>

<div align="center">
  <a href="https://www.npmjs.com/package/use-trpc" target="_blank">
    <img src="https://img.shields.io/static/v1?label=&message=npm&color=cb0000" alt="use-trpc on NPM">
  </a>
</div>
<hr>

# 👀 Features
- 🎻 Composable access to tRPC client, Queries, Mutations, and Subscriptions.
- ✔️ Configurable reactivity per query, mutation and subscription.
- 🗒️ Reactive Execution list for loading indicators.
- 🔃 Built-in tracking of reactive headers, procedure arguments and subscription arguments.
- 🔥 Automatic re-fetch and re-subscribe.
- 📦 Reactive data procedures and subscriptions.
- ☯️ Built with [vue-demi](https://github.com/vueuse/vue-demi) to support Vue 2 and Vue 3.
- ⌨️ Built with [TypeScript](https://www.typescriptlang.org/) providing TypeSafe options.

# 📦 Install

```bash
npm i use-trpc
```

# 🎉 Basic Usage
By default `reactive` objects will automatically be tracked and trigger a new execution when they change

```vue
<script setup lang="ts">
  import { reactive, ref } from 'vue'

  import type { Router } from '../../path/to/trpc/router'
  import { useTRPC } from 'use-trpc'

  const { useQuery, useMutation } = useTRPC<Router>({
    url: import.meta.env.VITE_tRPC_URL
  })

  const id = ref(0)
  const { data } = useQuery('getUser', { args: reactive({ id }) })
</script>

<template>
  <pre>{{ data }}</pre>
  <button @click="id=10">GetUser</button>
</template>
```

# 👀 Configuration Examples

## Reactive Headers
```ts
  // Shared composable for your app to get the active token
  const { token } = useToken() 
  const headers = reactive({
    Authorization: computed(() => `Bearer ${token.value}`),
  })

  // All procedures using this client will react and re-execute 
  // when the headers change
  const { useQuery, useMutation } = useTRPC<Router>({
    url: import.meta.env.VITE_tRPC_URL,
    headers,
  })
```

## Reactive Arguments
```ts
  const id = ref(0)
  const { data } = useQuery('getUser', { args: reactive({ id }) })

  // Will trigger an execution of getUser with the id of 10
  id.value = 10
```

## Opt-Out of Reactivity
When using a getter function for arguments reactive tracking will not be automatic. To Opt back 
into it you can set `reactive` to `true` and the getter function will be watched

```ts
  const id = ref(0)
  const { data } = useQuery('getUser', { args: () => reactive({ id }) })

  // Will not trigger an execution of getUser with the id of 10
  id.value = 10
```

## Full HTTP Client Config
```ts
  const token = ref('')
  const headers = reactive({
    Authorization: computed(() => `Bearer ${token.value}`),
  })

  // Pass in a complete tRPC client proxy config for complete control
  const { client, isExecuting, executions, useQuery, useMutation } = useTRPC<Router>({
    headers,
    client: {
      links: [
        httpLink({
          url: import.meta.env.VITE_tRPC_URL,
          headers,
        }),
      ],
    },
  })
```
## Simple HTTP + WebSocket Client
```ts
  const { useQuery, useSubscription, isExecuting, executions } = useTRPC<Router>({
    url: import.meta.env.VITE_tRPC_URL,
    wsUrl: import.meta.env.VITE_tRPC_WSURL,
  })
```
## Enable the default tRPC Logger
```ts
  const { useQuery, useSubscription, isExecuting, executions } = useTRPC<Router>({
    url: import.meta.env.VITE_tRPC_URL,
    wsUrl: import.meta.env.VITE_tRPC_WSURL,
    // this can also be LoggerLinkOptions top configure a logger manually
    logger: true
  })
```

## Full Query/Mutation Config
```ts
  const { data, execute, executing, immediatePromise, pause, paused, unpause } = useQuery(
    // path to the procedure
    'getUser',
    // useQuery configuration
    {
      // arguments for the procedure could also be `{id}`, `() => ({id})`, or `() => reactive({id})`
      args: reactive({ id }),
      immediate: true,
      initialData: { name: 'Bob' },
      msg: 'Loading User',
      // Full control of reactive tracking
      reactive: {
        args: true,
        headers: false
      }
    }
  )
```
## Full Subscription Config
```ts
  const {
    data, 
    error, 
    subscribe, 
    unsubscribe, 
    subscribed, 
    state, 
    paused, 
    pause, 
    unpause,
  } = useSubscription(
    // path to the topic to subscribe to
    'uptime', 
    // useSubscription configuration
    {
      // input arguments for this subscription (can also be reactive, ref, or a getter function)
      args: 'auth-token', 
      initialData: { start: 0, uptime: 0 },
      immediate: true,
      onData(data) {
        console.log('onData', data)
      },
      onError(err) {
        console.log('onError', err)
      },
      onComplete() {
        console.log('subscription completed')
      },
      onStarted() {
        console.log('subscription started')
      },
      onStopped() {
        console.log('subscription stopped')
      },
    }
  )
```

# ⚙️ Configuration Details

## useTRPC

| Property             | Description                                                                            |
| -------------------- | -------------------------------------------------------------------------------------- |
| url                  | _(string)_ URL to your TRPC Endpoint                                                   |
| wsUrl                | _(string)_ URL to your TRPC Websocket Endpoint                                         |
| headers              | Reactive or plain object or a function that returns a reactive or plain object         |
| logger               | Boolean or logger options to create a tRPC logger                                      |
| transformer          | Data transformer to serialize response data                                            |
| client               | Full tRPC client config                                                                |
| isWebSocketConnected | _(Ref)_ Used to indicate websocket connection status when using a custom client config |
| silent               | _(boolean)_ Suppress any warning or error logs                                         |

> **Warning**
>
> When using the full client config with reactive headers you must also pass the reactive headers 
> object, or function, into `useTRPC` as well. This allows for tracking of changes and re-execution of 
> procedures

## useQuery/useMutation

| Property    | Description                                                                   |
| ----------- | ----------------------------------------------------------------------------- |
| args        | _(any or () => any)_ arguments to pass along as query params or mutation body |
| immediate   | _(boolean)_ execute the procedure immediately                                 |
| initialData | Seed data for the reactive data property                                      |
| reactive    | _(boolean or {headers: boolean, args: boolean})_ Force reactivity on/off      |
| msg         | _(string)_ Message to edd to execution array when this procedure runs         |

## useSubscription

| Property    | Description                                                                 |
| ----------- | --------------------------------------------------------------------------- |
| args        | _(any or () => any)_ arguments to pass along as params for the subscription |
| onData      | Callback when server emits a message for this topic                         |
| onError     | Callback when the server emits an error for this topic                      |
| onStarted   | Callback when a subscription is started                                     |
| onComplete  | Callback when the server emits subscription completed                       |
| onStopped   | Callback when a subscription is stopped                                     |
| initialData | Seed data for the reactive data property                                    |
| immediate   | _(boolean)_ subscribe to the topic immediately                              |
| reactive    | _(boolean or {headers: boolean, args: boolean})_ Force reactivity on/off    |


# 🎁 Return Details

## useTRPC

| Property        | Description                                              |
| --------------- | -------------------------------------------------------- |
| client          | tRPC client for manual execution of procedures           |
| isExecuting     | _(Ref)_ boolean indicating if any procedure is executing |
| executions      | _(Ref)_ array of procedure execution messages            |
| connected       | _(Ref)_ boolean indicates if the socket is connected     |
| useQuery        | useQuery Composable for this client                      |
| useMutation     | useMutation Composable for this client                   |
| useSubscription | useSubscription Composable for this client               |

## useQuery/useMutation

| Property         | Description                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| data             | _(Ref)_ with the latest response value from the procedure                                               |
| error            | _(Ref)_ with the latest error value from the procedure                                                  |
| execute          | Function to run the procedure and update all reactive properties                                        |
| executing        | _(Ref)_ indicating whether this procedure is currently running                                          |
| pause            | Function to pause reactivity tracking for this procedure                                                |
| unpause          | Function to resume reactivity tracking for this procedure                                               |
| pause            | _(Ref)_ indicating if reactivity is paused                                                              |
| abortController  | _(Ref)_ ref to the current executions abort controller                                                  |
| immediatePromise | When composable is created with `{ immediate: true }` this promise can be awaited for initial execution |

## useSubscription

| Property    | Description                                                                       |
| ----------- | --------------------------------------------------------------------------------- |
| data        | _(Ref)_ with the latest message for the topic                                     |
| error       | _(Ref)_ with the latest error for the topic                                       |
| subscribe   | subscribe to the topic on the server                                              |
| unsubscribe | unsubscribe from topic on the server                                              |
| resubscribe | shortcut to unsubscribe and then subscribe to topic on the server                 |
| subscribed  | _(Ref)_ Boolean indicating an active subscription to the topic                    |
| state       | _(created, started, stopped, or completed)_ The current state of the subscription |
| paused      | _(Ref)_  Indicates if reactivity is paused for arguments on this subscription     |
| pause       | Pause reactivity tracking for arguments                                           |
| unpause     | resume reactivity tracking for arguments                                          |

# 💓 Thanks

This project is based on patterns from **VueUse** and of course relies on the amazing tRPC project 

- [tRPC](https://trpc.io/)
- [VueUse](https://github.com/vueuse/vueuse)