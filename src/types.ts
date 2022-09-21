import type { AnyProcedure, AnyRouter, ProcedureType } from '@trpc/server'

export type Fn<T = any> = () => T
export type MaybeAsyncFn<T = any> = () => T | Promise<T>

export type inferProcedureNames<
  R extends AnyRouter,
  T extends ProcedureType,
  P extends R['_def']['procedures'] = R['_def']['procedures'],
  K extends keyof P = keyof P
> = K extends string
  ? P[K] extends AnyProcedure
    ? P[K]['_type'] extends T
      ? K
      : never
    : P[K] extends AnyRouter
    ? `${K}.${inferProcedureNames<P[K], T>}`
    : never
  : never

export type inferProcedureValues<
  T extends AnyRouter,
  P extends inferProcedureNames<T, ProcedureType>
> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? T[K] extends AnyRouter
      ? Rest extends inferProcedureNames<T, ProcedureType>
        ? inferProcedureValues<T[K], Rest>
        : never
      : never
    : never
  : P extends keyof T
  ? T[P] extends AnyProcedure
    ? T[P]
    : never
  : never
