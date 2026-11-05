# ADR 0002: three more skills in the Claude Code plugin (troubleshoot, events, migration)

Date: 5 Nov 2026 (run-1105, item skills-pack-expand)

## Problem
The launch post sells "set up from your AI tool". On launch day developers will also ask their assistant to fix a
link that opens the browser, add a purchase event and move off Firebase Dynamic Links or Branch. The plugin ships
only `strait-setup`, so for those questions the assistant guesses: invented tool names, Firebase-era calls, wrong
event APIs. Each wrong answer is a support ticket or a lost first link.

## Who it serves
A developer with the `strait` plugin in Claude Code, mid-integration or mid-migration.

## Options
1. **Do nothing.** `strait-setup` mentions migration and "opens the browser" in one paragraph; the MCP prompts
   (`why_not_open`, `migrate_firebase_links`) exist but only run when the user picks them.
2. **More MCP prompts or tools.** Prompts only fire from a picker; tools can't read the user's code. No new endpoint is needed.
3. **Extend what exists (chosen).** Three short SKILL.md files beside `strait-setup`, each a router to the real MCP
   tools, the `strait` CLI and the live docs pages, which stay the source of truth. No code, no dependency, no npm release
   (skills ship from GitHub with the plugin; plugin version 0.1.0 → 0.2.0 so installs pick them up).

Reuse: same structure as `strait-setup` and Anthropic's skill format; facts copied from the live docs (5 Nov), not re-derived.

## Security lens
- Data exposure: every skill repeats "secret key only on servers"; the test fails on a literal `st_live_` key.
- Tampering/abuse: writes go through MCP tools that already preview and need `confirm: true` (`record_event`,
  `batch_create_links` after an explicit yes). The skills add no new write path.
- Spoofing/DoS: none new; checks without a key share the existing per-network budget.

## Architecture lens
Drift is the failure mode: a renamed tool or moved docs page makes a skill wrong. `test/skills.test.ts` checks every
backticked snake_case name against `TOOLS`/`PROMPTS` (plus a short allowlist of API field names) and every
straitlink.in/docs link against `src/docs-index.json`, so CI catches it. Skills stay under 100 lines and link out
for detail, so the docs, not the skills, carry versions.

## Cost
Zero runtime cost. Maintenance: rerun the test after `npm run docs-index`.
