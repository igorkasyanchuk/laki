# AGENTS.md: src/daemon/

What this folder's files are. Read the root [AGENTS.md](../../AGENTS.md) first: the commands, the architecture, the invariants, the conventions.

## Files

| file | what |
|---|---|
| `src/daemon/main.ts` | HTTP + WebSocket server, auth (token, Origin), the `api` table, `GET /artifact/…` (the artifacts viewer), shutdown |
| `src/daemon/gates.ts` | data only: every method's class for an agent's call (`AGENT_OK`, `AGENT_NO` with the why, `AGENT_OWN`) and for remote access (`REMOTE_OK`, `REMOTE_NO`), the ticks; main.ts' `classed` throws at load on one left out |
| `src/daemon/core.ts` | the model: projects, workspaces, tabs, hooks, queue, limits, run, ship, archive/fork, view; the modules below (hosts, pr, files, remote, resources…) import it and it them, and main.ts imports each directly; no module in the cycle reads another's const or let as it loads, so any of them can load first (`test/load-order.test.ts`), and the data folder, `dir`, is `dir.ts`', out of the cycle |
| `src/daemon/dir.ts` | the data folder, `dir` (`dataDir()`), in a module of its own: out of core's import cycle |
| `src/daemon/hosts.ts` | SSH hosts (one ssh connection per host, `exec`/`sshIn` there, a tab's ssh) and cloud workspaces |
| `src/daemon/pr.ts` | branches followed, PR scans, `autoPR` and the PR switches' messages, merge when green, the side panel's PR calls |
| `src/daemon/gitlab.ts` | GitLab through glab: `forgeOf` (a project's origin), its MR as a `PR` (`forge: 'gitlab'`), pipeline jobs as checks, the MR actions, issues, Ship's `shipMr` |
| `src/daemon/files.ts` | the diff against the base and its size, Changes' revert and redo, the side panel's files |
| `src/daemon/db.ts` | #1: a SQLite database for Files (fileRead's `db`, `dbRead`): its tables with their counts and schema, a table's first 200 rows sorted and filtered, a SELECT-only query; read-only `node:sqlite`; pure; run in a worker (`dbWorker.ts`, files.ts' `dbOf`: 5 s, 256 MB) |
| `src/daemon/dbWorker.ts` | `dbRead` off the daemon's main thread (`out/main/dbWorker.js`) |
| `src/daemon/sheet.ts` | an Excel workbook's sheets as tables (fileRead's `sheets`): the zip through node's zlib, values, dates by their style, each part once and 96 MB in all; pure; run in a worker (`sheetWorker.ts`, files.ts' `sheetsOf`: 3 s, 256 MB) |
| `src/daemon/remote.ts` | tunnels (cloudflared, tailscale), shared tabs, remote access |
| `src/daemon/agentLog.ts` | what agents did through Laki's API, per workspace (main.ts call's `agentLine`): kept and capped, `agentLog` reads it |
| `src/daemon/e2e.ts` | S14, remote access end to end: HKDF-SHA-256 keys, AES-256-GCM frames with per-direction counters (`channel`, `first`), a device key wrapped by its cookie (`wrap`, `unwrap`); the page's half is `src/renderer/src/e2e.ts` (WebCrypto, IndexedDB) |
| `src/daemon/resources.ts` | listening ports, memory and CPU by tab, process groups, sleep and wake |
| `src/daemon/artifacts.ts` | a storage folder's artifacts and the published links, kept in its `.laki-links.json` (`.url` files moved in) |
| `src/daemon/cap.ts` | a workspace's spend cap: its agents' meters summed (`capView`), the 80% notice, the stop and ask past it (`capTick`, `capToolEnd`), `capSet`, an agent's lower one only (`capRaises`); the cost warning (`wsUsd`, `costWarnOf`, `wsCost`, told once per amount in `capTick`) |
| `src/daemon/suggest.ts` | `laki suggest`: an agent's suggested task on its workspace (`suggest`, withdraw), the user's Start, Dismiss or Edit first's made (`suggestAnswer`) |
| `src/daemon/meters.ts` | transcripts read as they grow: the context and usage meters, today's spend; the Reader's chat (`chatRead`), its background tasks and MCP calls |
| `src/daemon/agentUsage.ts` | Grok's and Antigravity's chats by day and model, read only from their own files (Grok's `usage.json`, agy's conversation DB through node's sqlite: cloned, only its new steps read, past 32 MB in a worker, `agyWorker.ts`): the Usage page's and Today's rows |
| `src/daemon/mcpApps.ts` | MCP Apps in the Reader: a claude call's MCP server (from its Claude config) asked for the tool's `ui://` page, `GET /mcp-app/…` with its CSP, the app's tool calls |
| `src/daemon/phone.ts` | phone pushes and the taps that answer them, to the webhook and Telegram |
| `src/daemon/telegram.ts` | Settings › Telegram: your own bot (its token by keychain.ts), pairing by a one-time code, the long poll (getUpdates), pushes and edits, taps from the paired user's private chat only, the old webhook format migrated; `LAKI_TELEGRAM_API`: tests' fake |
| `src/daemon/schedule.ts` | the board's to-dos, reminders, scheduled tasks, `flowHooks` |
| `src/daemon/askStreak.ts` | F15: your Allows in a row per project and kind of ask (shared/ask.ts `streakOf`), at 5 a notice suggesting a rule (Make it a rule through `projectSet`'s allow, No, Don't suggest again); core's `streakReset` starts a project's over |
| `src/daemon/gitTidy.ts` | B8: each project's git tidied weekly (git worktree prune, git maintenance run --auto, under nice, never while its agents work, skipped where the user's git says so), Tidy now (`gitTidy`), the Disk page's git facts (`gitFacts`) |
| `src/daemon/dataBackup.ts` | `laki backup`, `laki restore <file.tgz>` (Settings › General › Backup): the user's data (dir.ts' `BACKUP_KEEP`) in a .tgz by the system's tar, its manifest first; a restore checked, staged, moved in as the daemon stops (`apply`, main.ts shutdown) |
| `src/daemon/uninstall.ts` | B3: Uninstall Laki (Settings › General › Developer, `laki uninstall`): a row per piece (the laki command, this Laki's skills, the daemon, the worktrees, the data), removed; the data and worktrees as the daemon stops (`wipe`, main.ts shutdown), an open app told (`uninstalled`: main's dialog, to the Trash) |
| `src/daemon/agentCli.ts` | A9: the agents' CLIs: each one's version and npm's newest, how it was installed (`howOf`), its update in a `script` tab (`agentUpdate`), `outdated` (the view's `agentUpdates`) |
| `src/daemon/accounts.ts` | claude's and codex's accounts: folders with the agent's own linked in, a tab's account, who signs in |
| `src/daemon/skill.ts` | the agent skills: SKILL.md and a CLI launcher in each agent's `skills/laki` and `skills/laki-widget` (`~/.claude`, `~/.codex`, `~/.gemini/config` (agy's), `~/.grok`, `~/.config/opencode`; `skills`, `skillSet`); `src/shared/usage.ts` is the CLI help it quotes |
| `src/daemon/widgets.ts` | widgets: folders, storage, fetch on schedule, actions, a JS widget's page; it re-exports the six below, so `widgets.X` reaches them |
| `src/daemon/widgetLogs.ts` | an extension's log file: its runs' stderr, Laki's lines, `laki widget log` |
| `src/daemon/widgetEvents.ts` | events and their handlers, gates before a ship, merge or archive, streams |
| `src/daemon/widgetTools.ts` | tools for agents, the asks before they run, grants, an AI source's permission asks |
| `src/daemon/widgetTrust.ts` | what a Yes holds for: `filesHash`, a repo extension's whole folder (`repoFiles`, `dirHash`), `widgetWhat` |
| `src/daemon/widgetFiles.ts` | an extension's files read and written, its history and undo, Remix, the trash |
| `src/daemon/widgetDev.ts` | runs, mock data and fixtures, `laki widget dev`'s links, `widgetNew`, the checker |
| `src/daemon/share.ts` | shared tabs: transcripts as what was said, its Markdown and the view-only page; the meters' `meterOf`: a transcript's context and tokens |
| `src/daemon/codespace.ts` | cloud workspaces' gh: a codespace made, waited for, started, stopped, deleted, listed; machine types; its ssh Host entry and `<data>/ssh/config` (`sshF`) |
| `src/daemon/turns.ts` | what agents' turns leave: each turn's changes (Undo), every turn kept on disk (F1: list, diff, rewind, a workspace from one), the next prompt guessed, a chat handed to the other agent |
| `src/daemon/clients.ts` | trusted clients (T1): an app outside Laki with a named, revocable token (`laki client`): the store (only each token's hash), mint, rotate, revoke; main.ts' `clientAsk` (Allow in the window), `clientCalls` and `clientNo` (its scopes, gates.ts' `CLIENT_READ`, `CLIENT_SCOPE`) Bound (T13): `progOf`, `bindCheck`, `clientBindTo` |
| `src/daemon/clientLog.ts` | T12: each trusted client's log (`clientDid`: a read folded per method and target per 5 minutes; ids and names only), calls with an unknown client token today; `src/renderer/src/SettingsClients.tsx` is Settings › Security › Trusted clients |
| `src/daemon/secrets.ts` | `laki secret`: an agent asks you for a token on a masked card, gets a 0600 file's path |
| `src/daemon/alerts.ts` | `laki alert`: an important card on your screen from an agent or a script; with choices it waits for your pick. `laki notice`: the same card in Laki's window, on any page, kept until closed, Open going to `--to`'s session |
| `src/daemon/verify.ts` | Done check: a project's scripts and a second agent's review as an agent's turn ends, failures sent back; the Proof card (each script's end and output in the storage folder's `proof/`, git's facts, the Preview's pictures: `proofShot`; `src/renderer/src/Proof.tsx` draws it) |
| `src/daemon/memory.ts` | memory's compaction: learned memories through Laki AI's model, every few days or when full, its log |
| `src/daemon/tickets.ts` | linked tickets: a project's Ticket script per workspace, its key, title and status |
| `src/daemon/policy.ts` | a managed policy for teams: locked settings, remote access off, approvals required, which agents |
| `src/daemon/program.ts` | OSC 7501, an agent's status through its terminal: reports parsed, one terminal's records; in shadow, only compared with hooks (`docs/dev/agents.md`) |
| `src/daemon/sees.ts` | F6: what an agent sees in a project, read only: its rule files (CLAUDE.md and @imports, AGENTS.md), Laki's memory, its MCP servers from its own config (`tomlServers`), masked; `agentContextOpen` |
| `src/daemon/hookHealth.ts` | hooks not heard: `hookCause`, why an agent's hooks likely don't reach Laki (no core import: tested directly) |
| `src/daemon/notes.ts` | notes and To-dos: one JSON file each, their pasted files, the list with search |
| `src/daemon/plans.ts` | specs and brainstorms: their folders, the editor's save, files, agents' output, a prototype's page |
| `src/daemon/workflow.ts` | workflows: the sources, the engine (runs, decisions, asks, agents' turns, commands, PR waits), resume |
| `src/daemon/keychain.ts` | Laki AI's keys in the macOS Keychain (`/usr/bin/security`, a signed release, the default data folder), else their 0600 files; a file moved in once it reads back the same; wrapped (`v10:`, main's safeStorage) through an app window that can (`setWrapper`: main.ts' `kcWrap`), plain without one; `keysWhere` for the diagnostics |
| `src/daemon/envKeys.ts` | secret-looking env values (Settings', a profile's, a project's, its MCP servers') and the phone push's URL kept by keychain.ts, state.json with their names only (null): restored as it loads, stored and stripped as it saves, a v1 state's moved in; `laki backup`'s manifest names them |
| `src/daemon/ai.ts` | Laki AI: OpenRouter's tool loop, claude -p and codex exec with `laki mcp`, the conversation, the key, the call log |
| `src/daemon/acp.ts` | ACP agents (Labs): a command profile with `acp`, spoken to over the Agent Client Protocol v1 on its stdio; `AcpPty` is its Session's pty (prompts, permission menus, Stop), its words the Reader's (`acpChat`), its turns hooks (`docs/dev/agents.md`) |
| `src/daemon/session.ts` | node-pty + headless mirror, snapshot, attach/detach, responder |
| `src/daemon/ptyHost.ts` | the daemon's side of the pty host: its connection, started when missing, a `HostPty` per terminal as Session's `Pty` |
| `src/daemon/limits.ts` | usage-limit reset parsing (from wb) |
| `src/daemon/usage.ts` | plan limits: Claude's, Codex's and Grok's usage endpoints, with the agents' own sign-in, kept 7.5 and 5 minutes; Antigravity's from agy's own /usage |
| `src/daemon/push.ts` | phone pushes: each format's request (`pushRequest`), the URL's check, `pushTo` |
| `src/daemon/device.ts` | laki screen's device ops: the iOS Simulator's and apps' windows' screenshots (in points), the simulator's taps, swipes, typing and elements through idb |
| `src/daemon/fun.ts` | `meme`: r/memes, r/ProgrammerHumor, r/wholesomememes (`SUBS`, in a random order): each one's hot pictures (Reddit's `hot.json`, else meme-api.com's `gimme/<sub>/50`: Reddit's bot wall; a list: no
redirect followed, 2 MB read at most, `conn.ts` `readCapped`), kept 15 minutes, one not shown yet at random (`seen`: the last 500); no NSFW, spoilers or pinned posts; the picture as a data URL (8 MB); only on a click; `LAKI_MEME_API` is tests' fake (localhost only) |
| `src/daemon/chats.ts` | Import chats (a project's ⋯ › Import chats…): Claude Code's and Codex's sessions run in the project's folder, or one of its workspaces', outside Laki, listed from their transcripts; each one picked opens as a tab that resumes it, in the workspace whose folder it ran in, else the project's own folder's (made if missing) |
