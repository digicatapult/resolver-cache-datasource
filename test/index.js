const { before, after, describe, it } = require('mocha')
const { gql } = require('apollo-server-express')
const { expect } = require('chai')
const sinon = require('sinon')

const { setup } = require('./utils')

const { withCaching } = require('../')

const simpleTypeDefs = gql`
  type Query {
    As: [A!]!
    Bs: [B!]!
  }

  type A {
    prop1: Int!
    prop2: String!
  }

  type B {
    As: [A!]!
  }
`

const simpleQuery = `query {
  As {
    prop1
    prop2
  }
}`

const simpleExpect = {
  data: {
    As: [
      {
        prop1: 2,
        prop2: '2',
      },
      {
        prop1: 4,
        prop2: '4',
      },
      {
        prop1: 6,
        prop2: '6',
      },
    ],
  },
}

const missExpect = {
  data: {
    As: [
      {
        prop1: 4,
        prop2: '4',
      },
      {
        prop1: 8,
        prop2: '8',
      },
      {
        prop1: 12,
        prop2: '12',
      },
    ],
  },
}

describe('ResolverCacheDataSource', function () {
  describe('empty cache', function () {
    const context = {
      typeDefs: simpleTypeDefs,
      resolvers: {
        Query: {
          As: () => [1, 2, 3],
        },
        A: {
          prop1: withCaching({
            resolve: (i) => 2 * i,
            cacheKeyItems: (i) => i,
          }),
          prop2: withCaching({
            resolve: (i) => '' + 2 * i,
            cacheKeyItems: (i) => i,
          }),
        },
      },
    }
    setup(context)

    it('should query the resolvers when there is nothing in the cache', async function () {
      const res = await context.client.query({
        query: simpleQuery,
        variables: [],
      })

      expect(res).to.deep.equal(simpleExpect)
    })
  })

  describe('cache hit', function () {
    let mul = 1
    const context = {
      typeDefs: simpleTypeDefs,
      resolvers: {
        Query: {
          As: () => [1, 2, 3],
        },
        A: {
          prop1: withCaching({
            resolve: (i) => 2 * i * mul,
            cacheKeyItems: (i) => i,
          }),
          prop2: withCaching({
            resolve: (i) => '' + 2 * i * mul,
            cacheKeyItems: (i) => i,
          }),
        },
      },
    }
    setup(context)

    it('should query the resolvers when there is nothing in the cache', async function () {
      const resA = await context.client.query({
        query: simpleQuery,
        variables: [],
      })
      // mutate mul to change the result in the resolver
      mul = mul + 1
      // requery
      const resB = await context.client.query({
        query: simpleQuery,
        variables: [],
      })

      // should get original result
      expect(resB).to.deep.equal(resA)
    })
  })

  describe('caching within query', function () {
    const propResolverFn = sinon.spy((i) => 2 * i)
    const context = {
      propResolverFn,
      typeDefs: simpleTypeDefs,
      resolvers: {
        Query: {
          As: () => [1, 2, 3],
          Bs: () => [{ As: [1, 2] }, { As: [3] }],
        },
        A: {
          prop1: withCaching({
            resolve: propResolverFn,
            cacheKeyItems: (i) => i,
          }),
        },
      },
    }
    setup(context)

    it('should query the resolvers when there is nothing in the cache', async function () {
      const res = await context.client.query({
        query: `
          query {
            As {
              prop1
            }
            Bs {
              As {
                prop1
              }
            }
          }
        `,
        variables: [],
      })

      expect(res).to.deep.equal({
        data: {
          As: [{ prop1: 2 }, { prop1: 4 }, { prop1: 6 }],
          Bs: [{ As: [{ prop1: 2 }, { prop1: 4 }] }, { As: [{ prop1: 6 }] }],
        },
      })
      expect(context.propResolverFn.callCount).to.equal(3)
    })
  })

  describe('cache miss (cacheBuster)', function () {
    let mul = 1
    const context = {
      typeDefs: simpleTypeDefs,
      resolvers: {
        Query: {
          As: () => [1, 2, 3],
        },
        A: {
          prop1: withCaching({
            resolve: (i) => 2 * i * mul,
            cacheKeyItems: (i) => i,
          }),
          prop2: withCaching({
            resolve: (i) => '' + 2 * i * mul,
            cacheKeyItems: (i) => i,
          }),
        },
      },
    }
    setup(context)

    it('should query the resolvers when there is nothing in the cache', async function () {
      // query to warm the cache
      await context.client.query({
        query: simpleQuery,
        variables: [],
      })
      // mutate mul to change the result in the resolver
      mul = mul + 1

      // delete the cacheBuster
      await context.cache.delete('cacheBuster')
      // re-setup the client which will create a new cacheBuster
      setup(context)
      // requery
      const res = await context.client.query({
        query: simpleQuery,
        variables: [],
      })

      // should get original result
      expect(res).to.deep.equal(missExpect)
    })
  })

  describe('cache miss (default ttl)', function () {
    let mul = 1
    const context = {
      typeDefs: simpleTypeDefs,
      resolvers: {
        Query: {
          As: () => [1, 2, 3],
        },
        A: {
          prop1: withCaching({
            resolve: (i) => 2 * i * mul,
            cacheKeyItems: (i) => i,
          }),
          prop2: withCaching({
            resolve: (i) => '' + 2 * i * mul,
            cacheKeyItems: (i) => i,
          }),
        },
      },
    }
    setup(context)

    before(function () {
      context.timer = sinon.useFakeTimers()
    })

    after(function () {
      context.timer.restore()
    })

    it('should query the resolvers when there is nothing in the cache', async function () {
      await context.client.query({
        query: simpleQuery,
        variables: [],
      })
      // mutate mul to change the result in the resolver
      mul = mul + 1

      context.timer.tick(101 * 1000) // 101s

      // requery
      const res = await context.client.query({
        query: simpleQuery,
        variables: [],
      })

      // should get original result
      expect(res).to.deep.equal(missExpect)
    })
  })

  describe('cache hit (override ttl)', function () {
    let mul = 1
    const context = {
      typeDefs: simpleTypeDefs,
      resolvers: {
        Query: {
          As: () => [1, 2, 3],
        },
        A: {
          prop1: withCaching({
            resolve: (i) => 2 * i * mul,
            cacheKeyItems: (i) => i,
            ttl: 200,
          }),
          prop2: withCaching({
            resolve: (i) => '' + 2 * i * mul,
            cacheKeyItems: (i) => i,
            ttl: 200,
          }),
        },
      },
    }
    setup(context)

    before(function () {
      context.timer = sinon.useFakeTimers()
    })

    after(function () {
      context.timer.restore()
    })

    it('should query the resolvers when there is nothing in the cache', async function () {
      const resA = await context.client.query({
        query: simpleQuery,
        variables: [],
      })
      // mutate mul to change the result in the resolver
      mul = mul + 1

      context.timer.tick(101 * 1000) // 101s

      // requery
      const resB = await context.client.query({
        query: simpleQuery,
        variables: [],
      })

      // should get original result
      expect(resB).to.deep.equal(resA)
    })
  })
})
