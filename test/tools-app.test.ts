import { describe, expect, it } from 'vitest';
import { runTool, toolsForKey } from '../src/server.js';
import { TOOLS } from '../src/tools.js';
import { mockClient } from './helpers.js';

const byName = (n: string) => {
  const t = TOOLS.find((x) => x.name === n);
  if (!t) throw new Error(`no tool ${n}`);
  return t;
};
const parse = (r: { content: Array<{ text?: string }> }) => JSON.parse(r.content[0]!.text!);
const KEY = 'st_live_test_mockkey';

// Shapes copied from the real prod answers (strait-dev, 9 Nov 2026: ops/run-1109/app-config-api/prod-endpoints.txt), trimmed.
const SETUP = {
  android: { packageName: 'com.straitlink.app', sha256Fingerprints: ['FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C'], scheme: 'straitlink', appLinksReady: true },
  ios: { teamId: 'C3L6B5HJU7', bundleId: 'in.straitlink.reference', appId: 'C3L6B5HJU7.in.straitlink.reference', appStoreId: null, appClipBundleId: null, universalLinksReady: true },
  domains: [{ host: 'strait-dev.strait.link', kind: 'link', files: [{ platform: 'android', url: 'https://strait-dev.strait.link/.well-known/assetlinks.json', served: true, since: '2026-11-05T13:26:34.907Z' }] }],
  filesCheckedAt: '2026-11-09T17:37:21.46+00:00',
  sdk: { android: { sdk: 'android', version: '0.10.4', reported: 'android/0.10.4', versionSeenAt: '2026-11-09T16:47:55.583Z', lastSeenAt: '2026-11-09T17:43:42.214Z' } },
  sdkWindow: { days: 30, newestOpens: 1000 },
  setupUrl: 'https://app.straitlink.in/setup#apps',
};
const VERIFY = {
  ok: false,
  checkedAt: '2026-11-09T17:44:14.217Z',
  summary: { pass: 1, warn: 1, fail: 1, unknown: 0, skip: 0 },
  checks: [
    { id: 'android_app', status: 'pass', title: 'Android app details are complete', detail: 'Package com.straitlink.app with 4 signing fingerprint(s).', fix: null },
    { id: 'ios_app', status: 'fail', title: 'iPhone Team ID or bundle ID missing or invalid', detail: 'No App ID.', fix: 'Copy the Team ID (developer.apple.com › Membership) and the bundle ID.' },
    { id: 'sdk_current.ios.unversioned', status: 'warn', platform: 'ios', title: 'Your iPhone build runs a Strait SDK from before 5 Nov 2026', detail: '…', fix: 'Update the Strait SDK.' },
  ],
};

describe('app setup tools (engine ADR 0108)', () => {
  it('are read-only, need the secret key and are offered to read-only keys', async () => {
    for (const n of ['get_app_setup', 'verify_app_setup']) {
      const t = byName(n);
      expect(t.needsKey, n).toBe(true);
      expect(t.annotations.readOnlyHint, n).toBe(true);
      expect(t.annotations.destructiveHint, n).toBe(false);
      expect(t.description, n).toMatch(/^Read-only\./);
    }
    const { client } = mockClient(() => ({ body: { name: 'Hilltop', key: { scope: 'read', prefix: null } } }));
    const names = (await toolsForKey(client)).map((t) => t.name);
    expect(names).toContain('get_app_setup');
    expect(names).toContain('verify_app_setup');
  });

  it('get_app_setup reads GET /v1/app with the key as a Bearer header and returns the answer', async () => {
    const { client, calls } = mockClient(() => ({ body: SETUP }));
    const r = await runTool(byName('get_app_setup'), client, {});
    expect(r.isError).toBeFalsy();
    expect(parse(r)).toEqual(SETUP);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url.pathname).toBe('/v1/app');
    expect(calls[0]!.url.search).toBe('');
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it('verify_app_setup reads GET /v1/app/verify and keeps every check with its status and fix', async () => {
    const { client, calls } = mockClient(() => ({ body: VERIFY }));
    const r = await runTool(byName('verify_app_setup'), client, {});
    expect(r.isError).toBeFalsy();
    expect(calls[0]!.url.pathname).toBe('/v1/app/verify');
    const out = parse(r);
    expect(out.ok).toBe(false);
    expect(out.checks.map((c: { id: string; status: string; fix: string | null }) => [c.id, c.status, c.fix])).toEqual([
      ['android_app', 'pass', null],
      ['ios_app', 'fail', 'Copy the Team ID (developer.apple.com › Membership) and the bundle ID.'],
      ['sdk_current.ios.unversioned', 'warn', 'Update the Strait SDK.'],
    ]);
  });

  it('tells the agent how to act: fix what is not pass, run again, what ok, warn and unknown mean, the rate limit', () => {
    const d = byName('verify_app_setup').description;
    expect(d).toMatch(/pass \/ warn \/ fail \/ unknown \/ skip/);
    expect(d).toMatch(/\bfix\b/);
    expect(d).toMatch(/ok is true only when nothing failed and nothing is unknown/);
    expect(d).toMatch(/older app details.*10 minutes/);
    expect(d).toMatch(/6 (calls )?a minute/);
    expect(byName('get_app_setup').description).toMatch(/verify_app_setup/);
  });

  it('never hands a key-shaped string through, even if the engine answer carried one', async () => {
    const leaky = { ...VERIFY, checks: [{ ...VERIFY.checks[1], detail: 'key st_live_abcDEF123_xyz in a note' }] };
    const { client } = mockClient(() => ({ body: leaky }));
    const r = await runTool(byName('verify_app_setup'), client, {});
    expect(r.content[0]!.text).not.toMatch(/st_live_abc/);
    expect(r.content[0]!.text).not.toContain(KEY);
  });

  it('API refusals come back as tool errors with the engine message (links-only key 403, rate limit 429)', async () => {
    // The engine's real refusal for a links-only key (redirect-engine src/core/key-scope.ts scopeRefusal).
    const LINKS_ONLY = { error: 'key_scope', message: 'This secret key is limited to links (/v1/links, /v1/qr.zip and /v1/simulate). Use a key with full access for this endpoint.' };
    for (const [status, body, re] of [
      [403, LINKS_ONLY, /verifyAppSetup: key_scope \(HTTP 403\)[\s\S]*Use a key with full access/],
      [429, { error: 'rate limited: at most 6 verify calls a minute per workspace' }, /verifyAppSetup: rate limited: at most 6 verify calls a minute per workspace \(HTTP 429\)/],
    ] as const) {
      const { client } = mockClient(() => ({ status, body }));
      const r = await runTool(byName('verify_app_setup'), client, {});
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toMatch(re);
    }
  });

  it('without a key, says how to set it and calls nothing', async () => {
    const { client, calls } = mockClient(() => ({ body: SETUP }), {});
    const r = await runTool(byName('get_app_setup'), client, {});
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/STRAIT_SECRET_KEY/);
    expect(calls).toHaveLength(0);
  });
});
