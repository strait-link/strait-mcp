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

Use Strait from AI tools such as Claude Code, Cursor and Claude Desktop: create, find, pause and resume deep links,
get their QR codes, read and compare analytics, see recent taps and conversion events, manage custom link domains,
look after webhooks (list, deliveries, test, redeliver), check App Links / Universal Links files or any vendor's link,
see where taps on a link go and search the Strait docs.

It is a local stdio server with 34 tools. Eleven of them write (`create_link`, `batch_create_links`, `update_link`,
`pause_link`, `resume_link`, `deactivate_link`, `record_event`, `add_domain`, `remove_domain`, `test_webhook`,
`redeliver_webhook_delivery`); the other twenty-three only read. `check_app_links`, `check_link`, `search_docs` and demo
`trace_tap` work without a key; every other tool needs your secret key. Other deep-link vendors also ship MCP servers
that can create links, so this README makes no "first" or "only" claim; it describes what this server does today.

**iPhone links: live · install matching: opt-in.** iPhone links (Universal Links) are live. iPhone install matching (deferred deep linking on iOS) is
opt-in: off until your workspace chooses a method in Dashboard → Settings → iPhone installs (device matching, paste
handoff, both or neither), which the SDK reads at runtime. Device matching is off for new workspaces, and iPhone
matches are labelled Estimated until measured. Android uses the Play Install Referrer.

> **Hosted server.** The same tools are served at `https://strait.link/mcp` (Streamable HTTP, since 24 Oct 2026):
> `claude mcp add --transport http strait https://strait.link/mcp --header "Authorization: Bearer st_live_your_key"`.
> It takes a secret key in the `Authorization` header (60 requests burst, then 1 a second, per key); OAuth sign-in is
> not there yet. The engine serves it with this package's `createStraitServer()` (library entry, 0.3.0).

## Tools

A read-only secret key (Dashboard → Settings → Secret keys, access "Read only") is offered only the tools that read
(0.5.1; the hosted server already did this). Full and links-only keys see every tool; the API still refuses anything
outside the key's access.

