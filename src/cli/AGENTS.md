# AGENTS.md: src/cli/

What this folder's files are. Read the root [AGENTS.md](../../AGENTS.md) first: the commands, the architecture, the invariants, the conventions.

## Files

| file | what |
|---|---|
| `src/cli/main.ts` | the `laki` CLI (`laki hook` is `src/cli/hook.ts`, its own build entry); `help`: `laki`, `--help`/`-h`, `laki help <command> [sub]`, `<command> --help` (or after its sub), before any daemon (`usage.ts` `helpFor`: its USAGE lines, its alternatives' else, then `HELP`'s details and examples, for agents) |
| `src/cli/mcp.ts` | `laki mcp`: the MCP server over stdio, its `ext_*` tools |
| `src/cli/completion.ts` | `laki completion zsh|bash|fish`: scripts from usage.ts' `completionWords`; names through `laki _complete` (main.ts: a running daemon only) |
