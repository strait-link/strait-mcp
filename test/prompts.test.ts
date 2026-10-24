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
  it('lists three prompts; debug_link takes a slug', async () => {
    const c = await connected();
    const { prompts } = await c.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['weekly_review', 'debug_link', 'setup_check']);
    expect(prompts.find((p) => p.name === 'debug_link')!.arguments).toEqual([expect.objectContaining({ name: 'slug', required: true })]);
  });

  it('every tool a prompt names exists, and the prompts never ask for a change', () => {
    const names = new Set(TOOLS.map((t) => t.name));
    for (const p of PROMPTS) {
      const text = p.text({ slug: 'summer' });
      for (const m of text.matchAll(/\b([a-z]+_[a-z_]+)\b/g)) expect(names.has(m[1]!), `${p.name}: ${m[1]}`).toBe(true);
      expect(text).not.toMatch(/confirm: true/);
    }
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
