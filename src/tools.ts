/**
 * The Strait MCP tools. Each tool is plain data plus a run() over StraitClient, so
 * the stdio server, the remote Worker and the tests all register the same list.
 */
import { z } from 'zod';
import { StraitApiError, type StraitClient, type NewLinkInput, type LinkPatchInput, type NewEventInput, type Domain } from './client.js';
import { parseCsv } from './csv.js';
import { searchDocs } from './docs.js';

export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface StraitTool<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  inputSchema: S;
  annotations: ToolAnnotations;
  /** Needs STRAIT_SECRET_KEY (false: public endpoints or local data only). */
  needsKey: boolean;
  run(client: StraitClient, args: z.infer<z.ZodObject<S>>): Promise<unknown>;
}

const tool = <S extends z.ZodRawShape>(t: StraitTool<S>) => t as unknown as StraitTool;

export type ContentBlock = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string; text?: undefined };

/** A tool answer that is more than JSON (e.g. a QR image). runTool passes its blocks through as-is (text redacted). */
export class ToolContent {
  constructor(readonly content: ContentBlock[]) {}
}

// ── shared input pieces ─────────────────────────────────────────────────────
const slug = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'letters, digits, - and _ (1–64)').describe("The link's slug: the part after the link domain, e.g. `summer` in https://hilltop.strait.link/summer");
const httpsUrl = z.string().url().refine((u) => u.startsWith('https://'), 'must be an https URL');
const uuid = z.string().uuid();
const when = z.union([z.string(), z.number()]).describe('ISO date-time (2026-12-31T23:59:59Z) or epoch ms');

const newLinkShape = {
  slug,
  longUrl: httpsUrl.describe('Where the link goes: an https URL on your app\'s domain. The app receives its path and query as the in-app route.'),
  title: z.string().max(200).optional().describe('Social preview title'),
  description: z.string().max(500).optional().describe('Social preview description'),
  imageUrl: httpsUrl.optional().describe('Social preview image (https)'),
  campaign: z.string().max(100).optional().describe("Campaign name for analytics; defaults to longUrl's utm_campaign"),
  tags: z.array(z.string().max(50)).max(20).optional(),
  iosFallbackUrl: httpsUrl.optional().describe('iPhone without the app: this page instead of longUrl'),
  androidFallbackUrl: httpsUrl.optional().describe('Android without the app (website mode): this page instead of longUrl'),
  desktopUrl: httpsUrl.optional().describe('Computers go here instead of longUrl'),
  expiresAt: when.optional().describe('After this the link stops opening its destination. Omit for never.'),
  expiredAction: z.enum(['page', 'store', 'url']).optional().describe('Where taps go after expiry: page (expired page), store (app store), url (expiredUrl)'),
  expiredUrl: httpsUrl.optional().describe('Required with expiredAction url'),
};

/** Simulator presets the engine understands (GET /v1/simulate ua=). */
export const UA_PRESETS = ['android', 'iphone', 'ipad', 'desktop', 'instagram-ios', 'instagram-android', 'facebook-android', 'whatsapp-android', 'bot'] as const;

/** The channels trace_tap walks through for one link. */
export const TRACE_MATRIX: Array<{ preset: (typeof UA_PRESETS)[number]; label: string }> = [
  { preset: 'android', label: 'Android, Chrome' },
  { preset: 'whatsapp-android', label: 'Android, WhatsApp' },
  { preset: 'instagram-android', label: 'Android, Instagram' },
  { preset: 'facebook-android', label: 'Android, Facebook' },
  { preset: 'iphone', label: 'iPhone, Safari' },
  { preset: 'instagram-ios', label: 'iPhone, Instagram' },
  { preset: 'ipad', label: 'iPad, Safari' },
  { preset: 'desktop', label: 'Computer' },
  { preset: 'bot', label: 'Link preview bot' },
];

/** Resolve slug-or-URL to the full short link. */
async function shortUrlOf(client: StraitClient, args: { slug?: string; url?: string }): Promise<string> {
  if (args.url) return args.url;
  if (!args.slug) throw new Error('give either slug or url');
  return (await client.getLink(args.slug)).shortUrl;
}

/** Drop the raw file bodies from an App Links report (they can be 32 KB each). */
function compactReport(report: unknown): unknown {
  if (!report || typeof report !== 'object') return report;
  const r = structuredClone(report) as Record<string, Record<string, unknown> | unknown>;
  for (const k of ['android', 'ios']) {
    const p = r[k] as Record<string, Record<string, unknown>> | undefined;
    if (!p) continue;
    for (const f of ['file', 'legacyFile']) if (p[f]) delete p[f].body;
  }
  return r;
}

/** "zapier.com" from a receiver URL: the path, and on some services (Pipedream, ngrok) the subdomain, can be a secret. */
function hostOf(url: string): string {
  try {
    const { hostname } = new URL(url);
    if (/^[\d.]+$/.test(hostname) || hostname.startsWith('[')) return hostname;
    return hostname.split('.').slice(-2).join('.');
  } catch {
    return '(invalid URL)';
  }
}

const UPDATE_FIELDS = ['longUrl', 'title', 'tags', 'expiresAt', 'expiredAction', 'expiredUrl'] as const;

/** Paused pages a turn-back-on preview reads to find the link (100 each). */
const PAUSED_PREVIEW_PAGES = 5;

