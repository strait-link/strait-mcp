---
name: strait-setup
description: Add Strait deep links and deferred deep links to a mobile or web app (React Native, Expo, Flutter, Android/Kotlin, iOS/Swift, Unity, web) and verify them. Use when the user wants links that open a screen in their app, wants to replace Firebase Dynamic Links or Branch with Strait, or asks why Strait links open the browser instead of the app.
---

# Set up Strait in an app

Strait links (`https://<handle>.strait.link/<slug>`) open the right screen in the app when it is installed, send
people to the store or website when it is not, and keep the destination through the install (deferred deep
link). Docs: https://straitlink.in/docs/ (every page also has a Markdown copy once the docs `.md` twins ship).
If the Strait MCP server is connected, prefer its tools: `search_docs`, `check_app_links`, `create_link`,
`trace_tap`.

## Rules (never break these)

1. **Two keys.** The **publishable key** (`st_pub_live_…`, Dashboard → Get started) goes in app and website code.
   The **secret key** (`st_live_…`, Dashboard → Settings → Secret keys) is for servers only. Never put a secret key
   in an app, a website, a repo or a client bundle. If you find one there, tell the user to revoke it.
2. **One callback.** Every SDK delivers every kind of link open (app closed, background, foreground, first open
   after install) through one `onLink` callback. Route from `e.path` and `e.params` there; don't add a second
   deep-link handler for the link domain (React Navigation `linking`, Expo Router default routing).
3. **iPhone is in beta.** Say so when you set up iOS. Android deferred links use the Play Install Referrer and need
   a build installed from Google Play (internal testing is enough) to test.
4. Don't promise numbers (speed, match rates) the docs don't state.

## Steps

1. **Find the platform.** Look for `app.json`/`app.config.*` with `expo` (Expo), `package.json` with
   `react-native` (React Native), `pubspec.yaml` (Flutter), `build.gradle(.kts)` (Android), `*.xcodeproj` /
   `Package.swift` (iOS), `ProjectSettings/` (Unity), or a web app.
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
4. **Install the SDK** (from GitHub until the registries list it; versions are on each docs page):
   - React Native / Expo: `npm install github:bazingga08/strait-sdk-react-native#v0.8.0 @react-native-async-storage/async-storage react-native-play-install-referrer`
     → https://straitlink.in/docs/sdks/react-native/
   - Flutter: `strait_sdk` from GitHub in `pubspec.yaml`, plus `flutter pub add app_links shared_preferences play_install_referrer flutter_timezone`
     → https://straitlink.in/docs/sdks/flutter/
   - Android: `implementation("com.github.bazingga08:strait-sdk-android:v0.7.2")` (JitPack) plus
     `com.android.installreferrer:installreferrer:2.2` → https://straitlink.in/docs/sdks/android/
   - iOS: Swift Package `https://github.com/bazingga08/strait-sdk-swift` from `0.8.0` → https://straitlink.in/docs/sdks/ios/
   - Web: `npm install github:bazingga08/strait-sdk-web#v0.5.2` → https://straitlink.in/docs/sdks/web/
   - Unity: https://straitlink.in/docs/sdks/unity/ · Node (server, secret key): https://straitlink.in/docs/sdks/node/
5. **Wire it** exactly as the platform's docs page shows: create the client once with `publishableKey` and
   `endpoint: 'https://<handle>.strait.link'` (plus storage and the install referrer where the page says so), call
   `start()` once at launch, and subscribe to `onLink`. In Expo Router also add `app/+native-intent.tsx` returning
   `'/'` for the link host, as the docs show.
6. **Make a test link**: Dashboard → Links, or the MCP `create_link` tool, or `POST /v1/links` from a server with the
   secret key. The destination must be `https://`; the app receives its path and query.

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
was installed before the files were right (reinstall). See https://straitlink.in/docs/troubleshooting/ or run the
MCP `trace_tap` tool on the link to see what each channel does.