| Tool | What it does | Key needed |
|---|---|---|
| `create_link` | Create one link and get its `shortUrl` | secret |
| `batch_create_links` | Create up to 500 links in one call (safe to re-run: existing slugs are per-item 409s) | secret |
| `get_link` | Read one link by slug | secret |
| `list_links` | List links, one page at a time. `status: "paused"` lists turned-off links (0.2.1) | secret |
| `update_link` | Change destination, title, tags or expiry, or `isActive` on its own (false pauses, true turns a paused link back on; 0.2.1). **Asks for `confirm: true`**: without it you get a preview and nothing changes | secret |
| `get_analytics` | Taps, app opens, installs, conversions and revenue, by day / channel / link / platform / campaign / country / UTM tag (`GET /v1/analytics`). iPhone installs come from opt-in install matching (labelled Estimated) | secret |
| `check_app_links` | Check a domain's `assetlinks.json` and `apple-app-site-association`, with a fix for each problem | none |
| `simulate_tap` | Dry-run one tap from one device or app (nothing recorded or billed) | secret |
| `trace_tap` | Walk a link through WhatsApp, Instagram, Facebook, Chrome, Safari, iPad, computer and preview bots; or read a Live Tap Trace from the website demo | secret (link) / none (demo token) |
| `get_workspace` | Who the key is: workspace, link domain, custom domains, plan, the key's access (full / links / read) and the saved QR styles (`qrStyles`, 0.6.0) (`GET /v1/workspace`; 0.5.0, needs engine with that route) | secret |
| `get_usage` | This month's taps and new links against the plan, `level` (ok / warn / over) and `new_links_paused` (`GET /v1/usage`) | secret |
| `get_app_setup` | The app setup Strait has: Android package, signing fingerprints and scheme; iPhone Team ID, bundle ID and App ID; each link domain's `assetlinks.json` / `apple-app-site-association` and whether it's served; the SDK version last sent per platform (`GET /v1/app`; 0.9.0) | secret (read or full) |
| `verify_app_setup` | Every setup check as pass / warn / fail / unknown / skip with a fix (app details, both files on each link domain fetched live, SDK connected and current, link opens, webhooks); `ok` only when nothing failed or is unknown. The agent fixes and runs it again; 6 a minute (`GET /v1/app/verify`; 0.9.0) | secret (read or full) |
| `get_referrals` | Referral report: taps and referred installs per code (`GET /v1/referrals`, a preview: says "not switched on yet" until it is) | secret |
| `list_webhook_deliveries` | A webhook's deliveries (status, attempts, last HTTP status, next retry; no payloads). Without `webhookId`: the workspace's webhooks (id, receiver site, events) | secret |
| `test_webhook` | Send one `ping` to a webhook now and see the receiver's status and time (not stored, not retried) | secret |
| `redeliver_webhook_delivery` | Send a failed delivery again (same `X-Strait-Delivery` id). **Asks for `confirm: true`** | secret |
| `deactivate_link` | Turn a link off: taps then get the "link not found" page. **Asks for `confirm: true`**; turn it back on with `update_link` `isActive: true` | secret |
| `pause_link` | Pause a link (taps get the "link not found" page until it is resumed). **Asks for `confirm: true`** (0.3.0) | secret |
| `resume_link` | Turn a paused link back on. **Asks for `confirm: true`** (0.3.0) | secret |
| `search_links` | Find links by text in slug, title, destination, campaign or tags, or by exact tag or campaign; active, inactive or all (0.3.0) | secret (owner/admin) |
| `get_link_qr` | A link's QR code as a PNG image or SVG, in the workspace's QR style or a saved style (`preset`, 0.6.0) (0.3.0) | secret |
| `get_campaign_qr_zip` | Every live link of a campaign as QR codes in one ZIP (SVG, or PNG up to 1024 px), handed back as an embedded file; 3 a minute per workspace (`GET /v1/qr.zip`; 0.6.0) | secret |
| `compare_analytics` | Two periods side by side (default: the one just before), totals and per channel / platform / link, with % change (0.3.0) | secret |
| `get_top_links` | Top links by taps, app opens, installs or conversions, with each one's share (0.3.0) | secret |
| `list_taps` | Recent taps, newest first, with where each was sent and the open/install it led to (default: last hour) (0.3.0) | secret (owner/admin) |
| `list_events` | Recent conversion and revenue events, newest first (default: last 7 days) (0.3.0) | secret (owner/admin) |
| `record_event` | Record a server-side conversion (`POST /v1/event`). **Asks for `confirm: true`** (0.3.0) | secret |
| `list_domains` | Custom link domains with status and the DNS records to add (0.3.0) | secret |
| `add_domain` | Add a custom link domain and get its DNS records (Scale and Enterprise). **Asks for `confirm: true`** (0.3.0) | secret |
| `remove_domain` | Remove a custom link domain. **Asks for `confirm: true`** (0.3.0) | secret |
| `list_webhooks` | The workspace's webhooks: id, receiver site (host only), events, on/off (0.3.0) | secret |
| `check_link` | Check any vendor's deep link (Firebase page.link, Branch, Strait): where it goes and what to fix (0.3.0) | none |
| `search_docs` | Search the live Strait docs (refreshed hourly; bundled copy offline) | none |

Every tool carries MCP annotations (`readOnlyHint`, `destructiveHint`, …) and the descriptions of the 0.2 and 0.3
tools start with "Read-only." or "Write.". `update_link`, `pause_link`, `deactivate_link` and `remove_domain` are
destructive. Every write except `create_link`, `batch_create_links` and `test_webhook` shows a preview first and acts
only with `confirm: true`. `create_link` and
`batch_create_links` write new links but never change existing ones. There is no delete tool: a deactivated link
keeps its history.

## Prompts

Clients that show MCP prompts (Claude Code: type `/`) offer six starters. All but `get_started` and `migrate_firebase_links` only read, and those two create links only after you answer yes:

