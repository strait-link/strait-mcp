# ADR 0004: search_docs reads the live docs (never stale)

Date: 10 Nov 2026 (run-1110, mcp-live-docs)

## Problem
`search_docs` searched only `src/docs-index.json`, built when the MCP package was released. Every SDK or docs release
after that left it stale until the next MCP release: on 10 Nov it still quoted the morning's SDK versions
(0.10.4 / 0.11.4 …) hours after the site showed 0.10.5 / 0.11.5. An AI agent that quotes yesterday's version installs
yesterday's bugs. Docs should be updated once, on the site.

## Who it serves
Developers whose AI agent sets up Strait (npm `@straitlink/mcp` and the hosted `strait.link/mcp`, which runs this
package inside the engine).

## Options
1. **Do nothing.** Release an MCP patch after every docs change (manual, forgotten; it already happened).
2. **Scheduled CI job** that rebuilds the index when the site changes and cuts an MCP patch, plus an engine dependency
   bump and deploy for the hosted server each time. Many moving parts (tagging bot, npm release, engine PR + deploy,
   registry publish) for a text change; still stale between runs; a release a day for nothing.
3. **Read the live docs with a short cache, bundled copy as fallback (chosen).** The site already publishes the whole
   docs as Markdown for AI tools (`llms-full.txt`, and the recipes in `llms-recipes.txt`); parse those into the same
   sections the bundled index has. One change fixes npm and hosted; no site change.
4. A new JSON index on the site. Exact same shape, but a second site artifact to maintain; the llms files exist and are
   already checked by the site's ai-seo gate. Parity is proven instead (below).

Reuse: the site's published llms files and its `slugify` rule (copied, 1 line); the existing BM25 search (now cached
per section list).

## Behaviour
- The very first `search_docs` call downloads both files (one 3 s budget), parses them and uses them; calls that arrive
  meanwhile wait for the same download. Later calls answer from memory; after an hour the next call answers at once from
  the last copy and refreshes in the background (stale-while-revalidate).
- Fallback: any failure (timeout, non-200, a redirect, a body over 4 MB, counted while streaming since the site sends it
  compressed with no length, fewer than half the bundled sections, e.g. an HTML error page) → the bundled index (or the
  last good live copy). Retries come 5 minutes later, in the background: only the very first try makes a call wait.
- A download that never settles (a Worker request that ended under it) stops blocking new ones after 2x its timeout.
- `STRAIT_DOCS_OFFLINE=1` → bundled only, no network. The test suite sets it; `test/live-docs.test.ts` covers the live path
  with an injected fetch.
- Parity (10 Nov, site `492a10c`): the live parse has all 550 bundled sections at the same URLs (+1: the API page's
  endpoint list) and the same top 3 results for six common queries.

## Security lens (STRIDE)
- Spoofing / tampering: fixed https URLs on our own domain, no user input in the URL (no SSRF), redirects refused. The
  text comes from the same site as the bundled docs, but it now reaches agents without this repo's release checks (for
  example `test/skills.test.ts`, no web `resolveDeferredLink` advice). Those checks belong at the source: the site's own
  `npm run check` gates every docs deploy. `openWorldHint` stays false: one fixed first-party source, not the open web.
- Data exposure: a plain GET of a public file, no query, no key, no cookies; no new tracker. The site sees one request per
  process per hour.
- DoS: at most one download per hour per process (5 min after a failure), size-capped, time-bounded; a slow site costs
  one call 3 s once, then the bundled copy.

## Architecture lens
No new dependency, no new state beyond a module-level cache (Node: the engine and stdio). The Worker variant (not
deployed) works the same; a background refresh there may be cut short with the request and is retried later.
Load: 2 cached static files (~590 KB) from Cloudflare per hour per engine instance. Memory: one extra parsed copy.

## Follow-up
The engine's `test/mcp-route.test.ts` calls `search_docs`; with 0.9.2 that one call reads the live docs in CI (bounded
by the 3 s timeout, falls back, so it cannot fail the test). Set `STRAIT_DOCS_OFFLINE=1` in the engine's vitest config
when that repo is next touched (kept out of the 0.9.2 bump PR on purpose).

## Cost
None.
