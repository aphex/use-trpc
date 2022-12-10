// @vitest-environment happy-dom

import { inferAsyncReturnType, initTRPC } from '@trpc/server'
import { createHTTPServer } from '@trpc/server/adapters/standalone'
import { applyWSSHandler } from '@trpc/server/adapters/ws'
import { observable } from '@trpc/server/observable'
import { EventEmitter } from 'events'
import { beforeAll, describe, expect, it } from 'vitest'
import { nextTick, reactive, ref, Ref, watch } from 'vue-demi'
import ws, { WebSocketServer } from 'ws'
import { z } from 'zod'
import { useTRPC } from '../src/useTRPC'

const globalAny = global as any
globalAny.WebSocket = ws

const PORT = 9898

/* -------------------------------------------------------------------------- */
/*                              tRPC Server Setup                             */
/* -------------------------------------------------------------------------- */
const createContext = () => ({})
type Context = inferAsyncReturnType<typeof createContext>

const bus = new EventEmitter()
let latest = ''

const t = initTRPC.context<Context>().create()
const router = t.router({
  getUser: t.procedure
    .input(
      z.object({
        name: z.string(),
      })
    )
    .query(({ input }) => `Hello, ${input.name}!`),
  push: t.procedure.input(z.string()).mutation(({ input }) => {
    latest = input
    bus.emit('push')
    return 'ok'
  }),
  latest: t.procedure.input(z.object({ name: z.string() })).subscription(({ input: { name } }) => {
    return observable<{ latest: string; name: string }>((emit) => {
      const _emit = () => {
        emit.next({ latest, name })
      }
      bus.on('push', _emit)

      return () => bus.off('push', _emit)
    })
  }),
})

export type Router = typeof router

/* -------------------------------------------------------------------------- */
/*                              Helper Utilities                              */
/* -------------------------------------------------------------------------- */
const create = (args?: Parameters<typeof useTRPC>[0]) => {
  return useTRPC<Router>({
    url: `http://localhost:${PORT}`,
    wsUrl: `ws://localhost:${PORT}`,
    ...args,
  })
}

const untilFalsy = async (ref: Ref<boolean | undefined>) => {
  await new Promise((resolve) =>
    watch(ref, (value) => {
      if (!value) resolve(true)
    })
  )
}

