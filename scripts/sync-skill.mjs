// Regenerates skills/strait-setup/SKILL.md from the site repo, which owns it (site/lib/skill.mjs,
// fed by site/site.config.json: install lines, versions, domains, keys). The site serves the same
// file at https://straitlink.in/ai/strait-setup/SKILL.md, and its tests fail if this copy drifts.
//   npm run skill:sync            (expects ../site; or SITE_DIR=/path/to/site)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(process.env.SITE_DIR ?? resolve(here, '../../site'));
if (!existsSync(resolve(site, 'lib/skill.mjs'))) {
  console.error(`No site checkout with lib/skill.mjs at ${site}. Set SITE_DIR.`);
  process.exit(1);
}
const { loadConfig } = await import(pathToFileURL(resolve(site, 'lib/config.mjs')).href);
const { straitSetupSkill } = await import(pathToFileURL(resolve(site, 'lib/skill.mjs')).href);
const out = resolve(here, '../skills/strait-setup/SKILL.md');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, straitSetupSkill(loadConfig(resolve(site, 'site.config.json'))));
console.log(`wrote ${out} from ${site}`);
