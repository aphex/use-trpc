import type { inferAsyncReturnType } from '@trpc/server'
import { initTRPC } from '@trpc/server'
import { createHTTPServer } from '@trpc/server/adapters/standalone'
import { z } from 'zod'
import Chance from 'chance'

const chance = new Chance()

const PORT = 8080

const createContext = () => ({})
type Context = inferAsyncReturnType<typeof createContext>

const t = initTRPC.context<Context>().create()
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
})

export type Router = typeof router

const { listen } = createHTTPServer({
  router,
  createContext,
})

console.log(`🚀 tRPC listening on port ${PORT}`)
listen(PORT)
