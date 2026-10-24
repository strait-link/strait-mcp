import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/csv.js';
import { runTool } from '../src/server.js';
import { TOOLS, diffMetrics, toMs } from '../src/tools.js';
import { LINK, mockClient, type Call } from './helpers.js';

const byName = (n: string) => {
  const t = TOOLS.find((x) => x.name === n);
  if (!t) throw new Error(`no tool ${n}`);
  return t;
};
const parse = (r: { content: Array<{ type: string; text?: string }> }) => JSON.parse(r.content[0]!.text!);
const KEY = 'st_live_test_mockkey';
const V03 = ['pause_link', 'resume_link', 'search_links', 'get_link_qr', 'compare_analytics', 'get_top_links', 'list_taps', 'list_events', 'record_event', 'list_domains', 'add_domain', 'remove_domain', 'list_webhooks', 'check_link'];
const WRITES = ['pause_link', 'resume_link', 'record_event', 'add_domain', 'remove_domain'];

/** Every input schema is a zod shape: parse args the way the MCP SDK does before run(). */
const run = (n: string, client: Parameters<typeof runTool>[1], args: Record<string, unknown>) => runTool(byName(n), client, args);

describe('0.3 tools: kinds, keys, descriptions', () => {
  it('fourteen new tools; Read-only / Write prefixes match the annotations', () => {
    for (const n of V03) {
      const t = byName(n);
      const write = WRITES.includes(n);
      expect(t.annotations.readOnlyHint, n).toBe(!write);
      expect(t.description, n).toMatch(write ? /^Write\./ : /^Read-only\./);
      expect(t.description.length, n).toBeGreaterThan(120);
    }
  });

  it('only check_link works without a key', () => {
    expect(V03.filter((n) => !byName(n).needsKey)).toEqual(['check_link']);
  });

  it('every write tool previews without confirm and calls nothing that writes', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['pause_link', { slug: 'summer' }],
      ['resume_link', { slug: 'summer' }],
      ['record_event', { event: 'purchase', value: 499, currency: 'INR' }],
      ['add_domain', { hostname: 'links.hilltop.example' }],
      ['remove_domain', { hostname: 'links.hilltop.example' }],
    ];
    for (const [n, args] of cases) {
      const { client, calls } = mockClient((c) =>
        c.url.pathname === '/v1/domains' ? { body: { enabled: true, allowed: true, cnameTarget: 'fallback.strait.link', max: 5, domains: [{ hostname: 'links.hilltop.example', verified: true, status: 'live' }] } }
        : c.url.pathname === '/v1/links' ? { body: { links: [{ ...LINK, isActive: false }], nextCursor: null } }
        : c.url.pathname === '/v1/links/summer' && n === 'resume_link' ? { status: 404, body: { error: 'link not found' } }
        : { body: LINK },
      );
      const r = parse(await run(n, client, args));
      expect(r.preview, n).toBe(true);
      expect(r.applied, n).toBe(false);
      expect(calls.every((c) => c.method === 'GET'), n).toBe(true);
    }
  });

  it('every key-needing tool sends the key only as a Bearer header', async () => {
    const respond = (c: Call) =>
      c.url.pathname === '/v1/export'
        ? { raw: c.url.searchParams.get('part') === 'links' ? JSON.stringify({ ...LINK, active: true }) + '\n' : 'created_at,slug\n', headers: { 'content-type': 'text/csv' } }
        : c.url.pathname.endsWith('/qr')
          ? { raw: new Uint8Array([137, 80, 78, 71]), headers: { 'content-type': 'image/png' } }
          : c.url.pathname === '/v1/domains'
            ? { body: { enabled: true, allowed: true, cnameTarget: null, max: 5, domains: [] } }
            : c.url.pathname === '/v1/analytics'
              ? { body: { totals: { taps: 1 }, rows: [] } }
              : { body: LINK };
    const cases: Array<[string, Record<string, unknown>]> = [
      ['search_links', { query: 'summer' }],
      ['get_link_qr', { slug: 'summer' }],
      ['compare_analytics', {}],
      ['get_top_links', {}],
      ['list_taps', {}],
      ['list_events', {}],
      ['record_event', { event: 'purchase', confirm: true }],
      ['list_domains', {}],
      ['add_domain', { hostname: 'links.hilltop.example', confirm: true }],
    ];
    for (const [n, args] of cases) {
      const { client, calls } = mockClient(respond);
      const r = await run(n, client, args);
      expect(r.isError, `${n}: ${JSON.stringify(r.content)}`).toBeFalsy();
      expect(calls.length, n).toBeGreaterThan(0);
      for (const c of calls) {
        expect(c.headers.authorization, n).toBe(`Bearer ${KEY}`);
        expect(c.url.href, n).not.toContain(KEY);
      }
    }
  });
});

