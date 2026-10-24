import { StraitClient } from '../src/client.js';

export interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

/** A StraitClient whose fetch is answered by `respond` and recorded in `calls`. */
export function mockClient(respond: (c: Call) => { status?: number; body?: unknown; raw?: string | Uint8Array; headers?: Record<string, string> }, opts: { secretKey?: string } = { secretKey: 'st_live_test_mockkey' }) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: URL | string | Request, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: new URL(String(input)),
      headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {})),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const r = respond(call);
    const status = r.status ?? 200;
    if (r.raw !== undefined) return new Response(r.raw, { status, headers: r.headers ?? { 'content-type': 'text/plain' } });
    return new Response(status === 204 || r.body === undefined ? null : JSON.stringify(r.body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { client: new StraitClient({ apiUrl: 'https://api.test', secretKey: opts.secretKey, fetch: fetchImpl }), calls };
}

export const LINK = { id: 'lnk_1', slug: 'summer', shortUrl: 'https://hilltop.strait.link/summer', longUrl: 'https://shop.hilltop.example/summer', title: 'Summer', tags: [], isActive: true };
