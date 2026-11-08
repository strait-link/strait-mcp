# Changelog

## 0.8.1 (8 Nov 2026)

- `strait-setup` skill and `search_docs` index regenerated from the site (8 Nov): Android 0.10.1, iOS 0.11.1, Flutter 0.10.2, Unity 0.9.1, Capacitor 0.4.1, web 0.8.1, Node 0.8.2, the setup-checker "Apps & stores" step.
- `strait-setup` skill and `search_docs` index: React Native 0.11.0 and Capacitor 0.4.0 (on npm since 7 Nov), regenerated from the live site.
- iPhone wording: the README banner and the server instructions say "iPhone links: live · install matching: opt-in" (was "iPhone is in beta"), the same words as the website and every SDK; `get_analytics` says iPhone installs come from opt-in install matching (labelled Estimated).

## 0.8.0 (7 Nov 2026)

- README (the npm page): only what users need. Build, test, registry and the unreleased OAuth Worker's deploy
  steps moved to `docs/MAINTAINERS.md` (repo only).
- `get_analytics` and `compare_analytics`: `group` also takes `app_version` and `sdk_version` (engine migration 0114,
  ADR 0088): app opens and installs by the app's and the Strait SDK's version they reported (sent by the SDKs
  released 7 Nov 2026: Android 0.10.0, iOS 0.11.0, React Native 0.11.0, Flutter 0.10.0; web sends the SDK version only). Taps, conversions and opens that sent no version come back with
  `key: null`. Needs an npm release and a
  hosted Worker deploy to reach users.
- `strait-setup` skill and `search_docs` index: the 7 Nov SDK versions (Android v0.10.0, iOS 0.11.0, Flutter 0.10.1,
  Unity 0.9.0, web 0.8.0, Node 0.8.1; React Native 0.10.2 and Capacitor 0.3.0 until their next npm release), regenerated
  from the live site (a111067) with `npm run skill:sync` and `npm run docs-index`.
- `get_analytics`: `group` also takes `campaign`, `country`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term` and
  `utm_content`, the values the live OpenAPI spec lists for `GET /v1/analytics` (engine #103, ADR 0082). Country and UTM
  rows cover taps since 5 Nov 2026; older taps come back with `key: null`. `compare_analytics` takes the same groups (not
  `none`/`day`). `ANALYTICS_GROUPS` is the one list. Needs an npm release and a hosted Worker deploy to reach users.
- Claude Code plugin 0.2.0: three more skills next to `strait-setup`. `strait-troubleshoot` (link opens the browser,
  deferred link missing after install, assetlinks.json / AASA failing, taps or events not showing) runs the real checks
  (`check_app_links`, `simulate_tap`, `trace_tap`, `list_taps`, `list_events`, `npx @straitlink/cli doctor`) and points
  to the troubleshooting docs. `strait-events` adds the platform's real `trackEvent` call (React Native, Expo, Capacitor,
  Flutter, Android, iOS, Unity; `POST /v1/event` on the web, `sendEvent` in Node). `strait-migration` maps Firebase
  Dynamic Links and Branch fields, imports links (Dashboard → Import, `POST /v1/links/batch`, `batch_create_links`) and
  swaps the SDK calls. `test/skills.test.ts` fails if a skill names a tool or prompt that doesn't exist or links a
  docs page that isn't in the docs index. The skills ship from GitHub with the plugin, not in the npm package.

## 0.7.0 (5 Nov 2026)

- New prompt `get_started` (six in all), optional `platform` (react-native, expo, flutter, android, ios, unity,
  capacitor, web): checks the key (`get_workspace`), offers an existing link or creates the first one with
  `create_link` only after the user says yes, finds the platform from the project files when none is given, reads
  that SDK's docs page (`/docs/sdks/<platform>.md`, or `search_docs`) and pastes its install and setup code exactly,
  lists the dashboard steps only the user can do, runs `check_app_links`, then verifies with test mode
  (`checkDeferred()` from a debug build, `list_taps`). The publishable key goes in the app, never a secret key.

## 0.6.0 (4 Nov 2026)

- `get_campaign_qr_zip` (new, read-only): every live link of a campaign as QR codes in one ZIP (`GET /v1/qr.zip`), SVG by
  default or PNG up to 1024 px, in the workspace's style or a saved one. Returns a summary (codes, format, logo, file name)
  and the ZIP as an embedded resource (`application/zip`, up to 8 MB; bigger: use SVG or the dashboard).
- `get_link_qr`: `preset` picks a saved QR style (Dashboard → Settings → QR codes).
- `get_workspace`: also returns the saved QR styles (`qrStyles`: id, name, colours, logo) when the engine sends them.

## 0.5.1 (4 Nov 2026)

- `search_docs`: the Free plan is 25,000 taps a month (was 10,000).
- A read-only secret key is offered only the tools that read (`tools/list` hides create, update, pause, resume,
  deactivate, record_event, domains and webhook sends). The stdio command asks `GET /v1/workspace` once at start;
  the remote Worker asks only on `tools/list`. If the access can't be read (older engine, links-only key, network,
  3 s timeout) every tool is offered as before; the API is still the guard. `toolsForKey()` is exported.

## 0.5.0 (26 Oct 2026)

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
