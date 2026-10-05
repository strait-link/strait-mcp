#!/usr/bin/env node
/**
 * Local MCP server over stdio:  npx @straitlink/mcp   (or node dist/stdio.js)
 * Env:
 *   STRAIT_SECRET_KEY  a secret key (st_live_…) from Dashboard → Settings → Secret keys. Without it only
 *                      check_app_links, search_docs and demo trace_tap work.
 *   STRAIT_API_URL     engine URL, default https://strait.link (e.g. http://localhost:3000 for a local engine)
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StraitClient, isSecretKey } from './client.js';
import { createStraitServer, SERVER_VERSION } from './server.js';

const secretKey = process.env.STRAIT_SECRET_KEY?.trim() || undefined;
if (secretKey && !isSecretKey(secretKey)) {
  // stdout is the protocol channel: diagnostics go to stderr.
  console.error(
    secretKey.startsWith('st_pub_')
      ? 'strait-mcp: STRAIT_SECRET_KEY is a publishable key (st_pub_…). Use a secret key (st_live_…) from Dashboard → Settings → Secret keys.'
      : 'strait-mcp: STRAIT_SECRET_KEY does not look like a Strait secret key (st_live_…).',
  );
  process.exit(1);
}
const client = new StraitClient({
  apiUrl: process.env.STRAIT_API_URL?.trim() || undefined,
  secretKey,
  userAgent: `strait-mcp/${SERVER_VERSION} (stdio)`,
});
const server = createStraitServer(client);
await server.connect(new StdioServerTransport());
if (!secretKey) console.error('strait-mcp: no STRAIT_SECRET_KEY set; link and analytics tools will ask for one.');
