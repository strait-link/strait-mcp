import { describe, expect, it, vi } from 'vitest';
import { runTool } from '../src/server.js';
import { TOOLS } from '../src/tools.js';
import { LINK, mockClient } from './helpers.js';

const byName = (n: string) => {
  const t = TOOLS.find((x) => x.name === n);
  if (!t) throw new Error(`no tool ${n}`);
  return t;
};
const parse = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0]!.text);
const HOOK = '7f3e2c1a-9b4d-4e8f-a6c5-2d1b0e9f8a73';
const DELIVERY = '3c9e1a7b-5d2f-4e8a-b6c1-9f0d2e4a7b58';
const KEY = 'st_live_test_mockkey';

describe('0.2 tools: names, kinds, keys', () => {
  it('adds six tools, all needing the secret key', () => {
    for (const n of ['get_usage', 'get_referrals', 'list_webhook_deliveries', 'test_webhook', 'redeliver_webhook_delivery', 'deactivate_link']) {
      expect(byName(n).needsKey, n).toBe(true);
    }
  });

  it('marks reads read-only and writes not, and says which in the description', () => {
    for (const n of ['get_usage', 'get_referrals', 'list_webhook_deliveries']) {
      expect(byName(n).annotations.readOnlyHint, n).toBe(true);
      expect(byName(n).description, n).toMatch(/^Read-only\./);
    }
    for (const n of ['test_webhook', 'redeliver_webhook_delivery', 'deactivate_link']) {
      expect(byName(n).annotations.readOnlyHint, n).toBe(false);
      expect(byName(n).description, n).toMatch(/^Write\./);
    }
    expect(byName('deactivate_link').annotations.destructiveHint).toBe(true);
  });

  it('every new tool sends the key as a Bearer header and never in the URL', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['get_usage', {}],
      ['get_referrals', {}],
      ['list_webhook_deliveries', { webhookId: HOOK }],
      ['list_webhook_deliveries', {}],
      ['test_webhook', { webhookId: HOOK }],
      ['redeliver_webhook_delivery', { deliveryId: DELIVERY, confirm: true }],
      ['deactivate_link', { slug: 'summer', confirm: true }],
    ];
    for (const [n, args] of cases) {
      const { client, calls } = mockClient((c) => (c.method === 'DELETE' ? { status: 204 } : { body: c.url.pathname === '/v1/export' ? { webhooks: [] } : LINK }));
      await runTool(byName(n), client, args);
      expect(calls.length, n).toBeGreaterThan(0);
      for (const c of calls) {
        expect(c.headers.authorization, n).toBe(`Bearer ${KEY}`);
        expect(c.url.href, n).not.toContain(KEY);
      }
    }
  });
});

describe('get_usage and get_referrals', () => {
  it('get_usage reads /v1/usage', async () => {
    const usage = { month: '2026-10', plan: 'free', taps: { used: 1712, included: 2000 }, links: { created: 14, included: 100 }, level: 'warn', new_links_paused: false };
    const { client, calls } = mockClient(() => ({ body: usage }));
    const r = parse(await runTool(byName('get_usage'), client, {}));
    expect(calls[0]).toMatchObject({ method: 'GET' });
    expect(calls[0]!.url.pathname).toBe('/v1/usage');
    expect(r).toEqual(usage);
  });

  it('get_referrals passes from and to', async () => {
    const { client, calls } = mockClient(() => ({ body: { preview: true, rows: [] } }));
    await runTool(byName('get_referrals'), client, { from: '2026-10-01', to: '2026-11-01' });
    expect(calls[0]!.url.pathname).toBe('/v1/referrals');
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ from: '2026-10-01', to: '2026-11-01' });
  });

  it('get_referrals explains a 404 (the preview is not switched on) instead of failing', async () => {
    const { client } = mockClient(() => ({ status: 404, body: { error: 'not found' } }));
    const r = await runTool(byName('get_referrals'), client, {});
    expect(r.isError).toBeUndefined();
    expect(parse(r)).toMatchObject({ available: false });
    expect(parse(r).note).toMatch(/not switched on/);
  });

  it('get_referrals still fails on other errors', async () => {
    const { client } = mockClient(() => ({ status: 429, body: { error: 'rate limited' } }));
    const r = await runTool(byName('get_referrals'), client, {});
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/HTTP 429/);
  });
});

