// The skills in the Claude Code plugin: each one names only real MCP tools and prompts, and links only real docs pages.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROMPTS } from '../src/prompts.js';
import { TOOLS } from '../src/tools.js';
import docs from '../src/docs-index.json' with { type: 'json' };

const SKILLS = ['strait-troubleshoot', 'strait-events', 'strait-migration'];
const file = (s: string) => new URL(`../skills/${s}/SKILL.md`, import.meta.url);
const real = new Set([...TOOLS.map((t) => t.name), ...PROMPTS.map((p) => p.name)]);
// snake_case words in backticks that are not tools: link-event reasons, API fields, Branch keys, test-mode reasons.
const NOT_TOOLS = new Set([
  'not_found', 'no_match', 'no_tap', 'other_device',
  'utm_source', 'pending_dns', 'deeplink_path', 'canonical_url', 'ios_url', 'android_url',
  'og_title', 'og_description', 'og_image_url', 'fallback_url', 'desktop_url', 'one_time_use',
]);
const pages = new Set(docs.sections.map((s: { url: string }) => s.url.split('#')[0]));

describe.each(SKILLS)('skill %s', (name) => {
  const text = existsSync(file(name)) ? readFileSync(file(name), 'utf8') : '';

  it('exists with a name and a "Use when" description, and stays short', () => {
    expect(text).toMatch(new RegExp(`^---\\nname: ${name}\\ndescription: [^\\n]*Use when[^\\n]*\\n---\\n`));
    expect(text.split('\n').length).toBeLessThanOrEqual(100);
  });

  it('names only real MCP tools and prompts', () => {
    const named = [...text.matchAll(/`\$?([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]!);
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((n) => !real.has(n) && !NOT_TOOLS.has(n))).toEqual([]);
  });

  it('links only docs pages that exist, and never a secret key', () => {
    const links = [...text.matchAll(/https:\/\/straitlink\.in\/docs\/[^\s)`#]*/g)].map((m) => m[0].replace(/\.md$/, '/'));
    expect(links.length).toBeGreaterThan(0);
    expect(links.filter((u) => !pages.has(u))).toEqual([]);
    expect(text).not.toMatch(/st_live_[0-9a-f]/);
  });
});

// Web SDK 0.8.3 (ADR 0003 there): deferred links resolve in the app; resolveDeferredLink is deprecated on the web
// (no request, always matched: false). Neither search_docs nor a skill may tell a website to call it.
describe('web: no resolveDeferredLink advice for websites', () => {
  const web = docs.sections.filter((s: { url: string }) => /\/docs\/sdks\/web\//.test(s.url));
  const all = ['strait-setup', ...SKILLS].map((s) => readFileSync(file(s), 'utf8'));

  it('the web SDK docs in search_docs say it is deprecated and show no call to it', () => {
    expect(web.length).toBeGreaterThan(0);
    for (const s of web as { markdown: string }[]) expect(s.markdown).not.toMatch(/import \{ resolveDeferredLink \}|await resolveDeferredLink\(/);
    expect(web.some((s: { markdown: string }) => /`resolveDeferredLink` is \*\*deprecated\*\*[^]*not available on the web/.test(s.markdown))).toBe(true);
  });

  it('every skill line that names resolveDeferredLink says not to use it on the web', () => {
    for (const text of all) {
      for (const line of text.split('\n').filter((l) => l.includes('resolveDeferredLink'))) expect(line).toMatch(/deprecated|never add/i);
    }
  });
});
