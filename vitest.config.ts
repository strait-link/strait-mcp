import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // @cloudflare/workers-oauth-provider imports the Workers runtime module; tests run in Node.
    alias: { 'cloudflare:workers': new URL('./test/stubs/cloudflare-workers.ts', import.meta.url).pathname },
  },
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // inline it so the alias above applies inside the package too
    server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } },
  },
});
