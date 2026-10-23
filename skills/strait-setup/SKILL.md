---
name: strait-setup
description: Add Strait deep links and deferred deep links to a mobile or web app (React Native, Expo, Flutter, Android/Kotlin, iOS/Swift, Unity, Capacitor/Ionic, web) or create links from a server, and verify them. Use when the user wants links that open a screen in their app, wants to replace Firebase Dynamic Links or Branch with Strait, or asks why Strait links open the browser instead of the app.
---

# Set up Strait in an app

Strait links (`https://<handle>.strait.link/<slug>`) open the right screen in the app when it is installed, send people to the
store or website when it is not, and keep the destination through the install (deferred deep link).

- Docs: https://straitlink.in/docs/ . Every docs page has a Markdown copy: add `.md` to its path (for example
  https://straitlink.in/docs/quick-start.md). Index for agents: https://straitlink.in/llms.txt . All docs in one file: https://straitlink.in/llms-full.txt .
- If the docs disagree with this file, the docs win. Read the platform's docs page before you write code.
- If the Strait MCP server is connected, prefer its tools: `search_docs`, `check_app_links`, `create_link`, `trace_tap`.

## Rules (never break these)

1. **Two keys.** The **publishable key** (`st_pub_live_…`, Dashboard → Get started) goes in app and website code.
   The **secret key** (`st_live_…`, Dashboard → Settings → Secret keys) is for servers only. Never put a secret key
   in an app, a website, a repo or a client bundle. If you find one there, tell the user to revoke it.
2. **One callback.** Every mobile SDK delivers every kind of link open (app closed, background, foreground, first
   open after install) through one `onLink` callback. Route from `e.path` and `e.params` when `e.matched` is
   true; don't add a second deep-link handler for the link domain (React Navigation `linking`, Expo Router default
   routing). `onLink` replays past events to late subscribers, so subscribing after `start()` is fine.
3. **iPhone links are live; iPhone install matching is opt-in.** Say so when you set up iOS: the screen after an App Store install is an Estimated match the owner switches on. Don't add clipboard reading yourself. On iPhone the app owner
   chooses the method in the dashboard (Settings → iPhone installs: device matching and/or paste handoff), and the SDK
   reads that choice from the server at runtime, so changing it needs no app release. New workspaces start with both
   off (`clipboardBoost` in the SDK is deprecated and ignored).
4. **Android deferred links** use the Google Play Install Referrer, so testing them needs a build installed from
   Google Play (internal testing is enough). Sideloaded builds can't test them.
5. **Install the SDKs** with the exact command below or on the docs page.
   Install the SDKs with the exact command on each SDK page: npm for React Native, Expo, web and Node, pub.dev for Flutter, JitPack (built from GitHub) for Android and git for Swift Package Manager and Unity. Don't guess a package name or version.
6. Don't promise numbers (speed, match rates) the docs don't state.

## Steps

1. **Find the platform.** `app.json`/`app.config.*` with `expo` (Expo), `package.json` with `react-native`
   (React Native), `capacitor.config.*` (Capacitor/Ionic), `pubspec.yaml` (Flutter), `build.gradle(.kts)`
   (Android), `*.xcodeproj` / `Package.swift` (iOS), `ProjectSettings/` (Unity), or a web app / server.
2. **Dashboard settings** (the user does this; ask for the values you need): package name, custom scheme and every
   SHA-256 signing fingerprint (debug, upload, and the Play App Signing key from Play Console → App integrity);
   Apple Team ID and bundle ID; default web URL. Get fingerprints with
   `keytool -list -v -keystore android/app/debug.keystore -storepass android | grep SHA256` (React Native / Expo
   prebuild) or `eas credentials` (EAS).
3. **Let the phone open the app** for `https://<handle>.strait.link`:
   - Android: an `autoVerify` App Links intent filter for the link host, plus an intent filter for the custom scheme,
     on a `singleTask` activity.
   - iPhone: Associated Domains `applinks:<handle>.strait.link`, and the custom scheme under URL Types.
   - Expo: `scheme`, `android.intentFilters` (with `autoVerify`) and `ios.associatedDomains` in `app.json`, then a
     **development build** (`npx expo run:android` or EAS). Expo Go cannot test this.
4. **Install the SDK** (versions are pinned here and on each docs page):
   - React Native / Expo: `npm install @straitlink/react-native@0.9.2 @react-native-async-storage/async-storage react-native-play-install-referrer`
     → https://straitlink.in/docs/sdks/react-native/ (Expo: https://straitlink.in/docs/sdks/expo/)
   - Flutter: in `pubspec.yaml`, `strait_sdk` as a git dependency (url `https://github.com/strait-link/strait-sdk-flutter`, ref `v0.9.3`),
     then `flutter pub add app_links shared_preferences play_install_referrer flutter_timezone`
     → https://straitlink.in/docs/sdks/flutter/
   - Android: `implementation("com.github.strait-link:strait-sdk-android:v0.8.1")` (JitPack: add `maven("https://jitpack.io")`) plus
     `com.android.installreferrer:installreferrer:2.2` → https://straitlink.in/docs/sdks/android/
   - iOS: Swift Package `https://github.com/strait-link/strait-sdk-swift` from `0.9.3` → https://straitlink.in/docs/sdks/ios/
   - Unity: Package Manager → Add package from git URL → `https://github.com/strait-link/strait-sdk-unity.git?path=src#v0.8.6` → https://straitlink.in/docs/sdks/unity/
   - Web (deferred links on a website): `npm install @straitlink/web@0.6.3` → https://straitlink.in/docs/sdks/web/
   - Capacitor / Ionic: there is no plugin yet. Use `@capacitor/app` (`getLaunchUrl`, `appUrlOpen`) and the REST
     calls the SDKs make (`POST /v1/resolve`, `/v1/referrer`, `/v1/match`, `/v1/open`) with the publishable key
     → https://straitlink.in/guides/capacitor-deep-linking/
   - Server (creates links, sends events; secret key from an environment variable): `npm install @straitlink/node@0.6.5`
     → https://straitlink.in/docs/sdks/node/
5. **Wire it** exactly as the platform's docs page shows: create the client once with `publishableKey` and
   `endpoint: 'https://<handle>.strait.link'` (plus storage and the install referrer where the page says so), call
   `start()` once at launch, and subscribe to `onLink`. In Expo Router also add `app/+native-intent.tsx` as the
   docs show. On the web, call `resolveDeferredLink` once on startup; it never throws and runs once per browser.
6. **Make a test link**: Dashboard → Links, or the MCP `create_link` tool, or `POST /v1/links` from a server with the
   secret key. The destination must be `https://`; the app receives its path and query. Share the `shortUrl` the
   API returns (slugs are unique per workspace). For many links use `POST /v1/links/batch` (up to 500 per call).

## Verify (run these, don't assume)

```sh
# 1. The domain serves the verification files with your app in them
curl https://<handle>.strait.link/.well-known/assetlinks.json
curl https://<handle>.strait.link/.well-known/apple-app-site-association
#    or: MCP check_app_links domain=<handle>.strait.link  (or https://straitlink.in/tools/)

# 2. Android verified the link host (after a fresh install). Want: verified
adb shell pm get-app-links <package.name>

# 3. Tap the link from WhatsApp or Gmail on a real phone: the app opens on the right screen and
#    onLink fires with matched: true. The tap and the open show in Dashboard → Analytics.
```

If links open the browser: a missing SHA-256 (most often the Play App Signing key), a typo in the host, or the app
was installed before the files were right (reinstall). See https://straitlink.in/docs/troubleshooting/ or run the MCP
`trace_tap` tool on the link to see what each channel does.
