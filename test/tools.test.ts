import { describe, expect, it } from 'vitest';
import { StraitClient, isSecretKey } from '../src/client.js';
import { searchDocs, tokens } from '../src/docs.js';
import { runTool } from '../src/server.js';
import { TOOLS, TRACE_MATRIX } from '../src/tools.js';
import { LINK, mockClient } from './helpers.js';

const byName = (n: string) => {
  const t = TOOLS.find((x) => x.name === n);
  if (!t) throw new Error(`no tool ${n}`);
  return t;
};
const parse = (r: { content: Array<{ text?: string }> }) => JSON.parse(r.content[0]!.text!);

describe('tool list', () => {
  it('has the ten council tools, the six 0.2 tools, the fourteen 0.3 tools and get_workspace (0.5), each with a description and annotations', () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      'create_link', 'batch_create_links', 'get_link', 'list_links', 'update_link',
      'get_analytics', 'check_app_links', 'simulate_tap', 'trace_tap',
      'get_workspace', 'get_usage', 'get_referrals', 'list_webhook_deliveries', 'test_webhook', 'redeliver_webhook_delivery', 'deactivate_link',
      'pause_link', 'resume_link', 'search_links', 'get_link_qr',
      'compare_analytics', 'get_top_links', 'list_taps', 'list_events', 'record_event',
      'list_domains', 'add_domain', 'remove_domain', 'list_webhooks', 'check_link',
      'search_docs',
    ]);
    for (const t of TOOLS) {
      expect(t.description.length, t.name).toBeGreaterThan(40);
      expect(t.annotations.title, t.name).toBeTruthy();
    }
  });

  it('only the tools that change or remove something live are destructive, and the read tools are read-only', () => {
    expect(TOOLS.filter((t) => t.annotations.destructiveHint).map((t) => t.name)).toEqual(['update_link', 'deactivate_link', 'pause_link', 'remove_domain']);
    for (const n of ['get_link', 'list_links', 'get_analytics', 'check_app_links', 'simulate_tap', 'trace_tap', 'search_docs']) {
      expect(byName(n).annotations.readOnlyHint, n).toBe(true);
    }
  });

  it('descriptions never use the wrong brand spelling or superlatives', () => {
    const text = JSON.stringify(TOOLS.map((t) => [t.name, t.description]));
    expect(text).not.toMatch(/straight|cheapest|cheaper than|\bbest\b|\bonly\b deep|\bfirst\b deep/i);
  });
});

describe('keys', () => {
  it('isSecretKey accepts st_live_/st_test_ and refuses publishable keys', () => {
    expect(isSecretKey('st_live_abc123')).toBe(true);
    expect(isSecretKey('st_test_abc123')).toBe(true);
    expect(isSecretKey('st_pub_live_abc123')).toBe(false);
    expect(isSecretKey('bk_live_abc')).toBe(false);
    expect(isSecretKey(undefined)).toBe(false);
  });

  it('a tool that needs a key says how to set it, and calls nothing', async () => {
    const { client, calls } = mockClient(() => ({ body: LINK }), {});
    const r = await runTool(byName('get_link'), client, { slug: 'summer' });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/STRAIT_SECRET_KEY/);
    expect(calls).toHaveLength(0);
  });

  it('sends the secret key as a Bearer token', async () => {
    const { client, calls } = mockClient(() => ({ body: LINK }));
    await runTool(byName('get_link'), client, { slug: 'summer' });
    expect(calls[0]!.headers.authorization).toBe('Bearer st_live_test_mockkey');
    expect(calls[0]!.url.pathname).toBe('/v1/links/summer');
  });
});

