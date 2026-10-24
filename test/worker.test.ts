/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The remote (Cloudflare Workers) entry, run in Node with a stub for the Workers
 * runtime module and an in-memory KV. Not deployed; these check the flag, the
 * bearer-key mode and that the OAuth endpoints are wired.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/worker.js';

class MemoryKV {
  private m = new Map<string, string>();
  async get(k: string, opts?: string | { type?: string }) {
    const v = this.m.get(k);
    const type = typeof opts === 'string' ? opts : opts?.type;
    return v === undefined ? null : type === 'json' ? JSON.parse(v) : v;
  }
  values() {
    return [...this.m.values()];
  }
  async put(k: string, v: string) {
    this.m.set(k, v);
  }
  async delete(k: string) {
    this.m.delete(k);
  }
  async list(opts: { prefix?: string } = {}) {
    return { keys: [...this.m.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).map((name) => ({ name })), list_complete: true, cursor: '' };
  }
}

const env = (over: Partial<Env> = {}) => ({ REMOTE_MCP: 'on', STRAIT_API_URL: 'https://api.test', MCP_ORIGIN: 'https://mcp.test', OAUTH_KV: new MemoryKV(), ...over }) as unknown as Env;
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
const rpc = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://mcp.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });

describe('remote MCP worker', () => {
  it('answers 404 everywhere unless REMOTE_MCP is "on"', async () => {
    for (const flag of [undefined, 'off', 'true']) {
      const r = await worker.fetch(rpc({}), env({ REMOTE_MCP: flag }), ctx);
      expect(r.status, String(flag)).toBe(404);
    }
  });

  it('bearer-key mode: a secret key gets the tool list', async () => {
    const auth = { authorization: 'Bearer st_live_test_remote' };
    const init = await worker.fetch(
      rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } }, auth),
      env(),
      ctx,
    );
    expect(init.status).toBe(200);
    expect(((await init.json()) as any).result.serverInfo.name).toBe('strait');
    const list = await worker.fetch(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { ...auth, 'mcp-protocol-version': '2025-06-18' }), env(), ctx);
    expect(list.status).toBe(200);
    const names = ((await list.json()) as any).result.tools.map((t: { name: string }) => t.name);
    expect(names).toHaveLength(30);
    expect(names).toContain('create_link');
  });

  it('a publishable key is not a bearer key: it goes to OAuth, which refuses it', async () => {
    const r = await worker.fetch(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: 'Bearer st_pub_live_nope' }), env(), ctx);
    expect(r.status).toBe(401);
  });

  it('no token: 401 with a pointer to the protected-resource metadata', async () => {
    const r = await worker.fetch(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), env(), ctx);
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate') ?? '').toMatch(/resource_metadata|Bearer/);
  });

  it('serves OAuth discovery metadata for the authorize, token and register endpoints', async () => {
    const r = await worker.fetch(new Request('https://mcp.test/.well-known/oauth-authorization-server'), env(), ctx);
    expect(r.status).toBe(200);
    const meta = (await r.json()) as Record<string, string>;
    expect(meta.authorization_endpoint).toMatch(/\/authorize$/);
    expect(meta.token_endpoint).toMatch(/\/token$/);
    expect(meta.registration_endpoint).toMatch(/\/register$/);
    const pr = await worker.fetch(new Request('https://mcp.test/.well-known/oauth-protected-resource/mcp'), env(), ctx);
    expect(pr.status).toBe(200);
    expect(((await pr.json()) as { resource: string }).resource).toBe('https://mcp.test/mcp');
  });

  it('/healthz answers without an upstream call (post-deploy check)', async () => {
    const r = await worker.fetch(new Request('https://mcp.test/healthz'), env(), ctx);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, service: 'strait-mcp', mcp: 'https://mcp.test/mcp' });
  });

  describe('OAuth consent page', () => {
    const redirect = 'https://client.example/callback';
    async function register(e: Env) {
      const r = await worker.fetch(
        new Request('https://mcp.test/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ client_name: 'Test <Client>', redirect_uris: [redirect], token_endpoint_auth_method: 'none' }),
        }),
        e,
        ctx,
      );
      expect(r.status).toBe(201);
      return ((await r.json()) as { client_id: string }).client_id;
    }
    const authorizeUrl = (clientId: string, redirectUri = redirect) =>
      `https://mcp.test/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=s1&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256`;

    it('shows the client name escaped, where the user goes back to, and anti-framing headers', async () => {
      const e = env();
      const id = await register(e);
      const r = await worker.fetch(new Request(authorizeUrl(id)), e, ctx);
      expect(r.status).toBe(200);
      const html = await r.text();
      expect(html).toContain('Connect Test &lt;Client&gt; to Strait');
      expect(html).toContain('<strong>client.example</strong>');
      expect(r.headers.get('x-frame-options')).toBe('DENY');
      expect(r.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/);
      expect(r.headers.get('cache-control')).toBe('no-store');
    });

    it('a redirect URI the client did not register gets an error page, not a redirect', async () => {
      const e = env();
      const id = await register(e);
      const r = await worker.fetch(new Request(authorizeUrl(id, 'https://evil.example/cb')), e, ctx);
      expect(r.status).toBe(400);
      expect(r.headers.get('location')).toBeNull();
      expect(await r.text()).toMatch(/not valid/);
    });

    it('an unknown client gets an error page', async () => {
      const r = await worker.fetch(new Request(authorizeUrl('nope')), env(), ctx);
      expect(r.status).toBe(400);
    });

    it('Cancel sends access_denied back to the client with its state', async () => {
      const e = env();
      const id = await register(e);
      const body = new URLSearchParams({ action: 'deny' });
      const r = await worker.fetch(new Request(authorizeUrl(id), { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } }), e, ctx);
      expect(r.status).toBe(302);
      const loc = new URL(r.headers.get('location')!);
      expect(loc.origin + loc.pathname).toBe(redirect);
      expect(loc.searchParams.get('error')).toBe('access_denied');
      expect(loc.searchParams.get('state')).toBe('s1');
    });

    afterEach(() => vi.unstubAllGlobals());

    it('full flow: a valid secret key → code → token → tools/list over OAuth', async () => {
      const seen: string[] = [];
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.startsWith('https://api.test/')) {
          seen.push(`${init?.method ?? 'GET'} ${new URL(url).pathname} ${new Headers(init?.headers).get('authorization')}`);
          return Response.json({ links: [], nextCursor: null });
        }
        throw new Error(`unexpected fetch ${url}`);
      });
      const e = env();
      const id = await register(e);
      const body = new URLSearchParams({ action: 'connect', secretKey: 'st_live_valid_key' });
      const r = await worker.fetch(new Request(authorizeUrl(id), { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } }), e, ctx);
      expect(r.status).toBe(302);
      expect(seen).toEqual(['GET /v1/links Bearer st_live_valid_key']);
      const code = new URL(r.headers.get('location')!).searchParams.get('code');
      expect(code).toBeTruthy();
      const tok = await worker.fetch(
        new Request('https://mcp.test/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'authorization_code', code: code!, client_id: id, redirect_uri: redirect, code_verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk' }),
        }),
        e,
        ctx,
      );
      expect(tok.status).toBe(200);
      const t = (await tok.json()) as { access_token: string; expires_in: number; refresh_token?: string };
      expect(t.expires_in).toBe(3600);
      expect(t.refresh_token).toBeTruthy();
      expect(t.access_token).not.toContain('st_live_');
      // The key is kept only inside the encrypted grant: never in plain text in KV.
      expect((e.OAUTH_KV as unknown as MemoryKV).values().join('\n')).not.toContain('st_live_valid_key');
      const list = await worker.fetch(
        rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { authorization: `Bearer ${t.access_token}`, 'mcp-protocol-version': '2025-06-18' }),
        e,
        ctx,
      );
      expect(list.status).toBe(200);
      expect(((await list.json()) as any).result.tools).toHaveLength(30);
    });

    it('a publishable key is refused on the consent form without calling the API', async () => {
      const e = env();
      const id = await register(e);
      const body = new URLSearchParams({ action: 'connect', secretKey: 'st_pub_live_x' });
      const r = await worker.fetch(new Request(authorizeUrl(id), { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } }), e, ctx);
      expect(r.status).toBe(400);
      expect(await r.text()).toMatch(/not a secret key/);
    });
  });
});
