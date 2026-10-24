# Contributing

Thanks for looking. Laki is one person's project, so a small, focused change with a test lands best; for anything
bigger, open an issue first and say what you're after.

## Build and test

You need Node 22.12+, git, and `gh` for anything about PRs.

```bash
npm install
npm run dev                              # the app, with the renderer on :5199
npm run typecheck
npm run test:one -- test/pr.test.ts      # the files you touched
npm test                                 # everything: a few minutes
```

The tests use fakes for every agent, `gh` and `ssh` (`test/fakes`), a temp `LAKI_HOME` and `HOME` each, and no
network. They never touch your `~/.laki`, `~/.claude` or `~/.codex`; keep it so.

## How the code works

[AGENTS.md](AGENTS.md) is the map: the daemon, its API, the renderer, and the rules (no new dependencies, the daemon
only on 127.0.0.1 behind its token, never write the agents' own settings). It's written for coding agents, so give it
to yours.

## A pull request

- one change per PR, with its test where that's cheap;
- a new command or key: `docs/guide.md`, the CLI's usage (`src/shared/usage.ts`), and `README.md` if it's a main one;
- something users see: a line under `## Next` in `docs/release-notes.md`;
- short, plain words in the UI.

Security problems: [SECURITY.md](SECURITY.md), not an issue. By sending a PR you agree it's under Laki's MIT license.
