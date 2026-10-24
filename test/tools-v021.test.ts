// 0.2.1: paused links from Claude (engine ADR 0041): list_links status, update_link isActive.
import { describe, expect, it } from 'vitest';
import { runTool } from '../src/server.js';
import { TOOLS } from '../src/tools.js';
import { LINK, mockClient } from './helpers.js';

const byName = (n: string) => {
  const t = TOOLS.find((x) => x.name === n);
  if (!t) throw new Error(`no tool ${n}`);
  return t;
};
const parse = (r: { content: Array<{ text?: string }> }) => JSON.parse(r.content[0]!.text!);
const PAUSED = { ...LINK, id: 'lnk_9', isActive: false, longUrl: 'https://shop.hilltop.example/old-summer' };

describe('list_links status', () => {
  it('passes status=paused through as the query param', async () => {
    const { client, calls } = mockClient(() => ({ body: { links: [PAUSED], nextCursor: null } }));
    const r = parse(await runTool(byName('list_links'), client, { status: 'paused' }));
    expect(calls[0]!.url.pathname).toBe('/v1/links');
    expect(calls[0]!.url.searchParams.get('status')).toBe('paused');
    expect(r.links[0].isActive).toBe(false);
  });

  it('without status sends none (active, as before)', async () => {
    const { client, calls } = mockClient(() => ({ body: { links: [], nextCursor: null } }));
    await runTool(byName('list_links'), client, {});
    expect(calls[0]!.url.searchParams.has('status')).toBe(false);
  });

  it('the schema refuses any other status and the description names paused', () => {
    const shape = byName('list_links').inputSchema as unknown as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    expect(shape.status!.safeParse('archived').success).toBe(false);
    expect(shape.status!.safeParse('active').success).toBe(true);
    expect(byName('list_links').description).toMatch(/paused/);
  });
});

describe('update_link isActive', () => {
  it('turn back on, preview: finds the paused link, changes nothing', async () => {
    const { client, calls } = mockClient((c) =>
      c.url.pathname === '/v1/links/summer' ? { status: 404, body: { error: 'link not found' } } : { body: { links: [{ ...PAUSED, slug: 'other' }, PAUSED], nextCursor: null } },
    );
    const r = parse(await runTool(byName('update_link'), client, { slug: 'summer', isActive: true }));
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(calls[1]!.url.searchParams.get('status')).toBe('paused');
    expect(r).toMatchObject({ preview: true, applied: false, slug: 'summer', current: { isActive: false, longUrl: PAUSED.longUrl }, proposed: { isActive: true } });
    expect(r.next).toMatch(/confirm: true/);
  });

  it('turn back on, preview: already on says so', async () => {
    const { client } = mockClient(() => ({ body: LINK }));
    const r = parse(await runTool(byName('update_link'), client, { slug: 'summer', isActive: true }));
    expect(r).toMatchObject({ preview: true, applied: false, alreadyOn: true });
  });

  it('turn back on, preview: no paused link with that slug', async () => {
    const { client } = mockClient((c) => (c.url.pathname === '/v1/links/summer' ? { status: 404, body: { error: 'link not found' } } : { body: { links: [], nextCursor: null } }));
    const r = parse(await runTool(byName('update_link'), client, { slug: 'summer', isActive: true }));
    expect(r).toMatchObject({ preview: true, applied: false, found: false });
  });

  it('turn back on, confirm: PATCH { isActive: true } alone', async () => {
    const { client, calls } = mockClient(() => ({ body: { ...PAUSED, isActive: true } }));
    const r = parse(await runTool(byName('update_link'), client, { slug: 'summer', isActive: true, confirm: true }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('PATCH');
    expect(calls[0]!.url.pathname).toBe('/v1/links/summer');
    expect(calls[0]!.body).toEqual({ isActive: true });
    expect(r).toMatchObject({ applied: true, link: { isActive: true } });
  });

  it('pause, preview then confirm: PATCH { isActive: false }', async () => {
    const preview = mockClient(() => ({ body: LINK }));
    const p = parse(await runTool(byName('update_link'), preview.client, { slug: 'summer', isActive: false }));
    expect(p).toMatchObject({ preview: true, applied: false, current: { isActive: true }, proposed: { isActive: false } });
    expect(preview.calls.every((c) => c.method === 'GET')).toBe(true);
    const { client, calls } = mockClient(() => ({ body: { ...LINK, isActive: false } }));
    await runTool(byName('update_link'), client, { slug: 'summer', isActive: false, confirm: true });
    expect(calls[0]!.body).toEqual({ isActive: false });
  });

  it('isActive with any other field is refused before any call', async () => {
    const { client, calls } = mockClient(() => ({ body: LINK }));
    const r = await runTool(byName('update_link'), client, { slug: 'summer', isActive: true, title: 'x', confirm: true });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/isActive on its own/);
    expect(calls).toHaveLength(0);
  });

  it('a blocked link: the engine 409 message reaches the user', async () => {
    const { client } = mockClient(() => ({ status: 409, body: { error: 'link_blocked', message: 'This link was disabled for breaking the acceptable use policy.' } }));
    const r = await runTool(byName('update_link'), client, { slug: 'summer', isActive: true, confirm: true });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/acceptable use policy/);
  });

  it('deactivate_link no longer says it cannot be turned back on', () => {
    expect(byName('deactivate_link').description).not.toMatch(/no way to turn a link back on/);
    expect(byName('deactivate_link').description).toMatch(/update_link with isActive: true/);
  });
});
