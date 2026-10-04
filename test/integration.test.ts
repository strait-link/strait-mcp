/**
 * End to end: the real MCP server over stdio (a child process, as Claude Code or Cursor
 * would run it) against a real local Strait engine (createApp + the in-memory store from
 * the sibling redirect-engine checkout). Creates a link and reads it back through MCP.
 * ENGINE_DIR overrides the engine location (default ../redirect-engine).
 */
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = resolve(import.meta.dirname, '..');
const ENGINE = resolve(process.env.ENGINE_DIR ?? resolve(ROOT, '../redirect-engine'));
const haveEngine = existsSync(resolve(ENGINE, 'src/app.ts')) && existsSync(resolve(ENGINE, 'node_modules/express'));
const SECRET = 'st_live_test_mcpintegration';

type TextResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

describe.skipIf(!haveEngine)('MCP server over stdio against a local engine', () => {
  let server: Server;
  let base: string;
  let client: Client;
  let hasAnalytics = false;

  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as TextResult;
    return { r, json: r.isError ? null : JSON.parse(r.content[0]!.text) };
  };

  beforeAll(async () => {
    const { createApp } = await import(resolve(ENGINE, 'src/app.ts'));
    const { MemoryStore } = await import(resolve(ENGINE, 'src/store/memory-store.ts'));
    const { hashApiKey } = await import(resolve(ENGINE, 'src/core/apikey.ts'));
    const { openapiSpec } = await import(resolve(ENGINE, 'src/core/openapi.ts'));
    hasAnalytics = '/v1/analytics' in (openapiSpec('http://x') as { paths: object }).paths;
    const store = new MemoryStore();
    store.addTenant(
      { id: 'ten_mcp', name: 'MCP test', publishableKey: 'st_pub_test_mcpintegration', config: { androidBundleId: 'com.acme.shop', androidScheme: 'acme', fallbackUrl: 'https://shop.example.com' } },
      ['127.0.0.1'],
    );
    store.apiKeys.push({ id: 'k_mcp', tenantId: 'ten_mcp', keyHash: hashApiKey(SECRET) });
    const app = createApp(store, { platformHosts: ['127.0.0.1'], matchRateLimit: { capacity: 0, refillPerSec: 0 } });
    server = await new Promise<Server>((ok) => {
      const s = app.listen(0, '127.0.0.1', () => ok(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    client = new Client({ name: 'strait-integration-test', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', resolve(ROOT, 'src/stdio.ts')],
        cwd: ROOT,
        env: { ...(process.env as Record<string, string>), STRAIT_SECRET_KEY: SECRET, STRAIT_API_URL: base },
        stderr: 'pipe',
      }),
    );
  });

  afterAll(async () => {
    await client?.close();
    await new Promise((ok) => server?.close(ok));
  });

  it('lists the ten tools with their schemas', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['batch_create_links', 'check_app_links', 'create_link', 'get_analytics', 'get_link', 'list_links', 'search_docs', 'simulate_tap', 'trace_tap', 'update_link'],
    );
    const create = tools.find((t) => t.name === 'create_link')!;
    expect(create.inputSchema.required).toEqual(expect.arrayContaining(['slug', 'longUrl']));
    expect(tools.find((t) => t.name === 'update_link')!.annotations?.destructiveHint).toBe(true);
  });

  it('server instructions carry the key rules', () => {
    expect(client.getInstructions()).toMatch(/Never put it in app or website code/);
  });

  it('creates a link and reads it back', async () => {
    const created = await call('create_link', { slug: 'mcp-summer', longUrl: 'https://shop.example.com/sale/summer', title: 'Summer sale', tags: ['mcp'] });
    expect(created.r.isError).toBeFalsy();
    expect(created.json).toMatchObject({ slug: 'mcp-summer', longUrl: 'https://shop.example.com/sale/summer', title: 'Summer sale' });
    expect(created.json.shortUrl).toMatch(/\/mcp-summer$/);

    const got = await call('get_link', { slug: 'mcp-summer' });
    expect(got.json).toMatchObject({ id: created.json.id, slug: 'mcp-summer', tags: ['mcp'] });

    const listed = await call('list_links', { limit: 10 });
    expect(listed.json.links.map((l: { slug: string }) => l.slug)).toContain('mcp-summer');
  });

  it('a duplicate slug comes back as a tool error, not a crash', async () => {
    const dup = await call('create_link', { slug: 'mcp-summer', longUrl: 'https://shop.example.com/x' });
    expect(dup.r.isError).toBe(true);
    expect(dup.r.content[0]!.text).toMatch(/409/);
  });

  it('batch-creates links', async () => {
    const b = await call('batch_create_links', { links: [{ slug: 'mcp-a', longUrl: 'https://shop.example.com/a' }, { slug: 'mcp-summer', longUrl: 'https://shop.example.com/b' }] });
    expect(b.json.summary).toEqual({ total: 2, created: 1, failed: 1 });
  });

  it('update_link previews first, then applies with confirm', async () => {
    const preview = await call('update_link', { slug: 'mcp-summer', longUrl: 'https://shop.example.com/sale/winter' });
    expect(preview.json).toMatchObject({ preview: true, applied: false, current: { longUrl: 'https://shop.example.com/sale/summer' } });
    expect((await call('get_link', { slug: 'mcp-summer' })).json.longUrl).toBe('https://shop.example.com/sale/summer');

    const applied = await call('update_link', { slug: 'mcp-summer', longUrl: 'https://shop.example.com/sale/winter', confirm: true });
    expect(applied.json).toMatchObject({ applied: true, link: { longUrl: 'https://shop.example.com/sale/winter' } });
    expect((await call('get_link', { slug: 'mcp-summer' })).json.longUrl).toBe('https://shop.example.com/sale/winter');
  });

  it('simulates and traces taps on the link', async () => {
    const sim = await call('simulate_tap', { slug: 'mcp-summer', ua: 'android' });
    expect(sim.r.isError).toBeFalsy();
    expect(sim.json.decision).toBeTruthy();
    expect(sim.json.platform).toBe('android');
    const trace = await call('trace_tap', { slug: 'mcp-summer' });
    expect(trace.json.rows).toHaveLength(9);
    expect(trace.json.rows.find((r: { preset: string }) => r.preset === 'bot').decision).toBe('preview');
  });

  it('reads analytics (when the engine has GET /v1/analytics)', async () => {
    const a = await call('get_analytics', { group: 'channel' });
    if (!hasAnalytics) {
      expect(a.r.isError).toBe(true); // older engine: 404
      return;
    }
    expect(a.r.isError).toBeFalsy();
    expect(a.json).toMatchObject({ group: 'channel', timezone: 'UTC', totals: { taps: 0 } });
  });

  it('search_docs answers offline', async () => {
    const s = await call('search_docs', { query: 'React Native onLink' });
    expect(s.json.results.length).toBeGreaterThan(0);
  });
});
