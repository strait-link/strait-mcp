import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SERVER_VERSION } from '../src/server.js';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
const pkg = read('package.json');
const server = read('server.json');

describe('MCP registry draft (server.json + package.json mcpName)', () => {
  it('uses one name in both files (the registry rejects a mismatch)', () => {
    expect(server.name).toBe('in.straitlink/mcp');
    expect(pkg.mcpName).toBe(server.name);
  });

  it('points at the npm package with matching versions', () => {
    expect(server.version).toBe(pkg.version);
    expect(SERVER_VERSION).toBe(pkg.version);
    expect(server.packages).toHaveLength(1);
    expect(server.packages[0]).toMatchObject({ registryType: 'npm', identifier: pkg.name, version: pkg.version, transport: { type: 'stdio' } });
  });

  it('marks the secret key as a secret and keeps the description within the registry limit', () => {
    const key = server.packages[0].environmentVariables.find((e: { name: string }) => e.name === 'STRAIT_SECRET_KEY');
    expect(key).toMatchObject({ isSecret: true });
    expect(server.description.length).toBeLessThanOrEqual(100);
  });

  it('is MIT (founder decision D16) and lists only the live hosted remote (engine /mcp, ADR 0054)', () => {
    expect(pkg.license).toBe('MIT');
    expect(readFileSync(new URL('../LICENSE', import.meta.url), 'utf8')).toMatch(/^MIT License/);
    expect(server.remotes).toEqual([
      expect.objectContaining({ type: 'streamable-http', url: 'https://strait.link/mcp', headers: [expect.objectContaining({ name: 'Authorization', isRequired: true, isSecret: true })] }),
    ]);
    expect(JSON.stringify(server)).not.toContain('mcp.strait.link'); // the OAuth Worker is not deployed
    expect(server.repository).toEqual({ url: 'https://github.com/strait-link/strait-mcp', source: 'github' });
  });
});
