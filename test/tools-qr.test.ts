// mcp-qr-tools (4 Nov 2026): saved QR styles (preset) on get_link_qr, the campaign QR ZIP, and the styles in get_workspace.
import { describe, expect, it } from 'vitest';
import { runTool } from '../src/server.js';
import { TOOLS } from '../src/tools.js';
import { mockClient } from './helpers.js';

const byName = (n: string) => {
  const t = TOOLS.find((x) => x.name === n);
  if (!t) throw new Error(`no tool ${n}`);
  return t;
};
const run = (n: string, client: Parameters<typeof runTool>[1], args: Record<string, unknown>) => runTool(byName(n), client, args);
const parse = (r: { content: Array<{ type: string; text?: string }> }) => JSON.parse(r.content[0]!.text!);
const ZIP = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]); // an empty ZIP (end of central directory only)

describe('get_link_qr preset', () => {
  it('passes preset=<id> through', async () => {
    const { client, calls } = mockClient(() => ({ raw: new Uint8Array([137, 80, 78, 71]), headers: { 'content-type': 'image/png' } }));
    await run('get_link_qr', client, { slug: 'summer', preset: 'p-packaging' });
    expect(calls[0]!.url.searchParams.get('preset')).toBe('p-packaging');
  });
  it('refuses a malformed preset id before calling', async () => {
    const t = byName('get_link_qr');
    expect(t.inputSchema.preset).toBeDefined();
    expect((t.inputSchema.preset as unknown as { safeParse(v: unknown): { success: boolean } }).safeParse('Not A Preset!').success).toBe(false);
  });
});

describe('get_campaign_qr_zip', () => {
  it('is a read-only tool that needs a key, described for an AI tool', () => {
    const t = byName('get_campaign_qr_zip');
    expect(t.annotations.readOnlyHint).toBe(true);
    expect(t.needsKey).toBe(true);
    expect(t.description).toMatch(/^Read-only\./);
    expect(t.description).toMatch(/get_workspace/);
  });

  it('calls GET /v1/qr.zip (SVG by default) and returns a summary plus the ZIP as an embedded resource', async () => {
    const { client, calls } = mockClient(() => ({ raw: ZIP, headers: { 'content-type': 'application/zip', 'x-strait-qr-count': '12', 'x-strait-qr-logo': 'embedded' } }));
    const r = await run('get_campaign_qr_zip', client, { campaign: 'Diwali Sale', preset: 'p-packaging' });
    expect(r.isError).toBeFalsy();
    const u = calls[0]!.url;
    expect(u.pathname).toBe('/v1/qr.zip');
    expect(u.searchParams.get('campaign')).toBe('Diwali Sale');
    expect(u.searchParams.get('format')).toBe('svg');
    expect(u.searchParams.get('preset')).toBe('p-packaging');
    expect(calls[0]!.headers.Authorization ?? calls[0]!.headers.authorization).toMatch(/^Bearer /);
    expect(parse(r)).toMatchObject({ campaign: 'Diwali Sale', codes: 12, format: 'svg', logo: 'embedded', fileName: 'diwali-sale-qr-codes.zip', bytes: ZIP.length });
    expect(r.content[1]).toEqual({
      type: 'resource',
      resource: { uri: 'strait://qr/diwali-sale-qr-codes.zip', mimeType: 'application/zip', blob: Buffer.from(ZIP).toString('base64') },
    });
  });

  it('PNG over 1024 px is refused before calling (the engine would 400)', async () => {
    const { client, calls } = mockClient(() => ({ raw: ZIP }));
    const r = await run('get_campaign_qr_zip', client, { campaign: 'x', format: 'png', size: 2048 });
    expect(r.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('a 404 (no live links in the campaign) and a 429 are tool errors with the engine message', async () => {
    for (const [status, error] of [[404, 'no live links in this campaign'], [429, 'rate limited: 3 ZIPs a minute']] as const) {
      const { client } = mockClient(() => ({ status, body: { error } }));
      const r = await run('get_campaign_qr_zip', client, { campaign: 'gone' });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.type === 'text' && r.content[0]!.text).toContain(error);
    }
  });

  it('a ZIP too big to hand over is an error that says how to make it smaller', async () => {
    const big = new Uint8Array(8 * 1024 * 1024 + 10);
    const { client } = mockClient(() => ({ raw: big, headers: { 'content-type': 'application/zip' } }));
    const r = await run('get_campaign_qr_zip', client, { campaign: 'huge' });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.type === 'text' && r.content[0]!.text).toMatch(/smaller|dashboard/i);
  });
});

describe('get_workspace', () => {
  it('passes the saved QR styles through', async () => {
    const styles = [{ id: 'p-packaging', name: 'Packaging', color: '1f2937', background: 'fef3c7', logo: true }];
    const { client } = mockClient(() => ({ body: { name: 'Hilltop', handle: 'hilltop', linkBase: 'https://hilltop.strait.link', linkDomain: 'hilltop.strait.link', customDomains: [], plan: 'free', key: { scope: 'read', prefix: 'st_live_ab12' }, qrStyles: styles } }));
    const r = await run('get_workspace', client, {});
    expect(parse(r).qrStyles).toEqual(styles);
  });
});
