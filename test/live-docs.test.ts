// search_docs reads the live docs (llms-full.txt + llms-recipes.txt on straitlink.in), cached for an hour,
// and falls back to the bundled index when offline or the fetch fails (ADR 0004).
import { afterEach, describe, expect, it } from 'vitest';
import { BUNDLED_SECTION_COUNT, LIVE_DOCS_TTL_MS, LIVE_DOCS_URLS, docsSections, parseLlmsText, resetLiveDocs, searchDocs } from '../src/docs.js';

const twin = (title: string, path: string, body: string, lead = 'A lead.') =>
  `# ${title}\n\n> ${lead}\n\n- Time: About 5 minutes\n\nSource: https://straitlink.in/${path}\n\n${body}\n`;

const FULL = `# Strait documentation (full text)\n\n> Deep links.\n\nEvery page of https://straitlink.in/docs/ in one file.\n\n> **Agent instructions:** use search_docs.\n\n${[
  twin('What is Strait?', 'docs/', 'Intro text.\n\n## A normal link vs a Strait link\n\nTable here.\n\n---\n\nAfter a rule, same page.\n\n## Start here\n\n```bash\n# a shell comment\nnpm i @straitlink/react-native@9.9.9\n```'),
  twin('Flutter deep linking', 'docs/sdks/flutter/', '## Install\n\nstrait_sdk: ^9.9.9'),
].join('\n---\n\n')}\n---\n\n# Pricing, Firebase Dynamic Links, iPhone status, security and glossary\n\nEach page is also at its own .md URL.\n\n${twin('Pricing', 'pricing/', '## Plans\n\nFree.')}\n---\n\n# Every other page (Markdown)\n\n- [Home](https://straitlink.in/index.md)\n`;
const RECIPES = `# Strait documentation for Recipes\n\n> Deep links.\n\n${[
  twin('What is Strait?', 'docs/', 'Intro text.'),
  twin('Recipe: referral links', 'docs/recipes/referrals/', '## Steps\n\nShare a code.'),
].join('\n---\n\n')}`;

describe('parseLlmsText', () => {
  const s = parseLlmsText(FULL, RECIPES);

  it('splits each docs page into its intro and ## sections, with the site anchors', () => {
    expect(s.map((x) => [x.page, x.section, x.url])).toEqual([
      ['What is Strait?', null, 'https://straitlink.in/docs/'],
      ['What is Strait?', 'A normal link vs a Strait link', 'https://straitlink.in/docs/#a-normal-link-vs-a-strait-link'],
      ['What is Strait?', 'Start here', 'https://straitlink.in/docs/#start-here'],
      ['Flutter deep linking', 'Install', 'https://straitlink.in/docs/sdks/flutter/#install'],
      ['Recipe: referral links', 'Steps', 'https://straitlink.in/docs/recipes/referrals/#steps'],
    ]);
  });

  it('keeps a horizontal rule and code comments inside the page, and drops non-docs pages and the file headers', () => {
    expect(s[1]!.markdown).toContain('After a rule, same page.');
    expect(s[2]!.markdown).toContain('# a shell comment');
    expect(s[3]!.markdown).toBe('strait_sdk: ^9.9.9');
    expect(s.some((x) => /Pricing|Every other page|Agent instructions/.test(x.page + x.markdown))).toBe(false);
  });
});

