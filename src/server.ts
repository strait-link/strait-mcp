/**
 * createStraitServer(): an McpServer with every Strait tool registered. Used by
 * the stdio entry (src/stdio.ts), the remote Worker (src/worker.ts) and the tests.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StraitApiError, type StraitClient } from './client.js';
import { PROMPTS, type StraitPrompt } from './prompts.js';
import { SERVER_INSTRUCTIONS, TOOLS, ToolContent, type ContentBlock, type StraitTool } from './tools.js';

export const SERVER_NAME = 'strait';
export const SERVER_VERSION = '0.4.1';

/** Anything shaped like a secret key (st_live_… / st_test_…) never leaves the server in a tool result. */
const SECRET_KEY_SHAPE = /(?<![A-Za-z0-9])st_(?:live|test)_[A-Za-z0-9_-]+/g;
export const redactSecrets = (text: string) => text.replace(SECRET_KEY_SHAPE, 'st_…[redacted]');

type ToolResult = { content: ContentBlock[]; isError?: boolean };

/** Turns a tool's return value (or error) into an MCP tool result. Errors are results, not protocol errors. */
export async function runTool(t: StraitTool, client: StraitClient, args: unknown): Promise<ToolResult> {
  try {
    if (t.needsKey && !client.hasSecretKey) {
      return {
        isError: true,
        content: [{ type: 'text', text: `${t.name} needs a Strait secret key. Set STRAIT_SECRET_KEY (st_live_…, from Dashboard → Settings → Secret keys) in this MCP server's environment.` }],
      };
    }
    const out = await t.run(client, args as never);
    if (out instanceof ToolContent) {
      return { content: out.content.map((b) => (b.type === 'text' ? { type: 'text', text: redactSecrets(b.text) } : b)) };
    }
    return { content: [{ type: 'text', text: redactSecrets(JSON.stringify(out ?? { ok: true }, null, 2)) }] };
  } catch (err) {
    const text =
      err instanceof StraitApiError
        ? `${err.message}${err.body && typeof err.body === 'object' ? `\n${JSON.stringify(err.body)}` : ''}`
        : err instanceof Error
          ? err.message
          : String(err);
    return { isError: true, content: [{ type: 'text', text: redactSecrets(text) }] };
  }
}

export function createStraitServer(client: StraitClient, tools: StraitTool[] = TOOLS, prompts: StraitPrompt[] = PROMPTS): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });
  for (const p of prompts) {
    server.registerPrompt(p.name, { title: p.title, description: p.description, argsSchema: p.argsSchema }, (args: unknown) => ({
      // Without argsSchema the SDK passes only `extra`, never arguments.
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: p.text(p.argsSchema ? (args as Record<string, string | undefined>) : {}) } }],
    }));
  }
  for (const t of tools) {
    server.registerTool(
      t.name,
      { title: t.annotations.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations },
      (args: unknown) => runTool(t, client, args),
    );
  }
  return server;
}
