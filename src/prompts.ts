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

export const PROMPTS: StraitPrompt[] = [
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
    description: 'Checks the App Links / Universal Links files, traces the link through each channel and reads its recent taps.',
    argsSchema: { slug },
    text: ({ slug: s }) =>
      `My Strait link "${s}" does not open my app where I expect. Find out why. ` +
      `1) get_link for "${s}" to read its shortUrl and destination. 2) check_app_links on the shortUrl's host and on the destination's host. ` +
      `3) trace_tap for "${s}". 4) list_taps for "${s}" (last 24 hours) to see what real taps did. ` +
      'Then tell me, channel by channel, where taps go and why, and the exact fix for every error finding. Do not change anything.',
  },
  {
    name: 'setup_check',
    title: 'Is my workspace set up?',
    description: "This month's usage, custom domains still waiting for DNS, webhooks that are failing, and the App Links files.",
    text: () =>
      'Check my Strait setup and list what needs attention. Use get_usage, list_domains (any domain not live: which DNS records are missing), ' +
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
    description: 'For a link that opened the store, browser or nothing: checks the link, the App Links / Universal Links files, the tap path and recent taps, and reads a pasted doctor() report.',
    argsSchema: { slug, platform, app },
    text: ({ slug: s, platform: p, app: a }) => {
      const where = p ? ` on ${p === 'iphone' ? 'an iPhone' : 'Android'}${a ? ` from ${a === 'browser' ? 'the browser' : a[0]!.toUpperCase() + a.slice(1)}` : ''}` : '';
      const tap = p
        ? `3) simulate_tap for "${s}" with ua "${presetFor(p, a)}" to see what Strait does on that phone and app. `
        : `3) trace_tap for "${s}" to see what Strait does on each phone and app. `;
      return (
        `My Strait link "${s}" did not open my app${where}. Find out why. ` +
        `1) get_link for "${s}": is it active, not expired, and does longUrl sit on my app's domain? ` +
        "2) check_app_links on the host of its shortUrl (and on longUrl's host if that is a different domain); list every error finding with its fix. " +
        tap +
        `4) list_taps for "${s}" over the last 24 hours: did my tap arrive, where was it sent, and did an app open follow? ` +
        'No tap at all means it never reached Strait (wrong link, or the app intercepted it). ' +
        '5) Ask me to run the SDK doctor() in a debug build and paste its findings. Read them by id: ' +
        DOCTOR_IDS +
        '. 6) If it is still unclear, search_docs for "links open the browser instead of the app". ' +
        'Then tell me the most likely cause first and the exact fix for it, then the others. Do not change anything.'
      );
    },
  },
];
