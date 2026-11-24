# AGENTS.md: src/ptyhost/

What this folder's files are. Read the root [AGENTS.md](../../AGENTS.md) first: the commands, the architecture, the invariants, the conventions.

## Files

| file | what |
|---|---|
| `src/ptyhost/main.ts` | the pty host (settings.ptyHost): a process that owns the terminals and their last 2 MB, so they outlive the daemon; `proto.ts`: its socket's frames and ops (`docs/dev/agents.md`) |