describe('docsSections (live with a bundled fallback)', () => {
  const realEnv = process.env.STRAIT_DOCS_OFFLINE;
  afterEach(() => {
    resetLiveDocs();
    if (realEnv === undefined) delete process.env.STRAIT_DOCS_OFFLINE;
    else process.env.STRAIT_DOCS_OFFLINE = realEnv;
  });
  const online = () => delete process.env.STRAIT_DOCS_OFFLINE;
  // Enough twins to pass the "at least half the bundled sections" sanity check.
  const big = `${FULL}\n---\n\n${Array.from({ length: BUNDLED_SECTION_COUNT }, (_, i) => twin(`Page ${i}`, `docs/p${i}/`, `## S${i}\n\nversion ${i}.0.0`)).join('\n---\n\n')}`;
  const fetchOf = (texts: Record<string, string>, calls: string[] = []) =>
    (async (url: string | URL) => {
      calls.push(String(url));
      const t = texts[String(url)];
      return t === undefined ? new Response('nope', { status: 503 }) : new Response(t, { status: 200, headers: { 'content-type': 'text/plain' } });
    }) as unknown as typeof fetch;
  const LIVE: Record<string, string> = { [LIVE_DOCS_URLS[0]]: big, [LIVE_DOCS_URLS[1]]: RECIPES };

  it('serves the live docs and fetches them once an hour', async () => {
    online();
    const calls: string[] = [];
    const f = fetchOf(LIVE, calls);
    const a = await docsSections({ fetch: f, now: 0 });
    expect(a.from).toBe('live');
    expect(searchDocs('flutter strait_sdk', 3, a.sections)[0]!.markdown).toContain('^9.9.9');
    expect(calls).toEqual([...LIVE_DOCS_URLS]);
    expect((await docsSections({ fetch: f, now: LIVE_DOCS_TTL_MS - 1 })).from).toBe('live');
    expect(calls).toHaveLength(2);
  });

  it('after an hour answers at once from the last copy and swaps in the new one when it lands', async () => {
    online();
    await docsSections({ fetch: fetchOf(LIVE), now: 0 });
    const releases: (() => void)[] = [];
    const newer: Record<string, string> = { ...LIVE, [LIVE_DOCS_URLS[0]]: big.replace('^9.9.9', '^10.0.0') };
    const slow = (async (url: string | URL) => {
      await new Promise<void>((r) => releases.push(r));
      return new Response(newer[String(url)]);
    }) as unknown as typeof fetch;
    const b = await docsSections({ fetch: slow, now: LIVE_DOCS_TTL_MS + 1 });
    expect(b.from).toBe('live');
    expect(searchDocs('flutter strait_sdk', 1, b.sections)[0]!.markdown).toContain('^9.9.9'); // the last copy, at once
    for (const r of releases) r();
    await new Promise((r) => setTimeout(r, 20));
    const c = await docsSections({ fetch: fetchOf({}), now: LIVE_DOCS_TTL_MS + 2 });
    expect(searchDocs('flutter strait_sdk', 1, c.sections)[0]!.markdown).toContain('^10.0.0');
  });

  it('calls that arrive while the first download runs all wait for it', async () => {
    online();
    const calls: string[] = [];
    const f = fetchOf(LIVE, calls);
    const all = await Promise.all([docsSections({ fetch: f, now: 0 }), docsSections({ fetch: f, now: 0 }), docsSections({ fetch: f, now: 0 })]);
    expect(all.map((x) => x.from)).toEqual(['live', 'live', 'live']);
    expect(calls).toHaveLength(2);
  });

  it('only the very first try makes a call wait: later retries run behind a bundled answer', async () => {
    online();
    await docsSections({ fetch: fetchOf({}), now: 0 });
    const hang = (() => new Promise(() => {})) as unknown as typeof fetch;
    const t0 = Date.now();
    expect((await docsSections({ fetch: hang, now: 5 * 60_000, timeoutMs: 1000 })).from).toBe('bundled');
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it('a download that never settles (a cut-off request) does not block later ones', async () => {
    online();
    const never = (() => new Promise(() => {})) as unknown as typeof fetch;
    void docsSections({ fetch: never, now: 0, timeoutMs: 10_000 }); // never settles, as if its request was cut off
    await new Promise((r) => setTimeout(r, 0));
    expect((await docsSections({ fetch: fetchOf(LIVE), now: 60_000, timeoutMs: 10_000 })).from).toBe('live');
  });

  it('stops reading a file past 4 MB even without a content-length', async () => {
    online();
    let sent = 0;
    const endless = (async (url: string | URL) =>
      String(url) === LIVE_DOCS_URLS[1]
        ? new Response(RECIPES)
        : new Response(new ReadableStream({ pull(c) { sent += 65536; c.enqueue(new Uint8Array(65536).fill(97)); } }))) as unknown as typeof fetch;
    expect((await docsSections({ fetch: endless, now: 0 })).from).toBe('bundled');
    expect(sent).toBeLessThan(6_000_000);
  });

  it('falls back to the bundled index when the site fails, and waits 5 minutes before trying again', async () => {
    online();
    const calls: string[] = [];
    const down = fetchOf({}, calls);
    const a = await docsSections({ fetch: down, now: 0 });
    expect(a.from).toBe('bundled');
    expect(a.sections).toHaveLength(BUNDLED_SECTION_COUNT);
    const n = calls.length;
    await docsSections({ fetch: down, now: 60_000 });
    expect(calls).toHaveLength(n);
    expect((await docsSections({ fetch: fetchOf(LIVE), now: 5 * 60_000 })).from).toBe('bundled'); // the retry runs behind this answer
    await new Promise((r) => setTimeout(r, 20));
    expect((await docsSections({ fetch: fetchOf({}), now: 5 * 60_000 + 1 })).from).toBe('live');
  });

  it('rejects a page that is not the docs (an HTML error page, a truncated file)', async () => {
    online();
    const html = fetchOf({ [LIVE_DOCS_URLS[0]]: '<!doctype html><title>Oops</title>', [LIVE_DOCS_URLS[1]]: RECIPES });
    expect((await docsSections({ fetch: html, now: 0 })).from).toBe('bundled');
  });

  it('does not follow a redirect off the site', async () => {
    online();
    const moved = (async () => new Response(null, { status: 302, headers: { location: 'https://example.com/llms-full.txt' } })) as unknown as typeof fetch;
    expect((await docsSections({ fetch: moved, now: 0 })).from).toBe('bundled');
  });

  it('falls back when the site is too slow', async () => {
    online();
    const hang = ((_u: string | URL, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch;
    const a = await docsSections({ fetch: hang, now: 0, timeoutMs: 20 });
    expect(a.from).toBe('bundled');
  });

  it('never touches the network with STRAIT_DOCS_OFFLINE=1', async () => {
    process.env.STRAIT_DOCS_OFFLINE = '1';
    const calls: string[] = [];
    expect((await docsSections({ fetch: fetchOf(LIVE, calls), now: 0 })).from).toBe('bundled');
    expect(calls).toEqual([]);
  });
});
