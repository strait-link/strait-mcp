/**
 * search_docs: keyword search over the Strait docs. It reads the live docs the website publishes
 * for AI tools (llms-full.txt + llms-recipes.txt on straitlink.in), keeps them for an hour, and
 * falls back to the bundled copy (src/docs-index.json, built by scripts/build-docs-index.mjs) when
 * the site is slow, down or unreachable, or when STRAIT_DOCS_OFFLINE=1. The fetch is a plain GET of
 * a public file: the query never leaves the machine (ADR docs/adr/0004-live-docs.md).
 */
import index from './docs-index.json' with { type: 'json' };

export interface DocSection {
  page: string;
  group: string;
  section: string | null;
  url: string;
  markdown: string;
}

export interface DocHit extends DocSection {
  score: number;
}

const SECTIONS: DocSection[] = (index as { sections: DocSection[] }).sections;

const STOP = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from', 'how', 'i', 'in', 'is', 'it', 'my', 'of', 'on', 'or', 'the', 'to', 'what', 'when', 'why', 'with', 'you', 'your', 'strait']);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[`*_#>\[\]()|]/g, ' ')
    .split(/[^a-z0-9.+-]+/)
    .map((t) => t.replace(/^[.+-]+|[.+-]+$/g, ''))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

interface Indexed {
  s: DocSection;
  tf: Map<string, number>;
  head: Set<string>;
  len: number;
}

type Built = { docs: Indexed[]; df: Map<string, number>; avg: number };
const builtFor = new WeakMap<DocSection[], Built>();
function build(sections: DocSection[]): Built {
  const cached = builtFor.get(sections);
  if (cached) return cached;
  const docs = sections.map((s) => {
    const words = tokens(s.markdown);
    const tf = new Map<string, number>();
    for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
    return { s, tf, head: new Set(tokens(`${s.page} ${s.section ?? ''}`)), len: words.length };
  });
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set([...d.tf.keys(), ...d.head])) df.set(w, (df.get(w) ?? 0) + 1);
  const avg = docs.reduce((n, d) => n + d.len, 0) / Math.max(1, docs.length);
  const b = { docs, df, avg };
  builtFor.set(sections, b);
  return b;
}

/** BM25 over section text, plus a boost when a query word is in the page title or section heading. */
export function searchDocs(query: string, limit = 5, sections: DocSection[] = SECTIONS): DocHit[] {
  const { docs, df, avg } = build(sections);
  const q = [...new Set(tokens(query))];
  if (!q.length) return [];
  const N = docs.length;
  const k1 = 1.2;
  const b = 0.75;
  const hits: DocHit[] = [];
  for (const d of docs) {
    let score = 0;
    for (const w of q) {
      const n = df.get(w) ?? 0;
      if (!n) continue;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const f = d.tf.get(w) ?? 0;
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg)));
      if (d.head.has(w)) score += idf * 1.5;
    }
    if (score > 0) hits.push({ ...d.s, score: Math.round(score * 100) / 100 });
  }
  return hits.sort((x, y) => y.score - x.score).slice(0, Math.max(1, Math.min(limit, 20)));
}

export const BUNDLED_SECTION_COUNT = SECTIONS.length;

const ORIGIN = 'https://straitlink.in';
export const LIVE_DOCS_URLS = [`${ORIGIN}/llms-full.txt`, `${ORIGIN}/llms-recipes.txt`] as const;
export const LIVE_DOCS_TTL_MS = 60 * 60_000;
const RETRY_AFTER_FAIL_MS = 5 * 60_000;
const MAX_BYTES = 4_000_000;

/** The site's heading anchors (site/lib/markdown.mjs slugify). */
const slugify = (t: string) =>
  t.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-');

/**
 * The site's llms text files → sections, the same shape scripts/build-docs-index.mjs makes from the
 * Markdown sources. Each page there is `# Title`, a lead, `Source: <url>`, then the body; pages are
 * joined by `---` lines. Only /docs/ pages are kept, each page once (the recipes file repeats the
 * getting-started pages).
 */