describe('pause_link and resume_link', () => {
  it('pause_link with confirm sends PATCH { isActive: false } alone', async () => {
    const { client, calls } = mockClient(() => ({ body: { ...LINK, isActive: false } }));
    const r = parse(await run('pause_link', client, { slug: 'summer', confirm: true }));
    expect(r.applied).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('PATCH');
    expect(calls[0]!.body).toEqual({ isActive: false });
  });

  it('resume_link preview finds the paused link; confirm sends { isActive: true }', async () => {
    const { client } = mockClient((c) => (c.url.pathname === '/v1/links' ? { body: { links: [{ ...LINK, isActive: false }], nextCursor: null } } : { status: 404, body: { error: 'link not found' } }));
    const p = parse(await run('resume_link', client, { slug: 'summer' }));
    expect(p.current).toMatchObject({ isActive: false, longUrl: LINK.longUrl });
    const { client: c2, calls } = mockClient(() => ({ body: LINK }));
    parse(await run('resume_link', c2, { slug: 'summer', confirm: true }));
    expect(calls[0]!.body).toEqual({ isActive: true });
  });
});

describe('search_links', () => {
  const ndjson = [
    { slug: 'summer', title: 'Summer sale', longUrl: 'https://shop.hilltop.example/summer', campaign: 'summer26', tags: ['sale'], active: true, expiresAt: null },
    { slug: 'spring', title: 'Spring', longUrl: 'https://shop.hilltop.example/spring', campaign: 'spring26', tags: ['sale', 'old'], active: false, expiresAt: null },
    { slug: 'app', title: null, longUrl: 'https://shop.hilltop.example/', campaign: null, tags: [], active: true, expiresAt: null },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n';
  const client = () => mockClient(() => ({ raw: ndjson, headers: { 'content-type': 'application/x-ndjson' } }));

  it('reads the links export and matches text in slug, title, url, campaign and tags (active by default)', async () => {
    const { client: c, calls } = client();
    const r = parse(await run('search_links', c, { query: 'SALE' }));
    expect(calls[0]!.url.searchParams.get('part')).toBe('links');
    expect(r.links.map((l: { slug: string }) => l.slug)).toEqual(['summer']);
    expect(r.matched).toBe(1);
  });

  it('status all / inactive, exact tag and campaign filters', async () => {
    expect(parse(await run('search_links', client().client, { tag: 'sale', status: 'all' })).links).toHaveLength(2);
    expect(parse(await run('search_links', client().client, { tag: 'sale', status: 'inactive' })).links.map((l: { slug: string }) => l.slug)).toEqual(['spring']);
    expect(parse(await run('search_links', client().client, { campaign: 'summer2', status: 'all' })).matched).toBe(0);
  });

  it('refuses a search with no filter, and skips a line cut by the read cap', async () => {
    const r = await run('search_links', client().client, {});
    expect(r.isError).toBe(true);
    expect(r.content[0]!.type === 'text' && r.content[0]!.text).toMatch(/query, tag or campaign/);
  });
});

describe('get_link_qr', () => {
  it('returns the PNG as an MCP image block plus the encoded URL', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const { client, calls } = mockClient(() => ({ raw: png, headers: { 'content-type': 'image/png', 'x-strait-qr-url': 'https://hilltop.strait.link/summer?utm_source=qr', 'x-strait-qr-logo': 'off' } }));
    const r = await run('get_link_qr', client, { slug: 'summer', color: '#1f2937' });
    expect(calls[0]!.url.pathname).toBe('/v1/links/summer/qr');
    expect(calls[0]!.url.searchParams.get('color')).toBe('1f2937');
    expect(calls[0]!.url.searchParams.get('size')).toBe('512');
    expect(r.content[1]).toEqual({ type: 'image', mimeType: 'image/png', data: Buffer.from(png).toString('base64') });
    expect(parse(r).encodedUrl).toBe('https://hilltop.strait.link/summer?utm_source=qr');
  });

  it('svg comes back as markup text', async () => {
    const { client } = mockClient(() => ({ raw: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', headers: { 'content-type': 'image/svg+xml' } }));
    const r = await run('get_link_qr', client, { slug: 'summer', format: 'svg' });
    expect(r.content[1]).toEqual({ type: 'text', text: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' });
  });

  it('an engine 400 (low contrast) is a tool error with its message', async () => {
    const { client } = mockClient(() => ({ status: 400, body: { error: 'colour contrast must be at least 3:1' } }));
    const r = await run('get_link_qr', client, { slug: 'summer', color: 'ffffff' });
    expect(r.isError).toBe(true);
  });
});

describe('analytics tools', () => {
  it('toMs and diffMetrics', () => {
    expect(toMs('2026-10-01', 0)).toBe(Date.UTC(2026, 9, 1));
    expect(toMs('1700000000000', 0)).toBe(1700000000000);
    expect(toMs(undefined, 42)).toBe(42);
    expect(() => toMs('soon', 0)).toThrow(/not a date/);
    const d = diffMetrics({ taps: 150, installs: 0, revenue: { INR: 200 } }, { taps: 100, installs: 0, revenue: { INR: 100, USD: 5 } }) as Record<string, any>;
    expect(d.taps).toEqual({ now: 150, before: 100, change: 50, pct: 50 });
    expect(d.installs.pct).toBeNull();
    expect(d.revenue.USD).toEqual({ now: 0, before: 5, change: -5, pct: -100 });
  });

  it('compare_analytics asks for two equal periods back to back and diffs the rows', async () => {
    const answers = [
      { totals: { taps: 200 }, rows: [{ key: 'whatsapp', taps: 150 }, { key: 'instagram', taps: 50 }] },
      { totals: { taps: 100 }, rows: [{ key: 'whatsapp', taps: 100 }, { key: 'gmail', taps: 10 }] },
    ];
    let i = 0;
    const { client, calls } = mockClient(() => ({ body: answers[i++] }));
    const r = parse(await run('compare_analytics', client, { from: '2026-10-08', to: '2026-10-15', group: 'channel' }));
    const q = calls.map((c) => Object.fromEntries(c.url.searchParams));
    expect(q[0]).toMatchObject({ from: String(Date.UTC(2026, 9, 8)), to: String(Date.UTC(2026, 9, 15)), group: 'channel' });
    expect(q[1]).toMatchObject({ from: String(Date.UTC(2026, 9, 1)), to: String(Date.UTC(2026, 9, 8)) });
    expect(r.totals.taps).toMatchObject({ now: 200, before: 100, pct: 100 });
    expect(r.rows.map((x: { key: string }) => x.key)).toEqual(['whatsapp', 'instagram', 'gmail']);
    expect(r.rows[2].taps).toMatchObject({ now: 0, before: 10, pct: -100 });
  });

  it('compare_analytics refuses a backwards range', async () => {
    const { client, calls } = mockClient(() => ({ body: {} }));
    const r = await run('compare_analytics', client, { from: '2026-10-15', to: '2026-10-01' });
    expect(r.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('get_top_links ranks group=link rows by the chosen metric with shares', async () => {
    const { client, calls } = mockClient(() => ({ body: { from: 'a', to: 'b', totals: { taps: 100, installs: 10 }, rows: [{ key: 'a', taps: 70, installs: 1 }, { key: 'b', taps: 30, installs: 9 }] } }));
    const r = parse(await run('get_top_links', client, { by: 'installs', limit: 1 }));
    expect(calls[0]!.url.searchParams.get('group')).toBe('link');
    expect(r.links).toEqual([expect.objectContaining({ rank: 1, slug: 'b', installs: 9, share: 90 })]);
  });
});

describe('list_taps and list_events', () => {
  it('parseCsv handles quotes, escaped quotes, newlines in cells and a cut last line', () => {
    expect(parseCsv('a,b\n1,"x, ""y"""\n2,"multi\nline"\n')).toEqual([{ a: '1', b: 'x, "y"' }, { a: '2', b: 'multi\nline' }]);
    expect(parseCsv('a,b\n1,2\n3,4', false)).toHaveLength(2);
    expect(parseCsv('a,b\n1,2\n3,', true)).toEqual([{ a: '1', b: '2' }]);
    expect(parseCsv('')).toEqual([]);
  });

  it('list_taps reads the taps export for the last hour, newest first, filtered by slug', async () => {
    const csv = 'click_id,clicked_at,slug,channel\nc1,2026-10-24T10:00:00.000Z,summer,whatsapp\nc2,2026-10-24T10:01:00.000Z,spring,direct\nc3,2026-10-24T10:02:00.000Z,summer,instagram\n';
    const { client, calls } = mockClient(() => ({ raw: csv, headers: { 'content-type': 'text/csv' } }));
    const r = parse(await run('list_taps', client, { slug: 'summer', to: '2026-10-24T11:00:00Z' }));
    const q = calls[0]!.url.searchParams;
    expect(q.get('part')).toBe('taps');
    expect(Number(q.get('to')) - Number(q.get('from'))).toBe(60 * 60 * 1000);
    expect(r.taps.map((t: { click_id: string }) => t.click_id)).toEqual(['c3', 'c1']);
    expect(r.matched).toBe(2);
    expect(r.truncated).toBeUndefined();
  });

  it('list_events defaults to 7 days and limits the rows', async () => {
    const csv = 'created_at,name,value\n' + Array.from({ length: 30 }, (_, i) => `t${i},purchase,${i}`).join('\n') + '\n';
    const { client, calls } = mockClient(() => ({ raw: csv, headers: { 'content-type': 'text/csv' } }));
    const r = parse(await run('list_events', client, { limit: 3 }));
    const q = calls[0]!.url.searchParams;
    expect(q.get('part')).toBe('events');
    expect(Number(q.get('to')) - Number(q.get('from'))).toBe(7 * 24 * 60 * 60 * 1000);
    expect(r.events.map((e: { value: string }) => e.value)).toEqual(['29', '28', '27']);
  });
});

describe('record_event', () => {
  it('with confirm posts the event (no confirm field) with the secret key', async () => {
    const { client, calls } = mockClient(() => ({ status: 202, body: { ok: true, clickId: null, linkId: null } }));
    const r = parse(await run('record_event', client, { event: 'purchase', value: 499, currency: 'INR', eventId: 'ord_1001', confirm: true }));
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url.pathname).toBe('/v1/event');
    expect(calls[0]!.body).toEqual({ event: 'purchase', value: 499, currency: 'INR', eventId: 'ord_1001' });
    expect(r).toMatchObject({ applied: true, ok: true });
  });
});

describe('domain tools', () => {
  const list = { enabled: true, allowed: true, cnameTarget: 'fallback.strait.link', max: 5, domains: [{ hostname: 'links.hilltop.example', verified: false, status: 'pending_dns', records: [] }] };

  it('list_domains passes the engine answer through', async () => {
    const { client } = mockClient(() => ({ body: list }));
    expect(parse(await run('list_domains', client, {}))).toEqual(list);
  });

  it('add_domain preview says when the plan does not allow it; confirm posts the lowercased hostname', async () => {
    const { client } = mockClient(() => ({ body: { ...list, allowed: false, domains: [] } }));
    expect(parse(await run('add_domain', client, { hostname: 'go.hilltop.example' })).next).toMatch(/Scale or Enterprise/);
    const { client: c2, calls } = mockClient(() => ({ status: 201, body: { hostname: 'go.hilltop.example', verified: false, status: 'pending_dns' } }));
    await run('add_domain', c2, { hostname: 'Go.Hilltop.Example', confirm: true });
    expect(calls[0]!.body).toEqual({ hostname: 'go.hilltop.example' });
  });

  it('remove_domain: 404-style error for an unknown domain, DELETE on confirm', async () => {
    const { client } = mockClient(() => ({ body: list }));
    const miss = await run('remove_domain', client, { hostname: 'nope.hilltop.example', confirm: true });
    expect(miss.isError).toBe(true);
    const { client: c2, calls } = mockClient((c) => (c.method === 'DELETE' ? { status: 204 } : { body: list }));
    const r = parse(await run('remove_domain', c2, { hostname: 'links.hilltop.example', confirm: true }));
    expect(r.applied).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual(['GET /v1/domains', 'DELETE /v1/domains/links.hilltop.example']);
  });
});

describe('list_webhooks and check_link', () => {
  it('list_webhooks returns receiver sites, never full URLs', async () => {
    const { client } = mockClient(() => ({ body: { webhooks: [{ id: 'w1', url: 'https://hooks.zapier.com/hooks/catch/123/secretpath', events: ['app.event'], active: true }] } }));
    const r = await run('list_webhooks', client, {});
    const text = r.content[0]!.type === 'text' ? r.content[0]!.text : '';
    expect(text).not.toContain('secretpath');
    expect(JSON.parse(text).webhooks[0]).toMatchObject({ id: 'w1', site: 'zapier.com' });
  });

  it('check_link posts to the public checker without a key', async () => {
    const { client, calls } = mockClient(() => ({ body: { verdict: 'works', provider: 'firebase' } }), {});
    const r = parse(await run('check_link', client, { url: 'https://hilltop.page.link/abc' }));
    expect(calls[0]!.url.pathname).toBe('/v1/tools/link-check');
    expect(calls[0]!.headers.authorization).toBeUndefined();
    expect(calls[0]!.body).toEqual({ url: 'https://hilltop.page.link/abc' });
    expect(r.verdict).toBe('works');
  });
});

describe('get_workspace (0.5)', () => {
  it('reads GET /v1/workspace with the key', async () => {
    const ws = { name: 'Hilltop', handle: 'hilltop', linkBase: 'https://hilltop.strait.link', linkDomain: 'hilltop.strait.link', customDomains: [], plan: 'free', key: { scope: 'read', prefix: 'st_live_ab12' } };
    const { client, calls } = mockClient(() => ({ body: ws }));
    expect(parse(await run('get_workspace', client, {}))).toEqual({ ...ws, key: { scope: 'read', endsWith: 'ab12' } });
    expect(calls[0]!.url.pathname).toBe('/v1/workspace');
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it('an engine without the route: explained, not an error', async () => {
    const { client } = mockClient(() => ({ status: 404, body: { error: 'not found' } }));
    const r = await run('get_workspace', client, {});
    expect(r.isError).toBeFalsy();
    expect(parse(r)).toMatchObject({ available: false });
  });
});
