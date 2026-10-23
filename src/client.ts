/**
 * A small client for the Strait HTTP API (https://strait.link). Web-standard only
 * (fetch, URL), so the same code runs in Node (stdio server) and in Cloudflare
 * Workers (remote server). Operation names follow the OpenAPI operationIds.
 */

export const DEFAULT_API_URL = 'https://strait.link';

export interface StraitClientOptions {
  /** Engine base URL, no trailing slash needed. Default https://strait.link. */
  apiUrl?: string;
  /** A secret key (st_live_… / st_test_…). Needed for every operation except checkAppLinks and getTapTrace. */
  secretKey?: string;
  fetch?: typeof fetch;
  /** Sent as User-Agent (Node) so the engine can tell MCP traffic apart. */
  userAgent?: string;
}

/** An error answer from the API, with its status and JSON body. */
export class StraitApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly operation: string,
  ) {
    const msg = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : `HTTP ${status}`;
    super(`${operation}: ${msg} (HTTP ${status})`);
    this.name = 'StraitApiError';
  }
}

export interface NewLinkInput {
  slug: string;
  longUrl: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  campaign?: string;
  tags?: string[];
  iosFallbackUrl?: string;
  androidFallbackUrl?: string;
  desktopUrl?: string;
  expiresAt?: string | number;
  expiredAction?: 'page' | 'store' | 'url';
  expiredUrl?: string;
}

export interface LinkPatchInput {
  longUrl?: string;
  title?: string;
  tags?: string[];
  expiresAt?: string | number | null;
  expiredAction?: 'page' | 'store' | 'url' | null;
  expiredUrl?: string | null;
}

export interface Link {
  id: string;
  slug: string;
  shortUrl: string;
  longUrl: string;
  title?: string | null;
  tags?: string[];
  isActive?: boolean;
  expiresAt?: number | null;
  [k: string]: unknown;
}

export type AnalyticsGroup = 'none' | 'day' | 'channel' | 'link' | 'platform';

/** True when this looks like a secret key (never a publishable key). */
export function isSecretKey(key: string | undefined): boolean {
  return !!key && /^st_(live|test)_[A-Za-z0-9_-]+$/.test(key) && !key.startsWith('st_pub_');
}

export class StraitClient {
  readonly apiUrl: string;
  private readonly secretKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent?: string;

  constructor(opts: StraitClientOptions = {}) {
    this.apiUrl = (opts.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
    this.secretKey = opts.secretKey;
    this.fetchImpl = opts.fetch ?? ((...a) => fetch(...a));
    this.userAgent = opts.userAgent;
  }

  get hasSecretKey(): boolean {
    return isSecretKey(this.secretKey);
  }

  private async call<T>(operation: string, method: string, path: string, opts: { query?: Record<string, string | number | undefined>; body?: unknown; auth?: boolean } = {}): Promise<T> {
    const auth = opts.auth ?? true;
    if (auth && !this.hasSecretKey) {
      throw new StraitApiError(401, { error: 'no secret key configured: set STRAIT_SECRET_KEY to a key from Dashboard → Settings → Secret keys (st_live_…)' }, operation);
    }
    const url = new URL(this.apiUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { accept: 'application/json' };
    if (auth) headers.authorization = `Bearer ${this.secretKey}`;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (this.userAgent) headers['user-agent'] = this.userAgent;
    const res = await this.fetchImpl(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown = text;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // not JSON: keep the text
    }
    if (!res.ok) throw new StraitApiError(res.status, json, operation);
    return json as T;
  }

  createLink(link: NewLinkInput) {
    return this.call<Link>('createLink', 'POST', '/v1/links', { body: link });
  }
  batchCreateLinks(links: NewLinkInput[]) {
    return this.call<{ results: Array<{ index: number; ok: boolean; status: number; link?: Link; error?: string; reason?: string }>; summary: { total: number; created: number; failed: number } }>(
      'batchCreateLinks', 'POST', '/v1/links/batch', { body: { links } },
    );
  }
  getLink(slug: string) {
    return this.call<Link>('getLink', 'GET', `/v1/links/${encodeURIComponent(slug)}`);
  }
  listLinks(opts: { limit?: number; cursor?: string } = {}) {
    return this.call<{ links: Link[]; nextCursor: string | null }>('listLinks', 'GET', '/v1/links', { query: { limit: opts.limit ?? 50, cursor: opts.cursor } });
  }
  updateLink(slug: string, patch: LinkPatchInput) {
    return this.call<Link>('updateLink', 'PATCH', `/v1/links/${encodeURIComponent(slug)}`, { body: patch });
  }
  getAnalytics(q: { from?: string; to?: string; link?: string; group?: AnalyticsGroup } = {}) {
    return this.call<unknown>('getAnalytics', 'GET', '/v1/analytics', { query: q });
  }
  simulateTap(url: string, ua: string) {
    return this.call<Record<string, unknown>>('simulateTap', 'GET', '/v1/simulate', { query: { url, ua } });
  }
  checkAppLinks(domain: string) {
    return this.call<unknown>('checkAppLinks', 'GET', '/v1/tools/app-links', { query: { domain }, auth: false });
  }
  getUsage() {
    return this.call<Record<string, unknown>>('getUsage', 'GET', '/v1/usage');
  }
  /** Referral report (preview): the engine answers 404 until referrals are switched on. */
  getReferrals(q: { from?: string; to?: string } = {}) {
    return this.call<Record<string, unknown>>('getReferrals', 'GET', '/v1/referrals', { query: q });
  }
  /** The workspace's webhooks, from the export (configuration only: the engine never exports signing secrets). */
  listWebhooks() {
    return this.call<{ webhooks: Array<{ id: string; url: string; events: string[]; active: boolean; createdAt?: string }> }>(
      'exportData', 'GET', '/v1/export', { query: { part: 'webhooks' } },
    );
  }
  listWebhookDeliveries(webhookId: string, opts: { limit?: number; cursor?: string } = {}) {
    return this.call<{ deliveries: unknown[]; nextCursor: string | null }>(
      'listWebhookDeliveries', 'GET', `/v1/webhooks/${encodeURIComponent(webhookId)}/deliveries`, { query: { limit: opts.limit, cursor: opts.cursor } },
    );
  }
  testWebhook(webhookId: string) {
    return this.call<Record<string, unknown>>('testWebhook', 'POST', `/v1/webhooks/${encodeURIComponent(webhookId)}/test`);
  }
  redeliverWebhookDelivery(deliveryId: string) {
    return this.call<Record<string, unknown>>('redeliverWebhookDelivery', 'POST', `/v1/webhook-deliveries/${encodeURIComponent(deliveryId)}/redeliver`);
  }
  /** DELETE /v1/links/{slug}: 204 deactivated; 404 (empty body) = no active link with that slug. */
  async deactivateLink(slug: string): Promise<void> {
    try {
      await this.call<void>('deactivateLink', 'DELETE', `/v1/links/${encodeURIComponent(slug)}`);
    } catch (err) {
      if (err instanceof StraitApiError && err.status === 404 && !err.body) {
        throw new StraitApiError(404, { error: `no active link with slug "${slug}" in this workspace` }, 'deactivateLink');
      }
      throw err;
    }
  }
  /** Live Tap Trace of the website demo (204 = no tap yet → null). */
  getTapTrace(token: string) {
    return this.call<unknown>('getTapTrace', 'GET', `/v1/trace/${encodeURIComponent(token)}`, { auth: false }).then((r) => r ?? null);
  }
}