export function parseLlmsText(...texts: string[]): DocSection[] {
  const groupOf = new Map(SECTIONS.map((s) => [s.url.split('#')[0], s.group]));
  const seen = new Set<string>();
  const out: DocSection[] = [];
  for (const text of texts) {
    const pages: { title: string; url: string; body: string }[] = [];
    for (const chunk of text.split(/\n---\n\n(?=# )/)) {
      // Header: "# Title", then lines that are not headings, then "Source: <url>".
      const m = /^# ([^\n]+)\n\n(?:(?:[^#\n][^\n]*)?\n)*?Source: (https:\/\/\S+)\n/m.exec(chunk);
      if (m) pages.push({ title: m[1]!.trim(), url: m[2]!, body: chunk.slice(m.index + m[0].length) });
      else if (pages.length) pages[pages.length - 1]!.body += `\n---\n\n${chunk}`; // a rule inside a page
    }
    for (const p of pages) {
      if (!p.url.startsWith(`${ORIGIN}/docs/`) || seen.has(p.url)) continue;
      seen.add(p.url);
      const group = groupOf.get(p.url) ?? 'Docs';
      const parts = p.body.split(/^## +/m);
      const push = (section: string | null, url: string, body: string) => {
        const markdown = body.replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim();
        if (markdown) out.push({ page: p.title, group, section, url, markdown });
      };
      push(null, p.url, parts.shift() ?? '');
      for (const part of parts) {
        const nl = part.indexOf('\n');
        const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
        push(heading, `${p.url}#${slugify(heading)}`, nl === -1 ? '' : part.slice(nl + 1));
      }
    }
  }
  return out;
}

/** The body as text, read in pieces and cut off past MAX_BYTES (the site sends it compressed, with no length). */
async function readCapped(res: Response, url: string): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error(`${url}: over ${MAX_BYTES} bytes`);
    }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let at = 0;
  for (const p of parts) all.set(p, (at += p.byteLength) - p.byteLength);
  return new TextDecoder().decode(all);
}

async function fetchLive(f: typeof fetch, timeoutMs: number): Promise<DocSection[]> {
  const signal = AbortSignal.timeout(timeoutMs);
  const texts = await Promise.all(
    LIVE_DOCS_URLS.map(async (url) => {
      const res = await f(url, { signal, redirect: 'manual', headers: { accept: 'text/plain' } }); // a redirect is a failure: only this host
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new Error(`${url}: HTTP ${res.status}`);
      }
      return readCapped(res, url);
    }),
  );
  const sections = parseLlmsText(...texts);
  // An error page or a cut-off file parses to a few sections at most: keep the bundled copy then.
  if (sections.length < SECTIONS.length / 2) throw new Error(`live docs: ${sections.length} sections`);
  return sections;
}

let live: { sections: DocSection[]; at: number } | null = null;
let failedAt = -Infinity;
/** The download under way; wait = callers without a live copy wait for it (only on the very first try). */
let inflight: { job: Promise<void>; until: number; wait: boolean } | null = null;

const offline = () => /^(1|true|yes)$/i.test((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.STRAIT_DOCS_OFFLINE ?? '');

/**
 * The sections search_docs searches. The very first try waits for the live docs (at most timeoutMs), and so does
 * every call that arrives during it; later calls answer at once from what is there (the last live copy, else the
 * bundled one) and, when that copy is an hour old or the last try failed 5 minutes ago, refresh in the background.
 */
export async function docsSections(opts: { fetch?: typeof fetch; now?: number; timeoutMs?: number } = {}): Promise<{ sections: DocSection[]; from: 'live' | 'bundled' }> {
  if (offline()) return { sections: SECTIONS, from: 'bundled' };
  const now = opts.now ?? Date.now();
  const timeoutMs = opts.timeoutMs ?? 3000;
  // A download that never settled (its request was cut off, e.g. in a Worker) stops counting after its time is up.
  if (inflight && now > inflight.until) inflight = null;
  if (!inflight && (!live || now - live.at >= LIVE_DOCS_TTL_MS) && now - failedAt >= RETRY_AFTER_FAIL_MS) {
    const mine = { job: Promise.resolve(), until: now + 2 * timeoutMs, wait: !live && failedAt === -Infinity };
    inflight = mine;
    mine.job = fetchLive(opts.fetch ?? ((...a) => fetch(...a)), timeoutMs)
      .then((sections) => void (live = { sections, at: now }))
      .catch(() => void (failedAt = now))
      .finally(() => void (inflight === mine && (inflight = null)));
  }
  if (!live && inflight?.wait) await inflight.job;
  return live ? { sections: live.sections, from: 'live' } : { sections: SECTIONS, from: 'bundled' };
}

/** Tests only: forget the live copy. */
export function resetLiveDocs() {
  live = null;
  failedAt = -Infinity;
  inflight = null;
}
