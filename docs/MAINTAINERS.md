# Maintaining @straitlink/mcp

For the Strait team and contributors (moved out of the README on 7 Nov 2026 so the npm page only shows what users need).

## Develop

```sh
npm ci
npm run typecheck     # Node, tests and the Worker
npm test              # unit, protocol, Worker and an end-to-end test against a local engine
npm run build
npm run inspect       # MCP Inspector CLI: lists the tools
npm run docs-index    # rebuild src/docs-index.json from ../site/content/docs
npm run skill:sync    # regenerate skills/strait-setup/SKILL.md from ../site
npm run deploy:check  # wrangler dry run of the production Worker (nothing uploaded)
```

The end-to-end test (`test/integration.test.ts`) starts the real engine from `../redirect-engine` (or
`ENGINE_DIR`) with its in-memory store, runs this server over stdio as a child process, creates a link and reads
it back. It is skipped when no engine checkout with installed dependencies is next to this repo.

## Claude Code skills (maintenance)

The site repo owns it (`site/lib/skill.mjs`, fed by `site.config.json`, so install lines and versions match the
docs). Don't edit this copy by hand: run `npm run skill:sync` (needs `../site` or `SITE_DIR`). The site's tests fail
when this copy drifts.

`skills/strait-troubleshoot`, `skills/strait-events` and `skills/strait-migration` are edited here. They name only
real MCP tools and prompts and link only real docs pages; `test/skills.test.ts` checks both against `src/tools.ts`,
`src/prompts.ts` and `src/docs-index.json`.

## MCP registry listing

`server.json` and the `mcpName` field in `package.json` list this server on the
[official MCP registry](https://registry.modelcontextprotocol.io) as `in.straitlink/mcp`. The registry checks that `mcpName` in the published npm package matches `server.json` `name`
([package types](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/package-types.mdx)).

- **Namespace `in.straitlink/mcp`.** Reverse-DNS of `straitlink.in`, proven with HTTP authentication
  ([authentication](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx)):
  the site serves the Ed25519 public key at `https://straitlink.in/.well-known/mcp-registry-auth`
  (`v=MCPv1; k=ed25519; p=<public key>`, written by the site's `lib/seo.mjs`), and the private key is the
  `MCP_REGISTRY_PRIVATE_KEY` Actions secret of this repo. No DNS change and no personal login.
- `remotes` lists the hosted server `https://strait.link/mcp` (Streamable HTTP, `Authorization: Bearer` secret key,
  live since 24 Oct 2026), and `repository` points at github.com/strait-link/strait-mcp. The OAuth Worker
  (`mcp.strait.link`) is not listed until it is deployed.
- **New version:** release it to npm first (release workflow), then run **Actions → MCP registry → Run workflow**.
  It checks `server.json` against `package.json`, the npm package and the registry schema, then logs in and publishes.
  Without the secret it only validates and stops.
- **New key:** `openssl genpkey -algorithm Ed25519 -out key.pem` (OpenSSL 3, not macOS LibreSSL); the public line is
  `v=MCPv1; k=ed25519; p=$(openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)` (put it in the
  site's `lib/seo.mjs` and deploy the site); the secret is the hex private key,
  `openssl pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n'`. Delete `key.pem` after.

## OAuth remote server (built, not deployed)

The hosted server above (`strait.link/mcp`) needs a key in a header. This Worker is the later, OAuth version.

`src/worker.ts` is a Cloudflare Worker serving MCP over Streamable HTTP at `https://mcp.strait.link/mcp`. It answers
404 everywhere unless `REMOTE_MCP=on` (only `env.production` in `wrangler.jsonc` turns it on).

- **Bearer-key mode:** `Authorization: Bearer st_live_…` on `/mcp`, for clients that take a header.
- **OAuth** (`@cloudflare/workers-oauth-provider`): dynamic client registration (`/register`), `/authorize`, `/token`,
  authorization-server metadata and RFC 9728 protected-resource metadata
  (`/.well-known/oauth-protected-resource/mcp`). PKCE, registered redirect URIs only.
  - The consent page asks for a secret key, checks it with `GET /v1/links?limit=1`, and keeps it only inside the
    grant, which the provider encrypts with the token (a test checks that KV never holds the key in plain text).
    It shows where the user is sent back to, has a Cancel button (`access_denied` back to the client), and sends
    `X-Frame-Options: DENY`, a strict CSP and `Cache-Control: no-store`.
  - Access tokens last 1 hour; refresh tokens 30 days.
  - Next step before a wide launch: replace the paste-a-key page with dashboard sign-in that mints a scoped key.
- **`/healthz`** returns `{ ok, service, version, mcp }` with no upstream call, for the post-deploy check.

### Try it locally

```sh
cp .dev.vars.example .dev.vars        # REMOTE_MCP=on, STRAIT_API_URL=http://localhost:3000
npm run dev:remote                    # wrangler dev on http://localhost:8787 (local KV, nothing leaves the machine)
curl http://localhost:8787/healthz
npx -y @modelcontextprotocol/inspector@0.17.5   # connect to http://localhost:8787/mcp
```

### Deploy the remote server (Strait team only)

Agents prepare this; only the Strait team deploys. Needs the Cloudflare account that holds the `strait.link` zone
(`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` from `redirect-engine/.env` work). The bundle is about 1.9 MB
(360 KB gzipped), inside the free plan's size limit; Workers Paid (already planned) is recommended for its higher
CPU time per request.

```sh
cd mcp-server && npm ci
npm run typecheck && npx vitest run            # all green
# 1. Create the OAuth store once and paste its id into env.production.kv_namespaces in wrangler.jsonc
npx -y wrangler@4 kv namespace create OAUTH_KV --env production
npm run deploy:preflight                       # exit 0 = config ready (fails while the id is a placeholder)
npm run deploy:check                           # wrangler dry run, nothing uploaded
# 2. Deploy. The custom domain creates the mcp.strait.link DNS record and certificate.
npx -y wrangler@4 deploy --env production
# 3. Check it
curl -s https://mcp.strait.link/healthz                                     # {"ok":true,...}
curl -s https://mcp.strait.link/.well-known/oauth-protected-resource/mcp    # resource: https://mcp.strait.link/mcp
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://mcp.strait.link/mcp  # 401 (needs a token)
claude mcp add --transport http strait https://mcp.strait.link/mcp          # then /mcp in Claude Code to sign in
```

Roll back with `npx -y wrangler@4 rollback --env production`, or switch it off by setting `REMOTE_MCP` to `"off"`
in `env.production.vars` and deploying again (every route then answers 404). Revoking the secret key a user pasted
cuts that connection off at the API.
