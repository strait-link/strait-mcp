# Changelog

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
