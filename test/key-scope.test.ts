import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createStraitServer, toolsForKey } from '../src/server.js';
import { TOOLS } from '../src/tools.js';
import { mockClient } from './helpers.js';

// A read-only key (engine ADR 0056) is offered only the tools that read; every other case gets them all.
const WORKSPACE = (scope: string) => ({ name: 'Hilltop', handle: 'hilltop', linkBase: 'https://hilltop.strait.link', linkDomain: 'hilltop.strait.link', customDomains: [], plan: 'free', key: { scope, prefix: 'st_live_ab' } });
const READ_NAMES = TOOLS.filter((t) => t.annotations.readOnlyHint).map((t) => t.name);
const WRITES = ['create_link', 'batch_create_links', 'update_link', 'deactivate_link', 'pause_link', 'resume_link', 'record_event', 'add_domain', 'remove_domain', 'test_webhook', 'redeliver_webhook_delivery'];

async function listedFor(respond: Parameters<typeof mockClient>[0], opts?: Parameters<typeof mockClient>[1], timeoutMs?: number) {
  const { client: api, calls } = mockClient(respond, opts);
  const server = createStraitServer(api, await toolsForKey(api, TOOLS, timeoutMs));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'scope-test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { names: (await client.listTools()).tools.map((t) => t.name), calls, client };
}

describe('tools offered by key scope', () => {
  it('a read-only key lists only the tools that read, and a hidden write tool is not callable', async () => {
    const { names, calls, client } = await listedFor(() => ({ body: WORKSPACE('read') }));
    expect(names.sort()).toEqual([...READ_NAMES].sort());
    for (const w of WRITES) expect(names, w).not.toContain(w);
    expect(names).toContain('get_link');
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual(['GET /v1/workspace']);
    const r = (await client.callTool({ name: 'create_link', arguments: { slug: 'x', longUrl: 'https://a.example/x' } })) as { isError?: boolean };
    expect(r.isError).toBe(true);
    expect(calls).toHaveLength(1); // nothing reached the API
  });

  it.each(['full', 'links'])('a %s key lists every tool', async (scope) => {
    const { names } = await listedFor(() => ({ body: WORKSPACE(scope) }));
    expect(names).toHaveLength(TOOLS.length);
    expect(names).toContain('create_link');
  });

  it('offers every tool when the scope cannot be read (older engine 404, links key 403, error, odd body)', async () => {
    for (const r of [{ status: 404, body: { error: 'not_found' } }, { status: 403, body: { error: 'key_scope' } }, { status: 500, body: {} }, { body: { name: 'x' } }, { body: null }]) {
      const { names } = await listedFor(() => r);
      expect(names, JSON.stringify(r)).toHaveLength(TOOLS.length);
    }
  });

  it('offers every tool, without waiting long, when the call hangs', async () => {
    const { client: api } = mockClient(() => ({ body: WORKSPACE('read') }));
    (api as unknown as { getWorkspace: () => Promise<never> }).getWorkspace = () => new Promise(() => {});
    const t0 = Date.now();
    expect(await toolsForKey(api, TOOLS, 50)).toHaveLength(TOOLS.length);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('no secret key: every tool, no API call', async () => {
    const { names, calls } = await listedFor(() => ({ body: WORKSPACE('read') }), {});
    expect(names).toHaveLength(TOOLS.length);
    expect(calls).toHaveLength(0);
  });
});
