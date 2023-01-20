import { before } from 'mocha'

import express from 'express'
import { ApolloServer } from '@apollo/server'
import { InMemoryLRUCache } from '@apollo/utils.keyvaluecache'
import request from 'supertest'
import { expressMiddleware } from '@apollo/server/express4'
import cors from 'cors'
import { ResolverCacheDataSource } from '../lib/index.js'

function mkClient(express) {
  const app = request(express)
  const client = async ({ data }) => {
    let req = app.post('/graphql')
    req = req.set('Content-Type', 'application/json').send(data)
    const res = await req

    if (res.body.errors) {
      throw res.body.errors
    }
    return res.body
  }
  return {
    query: ({ query, variables }) => client({ data: { query, variables } }),
  }
}

export function setup(context) {
  before(async function () {
    const cache = context.cache || new InMemoryLRUCache()
    const server = new ApolloServer({
      typeDefs: context.typeDefs,
      resolvers: context.resolvers,
      cache,
    })

    const app = express()

    await server.start()
    app.use(
      '/graphql',
      cors(),
      express.json(),
      expressMiddleware(server, {
        context: async ({ req }) => ({
          token: req.headers.token,
          dataSources: {
            autoResolver: new ResolverCacheDataSource({
              cache,
              defaultTTL: 100,
            }),
          },
        }),
      })
    )
    context.client = mkClient(app)
    context.cache = cache
  })
}
