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
];
