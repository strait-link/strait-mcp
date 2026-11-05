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
  it('lists six prompts, get_started first; debug_link takes a slug', async () => {
    const c = await connected();
    const { prompts } = await c.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['get_started', 'weekly_review', 'debug_link', 'setup_check', 'migrate_firebase_links', 'why_not_open']);
    expect(prompts.find((p) => p.name === 'debug_link')!.arguments).toEqual([expect.objectContaining({ name: 'slug', required: true })]);
  });

  it('every tool a prompt names exists (doctor finding ids such as host.file_missing are not tools), and none passes confirm: true', () => {
    const names = new Set(TOOLS.map((t) => t.name));
    for (const p of PROMPTS) {
      for (const args of [{ slug: 'summer' }, { slug: 'summer', platform: 'iphone', app: 'instagram' }, { old_domain: 'hilltop.page.link' }, { platform: 'flutter' }, { platform: 'expo' }]) {
        const text = p.text(args);
        for (const m of text.matchAll(/(?<![.\w])([a-z]+_[a-z_]+)\b/g)) expect(names.has(m[1]!), `${p.name}: ${m[1]}`).toBe(true);
        expect(text).not.toMatch(/confirm: true/);
      }
    }
  });

  it('only migrate_firebase_links and get_started may create links, and only after the user says yes', () => {
    const writes = /\b(batch_create_links|create_link|update_link|pause_link|resume_link|deactivate_link|add_domain|remove_domain|record_event|test_webhook|redeliver_webhook_delivery)\b/;
    const allowed: Record<string, string> = { migrate_firebase_links: 'batch_create_links', get_started: 'create_link' };
    for (const p of PROMPTS) {
      const text = p.text({ slug: 'summer' });
      if (!allowed[p.name]) {
        expect(text, p.name).not.toMatch(writes);
        continue;
      }
      const tool = allowed[p.name]!;
      const others = [...text.matchAll(new RegExp(writes, 'g'))].map((m) => m[1]).filter((t) => t !== tool);
      expect(others, p.name).toEqual([]);
      expect(text.indexOf('yes'), p.name).toBeGreaterThan(-1);
      expect(text.indexOf('yes'), p.name).toBeLessThan(text.indexOf(tool));
    }
  });

  it('get_started: key check first, the platform picks its SDK docs page, never the secret key in the app, verifies with test mode', async () => {
    const c = await connected();
    const { prompts } = await c.listPrompts();
    expect(prompts.find((p) => p.name === 'get_started')!.arguments).toEqual([expect.objectContaining({ name: 'platform', required: false })]);
    const get = async (a?: Record<string, string>) =>
      ((await c.getPrompt({ name: 'get_started', arguments: a })).messages[0]!.content as { text: string }).text;
    const bare = await get();
    expect(bare.indexOf('get_workspace')).toBeGreaterThan(-1);
    expect(bare.indexOf('get_workspace')).toBeLessThan(bare.indexOf('create_link'));
    expect(bare).toMatch(/pubspec\.yaml/); // no platform: detect it from the project files
    expect(bare).toMatch(/publishable key/);
    expect(bare).toMatch(/never .*secret key/i);
    expect(bare).toMatch(/Test mode/);
    expect(bare).toMatch(/checkDeferred\(\)/);
    expect(bare).toMatch(/list_taps/);
    expect(bare).toMatch(/check_app_links/);
    const flutter = await get({ platform: 'flutter' });
    expect(flutter).toContain('https://straitlink.in/docs/sdks/flutter.md');
    expect(flutter).not.toMatch(/pubspec\.yaml\)/);
    expect(await get({ platform: 'expo' })).toContain('https://straitlink.in/docs/sdks/expo.md');
    expect(await get({ platform: 'ios' })).toContain('https://straitlink.in/docs/sdks/ios.md');
    await expect(c.getPrompt({ name: 'get_started', arguments: { platform: 'windows' } })).rejects.toThrow();
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