describe('link tools', () => {
  it('create_link posts the link and returns it', async () => {
    const { client, calls } = mockClient(() => ({ status: 201, body: LINK }));
    const r = await runTool(byName('create_link'), client, { slug: 'summer', longUrl: 'https://shop.hilltop.example/summer' });
    expect(r.isError).toBeUndefined();
    expect(parse(r).shortUrl).toBe(LINK.shortUrl);
    expect(calls[0]).toMatchObject({ method: 'POST', body: { slug: 'summer', longUrl: 'https://shop.hilltop.example/summer' } });
  });

  it('API errors become tool errors with the message', async () => {
    const { client } = mockClient(() => ({ status: 409, body: { error: 'slug already exists in this workspace' } }));
    const r = await runTool(byName('create_link'), client, { slug: 'summer', longUrl: 'https://shop.hilltop.example/summer' });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/createLink: slug already exists in this workspace \(HTTP 409\)/);
  });

  it('batch_create_links sends one request', async () => {
    const { client, calls } = mockClient(() => ({ body: { results: [], summary: { total: 2, created: 2, failed: 0 } } }));
    await runTool(byName('batch_create_links'), client, { links: [{ slug: 'a', longUrl: 'https://x.example/a' }, { slug: 'b', longUrl: 'https://x.example/b' }] });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.pathname).toBe('/v1/links/batch');
    expect((calls[0]!.body as { links: unknown[] }).links).toHaveLength(2);
  });

  it('list_links pages with limit and cursor', async () => {
    const { client, calls } = mockClient(() => ({ body: { links: [LINK], nextCursor: null } }));
    await runTool(byName('list_links'), client, { limit: 10, cursor: 'abc' });
    expect(calls[0]!.url.search).toBe('?limit=10&cursor=abc');
  });

  it('update_link without confirm previews and changes nothing', async () => {
    const { client, calls } = mockClient(() => ({ body: LINK }));
    const r = parse(await runTool(byName('update_link'), client, { slug: 'summer', longUrl: 'https://shop.hilltop.example/winter' }));
    expect(r).toMatchObject({ preview: true, applied: false, current: { longUrl: LINK.longUrl }, proposed: { longUrl: 'https://shop.hilltop.example/winter' } });
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('update_link with confirm: true patches', async () => {
    const { client, calls } = mockClient((c) => ({ body: c.method === 'PATCH' ? { ...LINK, longUrl: 'https://shop.hilltop.example/winter' } : LINK }));
    const r = parse(await runTool(byName('update_link'), client, { slug: 'summer', longUrl: 'https://shop.hilltop.example/winter', confirm: true }));
    expect(r.applied).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { longUrl: 'https://shop.hilltop.example/winter' } });
    expect(calls[0]!.body).not.toHaveProperty('confirm');
  });

  it('update_link with nothing to change is an error', async () => {
    const { client } = mockClient(() => ({ body: LINK }));
    const r = await runTool(byName('update_link'), client, { slug: 'summer', confirm: true });
    expect(r.isError).toBe(true);
  });
});

