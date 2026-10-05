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
import { AuthorizationError, OAuthProvider, authorizationErrorRedirect, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
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

/** Headers on every HTML page this Worker serves: no framing (clickjacking), no inline scripts, no referrer. */
const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

const PAGE_STYLE = `body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 16px;color:#070A10;background:#fff}
@media (prefers-color-scheme:dark){body{color:#F3F5F8;background:#0A0E15}input{background:#151B26;color:#F3F5F8}}
input{width:100%;padding:.6rem;font:inherit;border:1px solid #888;border-radius:6px;box-sizing:border-box}
button{margin-top:1rem;margin-right:.5rem;padding:.6rem 1.2rem;font:inherit;border:0;border-radius:6px;background:#FF6A13;color:#070A10;font-weight:600}
button.secondary{background:transparent;color:inherit;border:1px solid #888}
.err{color:#c62828}.muted{opacity:.8;font-size:.9em}`;

/** The host the user is sent back to, shown on the consent page so they can see where the token goes. */
function returnHost(redirectUri: string): string {
  try {
    const u = new URL(redirectUri);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.host : `${u.protocol}//`;
  } catch {
    return 'an unknown address';
  }
}

export function consentPage(clientName: string, redirectUri: string, error?: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Strait</title><style>${PAGE_STYLE}</style></head><body>
<h1>Connect ${esc(clientName)} to Strait</h1>
<p>${esc(clientName)} will be able to create and update links and read analytics in your workspace.</p>
<p>Paste a secret key from Dashboard → Settings → Secret keys (it starts with <code>st_live_</code>). Create a separate key for this connection so you can revoke it on its own. It is checked with Strait and stored encrypted with this connection.</p>
<p class="muted">After you connect, you go back to <strong>${esc(returnHost(redirectUri))}</strong>. Only continue if you started this from ${esc(clientName)}.</p>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
<form method="post"><label for="k">Secret key</label><input id="k" name="secretKey" type="password" autocomplete="off" required pattern="st_(live|test)_.+">
<button type="submit" name="action" value="connect">Connect</button><button type="submit" name="action" value="deny" class="secondary" formnovalidate>Cancel</button></form></body></html>`;
  return new Response(html, { status: error ? 400 : 200, headers: PAGE_HEADERS });
}

/** A request the provider rejected before we know where to send the user back (bad client or redirect URI). */
function errorPage(message: string, status = 400): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Strait: cannot connect</title><style>${PAGE_STYLE}</style></head><body>
<h1>This connection request is not valid</h1><p class="err">${esc(message)}</p>
<p>Start again from your AI tool. If it keeps happening, the tool may be misconfigured.</p></body></html>`;
  return new Response(html, { status, headers: PAGE_HEADERS });
}

/** /authorize (consent), /healthz and /. The provider serves /token, /register and the metadata itself. */
const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/healthz' || url.pathname === '/') {
      // For the post-deploy check (README). No upstream call, no secrets.
      return Response.json({ ok: true, service: 'strait-mcp', version: SERVER_VERSION, mcp: `${url.origin}/mcp` }, { headers: { 'cache-control': 'no-store' } });
    }
    if (url.pathname !== '/authorize') return new Response('Not found', { status: 404 });
    // The auth request is re-parsed from the query string on both GET and POST (the form posts
    // back to the same URL), so nothing about the client or redirect comes from the form body.
    let authReq: Awaited<ReturnType<OAuthHelpers['parseAuthRequest']>>;
    try {
      authReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    } catch (err) {
      if (err instanceof AuthorizationError) {
        // Errors with a verified redirect go back to the client (RFC 6749 4.1.2.1); the rest render here.
        return err.redirectTo ? Response.redirect(err.redirectTo, 302) : errorPage(err.description ?? 'Invalid request.');
      }
      throw err;
    }
    const client = await env.OAUTH_PROVIDER.lookupClient(authReq.clientId);
    const clientName = client?.clientName || 'This app';
    if (request.method === 'GET') return consentPage(clientName, authReq.redirectUri);
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const form = await request.formData();
    if (form.get('action') === 'deny') {
      return Response.redirect(authorizationErrorRedirect(authReq, 'access_denied', 'The user cancelled.'), 302);
    }
    const secretKey = String(form.get('secretKey') ?? '').trim();
    if (!isSecretKey(secretKey)) return consentPage(clientName, authReq.redirectUri, 'That is not a secret key. It starts with st_live_ (a publishable key, st_pub_…, will not work).');
    try {
      await new StraitClient({ apiUrl: env.STRAIT_API_URL, secretKey, userAgent: USER_AGENT }).listLinks({ limit: 1 });
    } catch {
      return consentPage(clientName, authReq.redirectUri, 'Strait did not accept that key. Check it in Dashboard → Settings → Secret keys (a key is shown only once; create a new one if needed).');
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

/** Token lifetimes: short access tokens, refresh for 30 days (then the user connects again). */
export const ACCESS_TOKEN_TTL = 60 * 60;
export const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60;

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
      accessTokenTTL: ACCESS_TOKEN_TTL,
      refreshTokenTTL: REFRESH_TOKEN_TTL,
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
