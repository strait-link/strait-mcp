// The Claude Code plugin (.claude-plugin/): hosted MCP server + strait-setup skill, key asked at enable time.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
const plugin = read('.claude-plugin/plugin.json');
const market = read('.claude-plugin/marketplace.json');

describe('Claude Code plugin', () => {
  it('connects to the hosted server with the key from a sensitive userConfig, never a literal key', () => {
    expect(plugin.name).toBe('strait');
    expect(plugin.mcpServers.strait).toEqual({ type: 'http', url: 'https://strait.link/mcp', headers: { Authorization: 'Bearer ${user_config.secret_key}' } });
    expect(plugin.userConfig.secret_key).toMatchObject({ type: 'string', sensitive: true, required: true });
    expect(JSON.stringify(plugin)).not.toMatch(/st_live_[0-9a-f]/);
    expect(JSON.stringify(plugin)).not.toContain('mcp.strait.link'); // the OAuth Worker is not deployed
  });

  it('ships the strait-setup skill and an icon; the marketplace lists the repo root as the plugin', () => {
    expect(existsSync(new URL('../skills/strait-setup/SKILL.md', import.meta.url))).toBe(true);
    expect(existsSync(new URL('../.claude-plugin/icon.png', import.meta.url))).toBe(true);
    expect(market.plugins).toEqual([expect.objectContaining({ name: 'strait', source: './' })]);
    expect(plugin.license).toBe('MIT');
    expect(plugin.privacyPolicyUrl).toBe('https://straitlink.in/legal/privacy/');
  });
});
