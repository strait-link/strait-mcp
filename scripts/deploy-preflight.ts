/**
 * Checks wrangler.jsonc before the founder deploys the remote MCP server.
 *
 *   npm run deploy:preflight   → exit 0 when ready to deploy, 1 with a list of what to fix
 *
 * The same rules run in test/deploy-config.test.ts (with forDeploy: false, because the
 * KV namespace id is a placeholder until the founder creates it).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Json = Record<string, unknown>;

/** wrangler.jsonc → object. Only whole-line // comments are allowed (URLs inside strings stay intact). */
export function parseJsonc(text: string): Json {
  return JSON.parse(
    text
      .split('\n')
      .filter((l) => !/^\s*\/\//.test(l))
      .join('\n'),
  ) as Json;
}

const PLACEHOLDER = /REPLACE_WITH/;

/** Problems with the config, as plain sentences. Empty = fine. */
export function checkDeployConfig(cfg: Json, { forDeploy }: { forDeploy: boolean }): string[] {
  const out: string[] = [];
  const vars = (cfg.vars ?? {}) as Json;
  if (vars.REMOTE_MCP === 'on') out.push('Top-level REMOTE_MCP must stay "off" (it is the local-dev config).');
  if (cfg.workers_dev !== false) out.push('Top-level workers_dev must be false.');

  const prod = ((cfg.env ?? {}) as Json).production as Json | undefined;
  if (!prod) return [...out, 'env.production is missing.'];
  const pv = (prod.vars ?? {}) as Json;
  if (prod.name !== 'strait-mcp') out.push('env.production.name must be "strait-mcp".');
  if (pv.REMOTE_MCP !== 'on') out.push('env.production.vars.REMOTE_MCP must be "on".');
  if (pv.MCP_ORIGIN !== 'https://mcp.strait.link') out.push('env.production.vars.MCP_ORIGIN must be https://mcp.strait.link.');
  if (typeof pv.STRAIT_API_URL !== 'string' || !pv.STRAIT_API_URL.startsWith('https://')) out.push('env.production.vars.STRAIT_API_URL must be an https URL.');
  if (prod.workers_dev !== false) out.push('env.production.workers_dev must be false (no public *.workers.dev copy).');
  if (prod.preview_urls !== false) out.push('env.production.preview_urls must be false.');
  const routes = (prod.routes ?? []) as Json[];
  if (!routes.some((r) => r.pattern === 'mcp.strait.link' && r.custom_domain === true)) out.push('env.production.routes needs { "pattern": "mcp.strait.link", "custom_domain": true }.');
  const kv = ((prod.kv_namespaces ?? []) as Json[]).find((k) => k.binding === 'OAUTH_KV');
  if (!kv) out.push('env.production.kv_namespaces needs the OAUTH_KV binding.');
  else if (forDeploy && (typeof kv.id !== 'string' || PLACEHOLDER.test(kv.id) || !/^[0-9a-f]{32}$/.test(kv.id))) {
    out.push('env.production OAUTH_KV id is still a placeholder: run `npx wrangler@4 kv namespace create OAUTH_KV --env production` and paste the 32-character id.');
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cfg = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const problems = checkDeployConfig(cfg, { forDeploy: true });
  if (problems.length) {
    console.error(`Not ready to deploy:\n${problems.map((p) => `- ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log('wrangler.jsonc is ready for `npx wrangler@4 deploy --env production`.');
}
