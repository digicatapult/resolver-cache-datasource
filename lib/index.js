import { RESTDataSource } from '@apollo/datasource-rest'
import { randomBytes } from 'crypto'

class ResolverCacheDataSource extends RESTDataSource {
  constructor({ defaultTTL, cacheBusterKeyName = 'cacheBuster' }) {
    super()
    this.defaultTTL = defaultTTL
    this.cacheBusterKeyName = cacheBusterKeyName
  }

  initialize(config) {
    this.cache = config.cache
    console.log(cache)
    // local cache for the duration of a single query
    this.localCache = new Map()
  }

  async resolve(cacheKey, mkResultP, { ttl } = {}) {
    await this.assertCacheBuster()

    // build full cache key
    const fullKey = `${this.cacheBuster}-` + cacheKey
    // if local cache has key return that
    if (this.localCache.has(fullKey)) {
      return this.localCache.get(fullKey)
    } else {
      // check if it's in the cross query cache
      const cached = await this.cache.get(fullKey)

      // if so set in the local cache
      if (cached) {
        const res = JSON.parse(cached)
        this.localCache.set(fullKey, res)
        return res
      } else {
        // again check local cache (it may have been filled while we checked the main cache)
        if (this.localCache.has(fullKey)) {
          return this.localCache.get(fullKey)
        } else {
          // if it's not there build a result promise synchronously and set in local cache
          // we only want to run the resolver ONCE for a given cacheKey
          const resultP = mkResultP()
          this.localCache.set(fullKey, resultP)

          const result = await resultP
          await this.cache.set(fullKey, JSON.stringify(result), {
            ttl: ttl || this.defaultTTL,
          })
          return result
        }
      }
    }
  }

  async assertCacheBuster() {
    if (!this.cacheBuster) {
      if (!this.cbPromise) {
        this.cbPromise = this.cache.get(this.cacheBusterKeyName).then((cacheBuster) => {
          if (!cacheBuster) return this.reset()
          else return cacheBuster
        })
      }
      this.cacheBuster = await this.cbPromise
      delete this.cbPromise
    }
  }

  async reset() {
    this.cacheBuster = randomBytes(20).toString('hex')
    await this.cache.set(this.cacheBusterKeyName, this.cacheBuster)
    return this.cacheBuster
  }
}

const buildCacheKeyInner = (arr) => {
  if (Array.isArray(arr)) {
    return arr.map(buildCacheKeyInner)
  } else {
    return '' + arr // cast to string
  }
}
const buildCacheKey = (arr) => JSON.stringify(buildCacheKeyInner(arr), null, 0)

const withCaching =
  ({ resolve, cacheKeyItems, ttl }) =>
  async (obj, args, context, info) => {
    const dataSource = context.dataSources.autoResolver

    // prepend cache key with the type route to ensure namespaces don't collide
    const cacheKey = buildCacheKey([[info.parentType.name, info.fieldName], cacheKeyItems(obj, args, context)])

    return dataSource.resolve(cacheKey, () => resolve(obj, args, context, info), { ttl })
  }

export { ResolverCacheDataSource, withCaching }
