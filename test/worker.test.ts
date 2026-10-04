/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The remote (Cloudflare Workers) entry, run in Node with a stub for the Workers
 * runtime module and an in-memory KV. Not deployed; these check the flag, the
 * bearer-key mode and that the OAuth endpoints are wired.
 */
import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/worker.js';

class MemoryKV {
  private m = new Map<string, string>();
  async get(k: string, type?: string) {
    const v = this.m.get(k);
    return v === undefined ? null : type === 'json' ? JSON.parse(v) : v;
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
    expect(names).toHaveLength(10);
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
});
