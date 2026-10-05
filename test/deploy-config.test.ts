import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkDeployConfig, parseJsonc } from '../scripts/deploy-preflight.js';

const cfg = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const clone = () => JSON.parse(JSON.stringify(cfg)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('wrangler.jsonc (remote MCP deploy config)', () => {
  it('is deploy-shaped: only the KV namespace id is left for the founder', () => {
    expect(checkDeployConfig(cfg, { forDeploy: false })).toEqual([]);
    const forDeploy = checkDeployConfig(cfg, { forDeploy: true });
    expect(forDeploy).toHaveLength(1);
    expect(forDeploy[0]).toMatch(/OAUTH_KV id is still a placeholder/);
  });

  it('passes the deploy preflight once a real KV id is pasted', () => {
    const c = clone();
    c.env.production.kv_namespaces[0].id = '0123456789abcdef0123456789abcdef';
    expect(checkDeployConfig(c, { forDeploy: true })).toEqual([]);
  });

  it('keeps the local config off and production on mcp.strait.link only', () => {
    expect(cfg.vars).toMatchObject({ REMOTE_MCP: 'off' });
    const prod = (cfg.env as any).production; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(prod.vars).toMatchObject({ REMOTE_MCP: 'on', MCP_ORIGIN: 'https://mcp.strait.link' });
    expect(prod.routes).toEqual([{ pattern: 'mcp.strait.link', custom_domain: true }]);
  });

  it('flags the unsafe changes', () => {
    const on = clone();
    on.vars.REMOTE_MCP = 'on';
    expect(checkDeployConfig(on, { forDeploy: false }).join(' ')).toMatch(/Top-level REMOTE_MCP/);
    const dev = clone();
    dev.env.production.workers_dev = true;
    expect(checkDeployConfig(dev, { forDeploy: false }).join(' ')).toMatch(/workers\.dev/);
    const noRoute = clone();
    noRoute.env.production.routes = [];
    expect(checkDeployConfig(noRoute, { forDeploy: false }).join(' ')).toMatch(/mcp\.strait\.link/);
  });
});
