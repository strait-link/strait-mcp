---
name: strait-troubleshoot
description: Diagnose and fix Strait deep-link problems with the Strait MCP tools, the strait CLI and the troubleshooting docs. Use when a Strait link opens the browser or store instead of the app, a deferred link is missing after install, assetlinks.json or apple-app-site-association (AASA) checks fail, matched is false, or taps, opens or events don't show in Analytics.
---

# Troubleshoot Strait links

Find the cause with checks, then give the one fix. Read before you change anything; change nothing without a yes.

- Docs: https://straitlink.in/docs/troubleshooting/ (Markdown copy: same path with `.md`, e.g.
  https://straitlink.in/docs/troubleshooting.md). If this file and the docs disagree, the docs win.
- MCP tools (Strait plugin connected): `get_workspace` (link domain), `get_link`, `check_app_links`, `simulate_tap`,
  `trace_tap`, `list_taps`, `list_events`, `search_docs`. Starter prompts: `why_not_open`, `debug_link`, `setup_check`.
- No MCP? `curl` the two files and run `npx @straitlink/cli doctor --host <handle>.strait.link --android <package> --ios <bundle ID>`
  (add `--cert <SHA-256>`): https://straitlink.in/docs/cli/
- Ask the user for the slug, the phone (Android / iPhone), where they tapped (WhatsApp, Gmail, browser) and what happened.

## 1. The link opens the browser, not the app

1. `get_link` <slug>: active, not expired? Then `check_app_links` on the shortUrl's host (and on a custom domain).
   Each error finding has a fix line, almost always in Dashboard → Apps & stores.
2. `simulate_tap` <slug> with ua `android`, `iphone`, `whatsapp-android` or `instagram-android`, or `trace_tap` for all
   channels: what Strait does on that phone and why. Then `list_taps` (last hour): no tap means it never reached Strait.
3. Usual causes, in order:
   - **Android SHA-256 missing.** Each build has its own: debug keystore, upload key, and for Play installs the
     **App signing key** (Play Console → App integrity). Add every one in Apps & stores.
   - **Intent filter**: `android:autoVerify="true"`, `https`, `android:host` exactly the link domain.
   - **Installed before the files were right.** Android verifies at install: reinstall, then
     `adb shell pm get-app-links <package>` must say `verified`.
   - **iPhone**: AASA must list `<Team ID>.<bundle ID>`, the app needs `applinks:<handle>.strait.link`; Apple caches
     the file, so delete and reinstall the app.
   - **How it was tapped**: typing or pasting into the address bar never opens an app; in-app browsers (Instagram,
     TikTok) show an "Open in app" page. Test from Messages, WhatsApp or Gmail.
4. If they can run a debug build, ask for the SDK `doctor()` report and read its ids (`cert.missing`,
   `app.missing`, `key.secret`, `host.file_missing`…); the `why_not_open` prompt lists them all.

## 2. The deferred link is missing after install

- **Android** needs a build installed **from Google Play** (internal testing is fine); sideloaded builds have no
  install referrer. While the app isn't public, set "When someone without the app taps a link" to Always Google Play.
- **iPhone** is opt-in: Dashboard → Settings → iPhone installs must be on, the person taps **Get the app** on the Safari
  page and opens the app within an hour on the same network.
- The deferred check runs **once per install**: uninstall and reinstall to test again. Expo Go can't run the SDK.
- The code must subscribe with `onLink` and route only when `matched` is true; read `reason` when it is false
  (`no_match`: no recent matching tap; `not_found`: wrong publishable key or slug; `network`: retried later).
- Fastest proof without Play: Test mode with `checkDeferred()` from a debug build: https://straitlink.in/docs/test-mode/
  (`no_tap`: tap a link first; `other_device`: start a new test).
- `list_taps` for the slug: did the tap arrive, and did an install or app open follow it?

## 3. assetlinks.json / AASA checks fail

- `check_app_links` domain=<handle>.strait.link (no key needed), or https://straitlink.in/tools/app-links-checker/ .
- `404` for assetlinks.json means the Android fields in Apps & stores are empty; a missing app in AASA means Team ID or
  bundle ID is missing. Both files are built from Dashboard → Apps & stores: fix the values there, not in a file.
- Custom domain: `list_domains`; the files are served there only once it is `live` (not `pending_dns`), and the app
  build must list that domain too (intent filter host, `applinks:` entry). https://straitlink.in/docs/custom-domains/
- Background: https://straitlink.in/docs/app-links/

## 4. Taps, opens or events don't show

- Taps and app opens show in Dashboard → Analytics within a minute. Link-preview robots (WhatsApp, Slack) are never
  counted. Days are UTC. Check with `list_taps` (owner or admin secret key) and `get_analytics`.
- Events: `list_events` (last 7 days). If missing:
  - `trackEvent` returned false: offline or wrong publishable key; events are not queued, retry in app code.
  - Android: `trackEvent` blocks; on the main thread it throws `NetworkOnMainThreadException`.
  - Shows as direct: no link opened the app in the last 7 days, or the app opened without a link since. By design.
  - Counted twice: the same purchase is sent from the app and the server. Send it from one place.
- Webhooks for `app.event` not arriving: `list_webhooks`, `list_webhook_deliveries`, `test_webhook`.
- Setting events up: the strait-events skill, or https://straitlink.in/docs/analytics/

## Finish

Answer with the most likely cause first, the exact fix (file, dashboard field or command), and how to confirm it.
Still stuck: support@straitlink.in with the link, phone model, where it was tapped and what happened.
