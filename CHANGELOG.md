# Changelog

## 0.5.0 (unreleased)

- Two more prompts (five in all): `migrate_firebase_links` (optional old_domain: maps Firebase Dynamic Links to Strait
  fields with the docs' field table and `check_link`, shows the plan, and creates the links with `batch_create_links`
  only after the user says yes) and `why_not_open` (slug, optional platform and app: the link, App Links files, a
  simulated tap on that phone and app or a trace, recent taps, and the SDK `doctor()` finding ids from shared-spec
  ADR 0002).
- `get_workspace`: the key's workspace, link domain, custom domains, plan and access (full, links, read), from
  `GET /v1/workspace` (engine PR #52). An engine without that route gets a plain "not available yet" answer.

## 0.4.1 (24 Oct 2026)

- `search_docs` index and the bundled skill rebuilt from the live site (c888cd5): the hosted MCP guide and one page per
  tool group, secret key access (Full / Links only / Read only) and the `key_scope` error.

## 0.4.0 (24 Oct 2026)

- Three MCP prompts (starter requests in a client's prompt picker): `weekly_review` (this week against last week, top
  links, drops), `debug_link` (slug: App Links files, a trace and recent taps, with fixes) and `setup_check` (usage,
  custom domains, failing webhooks, App Links). They only read. `createStraitServer()` registers them; `PROMPTS` is exported.

## 0.3.0 (24 Oct 2026)

- 14 new tools (30 in all), each on an existing public API endpoint: `pause_link`, `resume_link`, `search_links`,
  `get_link_qr` (PNG as an MCP image, or SVG), `compare_analytics`, `get_top_links`, `list_taps`, `list_events`,
  `record_event`, `list_domains`, `add_domain`, `remove_domain`, `list_webhooks`, `check_link`.
- Writes (`pause_link`, `resume_link`, `record_event`, `add_domain`, `remove_domain`) preview first and act only with
  `confirm: true`.
- Library entry: `import { createStraitServer, StraitClient, TOOLS } from '@straitlink/mcp'` (with types), so a host can
  serve the same tools over HTTP. The `strait-mcp` command is unchanged.

## 0.2.3 (24 Oct 2026)

- package.json `repository`, `bugs` and `homepage` point at github.com/strait-link/strait-mcp (the npm page linked to a repo that does not exist). No code change.
