import { CreateTRPCClientOptions, createTRPCProxyClient, httpLink } from '@trpc/client'
import {
  computed,
  isReactive,
  nextTick,
  readonly,
  ref,
  shallowRef,
  UnwrapRef,
  watch,
} from 'vue-demi'

import type {
  AnyRouter,
  inferProcedureInput,
  inferProcedureOutput,
  ProcedureType,
} from '@trpc/server'
import type { Fn, inferProcedureNames, inferProcedureValues, MaybeAsyncFn } from './types'

type ProcedureOptions<T> = {
  immediate?: boolean
  reactive?: boolean | { headers?: boolean; args?: boolean }
  initialData?: T
  msg?: string
}

type ProcedureArgs<T> = T | (() => T | Promise<T>)

type UseTRPCOptions<T extends AnyRouter> = {
  url?: Parameters<typeof httpLink>[0]['url']
  headers?: Parameters<typeof httpLink>[0]['headers']
  client?: CreateTRPCClientOptions<T>
  suppressWarnings?: boolean
}

/**
 * tRPC Composable provides access to the client, mutations and queries
 */
export const useTRPC = <Router extends AnyRouter>(options: UseTRPCOptions<Router>) => {
  const clientOptions = options.client
    ? options.client
    : options.url
    ? {
        links: [httpLink({ url: options.url, headers: options.headers })],
        url: options.url,
      }
    : undefined

  if (!clientOptions) throw Error('URL or Client Configuration Required')
  const client = createTRPCProxyClient<Router>(clientOptions)

  // Execution tracking gives users a way to present loading indicators
  const activeExecutions = ref(new Map<number, string | undefined>())
  // Quick boolean access to know if the client is executing anything
  const isExecuting = computed(() => !!activeExecutions.value.size)
  // List of execution messages
  const executions = computed(() => [...activeExecutions.value.values()])

  let id = 0
  const addExecution = (msg?: string) => {
    id++
    activeExecutions.value.set(id, msg)
    return id
  }
  const removeExecution = (id: number) => activeExecutions.value.delete(id)

  // Common Procedure handler, just changes query and mutation
  const createProcedureHandler = <Method extends ProcedureType>(procedureType: Method) => {
    return <P extends inferProcedureNames<Router, Method>>(
      procedure: P,
      args: ProcedureArgs<inferProcedureInput<inferProcedureValues<Router, P>>>,
      {
        immediate,
        initialData,
        reactive,
        msg,
      }: ProcedureOptions<inferProcedureOutput<inferProcedureValues<Router, P>>> = {},
    ) => {
      // Is this a Query or Mutation?
      const method = procedureType === 'query' ? 'query' : 'mutate'

      // Lets default reactive to true
      if (reactive === undefined) reactive = true

      // Determine the reactivity of the headers options
      const headers = options.headers
      const hasHeadersFn = typeof headers === 'function'
      const isHeadersFnAsync = hasHeadersFn && headers.constructor.name === 'AsyncFunction'
      const isHeaderReactivityEnabled =
        reactive === true || (typeof reactive === 'object' && reactive.headers)
      const trackReactiveHeaders =
        isHeaderReactivityEnabled && ((headers && isReactive(headers)) || hasHeadersFn)

      if (
        !options.suppressWarnings &&
        isHeaderReactivityEnabled &&
        options.client &&
        !options.headers
      ) {
        console.warn(
          [
            `Reactive headers are enabled for "${method}.${procedure}" but useTRPC was configured`,
            `with a custom client and no headers were provided for tracking.`,
            `If you are using HttpLink in your client and want to track headers, you must provide the headers `,
            `as an option to useTRPC as well.`,
            `If this does not apply to you you can suppress this warning by setting 'reactive.headers' to false`,
            `in the options for "${method}.${procedure}" or setting 'suppressWarnings' to true in the useTRPC config.`,
          ].join('\n'),
        )
      }

      if (!options.suppressWarnings && isHeadersFnAsync && trackReactiveHeaders)
        console.warn(`Async headers cannot be reactive. Attempted on ${method}.${procedure}`)

      // Determine the reactivity of the procedure arguments
      const hasArgsFn = typeof args === 'function'
      const isArgsFnAsync = hasArgsFn && args.constructor.name === 'AsyncFunction'
      const trackReactiveArgs =
        (reactive === true || (typeof reactive === 'object' && reactive.args)) &&
        ((args && isReactive(args)) || hasArgsFn)

      if (!options.suppressWarnings && isArgsFnAsync && trackReactiveArgs)
        console.warn(`Async Arguments cannot be reactive. Attempted on ${method}.${procedure}`)

      // Reactive value of the procedure result
      const data = shallowRef<typeof initialData>(initialData)
      // Reactive value of the procedure error
      const error = ref()

      // Pausing will prevent the procedure from executing reactively from args or headers
      // manually calling the procedure will still execute
      const _executing = ref(false)
      const executing = readonly(_executing)
      const paused = ref(false)
      const pause = () => (paused.value = true)
      const unpause = () => (paused.value = false)

      // Get the procedure from the client using the dot notation path
      const path = procedure.split('.')
      const fn = path.reduce<any>((acc, curr) => acc[curr], client) as any

      // Internal execution function will actually call the procedure
      // we protect this behind a scheduler so that procedures are not executed
      // multiple times within the same tick
      const _execute = async () => {
        try {
          const _args = hasArgsFn ? await (args as MaybeAsyncFn)() : args
          data.value = (await fn[method](_args)) as UnwrapRef<typeof data>
        } catch (e) {
          error.value = e
        }
      }

      // We use this simple scheduler to keep the procedure from executing multiple times
      // in the same tick.
      // This can happen if multiple reactive properties or watchers trigger an execution
      // for example if the reactive headers and args change together
      const execute = async () => {
        if (_executing.value) return

        const id = addExecution(msg)
        _executing.value = true
        await nextTick(() => _execute())
        _executing.value = false
        removeExecution(id)
      }

      // Immediately execute?

      // Watch for changes in headers
      if (!isHeadersFnAsync && trackReactiveHeaders) {
        watch(hasHeadersFn ? () => headers() : headers, () => {
          if (!paused.value) execute()
        })
      }

      // Watch for changes in args
      if (!isArgsFnAsync && trackReactiveArgs) {
        watch(hasArgsFn ? () => (args as Fn)() : args, () => {
          if (!paused.value) execute()
        })
      }

      let immediatePromise: Promise<boolean> | undefined
      const result = {
        data,
        execute,
        executing,
        pause,
        unpause,
        paused,
        immediatePromise,
      }

      if (immediate) {
        result.immediatePromise = new Promise(async (resolve) => {
          await execute()
          resolve(true)
        })
      }

      return result
    }
  }

  const useQuery = createProcedureHandler('query')
  const useMutation = createProcedureHandler('mutation')

  return { client, isExecuting, executions, useQuery, useMutation }
}
