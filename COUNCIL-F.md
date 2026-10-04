# COUNCIL-F (Stream F, items F3 and F4): Strait MCP server and the setup skill

A new local repo, `strait/mcp-server` (`main` holds only an empty initial commit; the work is on `council/F`).
No GitHub repo was created, nothing is published to npm and nothing is deployed.

## What is here
- **Ten tools:** create_link, batch_create_links, get_link, list_links, update_link, get_analytics,
  check_app_links, simulate_tap, trace_tap and search_docs. They are described in `src/tools.ts`, and every tool
  has MCP annotations.
  - **Destructive action needs confirmation:** `update_link` is the only destructive tool. Without
    `confirm: true` it returns a current-vs-proposed preview and makes no PATCH.
  - `trace_tap` with a slug runs the link through 9 channel presets (`/v1/simulate`, nothing recorded). With a
    demo `st` token it reads `/v1/trace/{st}`.
  - `search_docs` is offline: BM25 over `src/docs-index.json`, built from `site/content/docs` by
    `npm run docs-index`. **Rebuild the index after Stream B's docs rewrite merges.**
  - The server's MCP `instructions` carry the key rules and the preview-then-confirm rule.
- **stdio entry:** `src/stdio.ts`, bin `strait-mcp`. It reads `STRAIT_SECRET_KEY` and `STRAIT_API_URL` and
  refuses a publishable key at startup. Without a key, only the key-free tools work.
- **Remote entry:** `src/worker.ts` is a Cloudflare Worker, not deployed. It answers 404 unless `REMOTE_MCP=on`.
  - Bearer-key mode on `/mcp`.
  - An OAuth scaffold on `@cloudflare/workers-oauth-provider`: dynamic client registration, `/authorize` (the
    consent page asks for a secret key, verifies it with `GET /v1/links?limit=1`, and stores it encrypted in the
    grant props; the user id is derived from a hash), `/token`, and RFC 9728 metadata at
    `/.well-known/oauth-protected-resource/mcp`.
  - `wrangler.jsonc` needs a KV namespace id.
- **F4:** `skills/strait-setup/SKILL.md` is a Claude Code skill: platform detection, key rules, install lines per
  SDK, the one `onLink` pattern and verify commands. Its wording was checked against the site docs.
- **README:** Claude Code, Cursor and Claude Desktop snippets. It says plainly that `npx @strait/mcp` won't work
  until the package is published, and gives "from a checkout" steps that work today.

## Gates (run 2026-10-05)
```sh
npm ci
npm run typecheck   # exit 0 (Node, tests, Worker configs)
npx vitest run      # exit 0: 4 files, 39 tests
npm run build       # exit 0
npm run inspect     # MCP Inspector CLI 0.17.5: tools/list returns the 10 tools
```
- `test/integration.test.ts` (9 tests) starts the **real engine** from `../redirect-engine` (on `council/F`, with
  its memory store) on a random port. It runs this server **over stdio as a child process**, lists the tools,
  creates a link and reads it back (get + list). It also checks: duplicate → tool error, batch, update preview
  then confirm, simulate, a 9-row trace, analytics, and docs search. Set `ENGINE_DIR` to point elsewhere; the
  test skips if no engine is there.
- `test/worker.test.ts`:
  - the flag is off by default
  - bearer-key initialize and tools/list work
  - a publishable key is refused
  - a request with no token gets a 401 with WWW-Authenticate
  - the AS and RFC 9728 metadata are served
- `test/tools.test.ts`, `test/protocol.test.ts`: mocked API and the in-memory transport. They also check that input
  validation (https-only URLs, slug regex) runs before any API call.

## Founder decisions needed
1. **Publish.** Create the npm org `@strait` (council ask F4), then flip `"private": true` and publish `@strait/mcp`
   0.1.0. Until then, the README's `npx` lines don't work.
2. **Repo.** Create a GitHub repo for it (public, like the SDKs?) and push `main` + `council/F`.
3. **Remote.** Deploying `mcp.strait.link` needs a KV namespace, a DNS route, and Workers Paid (already planned).
   Before going public, replace the paste-a-key consent page with dashboard sign-in that mints a scoped key.
