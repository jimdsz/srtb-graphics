import { onRequest } from './router';

// Pages advanced mode: every route, including immutable library assets, goes through auth.
// There is no pass-through-on-exception path to private static assets.
export default {
  async fetch(request, env, context) {
    return onRequest({
      request, env, params: {}, data: {}, functionPath: '/',
      waitUntil: promise => context.waitUntil(promise),
      passThroughOnException: () => { throw Error('Public fallback is forbidden.'); },
      next: input => env.ASSETS.fetch(input??request),
    });
  },
} satisfies ExportedHandler<Env & { ASSETS: Fetcher }>;
