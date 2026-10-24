# Contributing

Thanks for looking. Laki is one person's project, so a small, focused change with a test lands best; for anything
bigger, open an issue first and say what you're after.

## Build

You need macOS (Linux is a preview), Node 22.12+, git, and `gh` for anything about PRs.

```bash
git clone https://github.com/igorkasyanchuk/laki && cd laki
npm ci                                   # exactly the lockfile's versions
npm run dev                              # the app, with the renderer on :5199
npm run pack                             # dist/mac-arm64/Laki.app (Intel: dist/mac), ad-hoc signed
```

A Laki you built is ad-hoc signed: the first open asks once (System Settings › Privacy & Security › *Open Anyway*).

## Test

```bash
npm run typecheck
npm run test:one -- test/pr.test.ts      # the files you touched; one test: -- --test-name-pattern='<words>' <file>
npm test                                 # everything: a few minutes, 4 files at a time
```

The tests use fakes for every agent, `gh` and `ssh` (`test/fakes`), a temp `LAKI_HOME` and `HOME` each, and no
network. There is no CI: run the typecheck and the tests on your Mac before you send a PR.

To try the UI in a browser without your own projects or agents, a demo world (a repo, three workspaces, fake agents):

```bash
npm run demo -- /tmp/laki-x              # prints a URL with the daemon's port and token
npm run dev:web                          # then open that URL
LAKI_HOME=/tmp/laki-x/data node bin/laki.js stop        # afterwards (and stop vite)
```

## The rules

- **No new dependencies.** Node's stdlib and what's in `package.json` already.
- **Never touch the user's agents' own settings**: nothing writes `~/.claude/settings.json` or `~/.codex`, and no test
  touches the real `~/.laki`, `~/.claude` or `~/.codex`. Agents get Laki's settings through flags.
- The daemon listens on 127.0.0.1 only, behind its token and Origin check: keep both on anything new.
- Short, plain words in the UI.

## How the code works

[AGENTS.md](AGENTS.md) is the map: the daemon, its API, the renderer, every module and why it's so. It's written for
coding agents and it's long: give it to yours, or search it for the part you're changing.

## A pull request

- one change per PR, with its test where that's cheap;
- a new command or key: `docs/guide.md`, the CLI's usage (`src/shared/usage.ts`), and `README.md` if it's a main one;
- something users see: a line under `## Next` in `docs/release-notes.md`.

Security problems: [SECURITY.md](SECURITY.md), not an issue. By sending a PR you agree it's under Laki's MIT license.

## Releases

Maintainers only: `npm run release` builds every platform, signs and notarizes with the maintainer's Developer ID and
uploads a draft ([docs/manual-release.md](docs/manual-release.md)). Anyone else can run the same builds and checks
with neither, from a clean `main` on an Apple silicon Mac: `npm run release -- --adhoc --no-upload` (Docker for the
Linux ones, else `--skip=linux-arm64,linux-x64`; another branch: `--any-branch`).
