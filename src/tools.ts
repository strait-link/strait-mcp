/**
 * The Strait MCP tools. Each tool is plain data plus a run() over StraitClient, so
 * the stdio server, the remote Worker and the tests all register the same list.
 */
import { z } from 'zod';
import type { StraitClient, NewLinkInput, LinkPatchInput } from './client.js';
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

// ── shared input pieces ─────────────────────────────────────────────────────
const slug = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'letters, digits, - and _ (1–64)').describe("The link's slug: the part after the link domain, e.g. `summer` in https://acme.strait.link/summer");
const httpsUrl = z.string().url().refine((u) => u.startsWith('https://'), 'must be an https URL');
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

const UPDATE_FIELDS = ['longUrl', 'title', 'tags', 'expiresAt', 'expiredAction', 'expiredUrl'] as const;

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
    description: 'List active links, newest first, one page at a time. Pass nextCursor back as cursor until it is null.',
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional().describe('Page size, default 50'),
      cursor: z.string().optional().describe('nextCursor from the previous page'),
    },
    annotations: { title: 'List links', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: (c, a) => c.listLinks(a),
  }),
  tool({
    name: 'update_link',
    description:
      'Change a live link: its destination, title, tags or expiry. People who tap the link afterwards go to the new destination, ' +
      'so this needs confirm: true. Without it nothing changes: you get a preview of the current and proposed values to show the user first. ' +
      'null clears expiresAt / expiredAction / expiredUrl.',
    inputSchema: {
      slug,
      longUrl: httpsUrl.optional(),
      title: z.string().max(200).optional(),
      tags: z.array(z.string().max(50)).max(20).optional(),
      expiresAt: when.nullable().optional(),
      expiredAction: z.enum(['page', 'store', 'url']).nullable().optional(),
      expiredUrl: httpsUrl.nullable().optional(),
      confirm: z.boolean().optional().describe('true to apply the change; omit or false to preview it'),
    },
    annotations: { title: 'Update a link', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    needsKey: true,
    run: async (c, a) => {
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
    inputSchema: { domain: z.string().min(3).max(253).describe('A domain such as acme.strait.link or shop.example.com (a full URL is reduced to its host)') },
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
  'update_link changes where live links go: call it without confirm first, show the user the preview, and only then call it with confirm: true.',
  'When a link opens the browser instead of the app, run check_app_links on the link domain and the app domain, then trace_tap on the link.',
  'iPhone install matching (deferred deep linking on iOS) is in beta; Android uses the Play Install Referrer. Use search_docs before answering setup questions.',
].join('\n');
