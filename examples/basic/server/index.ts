import type { inferAsyncReturnType } from '@trpc/server'
import { initTRPC } from '@trpc/server'
import { createHTTPServer } from '@trpc/server/adapters/standalone'
import { applyWSSHandler } from '@trpc/server/adapters/ws'
import { observable } from '@trpc/server/observable'
import Chance from 'chance'
import ws from 'ws'
import { z } from 'zod'
import { performance } from 'perf_hooks'

const chance = new Chance()

const PORT = 8080

const createContext = () => ({})
type Context = inferAsyncReturnType<typeof createContext>

const t = initTRPC.context<Context>().create()
const start = performance.now()

const router = t.router({
  getUser: t.procedure
    .input(
      z.object({
        id: z.number(),
      })
    )
    .query(({ input }) => ({
      id: input.id,
      name: chance.name(),
      birthday: chance.birthday(),
      age: chance.age(),
      ssn: chance.ssn(),
      avatar: chance.avatar(),
      address: chance.address(),
      phone: chance.phone(),
      email: chance.email(),
    })),
  uptime: t.procedure.input(z.number()).subscription(({ input: id }) => {
    return observable<{ start: number; uptime: number; id: number }>((emit) => {
      const interval = setInterval(() => {
        const now = performance.now()
        const uptime = now - start

        emit.next({ start, uptime, id })
      }, 1000)

      return () => {
        clearInterval(interval)
      }
    })
  }),
})

export type Router = typeof router

const { server, listen } = createHTTPServer({
  router,
  createContext,
})

const wss = new ws.Server({ server })
applyWSSHandler<Router>({ wss, router, createContext })

console.log(`🚀 tRPC listening on port ${PORT}`)
listen(PORT)
