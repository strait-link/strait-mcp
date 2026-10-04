import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createStraitServer } from '../src/server.js';
import { LINK, mockClient } from './helpers.js';

// The MCP protocol layer without a child process: list tools, call one, validate input.
async function connect() {
  const { client: api, calls } = mockClient(() => ({ status: 201, body: LINK }));
  const server = createStraitServer(api);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'protocol-test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, calls };
}

describe('MCP protocol', () => {
  it('lists ten tools with JSON Schemas and annotations', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(10);
    const batch = tools.find((t) => t.name === 'batch_create_links')!;
    expect(batch.inputSchema).toMatchObject({ type: 'object', required: ['links'] });
    expect(tools.find((t) => t.name === 'search_docs')!.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(client.getServerVersion()).toMatchObject({ name: 'strait' });
  });

  it('calls a tool', async () => {
    const { client, calls } = await connect();
    const r = (await client.callTool({ name: 'create_link', arguments: { slug: 'summer', longUrl: 'https://shop.example.com/summer' } })) as { content: Array<{ text: string }> };
    expect(JSON.parse(r.content[0]!.text).slug).toBe('summer');
    expect(calls).toHaveLength(1);
  });

  it('rejects invalid input before any API call (http destination, bad slug)', async () => {
    const { client, calls } = await connect();
    const r1 = (await client.callTool({ name: 'create_link', arguments: { slug: 'summer', longUrl: 'http://shop.example.com/summer' } })) as { isError?: boolean };
    const r2 = (await client.callTool({ name: 'get_link', arguments: { slug: '../etc' } })) as { isError?: boolean };
    expect(r1.isError).toBe(true);
    expect(r2.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
