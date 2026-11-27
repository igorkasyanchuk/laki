# AGENTS.md: scripts/

What this folder's files are. Read the root [AGENTS.md](../AGENTS.md) first: the commands, the architecture, the invariants, the conventions.

## Notes

- `scripts/pack-smoke.sh` checks the packaged app (daemon, CLI and hooks through Electron's node, plus a
  window screenshot); `APP=$PWD/dist/mac/Laki.app` checks the Intel build (under Rosetta here). `scripts/mem.sh` measures RSS with 3 workspaces × 2 tabs and idle CPU, by hand; `scripts/mem.ts` (npm run mem) is the gate: the demo world on the packaged app, its own `--user-data-dir` (beside an open Laki), the daemon, the largest renderer and the pty host held to package.json's `lakiMem`, 10% allowed (`memCheck`, test/mem.test.ts); release.sh runs it.

## Files

| file | what |
|---|---|
| `scripts/` | `dmg.sh` (npm run dmg), `audit.ts` and `audit-allow.json` (npm run audit:deps), `demo.ts`, `ai-evals.ts` and `ai-evals.json` (npm run eval:ai: Laki AI's tool choice against a real model, in a demo world; CONTRIBUTING.md), `ui-smoke.ts`, `cov.ts`, `pack-smoke.sh`, `mem.sh`, `mem.ts` (npm run mem), `prices.ts` (npm run prices: LiteLLM's model price table into `src/shared/prices.json`, the claude-*, gpt-5*, grok-* and gemini-* chat rows with their cache, 1-hour write and long-prompt rates, sorted and dated; `-- <file.json>` reads a saved copy; by hand before a release: the app never fetches prices, `types.ts` `PRICE_OWN` wins over a row; dmg.sh warns past 30 days), `icon.swift`, `widget-schema.ts`, `icon-packs.ts` |
