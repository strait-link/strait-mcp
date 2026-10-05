# Strait MCP server (preview)

Use Strait from AI tools such as Claude Code, Cursor and Claude Desktop: create deep links, change them, read
analytics, check App Links / Universal Links files, see where taps on a link go, and search the Strait docs.

> **Preview.** The package is not on npm yet, so `npx @straitlink/mcp` does not work today. Until it is published,
> run it from a checkout (see "From a checkout" below). The remote server (`mcp.strait.link`) is built and
> deploy-ready but not deployed (see "Deploy the remote server").

## Tools

| Tool | What it does | Key needed |
|---|---|---|
| `create_link` | Create one link and get its `shortUrl` | secret |
| `batch_create_links` | Create up to 500 links in one call (safe to re-run: existing slugs are per-item 409s) | secret |
| `get_link` | Read one link by slug | secret |
| `list_links` | List links, one page at a time | secret |
| `update_link` | Change destination, title, tags or expiry. **Asks for `confirm: true`**: without it you get a preview and nothing changes | secret |
| `get_analytics` | Taps, app opens, installs, conversions and revenue, by day / channel / link / platform (`GET /v1/analytics`) | secret |
| `check_app_links` | Check a domain's `assetlinks.json` and `apple-app-site-association`, with a fix for each problem | none |
| `simulate_tap` | Dry-run one tap from one device or app (nothing recorded or billed) | secret |
| `trace_tap` | Walk a link through WhatsApp, Instagram, Facebook, Chrome, Safari, iPad, computer and preview bots; or read a Live Tap Trace from the website demo | secret (link) / none (demo token) |
| `search_docs` | Search the Strait docs offline (bundled index) | none |

Every tool carries MCP annotations (`readOnlyHint`, `destructiveHint`, …). Only `update_link` is destructive.

## Keys

The server needs a **secret key** (`st_live_…`) from **Dashboard → Settings → Secret keys**. A secret key can change your
links, so:

- Create a separate key for your AI tools, so you can revoke it on its own.
- Keep it in the MCP client's config or environment, never in app or website code.
- A publishable key (`st_pub_live_…`) does not work here: it is for the SDKs in your apps.

Without a key, `check_app_links`, `search_docs` and demo `trace_tap` still work.

| Variable | Meaning |
|---|---|
| `STRAIT_SECRET_KEY` | Your secret key (`st_live_…`) |
| `STRAIT_API_URL` | Engine URL. Default `https://strait.link`. Use `http://localhost:3000` for a local engine |

## Install

### Claude Code

```sh
claude mcp add strait --env STRAIT_SECRET_KEY=st_live_your_key -- npx -y @straitlink/mcp
```

### Cursor

`~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project; don't commit a key):

```json
{
  "mcpServers": {
    "strait": {
      "command": "npx",
      "args": ["-y", "@straitlink/mcp"],
      "env": { "STRAIT_SECRET_KEY": "st_live_your_key" }
    }
  }
}
```

### Claude Desktop

Settings → Developer → Edit config, then add the same `"strait"` entry under `mcpServers` and restart.

### From a checkout (works today)

```sh
cd mcp-server && npm ci && npm run build
claude mcp add strait --env STRAIT_SECRET_KEY=st_live_your_key -- node "$PWD/dist/stdio.js"
```

In Cursor or Claude Desktop use `"command": "node", "args": ["/absolute/path/to/mcp-server/dist/stdio.js"]`.

## Try it

- "Create a Strait link `diwali` to https://shop.example.com/sale/diwali with the title Diwali sale."
- "Which channel brought the most installs last month?"
- "My links open the browser instead of the app. Check acme.strait.link and shop.example.com."
- "What happens when someone taps `diwali` inside Instagram on an iPhone?"
- "How do I receive links in Expo Router?"

## Remote server (built, not deployed)

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

### Deploy the remote server (founder only)

Agents prepare this; only the founder deploys. Needs the Cloudflare account that holds the `strait.link` zone
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

## Claude Code skill

`skills/strait-setup/SKILL.md` teaches Claude Code how to add Strait to an app (React Native / Expo, Flutter,
Android, iOS, Unity, Capacitor, web, and a Node server). Copy the folder into `~/.claude/skills/` or a project's
`.claude/skills/`, or download it from https://straitlink.in/ai/strait-setup/SKILL.md.

The site repo owns it (`site/lib/skill.mjs`, fed by `site.config.json`, so install lines and versions match the
docs). Don't edit this copy by hand: run `npm run skill:sync` (needs `../site` or `SITE_DIR`). The site's tests fail
when this copy drifts.

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