describe('analytics, checks, simulation', () => {
  it('get_analytics passes the range, link and group', async () => {
    const { client, calls } = mockClient(() => ({ body: { totals: {} } }));
    await runTool(byName('get_analytics'), client, { from: '2026-09-01', to: '2026-10-01', link: 'summer', group: 'channel' });
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ from: '2026-09-01', to: '2026-10-01', link: 'summer', group: 'channel' });
  });

  it('check_app_links needs no key and drops the raw file bodies', async () => {
    const report = { domain: 'x.example', android: { status: 'ok', file: { url: 'u', body: '[big]' }, findings: [] }, ios: { status: 'error', file: { body: '{}' }, legacyFile: { body: 'x' }, findings: [{ id: 'ios.json' }] } };
    const { client, calls } = mockClient(() => ({ body: report }), {});
    const r = parse(await runTool(byName('check_app_links'), client, { domain: 'x.example' }));
    expect(calls[0]!.headers.authorization).toBeUndefined();
    expect(r.android.file).toEqual({ url: 'u' });
    expect(r.ios.legacyFile).toEqual({});
    expect(r.ios.findings).toEqual([{ id: 'ios.json' }]);
  });

  it('simulate_tap resolves a slug to its short URL first', async () => {
    const { client, calls } = mockClient((c) => ({ body: c.url.pathname === '/v1/simulate' ? { decision: 'redirect' } : LINK }));
    await runTool(byName('simulate_tap'), client, { slug: 'summer', ua: 'iphone' });
    expect(calls[1]!.url.searchParams.get('url')).toBe(LINK.shortUrl);
    expect(calls[1]!.url.searchParams.get('ua')).toBe('iphone');
  });

  it('trace_tap walks the channel matrix', async () => {
    const { client, calls } = mockClient((c) => ({ body: { decision: c.url.searchParams.get('ua') === 'bot' ? 'preview' : 'redirect', sentTo: 'app_or_store', reason: 'r' } }));
    const r = parse(await runTool(byName('trace_tap'), client, { url: LINK.shortUrl }));
    expect(r.simulated).toBe(true);
    expect(r.rows).toHaveLength(TRACE_MATRIX.length);
    expect(calls.map((c) => c.url.searchParams.get('ua'))).toEqual(TRACE_MATRIX.map((m) => m.preset));
    expect(r.rows.at(-1)).toMatchObject({ channel: 'Link preview bot', decision: 'preview' });
  });

  it('trace_tap with a demo token reads the trace without a key; no tap yet is explained', async () => {
    const { client, calls } = mockClient(() => ({ status: 204 }), {});
    const r = parse(await runTool(byName('trace_tap'), client, { token: 'abcdefghij0123456789' }));
    expect(calls[0]!.url.pathname).toBe('/v1/trace/abcdefghij0123456789');
    expect(r.trace).toBeNull();
  });
});

describe('search_docs', () => {
  it('finds the App Links page for assetlinks questions', () => {
    const hits = searchDocs('assetlinks.json sha256 fingerprint not verifying');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => /app-links|troubleshooting|sdks\/android/.test(h.url))).toBe(true);
    for (const h of hits) expect(h.url).toMatch(/^https:\/\/straitlink\.in\/docs\//);
  });

  it('finds the Firebase migration guide', () => {
    const [top] = searchDocs('migrate from Firebase Dynamic Links page.link');
    expect(top!.url).toMatch(/migrate-from-firebase/);
  });

  // Index rebuilt from the live site (23 Oct 2026): today's install lines, not the 16 Oct git recipe.
  it('answers install questions with the published packages, not the old git dependency', () => {
    const flutter = searchDocs('flutter install strait_sdk pubspec', 8);
    expect(flutter.some((h) => h.markdown.includes('strait_sdk: ^0.9.3'))).toBe(true);
    for (const h of searchDocs('flutter install', 10)) expect(h.markdown).not.toMatch(/Add the git dependency/);
    const rn = searchDocs('install react native sdk npm', 8);
    expect(rn.some((h) => h.markdown.includes('npm install @straitlink/react-native'))).toBe(true);
  });

  it('knows the CLI and MCP pages added on 23 Oct', () => {
    expect(searchDocs('strait init cli dry-run', 5).some((h) => h.url.includes('/docs/cli/'))).toBe(true);
    expect(searchDocs('mcp server claude add', 5).some((h) => h.url.includes('/docs/mcp/'))).toBe(true);
  });

  it('returns nothing for an empty or stop-word query', () => {
    expect(searchDocs('the and of')).toEqual([]);
    expect(tokens('How do I use React-Native?')).toEqual(['use', 'react-native']);
  });

  it('the tool truncates long sections and never needs a key', async () => {
    const r = parse(await runTool(byName('search_docs'), new StraitClient({ fetch: (() => { throw new Error('no network'); }) as unknown as typeof fetch }), { query: 'webhooks signature', limit: 2 }));
    expect(r.results.length).toBeLessThanOrEqual(2);
    for (const x of r.results) expect(x.markdown.length).toBeLessThan(2700);
  });
});