const watchFor = async <T>(ref: Ref<T>, value: T | ((value: T) => boolean)) => {
  return new Promise((resolve) => {
    watch(
      ref,
      (v) => {
        if (value instanceof Function && value(v)) {
          resolve(v)
        } else if (v === value) {
          resolve(v)
        }
      },
      { immediate: true }
    )
  })
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/* -------------------------------------------------------------------------- */
/*                                    Tests                                   */
/* -------------------------------------------------------------------------- */
beforeAll(() => {
  const { listen, server } = createHTTPServer({
    router,
    createContext,
  })

  const wss = new WebSocketServer({ server })
  applyWSSHandler<Router>({ wss, router, createContext })

  listen(PORT)
  return () => server.close()
})

// useQuery and useMutation both use the same code, so we just pick on here to test
describe('useQuery/useMutation', () => {
  it('data should be set to initialData', async () => {
    const { useQuery } = create()
    const { data } = useQuery('getUser', { name: 'Bob' }, { initialData: 'Hello' })

    await nextTick()
    expect(data.value).toBe('Hello')
  })
  it('should update data on next tick when set to immediate execution', async () => {
    const { useQuery } = create()
    const { data, immediatePromise } = useQuery('getUser', { name: 'Bob' }, { immediate: true })

    await immediatePromise
    expect(data.value).toBe('Hello, Bob!')
  })

  it('should update data after manual execution', async () => {
    const { useQuery } = create()
    const { data, execute } = useQuery('getUser', { name: 'Bob' })

    await execute()
    expect(data.value).toBe('Hello, Bob!')
  })

  describe('reactive headers', () => {
    it('should update data when a reactive headers changed', async () => {
      const headers = reactive({
        Authorization: 'no-token',
      })

      const { useQuery } = create({ headers })
      const { data, executing } = useQuery('getUser', { name: 'Bob' })

      headers.Authorization = 'jwt-token'
      await nextTick()
      expect(executing.value).toBe(true)
      await untilFalsy(executing)
      expect(data.value).toBe('Hello, Bob!')
    })

    it('should update data when a ref headers as a function changed when forced', async () => {
      const auth = ref('no-token')

      const { useQuery } = create({
        headers: () => ({
          Authorization: auth.value,
        }),
      })
      const { executing, data } = useQuery('getUser', { name: 'Bob' }, { reactive: { headers: true } })

      auth.value = 'jwt-token'
      await nextTick()
      expect(executing.value).toBe(true)
      await untilFalsy(executing)
      expect(data.value).toBe('Hello, Bob!')
    })

    it('should not update data when a reactive headers as a function changed', async () => {
      const headers = reactive({
        Authorization: 'no-token',
      })

      const { useQuery } = create({ headers: () => headers })
      const { executing } = useQuery('getUser', { name: 'Bob' })

      headers.Authorization = 'jwt-token'
      await nextTick()
      expect(executing.value).toBe(false)
    })

    it('should not update data when a ref headers as a function changed', async () => {
      const auth = ref('no-token')

      const { useQuery } = create({
        headers: () => ({
          Authorization: auth.value,
        }),
      })
      const { executing } = useQuery('getUser', { name: 'Bob' })

      auth.value = 'jwt-token'
      await nextTick()
      expect(executing.value).toBe(false)
    })
  })

  describe('reactive ags', () => {
    it('should update data when a reactive argument changed', async () => {
      const { useQuery } = create()
      const args = reactive({
        name: 'Steve',
      })
      const { data, executing } = useQuery('getUser', args)

      args.name = 'Bob'
      await untilFalsy(executing)
      expect(data.value).toBe('Hello, Bob!')
    })

    it('should pickup new reactive values when manually executed', async () => {
      const args = reactive({
        name: 'Steve',
      })
      const { useQuery } = create()
      const { execute, data } = useQuery('getUser', args, { reactive: { args: false } })

      args.name = 'Bob'
      await execute()
      expect(data.value).toBe('Hello, Bob!')
    })

    it('should pickup new function arg values when manually executed', async () => {
      const name = ref('Steve')
      const { useQuery } = create()
      const { execute, executing, data } = useQuery('getUser', () => ({ name: name.value }))

      name.value = 'Bob'
      execute()
      await untilFalsy(executing)
      expect(data.value).toBe('Hello, Bob!')
    })

    it('should only execute once if multiple reactive properties are changed', async () => {
      const headers = reactive({
        Authorization: 'no-token',
      })
      const args = reactive({
        name: 'Steve',
      })

      const { useQuery, executions } = create({ headers })
      useQuery('getUser', args)

      headers.Authorization = 'jwt-token'
      args.name = 'Bob'
      await nextTick()
      expect(executions.value.length).toBe(1)
    })

    it('should only execute once if execute is called multiple times', async () => {
      const { useQuery, executions } = create()
      const { execute } = useQuery('getUser', { name: 'Bob' })

      for (let i = 0; i < 10; i++) execute()
      await nextTick()
      expect(executions.value.length).toBe(1)
    })

    it('should not execute for reactive changes if reactivity is false', async () => {
      const args = reactive({
        name: 'Steve',
      })
      const { useQuery, executions } = create()
      useQuery('getUser', args, { reactive: false })

      args.name = 'Bob'
      await nextTick()
      expect(executions.value.length).toBe(0)
    })

    it('should not execute for reactive changes of a function', async () => {
      const args = reactive({
        name: 'Steve',
      })
      const { useQuery, executions } = create()
      useQuery('getUser', () => args)

      args.name = 'Bob'
      await nextTick()
      expect(executions.value.length).toBe(0)
    })

    it('should not execute for ref changes in a function', async () => {
      const name = ref('Steve')
      const { useQuery, executions } = create()
      useQuery('getUser', () => ({ name: name.value }))

      name.value = 'Bob'
      await nextTick()
      expect(executions.value.length).toBe(0)
    })

    it('should execute for ref changes in a function when forced', async () => {
      const name = ref('Steve')
      const { useQuery, executions } = create()
      useQuery('getUser', () => ({ name: name.value }), { reactive: true })

      name.value = 'Bob'
      await nextTick()
      expect(executions.value.length).toBe(1)
    })
  })
})

describe('useSubscription', () => {
  it('should update subscription active to true when created', async () => {
    const { useSubscription } = create()
    const { state, unsubscribe } = useSubscription('latest', { name: 'test' })

    await expect(watchFor(state, 'started')).resolves.not.toThrowError()
    unsubscribe()
  })

  it('should not start the subscription when immediate is false', async () => {
    const { useSubscription } = create()
    const { state, unsubscribe } = useSubscription('latest', { name: 'test' }, { immediate: false })

    // wait a bit incase it is trying to connect
    await sleep(250)
    expect(state.value).toBe('created')
    unsubscribe()
  })

  it('should update subscription state to stopped when unsubscribed', async () => {
    const { useSubscription } = create()
    const { state, unsubscribe } = useSubscription('latest', { name: 'test' })

    await expect(watchFor(state, 'started')).resolves.not.toThrowError()
    unsubscribe()

    //TODO: Issue here with tRPC as unsubscribing seems to put the subscription into a 'complete'
    // state when it should be 'stopped'
    await expect(watchFor(state, 'completed')).resolves.not.toThrowError()
    // await expect(watchFor(state, 'stopped')).resolves.not.toThrowError()
  })

  it('should update the subscription data on manual execute', async () => {
    const { useSubscription, useMutation } = create()
    const { execute } = useMutation('push', 'hello')
    const { data, unsubscribe, state } = useSubscription('latest', { name: 'test' })

    await expect(watchFor(state, 'started')).resolves.not.toThrowError()
    execute()
    await expect(watchFor(data, (v) => v?.latest === 'hello')).resolves.not.toThrowError()
    unsubscribe()
  })

  it('should resubscribe to the subscription when reactive args change', async () => {
    const { useSubscription, useMutation } = create()
    const { execute } = useMutation('push', 'hello')
    const name = ref('test')
    const { data, unsubscribe, state } = useSubscription('latest', reactive({ name }))

    // Wait for the subscription to be started
    await expect(watchFor(state, 'started')).resolves.not.toThrowError()

    // change args
    name.value = 'test2'
    // wait a tick for subscription to be unsubscribed
    await nextTick()

    // At this point the subscription state should not have changed
    // TODO: This seems like a tRPC bug, the state is completed but it likely should be stopped as the
    // observable itself is not completed
    // expect(state.value).toBe('stopped')

    // Wait for the subscription to be re-subscribed to
    await expect(watchFor(state, 'started')).resolves.not.toThrowError()
    // run a mutation to trigger a message
    execute()
    // Expect new data with the re-subscribed name
    await expect(watchFor(data, (v) => v?.latest === 'hello' && v?.name === 'test2')).resolves.not.toThrowError()
    // cleanup test
    unsubscribe()
  })

  it('should not resubscribe to the subscription when reactive args change while paused', async () => {
    const { useSubscription, useMutation } = create()
    const name = ref('test')
    const { execute } = useMutation('push', 'hello')
    const { data, unsubscribe, state, pause } = useSubscription('latest', reactive({ name }))

    // Wait for the subscription to be started
    await expect(watchFor(state, 'started')).resolves.not.toThrowError()

    // Pause reactivity
    pause()

    // change args
    name.value = 'test2'
    // wait a tick for subscription to be unsubscribed
    await nextTick()
    // At this point the subscription should stay connected
    expect(state.value).toBe('started')

    // give it a bit just to be sure it hasn't switches subscriptions
    await sleep(250)
    // run a mutation to trigger a message
    execute()
    // Check that the name change has not been applied
    await expect(watchFor(data, (v) => v?.latest === 'hello' && v?.name === 'test')).resolves.not.toThrowError()
    // cleanup test
    unsubscribe()
  })

  it('should not resubscribe to the subscription when reactive args change if already unsubscribed', async () => {
    const { useSubscription } = create()
    const name = ref('test')
    const { unsubscribe, state } = useSubscription('latest', reactive({ name }))

    // Wait for the subscription to be started
    await expect(watchFor(state, 'started')).resolves.not.toThrowError()

    unsubscribe()
    // TODO: Same completed vs stopped bug here
    await expect(watchFor(state, 'completed')).resolves.not.toThrowError()

    // change args
    name.value = 'test2'
    // wait a tick for subscription to be unsubscribed
    await nextTick()
    // TODO: Same completed vs stopped bug here
    // At this point the subscription should stay stopped
    expect(state.value).toBe('completed')
    // give it a bit just to be sure it doesn't try to start again
    await sleep(250)
    // TODO: Same completed vs stooped bug here
    // State should still be stopped even after a delay
    expect(state.value).toBe('completed')

    // cleanup test
    unsubscribe()
  })
})
