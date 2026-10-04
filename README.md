# Strait MCP server (preview)

Use Strait from AI tools such as Claude Code, Cursor and Claude Desktop: create deep links, change them, read
analytics, check App Links / Universal Links files, see where taps on a link go, and search the Strait docs.

> **Preview.** The package is not on npm yet, so `npx @strait/mcp` does not work today. Until it is published,
> run it from a checkout (see "From a checkout" below). The remote server (`mcp.strait.link`) is built but not deployed.

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
claude mcp add strait --env STRAIT_SECRET_KEY=st_live_your_key -- npx -y @strait/mcp
```

### Cursor

`~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project; don't commit a key):

```json
{
  "mcpServers": {
    "strait": {
      "command": "npx",
      "args": ["-y", "@strait/mcp"],
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

## Remote server (not deployed)

`src/worker.ts` is a Cloudflare Worker serving MCP over Streamable HTTP at `/mcp`, off unless `REMOTE_MCP=on`:

- **Bearer-key mode:** `Authorization: Bearer st_live_…`.
- **OAuth (scaffold):** dynamic client registration (`/register`), `/authorize`, `/token` and RFC 9728 metadata,
  using `@cloudflare/workers-oauth-provider`. The consent page asks for a secret key today, checks it with the API
  and keeps it encrypted in the grant. Next step: sign in with the dashboard and mint a scoped key instead.

`wrangler.jsonc` has the config. It needs a KV namespace id, and deploying needs the founder's approval.

## Claude Code skill

`skills/strait-setup/SKILL.md` teaches Claude Code how to add Strait to an app (React Native / Expo, Flutter,
Android, iOS, web). Copy the folder into `~/.claude/skills/` or a project's `.claude/skills/`.

## Develop

```sh
npm ci
npm run typecheck     # Node, tests and the Worker
npm test              # unit, protocol, Worker and an end-to-end test against a local engine
npm run build
npm run inspect       # MCP Inspector CLI: lists the tools
npm run docs-index    # rebuild src/docs-index.json from ../site/content/docs
```

The end-to-end test (`test/integration.test.ts`) starts the real engine from `../redirect-engine` (or
`ENGINE_DIR`) with its in-memory store, runs this server over stdio as a child process, creates a link and reads
it back. It is skipped when no engine checkout with installed dependencies is next to this repo.
