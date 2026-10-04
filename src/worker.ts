/**
 * Remote MCP server on Cloudflare Workers (planned at mcp.strait.link). NOT DEPLOYED:
 * every request gets 404 unless the REMOTE_MCP var is "on" (wrangler.jsonc keeps it "off").
 *
 * Two ways in, both on POST /mcp (Streamable HTTP, stateless, JSON responses):
 *  1. Bearer-key mode: `Authorization: Bearer st_live_…` — a secret key, used as-is.
 *  2. OAuth (scaffold, @cloudflare/workers-oauth-provider): the client registers itself
 *     (/register), sends the user to /authorize, gets a token from /token. Today the consent
 *     page asks the user to paste a secret key, which is verified against the API and kept
 *     encrypted in the grant (the provider encrypts props with the token). Replacing that
 *     page with a dashboard sign-in that mints a scoped key is the next step.
 */
import { OAuthProvider, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { StraitClient, isSecretKey } from './client.js';
import { createStraitServer, SERVER_VERSION } from './server.js';

export interface Env {
  /** "on" enables the server; anything else answers 404 everywhere. */
  REMOTE_MCP?: string;
  STRAIT_API_URL?: string;
  /** This server's public origin (RFC 9728 resource id = <origin>/mcp). Default https://mcp.strait.link. */
  MCP_ORIGIN?: string;
  OAUTH_KV: KVNamespace;
  /** Injected by OAuthProvider. */
  OAUTH_PROVIDER: OAuthHelpers;
}

interface GrantProps {
  secretKey: string;
}

const USER_AGENT = `strait-mcp/${SERVER_VERSION} (remote)`;

/** One stateless MCP exchange for this request, as the given key. */
export async function handleMcp(request: Request, secretKey: string, env: Pick<Env, 'STRAIT_API_URL'>): Promise<Response> {
  const client = new StraitClient({ apiUrl: env.STRAIT_API_URL, secretKey, userAgent: USER_AGENT });
  const server = createStraitServer(client);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

const apiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const props = (ctx as ExecutionContext & { props?: GrantProps }).props;
    if (!props?.secretKey) return new Response('Unauthorized', { status: 401 });
    return handleMcp(request, props.secretKey, env);
  },
};

/** A stable grant owner id derived from the key (no key material, no ':' — the token format reserves it). */
async function keyUserId(secretKey: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secretKey)));
  return `key-${[...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function consentPage(clientName: string, error?: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Strait</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 16px;color:#070A10;background:#fff}
@media (prefers-color-scheme:dark){body{color:#F3F5F8;background:#0A0E15}input{background:#151B26;color:#F3F5F8}}
input{width:100%;padding:.6rem;font:inherit;border:1px solid #888;border-radius:6px;box-sizing:border-box}
button{margin-top:1rem;padding:.6rem 1.2rem;font:inherit;border:0;border-radius:6px;background:#FF6A13;color:#070A10;font-weight:600}
.err{color:#c62828}</style></head><body>
<h1>Connect ${esc(clientName)} to Strait</h1>
<p>${esc(clientName)} will be able to create and update links and read analytics in your workspace.</p>
<p>Paste a secret key from Dashboard → Settings → Secret keys (it starts with <code>st_live_</code>). It is checked with Strait and stored encrypted with this connection.</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post"><label for="k">Secret key</label><input id="k" name="secretKey" autocomplete="off" required pattern="st_(live|test)_.+">
<button type="submit">Connect</button></form></body></html>`;
  return new Response(html, { status: error ? 400 : 200, headers: { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY' } });
}

/** /authorize (consent) and everything that is not the API. The provider serves /token and /register itself. */
const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/authorize') return new Response('Not found', { status: 404 });
    // The auth request is re-parsed from the query string on both GET and POST (the form posts
    // back to the same URL), so nothing about the client or redirect comes from the form body.
    const authReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    const client = await env.OAUTH_PROVIDER.lookupClient(authReq.clientId);
    const clientName = client?.clientName || 'This app';
    if (request.method === 'GET') return consentPage(clientName);
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const form = await request.formData();
    const secretKey = String(form.get('secretKey') ?? '').trim();
    if (!isSecretKey(secretKey)) return consentPage(clientName, 'That is not a secret key. It starts with st_live_ (a publishable key, st_pub_…, will not work).');
    try {
      await new StraitClient({ apiUrl: env.STRAIT_API_URL, secretKey, userAgent: USER_AGENT }).listLinks({ limit: 1 });
    } catch {
      return consentPage(clientName, 'Strait did not accept that key. Check it in Dashboard → Settings → Secret keys (a key is shown only once; create a new one if needed).');
    }
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: authReq,
      userId: await keyUserId(secretKey),
      metadata: { label: clientName },
      scope: authReq.scope,
      props: { secretKey } satisfies GrantProps,
    });
    return Response.redirect(redirectTo, 302);
  },
};

const providers = new Map<string, OAuthProvider<Env>>();
function providerFor(origin: string): OAuthProvider<Env> {
  let p = providers.get(origin);
  if (!p) {
    p = new OAuthProvider<Env>({
      apiRoute: '/mcp',
      apiHandler,
      defaultHandler,
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/token',
      clientRegistrationEndpoint: '/register',
      scopesSupported: ['links', 'analytics'],
      resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], resource_name: 'Strait' },
    });
    providers.set(origin, p);
  }
  return p;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (env.REMOTE_MCP !== 'on') return new Response('Not found', { status: 404 });
    const url = new URL(request.url);
    const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (url.pathname === '/mcp' && bearer && isSecretKey(bearer)) return handleMcp(request, bearer, env);
    return providerFor((env.MCP_ORIGIN ?? 'https://mcp.strait.link').replace(/\/+$/, '')).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