| Prompt | What it does |
|---|---|
| `get_started` (platform, optional: `react-native`, `expo`, `flutter`, `android`, `ios`, `unity`, `capacitor`, `web`) | Zero to a working link: checks the key with `get_workspace`, creates your first link with `create_link` after you answer yes, finds your platform (or uses the one you give), pastes the exact install and setup code from that SDK's docs page, runs `check_app_links`, and walks you through a test mode check (`checkDeferred()` in a debug build, then `list_taps`) |
| `weekly_review` | This week against last week (totals and channels), the top links by installs, and anything down more than 30 % |
| `debug_link` (slug) | Why a link opens the browser: the setup checks (`verify_app_setup`) first, then the App Links / Universal Links files, a trace per channel and its recent taps, with the fix |
| `setup_check` | Every setup check with its fix (`verify_app_setup`), usage, custom domains still waiting for DNS, webhooks with failed deliveries, and the App Links files |
| `migrate_firebase_links` (old_domain, optional) | Maps your Firebase Dynamic Links (long links, export rows or short links checked with `check_link`) to Strait fields, shows the plan, and runs `batch_create_links` only after you answer yes. Re-running is safe: existing slugs come back as a per-item 409 |
| `why_not_open` (slug; platform `android` / `iphone` and app `browser` / `whatsapp` / `instagram` / `facebook`, optional) | Why a link opened the store, browser or nothing: the setup checks (`verify_app_setup`) first, the link, the App Links / Universal Links files, the tap on that phone and app, its recent taps, and a pasted SDK `doctor()` report read by finding id (`key.secret`, `host.file_missing`, `app.missing`, `cert.missing`…) |

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
| `STRAIT_DOCS_OFFLINE` | `1`: `search_docs` uses only the docs bundled with this version. By default it reads the live docs (`straitlink.in/llms-full.txt` and `llms-recipes.txt`, a plain download that never includes your query) once an hour and uses the bundled copy when the site can't be reached |

## Install

### Claude Code plugin (hosted server + skills)

```text
/plugin install strait --marketplace strait-link/strait-mcp
```

(On older Claude Code: `/plugin marketplace add strait-link/strait-mcp`, then `/plugin install strait@strait-link`.) It asks
for a secret key when you enable it and keeps it in your system's credential store. It connects to the hosted server
`https://strait.link/mcp` and adds four skills: `strait-setup` (sets Strait up in an app), `strait-troubleshoot`,
`strait-events` (tracks an in-app event) and `strait-migration` (from Firebase Dynamic Links or Branch). Privacy:
https://straitlink.in/legal/privacy/

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
- "How did this week do against last week, by channel?"
- "Which links point at /summer? Pause the old ones."
- "Did my test tap on `summer` just now get recorded, and did it open the app?"
- "Give me a QR code for `summer` in dark grey."
- "Is links.hilltop.example set up yet? Which DNS records are missing?"
- "Check https://hilltop.page.link/abc before we migrate it."

Hilltop Shoes (`hilltop.strait.link`, `*.hilltop.example`) is a made-up shop used in examples.

## Contributing

Building, testing and releasing this package: [docs/MAINTAINERS.md](docs/MAINTAINERS.md).

## Licence

MIT. See [LICENSE](LICENSE).

## Claude Code skills

`skills/strait-setup/SKILL.md` teaches Claude Code how to add Strait to an app (React Native / Expo, Flutter,
Android, iOS, Unity, Capacitor, web, and a Node server). Copy the folder into `~/.claude/skills/` or a project's
`.claude/skills/`, or download it from https://straitlink.in/ai/strait-setup/SKILL.md.

## Docs and support

- **Docs:** [straitlink.in/docs/](https://straitlink.in/docs/) · [platform status](https://straitlink.in/platform-status/) · [troubleshooting](https://straitlink.in/docs/troubleshooting/)
- **Talk to the Strait team:** [support@straitlink.in](mailto:support@straitlink.in) (replies within 1 working day, IST) or call +91 81218 61890.
- **Bugs and feature requests:** [open an issue](https://github.com/strait-link/strait-mcp/issues) on this repo.
- **Security:** never in a public issue. Write to security@straitlink.in.
