<h1 align="center">Strait MCP server</h1>

<p align="center"><strong>Straight to the screen. On the record.</strong><br>
A tap on a Strait link goes straight to the exact screen in your app (Straight), and every tap is recorded (Stamped).</p>

<p align="center">
  <a href="https://straitlink.in/docs/">Docs</a> ·
  <a href="https://straitlink.in/platform-status/">Platform status</a> ·
  <a href="#docs-and-support">Talk to the Strait team</a>
</p>

`@straitlink/mcp` (preview)

```sh
claude mcp add strait --env STRAIT_SECRET_KEY=st_live_your_key -- npx -y @straitlink/mcp
```

Use Strait from AI tools such as Claude Code, Cursor and Claude Desktop: create deep links, change or turn them off,
read analytics, usage and referrals, check App Links / Universal Links files, see where taps on a link go, look after
webhooks (deliveries, test, redeliver) and search the Strait docs.

It is a local stdio server with 16 tools. Six of them write (`create_link`, `batch_create_links`, `update_link`,
`deactivate_link`, `test_webhook`, `redeliver_webhook_delivery`); the other ten only read. Fourteen need your secret
key; `check_app_links`, `search_docs` and demo `trace_tap` work without one. Other deep-link vendors also ship MCP servers that can create links, so this README
makes no "first" or "only" claim; it describes what this server does today.

**iPhone is in beta.** iPhone install matching (deferred deep linking on iOS) is in beta; Android uses the Play
Install Referrer. On iPhone the workspace chooses the method in Dashboard → Settings → iPhone installs (device
matching, paste handoff, both or neither), and the SDK reads that choice at runtime. Device matching is off for new
workspaces. The tools report iPhone results the same way, but treat iPhone install attribution as beta.

