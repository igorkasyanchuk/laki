# Laki: what we're building

Laki is a macOS desktop app for running several coding agents at once (Claude Code, Codex, or any command
line program), each task in its own git worktree, in real terminals. You see every agent's state at a
glance, step in when one needs you, and ship its branch as a PR. It's the successor of **wb**
(`~/projects/specdrop-cli`), a tmux + iTerm workbench with the same goal.

This folder is the product side: what Laki is for, what it does, and what's still open. How each build
works is in its own `AGENTS.md`; how to use it, in its `README.md`.

## Why

One developer runs many agents in parallel: a feature in one, a bug fix in another, a review in a third.
Plain terminals don't scale to that:

- you can't tell which agent is waiting for a permission, which finished and which is still working;
- agents step on each other in one checkout;
- closing a window or a crash kills hours of agent context;
- setup (install, env, ports) is repeated by hand for every task;
- PR feedback (failing CI, review comments) has to be copied back to the agent by hand.

wb solved most of this inside tmux and iTerm, but it's bound to them: no image preview, no rich panels, no
drag and drop, and a sidebar that has to stay open for background work. Laki is a standalone app with the
same engine ideas. On 2026-10-03 we chose to build our own app instead of adopting Superset, Supacode or
cmux.

## Principles

- **Agents stay real CLIs.** `claude` and `codex` run in real PTYs, exactly as in a terminal. Status comes
  from the agents' own hooks (Claude's `--settings` hooks, Codex's `notify`), not from screen scraping.
  A headless mode (stream-json, codex app-server) may come later.
- **A daemon owns the sessions.** The app is a client: closing it never stops an agent. Background work
  (PR checks, usage-limit waits, the follow-up queue) runs in the daemon, with the app open or not.
- **One CLI drives the same daemon**, for scripts and for agents themselves (the agent skill).
- **Compact and keyboard-first.** tmux-style tabs and panes, icons instead of text buttons, a status bar,
  a ⌘K palette, a key for every menu item.
- **Isolation by default.** One worktree and branch per task (`laki/<id>`), its own `$PORT`, its own setup.
  Local (in the repo) and plain (no git) folders work too.
- **Small and boring.** Few dependencies, platform features first, no telemetry. Data stays in the app's
  own folder; `~/.claude` and `~/.codex` are only written when the user installs the skill.

## Two builds, one product

Laki is built twice while we decide on the stack. Both have the same features and share their UI code
(identical `layout.ts`, `Panes.tsx`, `Find.tsx`, `ui.tsx`, `Settings.tsx`, `themes.ts`, `PromptInput.tsx`,
`Info.tsx`, `Glyph.tsx`, `SidePanel.tsx`): every change goes into both.

| | [Laki Electron](../electron) | [Laki Go](../go) |
|---|---|---|
| stack | Electron + Node daemon (node-pty, @xterm/headless) + React + xterm.js | Go daemon (creack/pty, x/vt) + Wails (system WebKit) + React + xterm.js |
| CLI | `laki-electron` | `laki-go` |
| data | `~/.laki-electron` (`LAKI_ELECTRON_HOME`) | `~/.laki-go` (`LAKI_GO_HOME`) |
| daemon link | HTTP + WebSocket on 127.0.0.1, token | unix socket in the data folder |
| app size / memory | ~290 MB / ~500 MB | ~10 MB / much less |
| strong at | rich UI next steps, Linux/Windows later, one language | memory, size, reuse of wb's Go engine |

Our current lean is Laki Electron, because the next asks (image preview, diagrams, drawing in the title
bar, Linux/Windows) are easiest there. Laki Go wins on memory, size and Go reuse. Not decided.

## Concepts

- **Project**: a git repo, or any folder, added to Laki (⌘O, or drop it on the window).
- **Workspace**: one task. A git worktree on branch `<prefix><id>` (default `laki/`), or the repo itself
  (*local*), or the folder (*plain*). Has a `$PORT`, a color, a name, and maybe a PR.
- **Tab**: holds one terminal or several panes (split, stacked). Kinds: agent, shell, setup, dev (Run), ship.
- **Preset**: how an agent starts: Claude Code, Codex or any command, with args and env.
- **Status**: running, waiting (a permission prompt), done while you weren't looking, idle, usage limit,
  ended (ok / failed). A workspace shows its most urgent tab.
- **Queue**: follow-ups typed into an agent when its turn ends (`send --when-idle`).
- **Scripts**: setup, teardown and run per project, in the app or in the repo's `.laki.json`.
- **Agent skill**: `SKILL.md` and a CLI launcher in `~/.claude/skills/<cli>` and `~/.codex/skills/<cli>`, so
  agents know Laki and can start workspaces, message other agents and read their screens.

