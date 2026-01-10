import type { PostGraphileOptions } from 'postgraphile';

export const postgraphileOptions: PostGraphileOptions = {
  graphiql: true,
  enhanceGraphiql: true,
  watchPg: true,
  dynamicJson: true,
  disableDefaultMutations: false,
  allowExplain: true,
  enableQueryBatching: true,
  ignoreRBAC: true,
  ignoreIndexes: true,
  extendedErrors: ['hint', 'detail', 'errcode'],
};


