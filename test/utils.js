const { before } = require('mocha')

const express = require('express')
const { ApolloServer } = require('apollo-server-express')
const { InMemoryLRUCache } = require('apollo-server-caching')
const request = require('supertest')

const { ResolverCacheDataSource } = require('../')

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

module.exports.setup = function (context) {
  before(async function () {
    const cache = context.cache || new InMemoryLRUCache()
    const server = new ApolloServer({
      typeDefs: context.typeDefs,
      resolvers: context.resolvers,
      cache,
      dataSources: () => {
        return {
          autoResolver: new ResolverCacheDataSource({
            defaultTTL: 100,
          }),
        }
      },
      context: async () => {
        return context.context || null
      },
    })

    const app = express()
    server.applyMiddleware({ app })
    context.client = mkClient(app)
    context.cache = cache
  })
}
