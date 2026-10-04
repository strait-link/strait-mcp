# COUNCIL-integration (mcp-server)

Branch `council/integration`, based on local `main` (7b1892d). Merged F. No remote exists yet.
- `scripts/build-docs-index.mjs` skips the generated per-operation API pages (`file: null` in the new docs nav), then
  `npm run docs-index` rebuilt `src/docs-index.json` from the integrated site docs: 257 sections from 62 pages.
- `npm run typecheck` exit 0; `npx vitest run` exit 0, 4 files / 39 tests; `npm run build` exit 0.