describe('webhook tools', () => {
  it('list_webhook_deliveries pages one webhook', async () => {
    const { client, calls } = mockClient(() => ({ body: { deliveries: [], nextCursor: null } }));
    await runTool(byName('list_webhook_deliveries'), client, { webhookId: HOOK, limit: 5, cursor: 'abc' });
    expect(calls[0]).toMatchObject({ method: 'GET' });
    expect(calls[0]!.url.pathname).toBe(`/v1/webhooks/${HOOK}/deliveries`);
    expect(calls[0]!.url.search).toBe('?limit=5&cursor=abc');
  });

  it('list_webhook_deliveries without an id lists the webhooks, host only (no full URL, no secret)', async () => {
    const exp = { exportedAt: 'x', note: 'n', webhooks: [{ id: HOOK, url: 'https://hooks.zapier.com/hooks/catch/123/abcSECRETPATH/', events: ['link.clicked'], active: true, createdAt: '2026-10-01T00:00:00.000Z' }] };
    const { client, calls } = mockClient(() => ({ body: exp }));
    const r = parse(await runTool(byName('list_webhook_deliveries'), client, {}));
    expect(calls[0]!.url.pathname).toBe('/v1/export');
    expect(calls[0]!.url.searchParams.get('part')).toBe('webhooks');
    expect(r.webhooks).toEqual([{ id: HOOK, host: 'hooks.zapier.com', events: ['link.clicked'], active: true, createdAt: '2026-10-01T00:00:00.000Z' }]);
    expect(JSON.stringify(r)).not.toContain('SECRETPATH');
    expect(r.next).toMatch(/webhookId/);
  });

  it('refuses a webhook or delivery id that is not a UUID before calling anything', async () => {
    const { client, calls } = mockClient(() => ({ body: {} }));
    const { z } = await import('zod');
    for (const [n, field] of [['list_webhook_deliveries', 'webhookId'], ['test_webhook', 'webhookId'], ['redeliver_webhook_delivery', 'deliveryId']] as const) {
      const schema = z.object(byName(n).inputSchema);
      expect(schema.safeParse({ [field]: '../links/summer' }).success, n).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });

  it('test_webhook posts to the test endpoint and returns the attempt', async () => {
    const attempt = { delivered: true, status: 200, error: null, durationMs: 182, deliveryId: 'd', event: 'ping' };
    const { client, calls } = mockClient(() => ({ body: attempt }));
    const r = parse(await runTool(byName('test_webhook'), client, { webhookId: HOOK }));
    expect(calls[0]).toMatchObject({ method: 'POST' });
    expect(calls[0]!.url.pathname).toBe(`/v1/webhooks/${HOOK}/test`);
    expect(r).toEqual(attempt);
  });

  it('redeliver_webhook_delivery without confirm previews and sends nothing', async () => {
    const { client, calls } = mockClient(() => ({ body: {} }));
    const r = parse(await runTool(byName('redeliver_webhook_delivery'), client, { deliveryId: DELIVERY }));
    expect(r).toMatchObject({ preview: true, applied: false, deliveryId: DELIVERY });
    expect(calls).toHaveLength(0);
  });

  it('redeliver_webhook_delivery with confirm posts and returns the delivery', async () => {
    const after = { id: DELIVERY, status: 'delivered', attempts: 1, lastStatus: 200 };
    const { client, calls } = mockClient(() => ({ body: after }));
    const r = parse(await runTool(byName('redeliver_webhook_delivery'), client, { deliveryId: DELIVERY, confirm: true }));
    expect(calls[0]).toMatchObject({ method: 'POST' });
    expect(calls[0]!.url.pathname).toBe(`/v1/webhook-deliveries/${DELIVERY}/redeliver`);
    expect(r).toEqual({ applied: true, delivery: after });
  });

  it('redeliver_webhook_delivery passes a 409 through with the engine message', async () => {
    const { client } = mockClient(() => ({ status: 409, body: { error: 'already delivered' } }));
    const r = await runTool(byName('redeliver_webhook_delivery'), client, { deliveryId: DELIVERY, confirm: true });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/redeliverWebhookDelivery: already delivered \(HTTP 409\)/);
  });
});

describe('deactivate_link', () => {
  it('without confirm previews the link and changes nothing', async () => {
    const { client, calls } = mockClient(() => ({ body: LINK }));
    const r = parse(await runTool(byName('deactivate_link'), client, { slug: 'summer' }));
    expect(r).toMatchObject({ preview: true, applied: false, slug: 'summer', shortUrl: LINK.shortUrl, longUrl: LINK.longUrl });
    expect(r.next).toMatch(/confirm: true/);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('with confirm sends DELETE and reports it', async () => {
    const { client, calls } = mockClient(() => ({ status: 204 }));
    const r = parse(await runTool(byName('deactivate_link'), client, { slug: 'summer', confirm: true }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'DELETE' });
    expect(calls[0]!.url.pathname).toBe('/v1/links/summer');
    expect(r).toMatchObject({ applied: true, slug: 'summer', deactivated: true });
  });

  it('a slug that is not active is a clear 404 error', async () => {
    const { client } = mockClient(() => ({ status: 404 }));
    const r = await runTool(byName('deactivate_link'), client, { slug: 'summer', confirm: true });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/deactivateLink: .*HTTP 404/);
  });
});

describe('secret hygiene (cso)', () => {
  it('redacts the key if an API error ever echoes it, and logs nothing', async () => {
    const spies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      const { client } = mockClient(() => ({ status: 401, body: { error: `invalid secret key ${KEY}` } }));
      const outs = [];
      for (const n of ['get_usage', 'test_webhook', 'deactivate_link']) {
        outs.push(await runTool(byName(n), client, { webhookId: HOOK, slug: 'summer', confirm: true }));
      }
      for (const r of outs) {
        expect(r.isError).toBe(true);
        expect(r.content[0]!.text).not.toContain(KEY);
        expect(r.content[0]!.text).toContain('[redacted]');
      }
      for (const s of spies) expect(s).not.toHaveBeenCalled();
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });

  it('redacts key-shaped strings in successful output too', async () => {
    const { client } = mockClient(() => ({ body: { note: 'st_test_abcdefghijklmnop leaked' } }));
    const r = await runTool(byName('get_usage'), client, {});
    expect(r.content[0]!.text).not.toMatch(/st_test_abcdefghijklmnop/);
  });
});
