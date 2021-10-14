# Resolver Cache DataSource

`resolver-cache-datasource` implements an [Apollo DataSource](https://www.apollographql.com/docs/apollo-server/data/data-sources/) for caching the results of an Apollo resolver based on a user provided cache-key method. Caching is applied by decorating a query resolver function.
