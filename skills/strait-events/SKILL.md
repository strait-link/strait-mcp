---
name: strait-events
description: Add Strait event and revenue tracking (purchase, signup or any in-app event) to an app or server with the real SDK call for its platform, so the event lands on the tap and channel that brought the user. Use when the user wants to track an in-app event, purchase, conversion or revenue with Strait, or replace BranchEvent or Firebase analytics for link attribution.
---

# Track an in-app event with Strait

Link opens and installs are reported by the SDK by itself. Only conversions (purchase, signup, add_to_cart…) need code.

## Steps

1. **Find the platform**: `app.json`/`app.config.*` with `expo` (Expo), `package.json` with `react-native`, `capacitor.config.*`
   (Capacitor), `pubspec.yaml` (Flutter), `build.gradle(.kts)` (Android), `*.xcodeproj`/`Package.swift` (iOS),
   `ProjectSettings/` (Unity), a website, or a Node server.
2. **Find the existing Strait client** (`createStrait`, `StraitLinks`, `StraitClient`, `LinksBehaviour.Client`) and use
   its variable name. No client yet? Set up the SDK first (strait-setup skill or https://straitlink.in/docs/sdks/).
3. **Ask which event and where**: the name (any string), and the place it really happens (the purchase success
   handler, not the button tap). `value` and `currency` are optional; send them for revenue.
4. **Add the call** from the table, after the event succeeds. Read the platform page first; it wins over this file.

| Platform | Call | Docs |
|---|---|---|
| React Native, Expo | `await links.trackEvent('purchase', { value: 49.99, currency: 'USD' })` resolves `true` when accepted | https://straitlink.in/docs/sdks/react-native/events/ |
| Capacitor / Ionic | `await strait.trackEvent('purchase', { value: 49.99, currency: 'USD' })` | https://straitlink.in/docs/sdks/capacitor/ |
| Flutter | `await links.trackEvent('purchase', value: 49.99, currency: 'USD')` returns `true` when accepted | https://straitlink.in/docs/sdks/flutter/events/ |
| Android (Kotlin) | `links.trackEvent("purchase", value = 49.99, currency = "USD")` **blocks**: call it off the main thread (a coroutine on `Dispatchers.IO` or `Thread { … }.start()`) | https://straitlink.in/docs/sdks/android/events/ |
| iOS (Swift) | `links.trackEvent("purchase", value: 49.99, currency: "USD") { ok in }` | https://straitlink.in/docs/sdks/ios/ |
| Unity | `await LinksBehaviour.Client.TrackEvent("purchase", value: 4.99, currency: "USD")` | https://straitlink.in/docs/sdks/unity/ |
| Web | `POST https://strait.link/v1/event` with `publishableKey`, `event`, `value`, `currency` and `clickId` from the `resolveDeferredLink` result (the web SDK doesn't remember it; keep it) | https://straitlink.in/docs/sdks/web/ |
| Node server | `await links.sendEvent({ event: 'purchase', value: 49.99, currency: 'USD', clickId })` with the secret key from an environment variable; `clickId` from an `app.opened` or `install.matched` webhook | https://straitlink.in/docs/sdks/node/ |

## Rules

- **Publishable key in apps and websites, secret key only on servers.** Never add a secret key (`st_live_…`) to app code.
- **Credit is automatic in apps**: the event carries the tap id of the last link open in the past 7 days. Pass
  `clickId` only to override it. An event with no recent link open counts as direct; that is by design.
- **One place per purchase**: app or server, not both, or revenue is counted twice.
- **Events are not queued.** If `trackEvent` returns false (offline, wrong key) and it matters, retry in app code.
- Don't put personal data (email, phone) in event names or fields.
- One-off event from the AI tool itself (a purchase the backend confirmed): MCP `record_event` previews first and
  needs `confirm: true`; give it an `eventId` such as the order id so a retry is stored once.

## Verify

1. The call returns `true` (log it in a debug build).
2. Test mode: Dashboard → Get started → Test mode, tap a link, open the debug build, fire the event. The dashboard lists
   **Events since the match**: https://straitlink.in/docs/test-mode/
3. MCP `list_events` (owner or admin secret key) shows the event with its channel and campaign, or Dashboard → Analytics
   shows it at the bottom of the funnel with its revenue.

Not showing? Use the strait-troubleshoot skill (section 4).
