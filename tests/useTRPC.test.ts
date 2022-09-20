// @vitest-environment happy-dom

import { beforeAll, describe, expect, it } from 'vitest'
import { createHTTPServer } from '@trpc/server/adapters/standalone'
import { inferAsyncReturnType, initTRPC } from '@trpc/server'
import { z } from 'zod'
import { useTRPC } from '../src/useTRPC'
import { nextTick, reactive, Ref, watch } from 'vue-demi'

const PORT = 9898

/* -------------------------------------------------------------------------- */
/*                              tRPC Server Setup                             */
/* -------------------------------------------------------------------------- */
const createContext = () => ({})
type Context = inferAsyncReturnType<typeof createContext>

const t = initTRPC.context<Context>().create()
const router = t.router({
  getUser: t.procedure
    .input(
      z.object({
        name: z.string(),
      }),
    )
    .query(({ input }) => `Hello, ${input.name}!`),
})

export type Router = typeof router

/* -------------------------------------------------------------------------- */
/*                              Helper Utilities                              */
/* -------------------------------------------------------------------------- */
const create = (args?: Parameters<typeof useTRPC>[0]) => {
  return useTRPC<Router>({
    url: `http://localhost:${PORT}`,
    ...args,
  })
}

const untilFalsy = async (ref: Ref<boolean | undefined>) => {
  await new Promise((resolve) =>
    watch(ref, (value) => {
      if (!value) resolve(true)
    }),
  )
}

/* -------------------------------------------------------------------------- */
/*                                    Tests                                   */
/* -------------------------------------------------------------------------- */
beforeAll(() => {
  const { listen, server } = createHTTPServer({
    router,
    createContext,
  })

  listen(PORT)
  return () => server.close()
})

// useQuery and useMutation both use the same code, so we just pick on here to test
describe('useQuery', () => {
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

  it('data should be set to initialData', async () => {
    const { useQuery } = create()
    const { data } = useQuery('getUser', { name: 'Bob' }, { initialData: 'Hello' })

    await nextTick()
    expect(data.value).toBe('Hello')
  })
})
