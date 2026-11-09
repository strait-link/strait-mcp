# ADR 0003: get_app_setup and verify_app_setup (the engine's app setup API as MCP tools)

Date: 10 Nov 2026 (run-1110, mcp-app-verify)

## Problem
AI coding agents are a growing way developers set up Strait. Today an agent can check one domain's files
(`check_app_links`) but cannot see the app details Strait has saved or whether the whole integration works (SDK
reporting, SDK current, link opens, webhooks), so setup bounces between the dashboard and the code. The engine now
answers both (`GET /v1/app`, `GET /v1/app/verify`, engine ADR 0108); the CLI has them (`strait app`, `strait app verify`,
CLI ADR 0003). The MCP server, the agent's own channel, does not.

## Who it serves
A developer whose AI agent (Claude Code, Cursor, …) does the integration: one "check my setup" call, a fix per problem,
loop until `ok`. Also the hosted server at strait.link/mcp (the engine runs this package).

## Options
1. **Do nothing.** Agents keep reading the dashboard through the human; `search_docs` can only describe checks.
2. **Re-implement the checks in the MCP server** from `check_app_links`, `list_taps`, … Rejected: a second copy of
   the rules and fix wording that drifts from the dashboard (the CLI ADR rejected the same).
3. **Thin tools over the engine answers (chosen).** Two read tools, inputs none, the engine's JSON returned as is
   (the engine owns rules, statuses and fix text). Same pattern as `get_workspace` / `get_usage`.

Reuse: `StraitClient.call` (Bearer key, errors as `StraitApiError`), `runTool` (key-shaped text redacted from every
result), `toolsForKey` and the engine's `READ_TOOLS` (both offer read-only-annotated tools to read keys, so the
tools reach read keys with no extra code).

## Security lens (STRIDE)
- Spoofing / elevation: secret key only (read or full; the engine refuses links-only 403 and publishable 401); the
  workspace is the key's own, no input to point elsewhere.
- Data exposure: the engine returns no keys, emails, webhook URLs, error or fetched-file text; signing fingerprints and
  app IDs are public (served in assetlinks.json / AASA). `runTool` still redacts anything `st_live_`/`st_test_`-shaped
  (tested).
- Tampering: read-only, no inputs.
- DoS / abuse: engine limits 30 (`/v1/app`) and 6 (`/v1/app/verify`, live fetches) a minute per workspace; the
  description tells the agent the 6-a-minute limit; the hosted route's own 60/1 s per-key limit stays in front.

## Architecture lens
No new dependency, no state, no new endpoint. Failure mode: an engine without the routes answers 404 as a tool
error (prod and the hosted server have them since engine `5edb460`). Load: one engine call per tool call.

## Cost
Two tool definitions, two client methods, one test file. Minor release 0.9.0 (new tools); the engine's pinned
dependency bump brings them to the hosted server.