> **Preview.** The remote server (`mcp.strait.link`) is built and deploy-ready but not deployed (see "Deploy the
> remote server"). Until then, use the local server above.

## Tools

| Tool | What it does | Key needed |
|---|---|---|
| `create_link` | Create one link and get its `shortUrl` | secret |
| `batch_create_links` | Create up to 500 links in one call (safe to re-run: existing slugs are per-item 409s) | secret |
| `get_link` | Read one link by slug | secret |
| `list_links` | List links, one page at a time | secret |
| `update_link` | Change destination, title, tags or expiry. **Asks for `confirm: true`**: without it you get a preview and nothing changes | secret |
| `get_analytics` | Taps, app opens, installs, conversions and revenue, by day / channel / link / platform (`GET /v1/analytics`). iPhone installs come from beta install matching | secret |
| `check_app_links` | Check a domain's `assetlinks.json` and `apple-app-site-association`, with a fix for each problem | none |
| `simulate_tap` | Dry-run one tap from one device or app (nothing recorded or billed) | secret |
| `trace_tap` | Walk a link through WhatsApp, Instagram, Facebook, Chrome, Safari, iPad, computer and preview bots; or read a Live Tap Trace from the website demo | secret (link) / none (demo token) |
| `get_usage` | This month's taps and new links against the plan, `level` (ok / warn / over) and `new_links_paused` (`GET /v1/usage`) | secret |
| `get_referrals` | Referral report: taps and referred installs per code (`GET /v1/referrals`, a preview: says "not switched on yet" until it is) | secret |
| `list_webhook_deliveries` | A webhook's deliveries (status, attempts, last HTTP status, next retry; no payloads). Without `webhookId`: the workspace's webhooks (id, receiver host, events) | secret |
| `test_webhook` | Send one `ping` to a webhook now and see the receiver's status and time (not stored, not retried) | secret |
| `redeliver_webhook_delivery` | Send a failed delivery again (same `X-Strait-Delivery` id). **Asks for `confirm: true`** | secret |
| `deactivate_link` | Turn a link off: taps then get the "link not found" page. **Asks for `confirm: true`**; the API can't turn it back on yet | secret |
| `search_docs` | Search the Strait docs offline (bundled index) | none |

Every tool carries MCP annotations (`readOnlyHint`, `destructiveHint`, …) and its description starts with
"Read-only." or "Write." for the 0.2 tools. `update_link` and `deactivate_link` are destructive; they and
`redeliver_webhook_delivery` show a preview first and act only with `confirm: true`. `create_link` and
`batch_create_links` write new links but never change existing ones. There is no delete tool: a deactivated link
keeps its history.

## Keys

The server needs a **secret key** (`st_live_…`) from **Dashboard → Settings → Secret keys**. A secret key can change your
links, so:

- Create a separate key for your AI tools, so you can revoke it on its own.
- Keep it in the MCP client's config or environment, never in app or website code.
- A publishable key (`st_pub_live_…`) does not work here: it is for the SDKs in your apps.
- The server sends the key only as an `Authorization: Bearer` header to `STRAIT_API_URL`, never logs it, and
  replaces anything shaped like a secret key in tool output or errors with `st_…[redacted]`.

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

### From a checkout

```sh
cd mcp-server && npm ci && npm run build
claude mcp add strait --env STRAIT_SECRET_KEY=st_live_your_key -- node "$PWD/dist/stdio.js"
```

In Cursor or Claude Desktop use `"command": "node", "args": ["/absolute/path/to/mcp-server/dist/stdio.js"]`.

## Try it

- "Create a Strait link `summer` to https://shop.hilltop.example/summer with the title Summer sale."
- "Which channel brought the most installs last month?"
- "My links open the browser instead of the app. Check hilltop.strait.link and shop.hilltop.example."
- "What happens when someone taps `summer` inside Instagram on an iPhone?"
- "How do I receive links in Expo Router?"
- "How much of this month's plan have we used?"
- "My webhook stopped firing. Show me its last deliveries, send it a test, and resend the failed ones."
- "Turn off the `spring-sale` link." (you'll see a preview first)
- "Which referral codes brought the most installs in October?"

Hilltop Shoes (`hilltop.strait.link`, `*.hilltop.example`) is a made-up shop used in examples.

## MCP registry listing (drafted, not published)

`server.json` and the `mcpName` field in `package.json` are drafts for the
[official MCP registry](https://registry.modelcontextprotocol.io). The registry checks that `mcpName` in the published npm package matches `server.json` `name`
([package types](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/package-types.mdx)).

- **Namespace `in.straitlink/mcp` (recommended).** Reverse-DNS of `straitlink.in`, so the listing carries the
  product's own domain. It needs DNS authentication: the Strait team adds a TXT record on the apex `straitlink.in`
  (`v=MCPv1; k=ed25519; p=<public key>`) and runs `mcp-publisher login dns --domain straitlink.in --private-key …`
  ([authentication](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx)).
  Keep the private key out of the repo.
- **Alternative `io.github.<owner>/strait-mcp`.** Uses GitHub OAuth (`mcp-publisher login github`) and needs no DNS
  change, but the name shows a personal GitHub account rather than the product domain, and it requires the public
  GitHub repo, which does not exist yet. To switch, change `name` in `server.json` and `mcpName` in `package.json`
  together (a test checks they match).
- `remotes` is left out until `mcp.strait.link` is deployed; add
  `{"type": "streamable-http", "url": "https://mcp.strait.link/mcp"}` then. Add `"repository": {"url": "https://github.com/bazingga08/strait-mcp", "source": "github"}`
  once the GitHub repo exists.
- Order when the Strait team is ready: create the repo, publish `@straitlink/mcp` to npm (done: 0.1.0 on 15 Oct,
  `mcpName` matches), add the TXT record, then run the **MCP registry** workflow (`.github/workflows/registry.yml`).
  Without the `MCP_DNS_PRIVATE_KEY` secret it only validates `server.json` (schema, name, version, npm) and stops.

### Founder steps (about 10 minutes, after the GitHub repo exists)

1. Claude makes a key pair on the Mac (`openssl genpkey -algorithm ed25519`) and shows you only the **public** part.
2. In the DNS settings for **straitlink.in**, add a **TXT** record on the root (`@`) with the value
   `v=MCPv1; k=ed25519; p=<public key>`. Save. It can take up to an hour to appear.
3. In GitHub, repo **strait-mcp → Settings → Secrets → Actions**, add `MCP_DNS_PRIVATE_KEY` with the private key
   (Claude puts it there if you allow secret writes).
4. Actions → **MCP registry** → Run workflow. When it's green, search "Strait" on
   registry.modelcontextprotocol.io: that's how you know it worked.

## Licence

MIT. See [LICENSE](LICENSE).

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

## Docs and support

- **Docs:** [straitlink.in/docs/](https://straitlink.in/docs/) · [platform status](https://straitlink.in/platform-status/) · [troubleshooting](https://straitlink.in/docs/troubleshooting/)
- **Talk to the Strait team:** [support@straitlink.in](mailto:support@straitlink.in) (replies within 1 working day, IST) or call +91 81218 61890.
- **Bugs and feature requests:** [open an issue](https://github.com/bazingga08/strait-mcp/issues) on this repo.
- **Security:** never in a public issue. Write to security@straitlink.in.
