// The skills in the Claude Code plugin: each one names only real MCP tools and prompts, and links only real docs pages.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROMPTS } from '../src/prompts.js';
import { TOOLS } from '../src/tools.js';
import docs from '../src/docs-index.json' with { type: 'json' };

const SKILLS = ['strait-troubleshoot', 'strait-events', 'strait-migration'];
const file = (s: string) => new URL(`../skills/${s}/SKILL.md`, import.meta.url);
// The check ids GET /v1/app/verify returns (redirect-engine src/core/app-config.ts, 10 Nov 2026); app_file and
// sdk_current come back as app_file.<platform>.<host> and sdk_current[.<platform>.<version>].
const VERIFY_CHECKS = ['android_app', 'ios_app', 'app_file', 'sdk_connected', 'sdk_current', 'link_opens', 'webhooks'];
const real = new Set([...TOOLS.map((t) => t.name), ...PROMPTS.map((p) => p.name)]);
// snake_case words in backticks that are not tools: link-event reasons, API fields, Branch keys, test-mode reasons.
const NOT_TOOLS = new Set([
  'not_found', 'no_match', 'no_tap', 'other_device',
  'utm_source', 'pending_dns', 'deeplink_path', 'canonical_url', 'ios_url', 'android_url',
  'og_title', 'og_description', 'og_image_url', 'fallback_url', 'desktop_url', 'one_time_use',
  'key_scope', ...VERIFY_CHECKS,
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

// MCP 0.9.0 (ADR 0003): troubleshooting starts with the one tool that names what is wrong, then walks each check's fix.
describe('strait-troubleshoot starts with verify_app_setup', () => {
  const text = readFileSync(file('strait-troubleshoot'), 'utf8');
  const body = text.slice(text.indexOf('\n# '));
  const steps = body.slice(body.indexOf('\n## '));

  it('the first step calls verify_app_setup, before any other tool, and says to run it again until ok is true', () => {
    const tools = [...steps.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]!).filter((n) => real.has(n));
    expect(tools[0]).toBe('verify_app_setup');
    expect(steps.slice(0, steps.indexOf('\n## ', 4))).toMatch(/again[^\n]*`ok`[^\n]*true/);
    expect(text.split('\n')[2]).toMatch(/verify_app_setup/); // the description, so the skill is picked for it
  });

  it('walks every check id the engine returns, and the CLI fallback when there is no MCP', () => {
    for (const id of VERIFY_CHECKS) expect(steps, id).toMatch(new RegExp('`' + id + '[`.]'));
    expect(text).toContain('npx @straitlink/cli app verify');
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