## What it does today

**Workspaces and projects**
- Add a repo or folder; new workspace from a base branch with a name, an agent and a first prompt (text,
  dictation, pasted or dropped images).
- Setup script per new worktree (agents and Run wait for it), teardown on delete or archive, env per project
  and globally, `$LAKI_PROJECT_PATH` to copy files like `.env` from the repo.
- Rename, color, reorder (drag), fork (new worktree + forked Claude chat), archive and restore (chats
  resume), delete.

**Agents and terminals**
- Real terminals with scrollback that survive the app closing; replay on reattach.
- Tabs and panes: split by dragging or from menus, resize, move, rename (double click), color, restart.
- A shell tab closes when it exits; an agent tab when it ends cleanly (exit 0). A failed one stays to read,
  and Enter starts it again.
- Live status per tab and workspace, macOS notifications when an off-screen tab waits or finishes.
- Esc / ⌃C interrupt goes back to idle. Usage limits: wait for the reset, then type `continue`.
- Resume after a daemon restart: `claude --resume`, `codex resume`.
- ⌘F find in the terminal; copy on select; font, size, line height, weight, contrast, cursor, zoom.

**Git and PRs**
- Status bar: branch ← base, `$PORT`, listening ports (click to open), PR, CI summary.
- PR scan with `gh` every minute; *fix CI* sends failing checks and their logs to the agent; *review* sends
  new review threads. Once per commit, at most 3 tries in a row.
- Ship: commit, push, open the PR in a ship tab.
- Info panel (⌘I): PR, checks, description, what each agent said last.

**Files**
- Side panel (⌥⌘B): files (changed ones marked), changes against the base with diffs, PR review threads.
- ⌘P / "Find files…" in ⌘K: fuzzy file search; preview text and images in the app; ⌘W closes the preview.
- Open in any installed editor or terminal (⌘E for the default).

**Run**
- ▷ Run starts the project's run script in a dev tab with `$PORT`; ■ stops it; open `localhost:$PORT`.

**Look**
- 14 themes (solid and Warp-style gradients, dark and light), theme colors in the terminal palette.
- Tab and workspace colors; compact layout aligned with the window's traffic lights; resizable, collapsible
  sidebar (⌘B).

**CLI**
- `ls [--json]`, `project add|ls|rm`, `new`, `tab`, `send [--when-idle]`, `screen`, `diff`, `run`, `ship`,
  `rm`, `archive`, `restore`, `fork`, `open`, `daemon`, `stop`. Agents' hooks call the same CLI.

## Quality bar

- macOS on Apple silicon first.
- End-to-end tests with fake `claude`, `codex` and `gh`, temp homes and their own daemons; never the real
  data folders. Coverage of daemon and CLI code: 90%+.
- Typing latency and screen replay fidelity are the main risks for a terminal app; both are checked by hand
  on each big change.
- A hook never fails or blocks an agent.

## Open questions and next

- **Pick the stack**: Electron or Go, then drop the other build.
- **Wanted next**: diagrams, drawing in the title bar, Linux and Windows.
- **Sessions that survive a daemon crash** (a holder process per session, as the wb-diri prototype did).
- **A status / MCP / JSON-schema layer** for other tools (as the wb-bot prototype had).
- **Several PRs per workspace**: the model tracks one per branch today.
- **Custom-command tabs** (e.g. `npm test`) close on a clean exit like agents do, which hides their output.
  Keep, or close only claude/codex and shells?
- **UI tests**: the React code has no tests yet.
- **Dictation** in the new-workspace prompt: the fix isn't confirmed with a real voice yet.
- **Ligatures** aren't drawn (needs an xterm.js add-on).
- **Signing, icon, auto-update** for both builds.

## History

- **2026-10-03**: decided to build our own app. Four prototypes were built and compared: Go + Wails (wb-spike),
  Electron (wb-superset), Rust + GPUI (wb-diri), terminal-native Go + Bubble Tea (wb-bot). wb-bot and wb-diri
  were dropped the same day. Feature batches since: compact UI, Settings page, presets, themes, PR
  automation, side panel, file finder and preview, agent skill, tab auto-close.
- **2026-10-03**: renamed to **Laki**. wb-superset became Laki Electron (`laki/electron`), wb-spike became
  Laki Go (`laki/go`). Both start with fresh data folders; the old apps' data (`~/.wb-superset`,
  `~/.wb-spike`) is left as it was.
