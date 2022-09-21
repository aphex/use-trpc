import {
  CreateTRPCClientOptions,
  createTRPCProxyClient,
  createWSClient,
  httpLink,
  splitLink,
  wsLink,
} from '@trpc/client'
import {
  computed,
  getCurrentScope,
  isReactive,
  nextTick,
  onScopeDispose,
  readonly,
  Ref,
  ref,
  shallowRef,
  UnwrapRef,
  watch,
} from 'vue-demi'

import type { AnyRouter, inferProcedureInput, inferProcedureOutput, ProcedureType } from '@trpc/server'
import type { Fn, inferProcedureNames, inferProcedureValues, MaybeAsyncFn } from './types'
import type { Observable, Unsubscribable } from '@trpc/server/observable'
import type { TRPCSubscriptionObserver } from '@trpc/client/dist/internals/TRPCClient'

type ProcedureOptions<T> = {
  immediate?: boolean
  reactive?: boolean | { headers?: boolean; args?: boolean }
  initialData?: T
  msg?: string
}

type SubscriptionOptions<T, E> = {
  onData?: (data: T) => void
  onError?: (data: E) => void
  initialData?: T
  immediate?: boolean
  resubscribeOnReconnect?: boolean
}

type ProcedureArgs<T> = T | (() => T | Promise<T>)

type UseTRPCOptions<T extends AnyRouter> = {
  url?: Parameters<typeof httpLink>[0]['url']
  headers?: Parameters<typeof httpLink>[0]['headers']
  wsUrl?: string
  client?: CreateTRPCClientOptions<T>
  isWebsocketConnected?: Ref<boolean>
  suppressWarnings?: boolean
}

/**
 * tRPC Composable provides access to the client, mutations and queries
 *
 * @param options.url HTTP url for tRPC client
 * @param options.headers Headers to use for this client, can be reactive and changes will execute all active procedures
 * @param options.wsUrl Websocket URL for tRPC client
 * @param options.client Full tRPC client config when not using url/wsUrl simple parameters
 * @param options.isWebsocketConnected When using custom client config this ref can be used to indicate if the websocket is connected. This is used to resubscribe to subscriptions when the websocket reconnects.
 * @param options.suppressWarnings Suppress any use-tRPC warnings
 */
