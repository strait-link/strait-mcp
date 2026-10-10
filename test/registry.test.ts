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

  it('is MIT (founder decision D16) and lists no undeployed remote', () => {
    expect(pkg.license).toBe('MIT');
    expect(readFileSync(new URL('../LICENSE', import.meta.url), 'utf8')).toMatch(/^MIT License/);
    expect(server.remotes).toBeUndefined();
  });
});
