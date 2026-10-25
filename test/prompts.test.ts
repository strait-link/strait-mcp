import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createStraitServer } from '../src/server.js';
import { PROMPTS } from '../src/prompts.js';
import { TOOLS } from '../src/tools.js';
import { mockClient } from './helpers.js';

async function connected() {
  const server = createStraitServer(mockClient(() => ({ body: {} })).client);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe('prompts', () => {
  it('lists five prompts; debug_link takes a slug', async () => {
    const c = await connected();
    const { prompts } = await c.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['weekly_review', 'debug_link', 'setup_check', 'migrate_firebase_links', 'why_not_open']);
    expect(prompts.find((p) => p.name === 'debug_link')!.arguments).toEqual([expect.objectContaining({ name: 'slug', required: true })]);
  });

  it('every tool a prompt names exists (doctor finding ids such as host.file_missing are not tools), and none passes confirm: true', () => {
    const names = new Set(TOOLS.map((t) => t.name));
    for (const p of PROMPTS) {
      for (const args of [{ slug: 'summer' }, { slug: 'summer', platform: 'iphone', app: 'instagram' }, { old_domain: 'hilltop.page.link' }]) {
        const text = p.text(args);
        for (const m of text.matchAll(/(?<![.\w])([a-z]+_[a-z_]+)\b/g)) expect(names.has(m[1]!), `${p.name}: ${m[1]}`).toBe(true);
        expect(text).not.toMatch(/confirm: true/);
      }
    }
  });

  it('only migrate_firebase_links may create links, and only after the user says yes', () => {
    const writes = /\b(batch_create_links|create_link|update_link|pause_link|resume_link|deactivate_link|add_domain|remove_domain|record_event|test_webhook|redeliver_webhook_delivery)\b/;
    for (const p of PROMPTS) {
      const text = p.text({ slug: 'summer' });
      if (p.name !== 'migrate_firebase_links') expect(text, p.name).not.toMatch(writes);
    }
    const m = PROMPTS.find((p) => p.name === 'migrate_firebase_links')!.text({});
    expect(m).toMatch(/batch_create_links/);
    expect(m.indexOf('yes')).toBeGreaterThan(-1);
    expect(m.indexOf('yes')).toBeLessThan(m.indexOf('batch_create_links'));
  });

  it('migrate_firebase_links: old_domain is optional; given, it is in the text; not a domain, refused', async () => {
    const c = await connected();
    const bare = await c.getPrompt({ name: 'migrate_firebase_links' });
    expect((bare.messages[0]!.content as { text: string }).text).toMatch(/search_docs/);
    const r = await c.getPrompt({ name: 'migrate_firebase_links', arguments: { old_domain: 'hilltop.page.link' } });
    const text = (r.messages[0]!.content as { text: string }).text;
    expect(text).toContain('hilltop.page.link');
    expect(text).toMatch(/check_link/);
    await expect(c.getPrompt({ name: 'migrate_firebase_links', arguments: { old_domain: 'https://x"; drop' } })).rejects.toThrow();
  });

  it('why_not_open: slug required; platform and app pick the simulate_tap preset; the doctor ids are explained', async () => {
    const c = await connected();
    const { prompts } = await c.listPrompts();
    const args = prompts.find((p) => p.name === 'why_not_open')!.arguments!;
    expect(args.map((a) => [a.name, a.required ?? false])).toEqual([['slug', true], ['platform', false], ['app', false]]);
    const get = async (a: Record<string, string>) =>
      ((await c.getPrompt({ name: 'why_not_open', arguments: a })).messages[0]!.content as { text: string }).text;
    const ig = await get({ slug: 'summer', platform: 'iphone', app: 'instagram' });
    expect(ig).toContain('"summer"');
    expect(ig).toMatch(/simulate_tap .*ua "instagram-ios"/);
    expect(await get({ slug: 'summer', platform: 'android', app: 'whatsapp' })).toMatch(/ua "whatsapp-android"/);
    expect(await get({ slug: 'summer', platform: 'iphone', app: 'whatsapp' })).toMatch(/ua "iphone"/);
    const any = await get({ slug: 'summer' });
    expect(any).toMatch(/trace_tap/);
    for (const id of ['key.secret', 'key.invalid', 'endpoint.invalid', 'host.unreachable', 'host.file_missing', 'app.none', 'app.unknown', 'app.missing', 'cert.missing'])
      expect(any, id).toContain(id);
    await expect(c.getPrompt({ name: 'why_not_open', arguments: { slug: 'summer', platform: 'windows' } })).rejects.toThrow();
    await expect(c.getPrompt({ name: 'why_not_open', arguments: { slug: 'not a slug' } })).rejects.toThrow();
  });

  it('get returns one user message; debug_link puts the slug in it', async () => {
    const c = await connected();
    const r = await c.getPrompt({ name: 'debug_link', arguments: { slug: 'summer' } });
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]!.role).toBe('user');
    expect((r.messages[0]!.content as { text: string }).text).toContain('"summer"');
    const w = await c.getPrompt({ name: 'weekly_review' });
    expect((w.messages[0]!.content as { text: string }).text).toMatch(/compare_analytics/);
  });

  it('debug_link refuses a slug that is not one', async () => {
    const c = await connected();
    await expect(c.getPrompt({ name: 'debug_link', arguments: { slug: 'not a slug"; drop' } })).rejects.toThrow();
  });
});