/** update_link with isActive (engine ADR 0041: PATCH { isActive } sent alone). */
async function setActive(c: StraitClient, slug: string, isActive: boolean, confirm: boolean, otherFields: boolean) {
  if (otherFields) throw new Error('send isActive on its own, then other fields in a second update_link call');
  if (confirm) return { applied: true, link: await c.updateLink(slug, { isActive }) };
  const next = `Nothing has changed yet. Show this to the user; if they agree, call update_link again with slug "${slug}", isActive: ${isActive} and confirm: true.`;
  const live = await c.getLink(slug).catch((err) => {
    if (err instanceof StraitApiError && err.status === 404) return null;
    throw err;
  });
  if (!isActive) {
    if (!live) throw new StraitApiError(404, { error: `no active link with slug "${slug}" in this workspace` }, 'updateLink');
    return { preview: true, applied: false, slug, shortUrl: live.shortUrl, current: { isActive: true, longUrl: live.longUrl }, proposed: { isActive: false }, next };
  }
  if (live) return { preview: true, applied: false, alreadyOn: true, slug, shortUrl: live.shortUrl, longUrl: live.longUrl, next: 'This link is already on. Nothing to do.' };
  let cursor: string | undefined;
  for (let page = 0; page < PAUSED_PREVIEW_PAGES; page++) {
    const r = await c.listLinks({ status: 'paused', limit: 100, cursor });
    const hit = r.links.find((l) => l.slug === slug);
    if (hit) return { preview: true, applied: false, slug, shortUrl: hit.shortUrl, current: { isActive: false, longUrl: hit.longUrl, title: hit.title ?? null }, proposed: { isActive: true }, next };
    if (!r.nextCursor) break;
    cursor = r.nextCursor;
  }
  return {
    preview: true, applied: false, found: false, slug,
    next: `No paused link "${slug}" in the newest ${PAUSED_PREVIEW_PAGES * 100} paused links (list_links status: paused shows them). Confirming answers 404 if there is none.`,
  };
}


