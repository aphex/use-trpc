import {
  CreateTRPCClientOptions,
  createTRPCProxyClient,
  createWSClient,
  httpLink,
  loggerLink,
  splitLink,
  TRPCLink,
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

import type { AnyRouter, inferProcedureInput, inferProcedureOutput, MaybePromise, ProcedureType } from '@trpc/server'
import type { Observable, Unsubscribable } from '@trpc/server/observable'
import type { Fn, inferProcedureNames, inferProcedureValues, MaybeAsyncFn } from './types'
import type { TRPCSubscriptionObserver } from '@trpc/client/dist/internals/TRPCUntypedClient'

type UseProcedureConfig<D> = {
  immediate?: boolean
  reactive?: boolean | { headers?: boolean; args?: boolean }
  initialData?: D
  msg?: string
}
type ProcedureArgs<T> = T | (() => MaybePromise<T | undefined>)

type UseSubscriptionConfig<D, E> = {
  onData?: (data: D) => void
  onError?: (data: E) => void
  onComplete?: () => void
  onStarted?: () => void
  onStopped?: () => void
  initialData?: D
  initialError?: E
  reactive?: boolean
  immediate?: boolean
}
type SubscriptionArgs<T> = T | (() => T)
type SubscriptionState = 'started' | 'stopped' | 'completed' | 'created'

/**
 * tRPC Composable provides access to the client, mutations and queries
 *
 * @param config.url HTTP url for tRPC client
 * @param config.headers Headers to use for this client, can be reactive and changes will execute all active procedures
 * @param config.wsUrl Websocket URL for tRPC client
 * @param config.logger Boolean to enable the default logger, or a logger config object
 * @param config.transformer Custom data transformer to serialize response data
 * @param config.client Full tRPC client config when not using url/wsUrl simple parameters
 * @param config.isWebsocketConnected When using custom client config this ref can be used to indicate if the websocket is connected. It is used just as a readonly passthrough for consistency
 * @param config.silent Suppress any use-tRPC warnings or errors
 */
export const useTRPC = <Router extends AnyRouter>(config: {
  url?: Parameters<typeof httpLink>[0]['url']
  headers?: Parameters<typeof httpLink>[0]['headers']
  wsUrl?: string
  logger?: boolean | Parameters<typeof loggerLink>[0]
  transformer?: Parameters<typeof createTRPCProxyClient>[0]['transformer']
  client?: CreateTRPCClientOptions<Router>
  isWebsocketConnected?: Ref<boolean>
  silent?: boolean
}) => {
  // Used to track the websocket state. This is used to resubscribe to subscriptions when the websocket reconnects.
  const { isWebsocketConnected: _isWebsocketConnected, headers } = config

  // If the user is using a custom client config they need to track the websocket state manually
  // we provide a ref that can be used to indicate if the websocket is connected
  const isWebsocketConnected =
    !config.wsUrl && _isWebsocketConnected ? computed(() => _isWebsocketConnected.value) : ref(false)
  const connected = readonly(isWebsocketConnected)

  const wsLinkConfig = config.wsUrl
    ? wsLink({
        client: createWSClient({
          url: config.wsUrl,
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

  const httpLinkConfig = config.url ? httpLink({ url: config.url, headers: config.headers }) : undefined

  const loggerLinkConfig = config.logger
    ? (loggerLink(config.logger === true ? {} : config.logger) as TRPCLink<Router>)
    : undefined

  const clientOptions = config.client
    ? config.client
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

  if (loggerLinkConfig) clientOptions.links.unshift(loggerLinkConfig)
  const client = createTRPCProxyClient<Router>({
    transformer: config.transformer,
    ...clientOptions,
  })

  // Execution tracking gives users a way to present loading indicators
  const activeExecutions = ref(new Map<number, string | undefined>())
  // Quick boolean access to know if the client is executing anything
  const isExecuting = computed(() => !!activeExecutions.value.size)
  // List of execution messages
  const executions = computed(() => [...activeExecutions.value.values()])

  let id = 0
  const addExecution = (msg?: string) => {
    if (id >= Number.MAX_SAFE_INTEGER) id = 0
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
     * @param procedureConfig.immediate Execute the procedure immediately
     * @param procedureConfig.initialData Initial data to use for reactive data
     * @param procedureConfig.reactive Force tracking on/off for both header and arg reactivity
     * @param procedureConfig.reactive.headers Force tracking on/off for header reactivity
     * @param procedureConfig.reactive.args Force tracking on/off for arg reactive
     * @param procedureConfig.msg Message to display in the execution list
     */
    return <
      P extends inferProcedureNames<Router, Method>,
      I extends inferProcedureInput<inferProcedureValues<Router, P>> = inferProcedureInput<
        inferProcedureValues<Router, P>
      >,
      O extends inferProcedureOutput<inferProcedureValues<Router, P>> = inferProcedureOutput<
        inferProcedureValues<Router, P>
      >
    >(
      procedure: P,
      ...[args, procedureConfig]: undefined extends O
        ? [args?: ProcedureArgs<I>, procedureConfig?: UseProcedureConfig<O>]
        : [args: ProcedureArgs<I>, procedureConfig?: UseProcedureConfig<O>]
    ) => {
      procedureConfig = procedureConfig || {}
      const { immediate, reactive, initialData, msg } = procedureConfig

      // Is this a Query or Mutation?
      const method = procedureType === 'query' ? 'query' : 'mutate'

      // Determine the reactivity of the headers options
      const areHeadersFn = typeof headers === 'function'
      const areHeadersAsyncFn = areHeadersFn && headers.constructor.name === 'AsyncFunction'
      const isHeaderReactivityTrue = reactive === true || (typeof reactive === 'object' && reactive.headers === true)
      const isHeaderReactivityFalse = reactive === false || (typeof reactive === 'object' && reactive.headers === false)
      const shouldTrackHeaderReactivity = isHeaderReactivityTrue
        ? true
        : isHeaderReactivityFalse
        ? false
        : headers && isReactive(headers)

      if (!config.silent && shouldTrackHeaderReactivity && config.client && !config.headers) {
        console.warn(
          [
            `Reactive headers are enabled for "${method}.${procedure}" but useTRPC was configured`,
            `with a custom client and no headers were provided for tracking.`,
            `If you are using HttpLink in your client and want to track headers, you must provide the headers`,
            `as an option to useTRPC as well.`,
            `If this does not apply to you you can suppress this warning by setting 'reactive.headers' to false`,
            `in the options for "${method}.${procedure}" or setting 'silent' to true in the useTRPC config.`,
          ].join('\n')
        )
      }

      if (!config.silent && areHeadersAsyncFn && shouldTrackHeaderReactivity)
        console.warn(`Async headers cannot be reactive. Attempted on ${method}.${procedure}`)

      // Determine the reactivity of the procedure arguments
      const areArgsFn = typeof args === 'function'
      const areArgsAsyncFn = areArgsFn && args.constructor.name === 'AsyncFunction'
      const isArgReactivityTrue = reactive === true || (typeof reactive === 'object' && reactive.args === true)
      const isArgReactivityFalse = reactive === false || (typeof reactive === 'object' && reactive.args === false)
      const shouldTrackReactiveArgs = isArgReactivityTrue
        ? true
        : isArgReactivityFalse
        ? false
        : args && isReactive(args)

      if (!config.silent && areArgsAsyncFn && shouldTrackReactiveArgs)
        console.warn(`Async Arguments cannot be reactive. Attempted on ${method}.${procedure}`)

      // Reactive value of the procedure result
      const _data = shallowRef(initialData)
      const data = readonly(_data)
      // Reactive value of the procedure error
      const _error = ref()
      const error = readonly(_error)

      // Pausing will prevent the procedure from executing reactively from args or headers
      // manually calling the procedure will still execute
      const _executing = ref(false)
      const executing = readonly(_executing)
      const paused = ref(false)
      const pause = () => (paused.value = true)
      const unpause = () => (paused.value = false)
      const abortController = ref<AbortController>()

      // Get the procedure from the client using the dot notation path
      const path = procedure.split('.')
      const fn = path.reduce<any>((acc, curr) => acc[curr], client) as any

      // Internal execution function will call the procedure.
      // we protect this behind a scheduler so that procedures are not executed
      // multiple times within the same tick
      const _execute = async () => {
        try {
          const _args = areArgsFn ? await (args as MaybeAsyncFn)() : args
          // Allow args fn to opt out of running the tRPC procedure by returning an undefined
          if (areArgsFn && _args === undefined) return

          abortController.value = new AbortController()
          _data.value = (await fn[method](_args, { signal: abortController.value.signal })) as UnwrapRef<O>
        } catch (e) {
          // if (!config.silent) console.error(e)
          _error.value = e
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
      if (headers && !areHeadersAsyncFn && shouldTrackHeaderReactivity) {
        watch(areHeadersFn ? () => headers() : headers, () => {
          if (!paused.value) execute()
        })
      }

      // Watch for changes in args
      if (args && !areArgsAsyncFn && shouldTrackReactiveArgs) {
        watch(areArgsFn ? () => (args as Fn)() : args, () => {
          if (!paused.value) execute()
        })
      }

      let immediatePromise: Promise<boolean> | undefined
      const result = {
        data,
        reset: () => (_data.value = initialData),
        clear: () => (_data.value = undefined),
        error,
        execute,
        executing,
        pause,
        unpause,
        paused,
        abortController,
        immediatePromise,
      }

      if (immediate) {
        result.immediatePromise = new Promise(async (resolve) => {
          await execute()
          resolve(true)
        })
      }

      // Abort request on unmount / scope disposal
      if (getCurrentScope()) onScopeDispose(() => abortController.value?.abort())

      return result
    }
  }

  // Query and Mutation composables use the exact same logic
  const useQuery = createProcedureHandler('query')
  const useMutation = createProcedureHandler('mutation')

  // Subscription composable requires lookups for the resulting data that is emitted from the server
  // as well as socket reconnect logic. It also provides both reactive properties and callback handlers.
  // Though reactive data is preferred the callback maybe be needed if your socket messages are the same
  // but still require action. For example the server only emits a `ping` every 10 seconds, the
  // reactive property would only update once, whereas the callback would be triggered for each message.

  /**
   * useSubscription composable to subscribe to a topic and reactively receive data
   *
   * @param topic dot notation path to the topic you want to subscribe to
   * @param args input arguments to pass when subscribing
   * @param subscriptionConfig.onData callback function that will be called for each message
   * @param subscriptionConfig.onError callback function that will be called if an error occurs
   * @param subscriptionConfig.onComplete callback function that will be called when a subscription is completed
   * @param subscriptionConfig.onStarted callback function that will be called when a subscription is started
   * @param subscriptionConfig.onStopped callback function that will be called when a subscription is stopped
   * @param subscriptionConfig.initialData initial data to use for the reactive data property
   * @param subscriptionConfig.immediate immediately subscribe to this topic (default true)
   * @param subscriptionConfig.reactive force reactivity tracking on or off for the subscription arguments
   * @returns
   */
  const useSubscription = <
    P extends inferProcedureNames<Router, 'subscription'>,
    I extends inferProcedureInput<inferProcedureValues<Router, P>> = inferProcedureInput<
      inferProcedureValues<Router, P>
    >,
    O extends inferProcedureValues<Router, P>['_def']['_output_out'] = inferProcedureValues<
      Router,
      P
    >['_def']['_output_out'],
    R extends [any, any] = O extends Observable<infer O, infer E> ? [O, E] : [never, never]
  >(
    topic: P,
    ...[args, subscriptionConfig]: undefined extends I
      ? [args?: SubscriptionArgs<I>, subscriptionConfig?: UseSubscriptionConfig<R[0], R[1]>]
      : [args: SubscriptionArgs<I>, subscriptionConfig?: UseSubscriptionConfig<R[0], R[1]>]
  ) => {
    subscriptionConfig = subscriptionConfig || {}
    const { initialData, initialError, reactive } = subscriptionConfig
    let { onData, onError, onComplete, onStarted, onStopped, immediate } = subscriptionConfig

    // Lets default to immediately subscribing to the topic
    if (immediate === undefined) immediate = true
    // Reactive data with the latest result from the subscription topic
    // Seeded with initial data if provided
    const _data = shallowRef(initialData)
    const data = readonly(_data)
    // Reactive error with the latest error from the subscription topic
    const _error = shallowRef(initialError)
    const error = readonly(_error)
    // Reactive boolean indicating if the subscription is currently started
    const _state = ref<SubscriptionState>('created')
    const state = readonly(_state)

    // Convert the dot notation path back into a subscription resolver
    const path = topic.split('.')
    const resolver = path.reduce<any>((acc, curr) => acc[curr], client) as {
      subscribe: (input: void | undefined, opts: TRPCSubscriptionObserver<R[0], R[1]>) => Unsubscribable
    }

    const hasArgsFn = typeof args === 'function'
    const trackReactiveArgs = reactive === true ? true : reactive === false ? false : args && isReactive(args)
    const paused = ref(false)
    const pause = () => (paused.value = true)
    const unpause = () => (paused.value = false)

    let _unsubscribe: Unsubscribable['unsubscribe'] | undefined
    const _subscribed = ref(false)
    const subscribed = readonly(_subscribed)
    // We wrap this in a function so we can immediately execute it
    // but also run the exact same code if reactive arguments change
    const _subscribe = () => {
      if (_subscribed.value) return

      const _args = hasArgsFn ? (args as Fn)() : args
      const { unsubscribe } = resolver.subscribe(_args, {
        onData(value) {
          _data.value = value
          if (onData) onData(value)
        },
        onError(value) {
          if (!connected.value) _subscribed.value = false
          _error.value = value
          if (onError) onError(value)
        },
        onComplete() {
          _state.value = 'completed'
          if (onComplete) onComplete()
        },
        onStarted() {
          _state.value = 'started'
          if (onStarted) onStarted()
        },
        onStopped() {
          _state.value = 'stopped'
          if (onStopped) onStopped()
        },
      })
      _subscribed.value = true

      return () => {
        unsubscribe()
        _subscribed.value = false
      }
    }
    // Here we mask the original subscribe function with our own public version
    // so we can assure that the unsubscribe function is always available and up to date
    const subscribe = () => (_unsubscribe = _subscribe())
    const unsubscribe = () => _unsubscribe && _unsubscribe()
    const resubscribe = async () => {
      unsubscribe()
      await nextTick()
      subscribe()
    }

    // Make it so 👉
    if (immediate) subscribe()

    // Cleanup on scope disposal
    if (getCurrentScope())
      onScopeDispose(() => {
        onData = onError = onComplete = onStarted = onStopped = undefined
        unsubscribe && unsubscribe()
      })

    // Watch for changes in args and resubscribe with new args
    if (args && trackReactiveArgs) {
      watch(hasArgsFn ? () => (args as Fn)() : args, async () => {
        if (paused.value || !_subscribed.value) return

        await resubscribe()
      })
    }

    // Watch for changes in connection state and resubscribe if needed
    // Handling this in the composable for now as we wait for
    // https://github.com/trpc/trpc/issues/2776 to get solved
    let hasEverConnected: boolean
    watch(
      connected,
      (current, previous) => {
        if (hasEverConnected && current && !previous) subscribe()
        if (!hasEverConnected && current) hasEverConnected = true
      },
      { immediate: true }
    )

    return { data, error, subscribe, unsubscribe, resubscribe, subscribed, state, paused, pause, unpause }
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
