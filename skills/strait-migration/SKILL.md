---
name: strait-migration
description: Move an app from Firebase Dynamic Links or Branch to Strait - map link parameters to Strait fields, import the old links (dashboard import, the batch API or the Strait MCP tools), swap the SDK calls and switch the backend. Use when the user is leaving Firebase Dynamic Links (page.link), Branch (app.link) or AppsFlyer OneLink, or asks how to migrate deep links to Strait.
---

# Migrate to Strait from Firebase Dynamic Links or Branch

- Guides: Firebase https://straitlink.in/docs/migrate-from-firebase/ , Branch https://straitlink.in/docs/migrate-from-branch/ ,
  AppsFlyer OneLink https://straitlink.in/docs/migrate-from-appsflyer/ . Add `.md` for Markdown. The docs win over this file.
- Never create links before the user answers yes to a plan. Secret key (`st_live_…`) only on servers, from an environment variable.

## 1. Find what used the old vendor

```bash
grep -rn "firebasedynamiclinks.googleapis.com" .                                   # Firebase, backend
grep -rn "dynamiclinks\|firebase_dynamic_links\|getDynamicLink\|dynamic-links\|handleUniversalLink" .   # Firebase, apps
grep -rn "react-native-branch\|io.branch\|flutter_branch_sdk\|BranchEvent\|initSession" .   # Branch
```

Also list where people see old links: emails, push, website, QR codes, SMS templates.

## 2. Order (so nothing points at a link that doesn't exist)

1. **Settings** (the user): package name, SHA-256 fingerprints, Team ID and bundle ID in Dashboard → Apps & stores.
2. **Links**: import the old links with their old codes (step 4).
3. **App**: ship an update with the Strait SDK (step 5).
4. **Server**: make new links with `POST /v1/links`, then replace old links where you control the text.

## 3. Map the fields

| Firebase | Branch | Strait |
|---|---|---|
| `link` (deep link) | `$deeplink_path` on the website address, else `$canonical_url` | `longUrl` (https; the app gets its path and query) |
| short code / `suffix` | `alias` or the end of the short link | `slug` (unique per workspace) |
| `afl` / `ifl` | `$android_url` / `$ios_url` | `androidFallbackUrl` / `iosFallbackUrl` |
| `ofl` | `$desktop_url`, `$canonical_url`, `$fallback_url` | `desktopUrl` |
| `st` / `sd` / `si` | `$og_title` / `$og_description` / `$og_image_url` | `title` / `description` / `imageUrl` |
| `utmCampaign` | `~campaign` (`~channel` → `utm_source` on `longUrl`) | `campaign` |
| `apn`, `ibi`, `isi` | app settings | Once, in Dashboard → Apps & stores, not per link |

`amv`/`imv`, `efr` and Branch journeys, banners and `$one_time_use` have no Strait field; say so. Analytics history stays with the old vendor.

## 4. Import the links (there is no CLI import command)

- **Firebase, any size**: Dashboard → Import → Move from Firebase. Upload each CSV from the Google Takeout zip; no export:
  type the old domain. It rebuilds codes, fallbacks, previews and `utm_` tags and lists the links that need a destination.
  https://straitlink.in/docs/migrate-from-firebase/one-step/
- **Branch**: Dashboard → Import → From Branch, upload the unedited CSV or JSON export, Preview, then Import.
- **From the AI tool**: the `migrate_firebase_links` prompt, or build the rows yourself: `check_link` on an old short link to
  learn where it goes, show the plan table, and after a yes `batch_create_links` (up to 500 per call).
- **Script, thousands of links**: `POST https://strait.link/v1/links/batch` (up to 500 per call, `Authorization: Bearer $SECRET_KEY`).
  Each item gets its own result; an existing slug is a `409` for that item only, so re-runs are safe; `402` is the plan limit.
  https://straitlink.in/docs/migrate-from-firebase/cutover/

## 5. Swap the SDK calls

Install the Strait SDK with the exact command on its page (strait-setup skill, https://straitlink.in/docs/sdks/), then:

| Old call | Strait |
|---|---|
| Firebase `getInitialLink()` + `onLink` (React Native, Flutter) | `links.start()` once + `links.onLink(...)` (Flutter: `links.start(initialUrl:, urls:, lifecycle:)` + `links.onLink.listen`) |
| Android `Firebase.dynamicLinks.getDynamicLink(intent)` | `links.start(intent?.dataString)` in `onCreate`, `links.handleUrl(...)` in `onNewIntent`, `links.onLink { e -> }` |
| iOS `handleUniversalLink(url)` | `links.handle(userActivity:)` and `links.handle(url:)` |
| `pendingDynamicLinkData.link` / Branch `params.$deeplink_path` | `e.path` and `e.params`, only when `e.matched` |
| Branch `branch.subscribe(...)`, `initSession` | `links.onLink((e) => { if (e.matched && e.path) route(e.path, e.params) })` |
| `BranchEvent(...).logEvent()` | `links.trackEvent('purchase', { value, currency })` (strait-events skill) |
| `buildShortLink` / `createDynamicLink` in the app | A call to your own server, which uses `POST /v1/links` with the secret key |

Remove the Firebase Dynamic Links dependency completely (leftover listeners swallow links). For Branch, keep its SDK in the
first release while old `app.link` links get taps. Keep the `page.link` host in the next build (`linkHosts`) so people
who have the app still open old links: https://straitlink.in/docs/migrate-from-firebase/page-link/
Detail per platform: https://straitlink.in/docs/migrate-from-firebase/sdk/

## 6. Switch the backend

Replace `POST firebasedynamiclinks.googleapis.com/v1/shortLinks` (or Branch's link API) with `POST https://strait.link/v1/links`
(or `@straitlink/node`), and share the `shortUrl` it returns.

## Verify

`check_app_links` on the link domain, `simulate_tap` on one imported slug with ua `android` and `iphone`, then a real tap
from Messages or Gmail on a phone with the new build. Old `page.link` URLs can't be redirected by anyone but Google: replace them.
