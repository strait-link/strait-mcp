/**
 * Build src/docs-index.json (what the search_docs tool searches) from the website's
 * docs: ../site/content/docs/*.md, in sidebar order (site/lib/nav.mjs), with the
 * {{placeholders}} filled from site/site.config.json. One entry per ## section.
 *   npm run docs-index            (SITE_DIR=/path/to/site to use another checkout)
 * Build from what is LIVE: SITE_DIR = an export of the site's origin/main, SITE_COMMIT = its short sha
 * (written into the index as siteCommit so a stale index is easy to spot).
 * Run it whenever the docs change; the index is committed so the server works offline.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const siteDir = resolve(process.env.SITE_DIR ?? new URL('../../site', import.meta.url).pathname);
if (!existsSync(join(siteDir, 'content/docs'))) {
  console.error(`no docs at ${siteDir}/content/docs (set SITE_DIR)`);
  process.exit(1);
}
const { loadConfig, placeholderMap, interpolate } = await import(pathToFileURL(join(siteDir, 'lib/config.mjs')).href);
const { DOCS_NAV } = await import(pathToFileURL(join(siteDir, 'lib/nav.mjs')).href);
const { slugify } = await import(pathToFileURL(join(siteDir, 'lib/markdown.mjs')).href);

const cfg = loadConfig(pathToFileURL(join(siteDir, 'site.config.json')));
const map = placeholderMap(cfg);
const origin = `https://${cfg.domains.site}`;

/** Front matter off, placeholders filled. */
function load(file) {
  let text = readFileSync(join(siteDir, 'content/docs', `${file}.md`), 'utf8');
  let title = null;
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (fm) {
    title = fm[1].match(/^title:\s*(.+)$/m)?.[1]?.replace(/^["']|["']$/g, '') ?? null;
    text = text.slice(fm[0].length);
  }
  const abs = (t) => t.replace(/\]\(\//g, `](${origin}/`); // site-relative links → absolute
  return { title: title && interpolate(title, map, `${file}.md title`), text: abs(interpolate(text, map, `${file}.md`)) };
}

const entries = [];
for (const group of DOCS_NAV) {
  for (const item of group.items) {
    // Per-operation API pages are generated from openapi.json (file: null); they have no Markdown source.
    if (!item.file) continue;
    const { title, text } = load(item.file);
    const pageTitle = title ?? item.label;
    const url = `${origin}/${item.path}`;
    // Split on ## headings (### stays inside its section); the part before the first ## is the intro.
    const parts = text.split(/^## +/m);
    const intro = parts.shift() ?? '';
    const push = (section, anchor, body) => {
      const clean = body.replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim();
      if (clean) entries.push({ page: pageTitle, group: group.title, section, url: anchor ? `${url}#${anchor}` : url, markdown: clean });
    };
    push(null, null, intro.replace(/^# .*\n/, ''));
    for (const part of parts) {
      const nl = part.indexOf('\n');
      const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
      push(heading, slugify(heading), nl === -1 ? '' : part.slice(nl + 1));
    }
  }
}

const out = new URL('../src/docs-index.json', import.meta.url);
let siteCommit = process.env.SITE_COMMIT ?? null;
if (!siteCommit) {
  try {
    siteCommit = execFileSync('git', ['-C', siteDir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {}
}
const json = JSON.stringify({ source: origin, builtFrom: 'site/content/docs', siteCommit, sections: entries }, null, 1) + '\n';
writeFileSync(out, json);
console.log(`docs-index.json: ${entries.length} sections from ${DOCS_NAV.flatMap((g) => g.items).length} pages, ${(json.length / 1024).toFixed(0)} KB`);
