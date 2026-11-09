/**
 * MCP prompts: starter requests a client shows in its prompt picker. Each one is plain text that
 * names the tools to use, so the model runs the same tools the user could ask for in their own words.
 */
import { z } from 'zod';

export interface StraitPrompt {
  name: string;
  title: string;
  description: string;
  argsSchema?: z.ZodRawShape;
  text(args: Record<string, string | undefined>): string;
}

const slug = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).describe("The link's slug, e.g. summer");
const host = z
  .string()
  .regex(/^(?=.{3,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/i)
  .optional()
  .describe('Your old Firebase link domain, e.g. yourapp.page.link');
const platform = z.enum(['android', 'iphone']).optional().describe('The phone it failed on');
const app = z.enum(['browser', 'whatsapp', 'instagram', 'facebook']).optional().describe('Where it was tapped');

/** SDK docs page per app platform (each page has a Markdown copy at the same path + .md). */
const SDKS: Record<string, string> = {
  'react-native': 'React Native',
  expo: 'Expo',
  flutter: 'Flutter',
  android: 'Android (Kotlin)',
  ios: 'iOS (Swift)',
  unity: 'Unity',
  capacitor: 'Capacitor / Ionic',
  web: 'web',
};
const sdkPlatform = z
  .enum(Object.keys(SDKS) as [string, ...string[]])
  .optional()
  .describe('Your app: react-native, expo, flutter, android, ios, unity, capacitor or web (left out: found from the project files)');

function sdkStep(p?: string): string {
  const page = (k: string) => `https://straitlink.in/docs/sdks/${k}.md`;
  const pick =
    p && SDKS[p]
      ? `The app is ${SDKS[p]}: read ${page(p)} in full. `
      : 'Find the platform from the project files: app.json or app.config.* with expo (expo), package.json with react-native (react-native), ' +
        'capacitor.config.* (capacitor), pubspec.yaml (flutter), build.gradle or build.gradle.kts (android), *.xcodeproj or Package.swift (ios), ' +
        'ProjectSettings/ (unity), else a website (web); ask me if it is unclear. Then read its page in full: ' +
        `https://straitlink.in/docs/sdks/<platform>.md (for example ${page('react-native')}). `;
  const name = p && SDKS[p] ? SDKS[p].replace(/ (\(.*\)|\/.*)$/, '') : '<platform>';
  return (
    pick +
    `If you cannot open web pages, use search_docs for "${name} install" and "${name} create the client" instead. ` +
    'Then paste the install command and the setup code exactly as the page shows them: same package names, same versions, same order; ' +
    'never guess a package or a version. The app gets the publishable key from Dashboard → Get started and the endpoint ' +
    "https://<link domain from step 1>; never put a secret key in the app (that includes the one I gave you). " +
    'Give me the dashboard steps the page lists (package name, SHA-256 fingerprints, Team ID and bundle ID in Dashboard → Apps & stores) ' +
    'as a short list, because only I can do them. '
  );
}

/** simulate_tap preset for a phone + app; an app without its own preset on that phone falls back to the phone. */
function presetFor(p?: string, a?: string): string {
  const phone = p === 'iphone' ? 'iphone' : 'android';
  const own: Record<string, string[]> = { iphone: ['instagram'], android: ['whatsapp', 'instagram', 'facebook'] };
  return a && own[phone]!.includes(a) ? `${a}-${phone === 'iphone' ? 'ios' : 'android'}` : phone;
}

/** The SDK doctor() finding ids (shared-spec ADR 0002), so the model can read a pasted doctor report. */
const DOCTOR_IDS =
  'key.secret (a secret key is inside the app: use the publishable key and revoke that secret key), key.invalid (not a publishable key), ' +
  'endpoint.invalid (endpoint is not the https link domain), host.unreachable (the phone could not reach the link domain), ' +
  'host.file_missing (the endpoint does not serve assetlinks.json / apple-app-site-association: endpoint is not the Strait link domain), ' +
  'app.none (no app of that platform in Dashboard → Apps & stores), app.unknown (a warning: the SDK could not read the app id), ' +
  "app.missing (this package / bundle ID is not listed), cert.missing (this build's signing certificate fingerprint is not listed; " +
  'debug, release and Play App Signing each have their own)';

/** First troubleshooting step: the engine's own setup checks (GET /v1/app/verify), each with its fix. */
const VERIFY_FIRST =
  'verify_app_setup to check the whole setup: list every check that is not pass or skip, most likely cause first, with its fix. ' +
  'If it answers 403 (a links-only key), say a read or full key can run it and go on. ';

export const PROMPTS: StraitPrompt[] = [
  {
    name: 'get_started',
    title: 'From zero to your first link and SDK setup',
    description:
      'Checks your key, creates your first link (after you say yes), adds the right SDK to your app with the exact install and setup code from the docs, and checks it with test mode.',
    argsSchema: { platform: sdkPlatform },
    text: ({ platform: p }) =>
      'Take me from zero to a working Strait link in my app. Go one step at a time and tell me what you found after each step. ' +
      '1) get_workspace to check the key: the workspace name, its link domain and what the key may do. ' +
      'If it fails, stop and tell me to make a secret key in Dashboard → Settings → Secret keys and add it to this AI tool (https://straitlink.in/docs/mcp/). ' +
      'If the key is read only, say that you cannot create links with it and that I can make the first link in Dashboard → Links instead. ' +
      '2) list_links: if I already have a link, offer to use it. Otherwise propose one link: slug first-link and a longUrl I give you ' +
      "(an https page on my app's website, for example the home page; the app receives its path). Show me the slug and longUrl and ask me to answer yes. " +
      'Only after my yes, create_link, then give me its shortUrl. ' +
      '3) Add the SDK. ' +
      sdkStep(p) +
      '4) check_app_links on the link domain: list each error finding with its fix (most are in Dashboard → Apps & stores). ' +
      '5) Verify with Test mode (https://straitlink.in/docs/test-mode.md, or search_docs for "test mode run a test"): ' +
      "add a debug-only button that calls the SDK's checkDeferred() as the page shows; I turn on Test mode in Dashboard → Get started (a 15-minute window), " +
      "tap the shortUrl on my phone, install and open the debug build and press the button. onLink should fire with kind deferred, matched true and matchMethod test. " +
      'Then list_taps for the slug over the last hour to confirm my tap arrived. If the reply says no tap was seen, I tap the link again and press the button again; ' +
      'if another phone checked in first, I start a new test. ' +
      '6) Run verify_app_setup if the key may (read or full) and fix what is not pass or skip with me. ' +
      'End with a checklist: key, first link, SDK installed, setup code, dashboard settings, App Links check, test mode match; ok or what is left, with the one next step for each.',
  },
  {
    name: 'weekly_review',
    title: 'Weekly review',
    description: 'This week against last week: totals and channels, the top links, and anything that dropped.',
    text: () =>
      'Give me a weekly review of my Strait links. Use compare_analytics for the last 7 days against the 7 days before, ' +
      'once for totals and once with group: channel. Then get_top_links for the last 7 days by installs. ' +
      'Report in short paragraphs: what went up, what went down (call out any channel or link down more than 30 %), ' +
      'and one thing to check next. Use only the numbers the tools return; say when a number is 0 or missing.',
  },
  {
    name: 'debug_link',
    title: 'Why does this link open the browser?',
    description: 'Runs the setup checks, checks the App Links / Universal Links files, traces the link through each channel and reads its recent taps.',
    argsSchema: { slug },
    text: ({ slug: s }) =>
      `My Strait link "${s}" does not open my app where I expect. Find out why. ` +
      '1) ' + VERIFY_FIRST +
      `2) get_link for "${s}" to read its shortUrl and destination. 3) check_app_links on the shortUrl's host and on the destination's host. ` +
      `4) trace_tap for "${s}". 5) list_taps for "${s}" (last 24 hours) to see what real taps did. ` +
      'Then tell me, channel by channel, where taps go and why, and the exact fix for every error finding. Do not change anything.',
  },
  {
    name: 'setup_check',
    title: 'Is my workspace set up?',
    description: "Every app setup check with its fix, this month's usage, custom domains still waiting for DNS, failing webhooks and the App Links files.",
    text: () =>
      'Check my Strait setup and list what needs attention. Start with ' + VERIFY_FIRST +
      'Then use get_usage, list_domains (any domain not live: which DNS records are missing), ' +
      'list_webhooks then list_webhook_deliveries for each one that is on (any failed deliveries in the last days), ' +
      'and check_app_links on my link domain (the host of any link from list_links). ' +
      'Answer as a short checklist: ok or needs attention, with the one next step for each. Do not change anything.',
  },
  {
    name: 'migrate_firebase_links',
    title: 'Move my Firebase Dynamic Links',
    description: 'Maps your Firebase Dynamic Links to Strait links, shows the plan, and creates them in bulk only after you say yes.',
    argsSchema: { old_domain: host },
    text: ({ old_domain: d }) =>
      'Help me move my Firebase Dynamic Links to Strait. ' +
      '1) search_docs for "migrate from Firebase Dynamic Links" and use its field table (link → longUrl, afl → androidFallbackUrl, ' +
      'ifl → iosFallbackUrl, ofl → desktopUrl, st/sd/si → title/description/imageUrl, utm campaign → campaign). ' +
      `2) Ask me to paste my links: long Dynamic Links (with link=, afl=, ifl=…), rows from the Firebase export CSV, or short links${d ? ` on ${d}` : ''}. ` +
      'For a short link with no long form, run check_link on it to learn where it goes now (a few checks a minute; say which ones you could not check). ' +
      "3) Build one Strait link per old link: the slug is the old link's code (the path after the domain), longUrl must be https; " +
      'list any link you cannot map and why. Old app settings (package name, bundle ID, App Store ID) are not per link: tell me to add them once in Dashboard → Apps & stores. ' +
      '4) Show me the plan as a table (slug, longUrl, fallbacks) with the count, and ask me to answer yes. Create nothing before I say yes. ' +
      '5) After my yes, batch_create_links in groups of at most 500. A slug that already exists comes back as a 409 for that item, so a re-run is safe. ' +
      'Report how many were created, already existed or failed, with each failure. ' +
      '6) get_link on one created slug and check_app_links on the host of its shortUrl, then tell me what is left: ' +
      'point my app and backend at the new shortUrl links, and for big exports the dashboard has Import → Move from Firebase.',
  },
  {
    name: 'why_not_open',
    title: "Why didn't my link open the app?",
    description: 'For a link that opened the store, browser or nothing: runs the setup checks, checks the link, the App Links / Universal Links files, the tap path and recent taps, and reads a pasted doctor() report.',
    argsSchema: { slug, platform, app },
    text: ({ slug: s, platform: p, app: a }) => {
      const where = p ? ` on ${p === 'iphone' ? 'an iPhone' : 'Android'}${a ? ` from ${a === 'browser' ? 'the browser' : a[0]!.toUpperCase() + a.slice(1)}` : ''}` : '';
      const tap = p
        ? `4) simulate_tap for "${s}" with ua "${presetFor(p, a)}" to see what Strait does on that phone and app. `
        : `4) trace_tap for "${s}" to see what Strait does on each phone and app. `;
      return (
        `My Strait link "${s}" did not open my app${where}. Find out why. ` +
        '1) ' + VERIFY_FIRST +
        `2) get_link for "${s}": is it active, not expired, and does longUrl sit on my app's domain? ` +
        "3) check_app_links on the host of its shortUrl (and on longUrl's host if that is a different domain); list every error finding with its fix. " +
        tap +
        `5) list_taps for "${s}" over the last 24 hours: did my tap arrive, where was it sent, and did an app open follow? ` +
        'No tap at all means it never reached Strait (wrong link, or the app intercepted it). ' +
        '6) Ask me to run the SDK doctor() in a debug build and paste its findings. Read them by id: ' +
        DOCTOR_IDS +
        '. 7) If it is still unclear, search_docs for "links open the browser instead of the app". ' +
        'Then tell me the most likely cause first and the exact fix for it, then the others. Do not change anything.'
      );
    },
  },
];
