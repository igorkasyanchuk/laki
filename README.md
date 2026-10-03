# Laki

A macOS app for running coding agents (Claude Code, Codex, or any command) side by side, each task in its
own git worktree, in real terminals. What it is and where it's going: [requirements](requirements/README.md).

Laki is built twice while we pick the stack; both have the same features and UI:

- [`electron/`](electron): **Laki Electron**, Electron + a Node daemon. CLI `laki-electron`, data `~/.laki-electron`.
- [`go/`](go): **Laki Go**, a Go daemon + Wails. CLI `laki-go`, data `~/.laki-go`.

Each is its own git repository with a `README.md` (install, use) and an `AGENTS.md` (how the code works).
The UI files listed in `requirements/README.md` are identical in both: change both copies.

```bash
cd electron && npm install && npm run pack && npm test     # dist/mac-arm64/Laki Electron.app
cd go && (cd frontend && npm install) && ~/go/bin/wails build && go test ./...   # build/bin/laki-go.app
```