// ── 0.3 helpers ─────────────────────────────────────────────────────────────
const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO date, ISO date-time or epoch ms → epoch ms (the formats the engine accepts). */
export function toMs(v: string | number | undefined, fallback: number): number {
  if (v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : /^\d+$/.test(v) ? Number(v) : Date.parse(v);
  if (!Number.isFinite(n)) throw new Error(`not a date: ${v} (use 2026-10-01, an ISO date-time or epoch ms)`);
  return n;
}

const iso = (ms: number) => new Date(ms).toISOString();

type Metrics = { taps?: number; billableTaps?: number; appOpens?: number; installs?: number; conversions?: number; revenue?: Record<string, number> };
type AnalyticsAnswer = { totals: Metrics; rows?: Array<Metrics & { key: string }> };
const COUNTS = ['taps', 'billableTaps', 'appOpens', 'installs', 'conversions'] as const;

/** Change from `before` to `now` for each count and each revenue currency. pct is null when before is 0. */
export function diffMetrics(now: Metrics = {}, before: Metrics = {}) {
  const out: Record<string, unknown> = {};
  for (const k of COUNTS) {
    const a = now[k] ?? 0;
    const b = before[k] ?? 0;
    out[k] = { now: a, before: b, change: a - b, pct: b ? Math.round(((a - b) / b) * 1000) / 10 : null };
  }
  const currencies = new Set([...Object.keys(now.revenue ?? {}), ...Object.keys(before.revenue ?? {})]);
  if (currencies.size) {
    out.revenue = Object.fromEntries(
      [...currencies].map((c) => {
        const a = now.revenue?.[c] ?? 0;
        const b = before.revenue?.[c] ?? 0;
        return [c, { now: a, before: b, change: a - b, pct: b ? Math.round(((a - b) / b) * 1000) / 10 : null }];
      }),
    );
  }
  return out;
}

const range = {
  from: z.string().optional().describe('Inclusive start: 2026-10-01, an ISO date-time or epoch ms'),
  to: z.string().optional().describe('Exclusive end, same formats; default now'),
};

/** Newest `limit` rows of a CSV export in [from, to), optionally for one slug. */
async function recentRows(c: StraitClient, part: 'taps' | 'events', a: { from?: string; to?: string; slug?: string; limit?: number }, defaultSpanMs: number) {
  const to = toMs(a.to, Date.now());
  const from = toMs(a.from, to - defaultSpanMs);
  const { text, truncated } = await c.exportText(part, { from, to }, EXPORT_READ_BYTES);
  let rows = parseCsv(text, truncated);
  if (a.slug) rows = rows.filter((r) => r.slug === a.slug);
  const limit = a.limit ?? 20;
  return {
    from: iso(from),
    to: iso(to),
    [part]: rows.slice(-limit).reverse(),
    shown: Math.min(limit, rows.length),
    matched: rows.length,
    ...(truncated
      ? { truncated: true, note: `There are more ${part} in this range than one call reads; these are the newest of the oldest part. Narrow from / to to see the latest ones.` }
      : {}),
  };
}

/** Bytes of an export one tool call reads (the engine stops streaming when we stop reading). */
const EXPORT_READ_BYTES = 2 * 1024 * 1024;
const SEARCH_READ_BYTES = 8 * 1024 * 1024;

const hostname = z
  .string()
  .min(4)
  .max(253)
  .regex(/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i, 'a hostname such as links.hilltop.example (no https://, no path)')
  .describe('A subdomain you own, such as links.hilltop.example');

async function findDomain(c: StraitClient, host: string): Promise<{ list: Awaited<ReturnType<StraitClient['listDomains']>>; domain: Domain | null }> {
  const list = await c.listDomains();
  return { list, domain: list.domains.find((d) => d.hostname.toLowerCase() === host.toLowerCase()) ?? null };
}

const toBase64 = (bytes: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

export const TOOLS: StraitTool[] = [
  tool({
    name: 'create_link',
    description:
      'Create one deep link (short link) in the workspace of STRAIT_SECRET_KEY. Returns the link with its shortUrl ' +
      '(https://<workspace>.strait.link/<slug>) to share. The link opens the app when installed (App Links / Universal Links), ' +
      'otherwise the store or website, and keeps the destination through an install. For more than a few links use batch_create_links.',
    inputSchema: newLinkShape,
    annotations: { title: 'Create a link', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    needsKey: true,
    run: (c, a) => c.createLink(a as NewLinkInput),
  }),
  tool({
    name: 'batch_create_links',
    description:
      'Create up to 500 links in one call (imports, migrations, campaigns). Each item is checked like create_link and gets its own ' +
      'result; a slug that already exists is a per-item 409, so re-running an import is safe. Read results[i].ok.',
    inputSchema: { links: z.array(z.object(newLinkShape)).min(1).max(500) },
    annotations: { title: 'Create links in bulk', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: (c, a) => c.batchCreateLinks(a.links as NewLinkInput[]),
  }),
  tool({
    name: 'get_link',
    description: "Get one active link by slug: destination, fallbacks, tags, expiry and its shortUrl.",
    inputSchema: { slug },
    annotations: { title: 'Get a link', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: (c, a) => c.getLink(a.slug),
  }),
  tool({
    name: 'list_links',
    description:
      'List links, newest first, one page at a time. Pass nextCursor back as cursor until it is null. ' +
      'status: active (default) or paused (turned off, and can be turned back on with update_link isActive: true; links disabled for abuse are not listed).',
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional().describe('Page size, default 50'),
      cursor: z.string().optional().describe('nextCursor from the previous page'),
      status: z.enum(['active', 'paused']).optional().describe('active (default) or paused'),
    },
    annotations: { title: 'List links', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: (c, a) => c.listLinks(a),
  }),
  tool({
    name: 'update_link',
    description:
      'Change a link: its destination, title, tags or expiry, or turn it off or back on with isActive. People who tap the link afterwards get the change, ' +
      'so this needs confirm: true. Without it nothing changes: you get a preview of the current and proposed values to show the user first. ' +
      'null clears expiresAt / expiredAction / expiredUrl. isActive is sent on its own: false pauses the link (taps get the "link not found" page), ' +
      'true turns a paused link back on (taps follow within about 30 seconds). A link disabled for breaking the acceptable use policy cannot be turned back on, ' +
      'and if another active link now uses the slug, pause or rename that one first.',
    inputSchema: {
      slug,
      longUrl: httpsUrl.optional(),
      title: z.string().max(200).optional(),
      tags: z.array(z.string().max(50)).max(20).optional(),
      expiresAt: when.nullable().optional(),
      expiredAction: z.enum(['page', 'store', 'url']).nullable().optional(),
      expiredUrl: httpsUrl.nullable().optional(),
      isActive: z.boolean().optional().describe('Alone: false pauses the link, true turns a paused link back on'),
      confirm: z.boolean().optional().describe('true to apply the change; omit or false to preview it'),
    },
    annotations: { title: 'Update a link', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: async (c, a) => {
      if (a.isActive !== undefined) return setActive(c, a.slug, a.isActive, a.confirm === true, UPDATE_FIELDS.some((f) => a[f] !== undefined));
      const patch: LinkPatchInput = {};
      for (const f of UPDATE_FIELDS) if (a[f] !== undefined) (patch as Record<string, unknown>)[f] = a[f];
      if (!Object.keys(patch).length) throw new Error('nothing to change: give at least one of ' + UPDATE_FIELDS.join(', '));
      if (a.confirm !== true) {
        const current = await c.getLink(a.slug);
        const before = Object.fromEntries(Object.keys(patch).map((k) => [k, current[k] ?? null]));
        return {
          preview: true,
          applied: false,
          slug: a.slug,
          shortUrl: current.shortUrl,
          current: before,
          proposed: patch,
          next: 'Nothing has changed yet. Show this to the user; if they agree, call update_link again with the same fields and confirm: true.',
        };
      }
      return { applied: true, link: await c.updateLink(a.slug, patch) };
    },
  }),
  tool({
    name: 'get_analytics',
    description:
      'Taps, app opens, installs, conversions and revenue for the workspace (or one link) over a date range, optionally grouped by ' +
      'day, channel (whatsapp, instagram, gmail, direct…), link or platform. Same definitions as the dashboard; days are UTC; ' +
      'at most 92 days per call (default: the last 30 days).',
    inputSchema: {
      from: z.string().optional().describe('Inclusive start: 2026-09-01, an ISO date-time or epoch ms'),
      to: z.string().optional().describe('Exclusive end, same formats; default now'),
      link: slug.optional().describe('Only this link (slug)'),
      group: z.enum(['none', 'day', 'channel', 'link', 'platform']).optional(),
    },
    annotations: { title: 'Read analytics', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: (c, a) => c.getAnalytics(a),
  }),
  tool({
    name: 'check_app_links',
    description:
      "Check a domain's App Links (Android, /.well-known/assetlinks.json) and Universal Links (iPhone, apple-app-site-association) " +
      'files: each finding has a severity (ok / warn / error) and a fix. Use it when links open the browser instead of the app. ' +
      'It checks the files the domain serves, not how one particular phone behaves. No key needed.',
    inputSchema: { domain: z.string().min(3).max(253).describe('A domain such as hilltop.strait.link or shop.hilltop.example (a full URL is reduced to its host)') },
    annotations: { title: 'Check App Links / Universal Links files', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    needsKey: false,
    run: async (c, a) => compactReport(await c.checkAppLinks(a.domain)),
  }),
  tool({
    name: 'simulate_tap',
    description:
      'Dry-run one tap on a link from one kind of device or app and see exactly what Strait would do (redirect, in-app-browser ' +
      'escape page, store, preview card) and why. Nothing is recorded or billed. ua is a preset or a raw User-Agent string.',
    inputSchema: {
      slug: slug.optional(),
      url: httpsUrl.optional().describe('The full short link instead of slug'),
      ua: z.string().min(2).max(512).describe(`A preset (${UA_PRESETS.join(', ')}) or a raw User-Agent`),
    },
    annotations: { title: 'Simulate a tap', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: async (c, a) => c.simulateTap(await shortUrlOf(c, a), a.ua),
  }),
  tool({
    name: 'trace_tap',
    description:
      'Explain where taps on a link go. With slug or url: walks the link through the common channels (Android Chrome, WhatsApp, ' +
      'Instagram and Facebook in-app browsers, iPhone Safari and Instagram, iPad, computer, preview bot) and returns one row per ' +
      'channel with the decision, where the tap is sent and the reason. A simulation: nothing is recorded. With token: reads a ' +
      'Live Tap Trace from the straitlink.in demo (the st value of a demo.strait.link/try link), i.e. what happened to a real tap.',
    inputSchema: {
      slug: slug.optional(),
      url: httpsUrl.optional(),
      token: z.string().regex(/^[a-z0-9]{20,32}$/).optional().describe('Demo trace token (st=…) instead of a link'),
    },
    annotations: { title: 'Trace taps on a link', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    needsKey: false,
    run: async (c, a) => {
      if (a.token) {
        const trace = await c.getTapTrace(a.token);
        return trace ?? { trace: null, note: 'No tap for this token yet (or it is older than 15 minutes). Tap the demo link on a phone, then try again.' };
      }
      if (!c.hasSecretKey) throw new Error('tracing a link needs STRAIT_SECRET_KEY (a demo token does not)');
      const url = await shortUrlOf(c, a);
      const rows = [];
      for (const m of TRACE_MATRIX) {
        const r = await c.simulateTap(url, m.preset);
        rows.push({ channel: m.label, preset: m.preset, decision: r.decision, sentTo: r.sentTo ?? null, reason: r.reason ?? null, location: r.location ?? null });
      }
      return { link: url, simulated: true, rows };
    },
  }),
  tool({
    name: 'get_usage',
    description:
      "Read-only. This calendar month's usage (UTC) against the workspace's plan: billed taps used and included, new links " +
      'created and included (null = no limit), level (ok, warn from 80 % of included taps, over from 100 %) and new_links_paused. ' +
      'Going over never stops a redirect; new_links_paused means create_link answers 402 until an upgrade or the month ends.',
    inputSchema: {},
    annotations: { title: 'Read this month\'s usage', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: (c) => c.getUsage(),
  }),
  tool({
    name: 'get_referrals',
    description:
      'Read-only. The referral report (a preview): for each referral code in a date range, the taps that carried it and the ' +
      'referred installs, most conversions first. Days are UTC; at most 92 days per call (default: the last 30 days). ' +
      'If referrals are not switched on for the workspace yet, says so instead of failing.',
    inputSchema: {
      from: z.string().optional().describe('Inclusive start: 2026-10-01, an ISO date-time or epoch ms'),
      to: z.string().optional().describe('Exclusive end, same formats; default now'),
    },
    annotations: { title: 'Read the referral report', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: async (c, a) => {
      try {
        return await c.getReferrals(a);
      } catch (err) {
        // The engine's unmounted-route answer, not any 404 (e.g. a wrong STRAIT_API_URL serving HTML).
        if (err instanceof StraitApiError && err.status === 404 && (err.body as { error?: unknown } | null)?.error === 'not found') {
          return { available: false, note: 'The referral report is a preview and is not switched on for the API yet. Referral codes still travel on links; the report appears here once it is switched on.' };
        }
        throw err;
      }
    },
  }),
  tool({
    name: 'list_webhook_deliveries',
    description:
      "Read-only. A webhook's delivery history, newest first (kept 30 days): each event sent, its status (pending = waiting " +
      'for a retry, delivered, failed = gave up after 6 attempts), attempts, last HTTP status or error and the next retry time. ' +
      'A permanent error (e.g. unsafe_target) fails at once. Payloads are never returned. Without webhookId it lists the ' +
      'workspace\'s webhooks (id, receiver site, events, active) ' +
      'so you can pick one. Use it when a webhook seems to have stopped.',
    inputSchema: {
      webhookId: uuid.optional().describe('The webhook id; omit to list the webhooks first'),
      limit: z.number().int().min(1).max(100).optional().describe('Page size, default 20'),
      cursor: z.string().optional().describe('nextCursor from the previous page'),
    },
    annotations: { title: 'List webhook deliveries', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: async (c, a) => {
      if (a.webhookId) return c.listWebhookDeliveries(a.webhookId, a);
      const { webhooks } = await c.listWebhooks();
      return {
        // Receiver URLs are often capability URLs (Zapier, Slack): only the host leaves the engine's answer.
        webhooks: webhooks.map((w) => ({ id: w.id, site: hostOf(w.url), events: w.events, active: w.active, createdAt: w.createdAt })),
        next: webhooks.length
          ? 'Call list_webhook_deliveries again with webhookId set to one of these ids.'
          : 'This workspace has no webhooks. Add one in Dashboard → Settings → Webhooks.',
      };
    },
  }),
  tool({
    name: 'test_webhook',
    description:
      'Write. Sends one test event (event: ping) to a webhook right now, even if it is paused, and returns whether the receiver ' +
      'accepted it, its HTTP status and the time taken (never its response body). The ping is not stored or retried and ' +
      'changes nothing in Strait. Get the id from list_webhook_deliveries without webhookId.',
    inputSchema: { webhookId: uuid.describe('The webhook id') },
    annotations: { title: 'Send a test webhook', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    needsKey: true,
    run: (c, a) => c.testWebhook(a.webhookId),
  }),
  tool({
    name: 'redeliver_webhook_delivery',
    description:
      "Write. Sends one past webhook delivery again, right away, to the webhook's current URL, with the same X-Strait-Delivery id " +
      '(receivers that de-duplicate on it are safe); its retry schedule starts over. For failed deliveries. This re-sends a real ' +
      'event into the receiving system, so it needs confirm: true; without it nothing is sent. Refused (409) when already ' +
      'delivered or being sent right now. A paused webhook must be turned back on first (Dashboard → Settings → Webhooks), ' +
      'otherwise the redelivery fails at once.',
    inputSchema: {
      deliveryId: uuid.describe('The delivery id, from list_webhook_deliveries'),
      confirm: z.boolean().optional().describe('true to send it; omit or false to preview'),
    },
    annotations: { title: 'Redeliver a webhook delivery', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    needsKey: true,
    run: async (c, a) => {
      if (a.confirm !== true) {
        return {
          preview: true,
          applied: false,
          deliveryId: a.deliveryId,
          next: 'Nothing has been sent. This re-sends a real event to the webhook receiver. If the user agrees, call redeliver_webhook_delivery again with confirm: true.',
        };
      }
      return { applied: true, delivery: await c.redeliverWebhookDelivery(a.deliveryId) };
    },
  }),
  tool({
    name: 'deactivate_link',
    description:
      'Write. Turns a link off: afterwards every tap on it gets the "link not found" page instead of the app, store or website. ' +
      'Its history stays in analytics, and it can be turned back on with update_link with isActive: true. This needs confirm: true; without it ' +
      'nothing changes and you get a preview of the link to show the user first.',
    inputSchema: {
      slug,
      confirm: z.boolean().optional().describe('true to deactivate; omit or false to preview'),
    },
    annotations: { title: 'Deactivate a link', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: async (c, a) => {
      if (a.confirm !== true) {
        const current = await c.getLink(a.slug);
        return {
          preview: true,
          applied: false,
          slug: a.slug,
          shortUrl: current.shortUrl,
          longUrl: current.longUrl,
          title: current.title ?? null,
          next: 'Nothing has changed yet. After deactivation taps get the "link not found" page until it is turned back on (update_link isActive: true). If the user agrees, call deactivate_link again with confirm: true.',
        };
      }
      await c.deactivateLink(a.slug);
      return { applied: true, slug: a.slug, deactivated: true };
    },
  }),
  // ── 0.3: links ────────────────────────────────────────────────────────────
  tool({
    name: 'pause_link',
    description:
      'Write. Pauses a link: until it is resumed, every tap gets the "link not found" page instead of the app, store or website. ' +
      'Its history stays in analytics. Needs confirm: true; without it nothing changes and you get a preview of the link to show the user. ' +
      'Undo with resume_link.',
    inputSchema: { slug, confirm: z.boolean().optional().describe('true to pause; omit or false to preview') },
    annotations: { title: 'Pause a link', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: (c, a) => setActive(c, a.slug, false, a.confirm === true, false),
  }),
  tool({
    name: 'resume_link',
    description:
      'Write. Turns a paused link back on: taps follow it again within about 30 seconds. Needs confirm: true; without it nothing ' +
      'changes and you get a preview (it looks the link up among paused links). A link disabled for breaking the acceptable use policy ' +
      'cannot be resumed, and if another active link now uses the slug, pause or rename that one first. list_links with status: paused lists paused links.',
    inputSchema: { slug, confirm: z.boolean().optional().describe('true to resume; omit or false to preview') },
    annotations: { title: 'Resume a paused link', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: (c, a) => setActive(c, a.slug, true, a.confirm === true, false),
  }),
  tool({
    name: 'search_links',
    description:
      'Read-only. Finds links by text across slug, title, destination (longUrl), campaign and tags, or by an exact tag or campaign, ' +
      'including paused and inactive links (status: all). Use it for "which links point at /summer", "every link tagged diwali" or ' +
      '"links in the spring campaign". Reads the workspace\'s links export, so it needs an owner\'s or admin\'s secret key.',
    inputSchema: {
      query: z.string().min(1).max(200).optional().describe('Text to find (case-insensitive) in slug, title, longUrl, campaign or tags'),
      tag: z.string().max(50).optional().describe('Only links with exactly this tag'),
      campaign: z.string().max(100).optional().describe('Only links in exactly this campaign'),
      status: z.enum(['active', 'inactive', 'all']).optional().describe('active (default), inactive (paused or disabled) or all'),
      limit: z.number().int().min(1).max(100).optional().describe('Links to return, default 20'),
    },
    annotations: { title: 'Search links', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: async (c, a) => {
      if (!a.query && !a.tag && !a.campaign) throw new Error('give query, tag or campaign (list_links lists every link)');
      const { text, truncated } = await c.exportText('links', {}, SEARCH_READ_BYTES);
      const lines = text.split('\n');
      if (truncated) lines.pop(); // cut mid-line
      const q = a.query?.toLowerCase();
      const status = a.status ?? 'active';
      const hits: Array<Record<string, unknown>> = [];
      let matched = 0;
      for (const line of lines) {
        if (!line.trim()) continue;
        let l: { slug: string; longUrl: string; title: string | null; campaign: string | null; tags: string[]; active: boolean; expiresAt: string | null };
        try {
          l = JSON.parse(line);
        } catch {
          continue;
        }
        if (status === 'active' && !l.active) continue;
        if (status === 'inactive' && l.active) continue;
        if (a.tag && !(l.tags ?? []).includes(a.tag)) continue;
        if (a.campaign && l.campaign !== a.campaign) continue;
        if (q && ![l.slug, l.title, l.longUrl, l.campaign, ...(l.tags ?? [])].some((v) => typeof v === 'string' && v.toLowerCase().includes(q))) continue;
        matched++;
        if (hits.length < (a.limit ?? 20)) hits.push({ slug: l.slug, title: l.title, longUrl: l.longUrl, campaign: l.campaign, tags: l.tags, active: l.active, expiresAt: l.expiresAt });
      }
      return {
        links: hits,
        matched,
        next: hits.length ? 'get_link (active links) shows a link\'s shortUrl and every field.' : 'Nothing matched. Try a shorter query or status: all.',
        ...(truncated ? { truncated: true, note: 'The workspace has more links than one search reads; some links were not searched.' } : {}),
      };
    },
  }),
  tool({
    name: 'get_link_qr',
    description:
      'Read-only. A print-ready QR code for a link, in the workspace\'s QR style (Dashboard → Settings → QR codes); the options override it ' +
      'for this one code. Returns the image (PNG, or SVG markup) and the exact URL in the code. By default scans add utm_source=qr, so ' +
      'they show as the qr channel in analytics. Refused (400) if the colours have under 3:1 contrast.',
    inputSchema: {
      slug,
      format: z.enum(['png', 'svg']).optional().describe('png (default) or svg'),
      size: z.number().int().min(128).max(2048).optional().describe('Width and height in pixels, default 512'),
      color: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional().describe('Code colour as hex, e.g. 1f2937'),
      background: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional().describe('Background colour as hex, e.g. ffffff'),
      logo: z.boolean().optional().describe('Put the app icon in the middle (default: the workspace setting)'),
      track: z.boolean().optional().describe('Add utm_source=qr so scans count as the qr channel (default true)'),
    },
    annotations: { title: 'Get a QR code for a link', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: async (c, a) => {
      const format = a.format ?? 'png';
      const r = await c.getLinkQr(a.slug, {
        format,
        size: a.size ?? 512,
        color: a.color?.replace(/^#/, ''),
        background: a.background?.replace(/^#/, ''),
        logo: a.logo,
        track: a.track,
      });
      const about = { slug: a.slug, format, encodedUrl: r.headers.get('x-strait-qr-url'), logo: r.headers.get('x-strait-qr-logo') };
      if (format === 'svg') return new ToolContent([{ type: 'text', text: JSON.stringify(about, null, 2) }, { type: 'text', text: new TextDecoder().decode(r.bytes) }]);
      return new ToolContent([{ type: 'text', text: JSON.stringify(about, null, 2) }, { type: 'image', data: toBase64(r.bytes), mimeType: 'image/png' }]);
    },
  }),

  // ── 0.3: analytics ────────────────────────────────────────────────────────
  tool({
    name: 'compare_analytics',
    description:
      'Read-only. Compares two periods: taps, app opens, installs, conversions and revenue now against before, with the change and the ' +
      'percent change (null when before was 0). By default "before" is the period of the same length just before. With group (channel, ' +
      'platform or link) it compares each row too, biggest first. Use it for "how did this week do against last week" or "why did installs drop". ' +
      'Days are UTC; each period at most 92 days.',
    inputSchema: {
      ...range,
      compareFrom: z.string().optional().describe('Start of the period to compare against; default: just before from'),
      compareTo: z.string().optional().describe('End of the period to compare against; default: from'),
      link: slug.optional().describe('Only this link (slug)'),
      group: z.enum(['channel', 'platform', 'link']).optional().describe('Also compare row by row'),
      limit: z.number().int().min(1).max(50).optional().describe('Rows to compare with group, default 10'),
    },
    annotations: { title: 'Compare two periods', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: async (c, a) => {
      const to = toMs(a.to, Date.now());
      const from = toMs(a.from, to - 30 * DAY_MS);
      if (from >= to) throw new Error('from must be before to');
      const bTo = toMs(a.compareTo, from);
      const bFrom = toMs(a.compareFrom, bTo - (to - from));
      if (bFrom >= bTo) throw new Error('compareFrom must be before compareTo');
      const group = a.group ?? 'none';
      const [now, before] = (await Promise.all([
        c.getAnalytics({ from: String(from), to: String(to), link: a.link, group }),
        c.getAnalytics({ from: String(bFrom), to: String(bTo), link: a.link, group }),
      ])) as [AnalyticsAnswer, AnalyticsAnswer];
      const out: Record<string, unknown> = {
        now: { from: iso(from), to: iso(to) },
        before: { from: iso(bFrom), to: iso(bTo) },
        link: a.link ?? null,
        totals: diffMetrics(now.totals, before.totals),
      };
      if (a.group) {
        const prev = new Map((before.rows ?? []).map((r) => [r.key, r]));
        const keys = [...new Set([...(now.rows ?? []).map((r) => r.key), ...(before.rows ?? []).map((r) => r.key)])];
        const cur = new Map((now.rows ?? []).map((r) => [r.key, r]));
        keys.sort((x, y) => (cur.get(y)?.taps ?? 0) - (cur.get(x)?.taps ?? 0) || (prev.get(y)?.taps ?? 0) - (prev.get(x)?.taps ?? 0));
        out.group = a.group;
        out.rows = keys.slice(0, a.limit ?? 10).map((k) => ({ key: k, ...diffMetrics(cur.get(k), prev.get(k)) }));
      }
      return out;
    },
  }),
  tool({
    name: 'get_top_links',
    description:
      'Read-only. The workspace\'s top links over a date range, ranked by taps, app opens, installs or conversions, with each link\'s ' +
      'share of the total. Use it for "which links brought the most installs this month". Days are UTC; at most 92 days (default: the last 30).',
    inputSchema: {
      ...range,
      by: z.enum(['taps', 'appOpens', 'installs', 'conversions']).optional().describe('What to rank by, default taps'),
      limit: z.number().int().min(1).max(50).optional().describe('Links to return, default 10'),
    },
    annotations: { title: 'Rank the top links', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: async (c, a) => {
      const by = a.by ?? 'taps';
      const r = (await c.getAnalytics({ from: a.from, to: a.to, group: 'link' })) as AnalyticsAnswer & { from?: string; to?: string };
      const total = r.totals?.[by] ?? 0;
      const rows = [...(r.rows ?? [])].sort((x, y) => (y[by] ?? 0) - (x[by] ?? 0)).slice(0, a.limit ?? 10);
      return {
        from: r.from,
        to: r.to,
        by,
        total,
        links: rows.map((row, i) => ({ rank: i + 1, slug: row.key, [by]: row[by] ?? 0, share: total ? Math.round(((row[by] ?? 0) / total) * 1000) / 10 : null, taps: row.taps, appOpens: row.appOpens, installs: row.installs, conversions: row.conversions, revenue: row.revenue })),
      };
    },
  }),

  // ── 0.3: taps and events ──────────────────────────────────────────────────
  tool({
    name: 'list_taps',
    description:
      'Read-only. Recent individual taps, newest first: when, which link, platform, channel, in-app browser, where Strait sent it ' +
      '(sent_to), and the app open and install it led to (opened_at, open_kind, installed_at, match_method). Default: the last hour. ' +
      'Use it to check that a test tap was recorded and what happened to it. Reads the taps export (an owner\'s or admin\'s key).',
    inputSchema: {
      ...range,
      slug: slug.optional().describe('Only taps on this link'),
      limit: z.number().int().min(1).max(100).optional().describe('Taps to return, default 20'),
    },
    annotations: { title: 'List recent taps', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: (c, a) => recentRows(c, 'taps', a, 60 * 60 * 1000),
  }),
  tool({
    name: 'list_events',
    description:
      'Read-only. Recent conversion and revenue events (from the SDKs\' track calls or record_event), newest first: name, value, ' +
      'currency, platform, the link and tap they are attributed to, and that tap\'s channel and campaign. Default: the last 7 days. ' +
      'Use it to check that purchases or sign-ups arrive. Reads the events export (an owner\'s or admin\'s key).',
    inputSchema: {
      ...range,
      slug: slug.optional().describe('Only events attributed to this link'),
      limit: z.number().int().min(1).max(100).optional().describe('Events to return, default 20'),
    },
    annotations: { title: 'List recent events', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: (c, a) => recentRows(c, 'events', a, 7 * DAY_MS),
  }),
  tool({
    name: 'record_event',
    description:
      'Write. Records one conversion or revenue event from your server side (trusted: sentWith secret_key), the same as POST /v1/event. ' +
      'It counts in analytics and revenue and is sent to webhooks subscribed to app.event, so it needs confirm: true; without it nothing ' +
      'is recorded and you get a preview. clickId ties it to the tap it came from (apps get it from the SDK). eventId (e.g. your order id) ' +
      'makes retries safe: the same eventId is stored once. Apps should send events with the SDKs, not this tool.',
    inputSchema: {
      event: z.string().min(1).max(64).describe('Event name, e.g. purchase or signup'),
      value: z.number().optional().describe('Revenue amount, e.g. 499'),
      currency: z.string().regex(/^[A-Z]{3}$/).optional().describe('ISO currency, e.g. INR or USD'),
      clickId: uuid.optional().describe('The tap this conversion came from'),
      linkId: z.string().max(100).optional().describe('The link, when there is no clickId'),
      eventId: z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/).optional().describe('Idempotency id, e.g. ord_1001'),
      platform: z.string().max(20).optional().describe('ios, android or web'),
      data: z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/), z.union([z.string().max(256), z.number(), z.boolean(), z.null()])).optional().describe('Up to 20 custom key-values for the app.event webhook (not stored with the event)'),
      confirm: z.boolean().optional().describe('true to record it; omit or false to preview'),
    },
    annotations: { title: 'Record a conversion event', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    needsKey: true,
    run: async (c, a) => {
      const { confirm, ...e } = a;
      if (e.data && Object.keys(e.data).length > 20) throw new Error('data has at most 20 keys');
      if (confirm !== true) {
        return {
          preview: true,
          applied: false,
          event: e,
          next: 'Nothing has been recorded. This adds a real event to analytics and revenue and sends it to app.event webhooks. If the user agrees, call record_event again with the same fields and confirm: true.',
        };
      }
      return { applied: true, ...(await c.recordEvent(e as NewEventInput)) };
    },
  }),

  // ── 0.3: custom domains ───────────────────────────────────────────────────
  tool({
    name: 'list_domains',
    description:
      'Read-only. The workspace\'s custom link domains (e.g. links.hilltop.example) with each one\'s status (pending_dns until the DNS ' +
      'records are in place, then live; verified once ownership is proven) and the exact DNS records to add. Also says whether custom ' +
      'domains are switched on and allowed on this plan (Scale and Enterprise) and the limit. Use it for "is my domain set up yet".',
    inputSchema: {},
    annotations: { title: 'List custom domains', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: (c) => c.listDomains(),
  }),
  tool({
    name: 'add_domain',
    description:
      'Write. Adds a custom link domain (a subdomain you own, e.g. links.hilltop.example) and returns the DNS records to add at your DNS ' +
      'provider: a CNAME to Strait, a TXT record proving ownership and a TXT record for the HTTPS certificate. Scale and Enterprise only, ' +
      'at most 5 per workspace. Needs confirm: true; without it nothing changes and you get a preview (plan, limit, domains already added).',
    inputSchema: { hostname, confirm: z.boolean().optional().describe('true to add it; omit or false to preview') },
    annotations: { title: 'Add a custom domain', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    needsKey: true,
    run: async (c, a) => {
      if (a.confirm === true) return { applied: true, domain: await c.addDomain(a.hostname.toLowerCase()), next: 'Add these DNS records, then check with list_domains (status turns live, verified true).' };
      const { list, domain } = await findDomain(c, a.hostname);
      return {
        preview: true,
        applied: false,
        hostname: a.hostname.toLowerCase(),
        alreadyAdded: !!domain,
        customDomainsOn: list.enabled,
        allowedOnPlan: list.allowed,
        used: list.domains.length,
        max: list.max,
        next: domain
          ? 'This domain is already added; list_domains shows its status and DNS records.'
          : !list.allowed
            ? 'Custom domains need the Scale or Enterprise plan; adding answers 402 on this plan.'
            : 'Nothing has changed yet. If the user agrees, call add_domain again with confirm: true.',
      };
    },
  }),
  tool({
    name: 'remove_domain',
    description:
      'Write. Removes a custom link domain: links stop working on it at once (they keep working on the workspace\'s strait.link address). ' +
      'Afterwards delete its CNAME and TXT records at your DNS provider. Needs confirm: true; without it nothing changes and you get a preview.',
    inputSchema: { hostname, confirm: z.boolean().optional().describe('true to remove it; omit or false to preview') },
    annotations: { title: 'Remove a custom domain', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: async (c, a) => {
      const { domain } = await findDomain(c, a.hostname);
      if (!domain) throw new StraitApiError(404, { error: `no custom domain "${a.hostname}" in this workspace (list_domains lists them)` }, 'removeDomain');
      if (a.confirm !== true) {
        return {
          preview: true,
          applied: false,
          domain: { hostname: domain.hostname, status: domain.status, verified: domain.verified },
          next: `Nothing has changed yet. After removal every link on https://${domain.hostname} stops working. If the user agrees, call remove_domain again with confirm: true.`,
        };
      }
      await c.removeDomain(domain.hostname);
      return { applied: true, removed: domain.hostname, next: 'Delete its CNAME and TXT records at your DNS provider.' };
    },
  }),

  // ── 0.3: webhooks and checks ──────────────────────────────────────────────
  tool({
    name: 'list_webhooks',
    description:
      'Read-only. The workspace\'s webhooks: id, receiver site (the host only: receiver URLs often carry a secret), the events each one ' +
      'gets (link.clicked, app.opened, install.matched, app.event, referral.converted) and whether it is on. Never returns signing secrets. Use the id with ' +
      'list_webhook_deliveries or test_webhook. Webhooks are added in Dashboard → Settings → Webhooks.',
    inputSchema: {},
    annotations: { title: 'List webhooks', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: async (c) => {
      const { webhooks } = await c.listWebhooks();
      return { webhooks: webhooks.map((w) => ({ id: w.id, site: hostOf(w.url), events: w.events, active: w.active, createdAt: w.createdAt })) };
    },
  }),
  tool({
    name: 'check_link',
    description:
      'Read-only. Checks any deep link, from any vendor (a Firebase Dynamic Link on page.link, Branch app.link, a Strait link, a plain ' +
      'URL): where it goes on Android, iPhone and computers, whether it still works, and what to fix. Use it before migrating links or when ' +
      'an old link stopped working. Only public https links. No key needed; a few checks a minute per network.',
    inputSchema: { url: httpsUrl.describe('The full link, e.g. https://hilltop.page.link/abc') },
    annotations: { title: 'Check any deep link', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    needsKey: false,
    run: (c, a) => c.checkLink(a.url),
  }),
  tool({
    name: 'search_docs',
    description:
      'Search the Strait documentation (SDK setup for React Native / Expo, Flutter, Android, iOS, Unity, web and Node; App Links and ' +
      'Universal Links; deferred deep linking; analytics; REST API; webhooks; migrating from Firebase Dynamic Links or Branch; ' +
      'troubleshooting). Returns the closest-matching sections as Markdown with their URLs. Works offline.',
    inputSchema: {
      query: z.string().min(2).max(300),
      limit: z.number().int().min(1).max(10).optional().describe('Sections to return, default 4'),
    },
    annotations: { title: 'Search the docs', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    needsKey: false,
    run: async (_c, a) => {
      const hits = searchDocs(a.query, a.limit ?? 4);
      return {
        query: a.query,
        results: hits.map((h) => ({
          page: h.page,
          section: h.section,
          url: h.url,
          markdown: h.markdown.length > 2500 ? `${h.markdown.slice(0, 2500)}\n\n… (truncated; read the rest at ${h.url})` : h.markdown,
        })),
      };
    },
  }),
];

/** The guidance every client gets with the server (MCP `instructions`). */
export const SERVER_INSTRUCTIONS = [
  'Strait makes links open the right screen in a mobile app (deep links), including after an install (deferred deep links), and reports what happened to each tap.',
  'Keys: the secret key (st_live_…) is for servers and this MCP server only. Never put it in app or website code. Apps and websites use the publishable key (st_pub_live_…) with the Strait SDKs.',
  'Share a link by its shortUrl. Prefer batch_create_links over many create_link calls.',
  'update_link, pause_link, resume_link, deactivate_link, redeliver_webhook_delivery, record_event, add_domain and remove_domain change live behaviour: call them without confirm first, show the user the preview, and only then call them with confirm: true.',
  'To pause a link use pause_link; to turn a paused link back on, list_links with status: paused to find it, then resume_link.',
  'To find links by destination, title, tag or campaign use search_links. For "this week against last week" use compare_analytics; for the best-performing links use get_top_links.',
  'To check that a test tap or a purchase arrived: list_taps (last hour by default) and list_events (last 7 days).',
  'When a webhook seems to have stopped: list_webhooks to find it, list_webhook_deliveries, then test_webhook, then redeliver_webhook_delivery for failed deliveries.',
  'Custom link domains: list_domains shows each domain\'s status and the DNS records still to add.',
  'When a link opens the browser instead of the app, run check_app_links on the link domain and the app domain, then trace_tap on the link. check_link checks any vendor\'s link (Firebase page.link, Branch) before a migration.',
  'iPhone install matching (deferred deep linking on iOS) is in beta; Android uses the Play Install Referrer. On iPhone the workspace picks the method (device matching, paste handoff, both or neither) in Dashboard → Settings → iPhone installs, read by the SDK at runtime; device matching is off for new workspaces. Use search_docs before answering setup questions.',
].join('\n');