export const useTRPC = <Router extends AnyRouter>(options: UseTRPCOptions<Router>) => {
  // Used to track the websocket state. This is used to resubscribe to subscriptions when the websocket reconnects.
  const { isWebsocketConnected: externalIsWebsocketConnected } = options

  // If the user is using a custom client config we need to track the websocket state manually
  // we provide a ref that can be used to indicate if the websocket is connected
  const isWebsocketConnected =
    !options.wsUrl && externalIsWebsocketConnected ? computed(() => externalIsWebsocketConnected.value) : ref(false)
  const connected = readonly(isWebsocketConnected)

  const wsLinkConfig = options.wsUrl
    ? wsLink({
        client: createWSClient({
          url: options.wsUrl,
          onClose() {
            // We cast these as typescript is not able to infer these will be regular refs
            // from just the `wsUrl` property
            ;(isWebsocketConnected as Ref<boolean>).value = false
          },
          onOpen() {
            ;(isWebsocketConnected as Ref<boolean>).value = true
          },
        }),
      })
    : undefined

  const httpLinkConfig = options.url ? httpLink({ url: options.url, headers: options.headers }) : undefined

  const clientOptions = options.client
    ? options.client
    : httpLinkConfig && wsLinkConfig
    ? {
        links: [
          splitLink({
            condition(op) {
              return op.type === 'subscription'
            },
            true: wsLinkConfig,
            false: httpLinkConfig,
          }),
        ],
      }
    : httpLinkConfig
    ? {
        links: [httpLinkConfig],
      }
    : wsLinkConfig
    ? {
        links: [wsLinkConfig],
      }
    : undefined

  if (!clientOptions) throw Error('URL, WsURL, or Client Configuration Required')
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
    /**
     * tRPC Composable provides access to the client, mutations and queries
     *
     * @param procedure dot notation path to procedure
     * @param args Arguments to pass to procedure
     * @param options.immediate Execute the procedure immediately
     * @param options.initialData Initial data to use for reactive data
     * @param options.reactive Make the data reactive, can be set to false to disable reactivity
     * @param options.reactive.headers Make the headers reactive, can be set to false to disable reactivity
     * @param options.reactive.args Make the args reactive, can be set to false to disable reactivity
     * @param options.msg Message to display in the execution list
     */
    return <P extends inferProcedureNames<Router, Method>>(
      procedure: P,
      args: ProcedureArgs<inferProcedureInput<inferProcedureValues<Router, P>>>,
      {
        immediate,
        initialData,
        reactive,
        msg,
      }: ProcedureOptions<inferProcedureOutput<inferProcedureValues<Router, P>>> = {}
    ) => {
      // Is this a Query or Mutation?
      const method = procedureType === 'query' ? 'query' : 'mutate'

      // Lets default reactive to true
      if (reactive === undefined) reactive = true

      // Determine the reactivity of the headers options
      const headers = options.headers
      const hasHeadersFn = typeof headers === 'function'
      const isHeadersFnAsync = hasHeadersFn && headers.constructor.name === 'AsyncFunction'
      const isHeaderReactivityEnabled = reactive === true || (typeof reactive === 'object' && reactive.headers)
      const trackReactiveHeaders = isHeaderReactivityEnabled && ((headers && isReactive(headers)) || hasHeadersFn)

      if (!options.suppressWarnings && isHeaderReactivityEnabled && options.client && !options.headers) {
        console.warn(
          [
            `Reactive headers are enabled for "${method}.${procedure}" but useTRPC was configured`,
            `with a custom client and no headers were provided for tracking.`,
            `If you are using HttpLink in your client and want to track headers, you must provide the headers`,
            `as an option to useTRPC as well.`,
            `If this does not apply to you you can suppress this warning by setting 'reactive.headers' to false`,
            `in the options for "${method}.${procedure}" or setting 'suppressWarnings' to true in the useTRPC config.`,
          ].join('\n')
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

  // Query and Mutation composables use the exact same logic
  const useQuery = createProcedureHandler('query')
  const useMutation = createProcedureHandler('mutation')

  // Subscription composable requires lookups for the resulting data that is emitted from the server
  // as well as socket reconnect logic. It also provides both reactive properties and a callback handler.
  // Though reactive data is preferred the callback maybe be needed if your socket messages are the same
  // but still require action. For example the server only emits a `ping` every 10 seconds, the
  // reactive property would only update once, whereas the callback would be triggered for each message.

  /**
   * useSubscription composable to subscribe to a topic and reactively receive data
   *
   * @param topic dot notation path to the topic you want to subscribe to
   * @param params.onData callback function that will be called for each message
   * @param params.onError callback function that will be called if an error occurs
   * @param params.initialData initial data to use for the reactive data property
   * @param params.immediate immediately subscribe to this topic (default true)
   * @param params.resubscribeOnReconnect automatically resubscribe to the topic on socket reconnect
   * @returns
   */
  const useSubscription = <
    P extends inferProcedureNames<Router, 'subscription'>,
    O extends inferProcedureValues<Router, P>['_def']['_output_out'] = inferProcedureValues<
      Router,
      P
    >['_def']['_output_out'],
    T extends [any, any] = O extends Observable<infer O, infer E> ? [O, E] : [never, never]
  >(
    topic: P,
    { onData, onError, initialData, immediate, resubscribeOnReconnect }: SubscriptionOptions<T[0], T[1]> = {}
  ) => {
    // Lets default to immediately subscribing to the topic
    if (immediate === undefined) immediate = true
    // Reactive data with the latest result from the subscription topic
    // Seeded with initial data if provided
    const data = ref<T[0]>(initialData)
    // Reactive error with the latest error from the subscription topic
    const error = ref<T[1]>()

    // Convert the dot notation path back into a subscription resolver
    const path = topic.split('.')
    const resolver = path.reduce<any>((acc, curr) => acc[curr], client) as {
      subscribe: (input: void | undefined, opts: Partial<TRPCSubscriptionObserver<T[0], T[1]>>) => Unsubscribable
    }

    let _unsubscribe: Unsubscribable['unsubscribe'] | undefined
    const _subscribed = ref(false)
    const subscribed = readonly(_subscribed)
    // We wrap this in a function so we can immediately execute it
    // but also run the exact same code if the socket reconnects after a disconnect
    const _subscribe = () => {
      if (_subscribed.value) return

      const { unsubscribe } = resolver.subscribe(undefined, {
        onData(_data) {
          data.value = _data
          if (onData) onData(_data)
        },
        onError(_error) {
          error.value = _error
          if (onError) onError(_error)
        },
      })
      _subscribed.value = true

      return () => {
        _subscribed.value = false
        unsubscribe()
      }
    }
    // Here we mask the original subscribe function with our own public version
    // so we can assure that the unsubscribe function is always available and up to date
    const subscribe = () => (_unsubscribe = _subscribe())
    const unsubscribe = () => _unsubscribe && _unsubscribe()

    // Make it so 👉
    if (immediate) subscribe()

    // Monitor for web socket disconnects and reconnects
    // if we disconnect flag it here so we know to resubscribe on reconnect
    let hasDisconnected = false
    watch(isWebsocketConnected, (connected, oldConnected) => {
      if (oldConnected && !connected) {
        hasDisconnected = true
        _subscribed.value = false
        if (resubscribeOnReconnect) unsubscribe()
      } else if (hasDisconnected && !oldConnected && connected) {
        if (resubscribeOnReconnect) subscribe()
        hasDisconnected = false
      }
    })

    // Cleanup on scope disposal
    if (getCurrentScope())
      onScopeDispose(() => {
        onData = onError = undefined
        unsubscribe && unsubscribe()
      })

    return { data, error, subscribe, unsubscribe, subscribed }
  }

  return {
    client,
    isExecuting,
    executions,
    connected,
    useQuery,
    useMutation,
    useSubscription,
  }
}
