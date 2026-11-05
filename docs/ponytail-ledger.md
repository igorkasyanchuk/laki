# Ponytail ledger

A `ponytail:` comment marks a deliberate shortcut: something left simple on purpose, usually with the limit it has and
how to lift it (AGENTS.md › Conventions). This is every one of them in `src/`, in one list, so they can be fixed one at
a time instead of waiting in the code.

How it was made, 2026-11-06, at `6fe85ec`: `grep -rn "ponytail:" src` gave **252** notes in 74 files. Each was read with
the code around it (the limit as the code has it, not only as the comment says), then given an area, a risk and a
proposal:

- **Risk**: *security* (an agent, a page or a remote caller gets past a check, or a secret leaks), *data loss* (your
  work deleted or not written), *correctness* (a wrong answer or a wrong action), *performance* (a known ceiling),
  *polish* (a rough edge). Most are polish or a ceiling no one has hit; security and data loss are kept for real
  exposure.
- **Proposal**: *fix now* (small, worth it), *issue* (worth it, but bigger or needing a decision: its body is under
  Issues to file), *fine as it is*.

| | security | data loss | correctness | performance | polish | all |
|---|---|---|---|---|---|---|
| fix now | 2 | 2 | 10 | 5 | 3 | 22 |
| issue | 7 | 1 | 3 | 2 | 0 | 13 |
| fine as it is | 3 | 0 | 17 | 13 | 184 | 217 |
| all | 12 | 3 | 30 | 20 | 187 | 252 |

Two notes are stale: the shortcut they describe is gone (`core.ts:627`: `.laki.json` is already cached by mtime;
`widgetTrust.ts:73`: subfolders are already hashed). Their fix is the comment. Line numbers are as of `6fe85ec`; they
move as fixes land, so find a note by its words.

## Top 10 to fix first

A recommendation: the user picks which ones get fixed. Real risks with small fixes first; the largest real one, the
agent-vs-user boundary (per-tab tokens), is under Issues because it's L and needs a decision first.

- [x] **1. `src/daemon/share.ts:240`: shared tabs and phone pushes mask secrets by a few shapes.** Security, S.
  A shared tab is a page on the internet; its chat is the agent's words and its tool calls, where keys turn up
  (`export STRIPE_KEY=sk_live_…`, `psql postgres://me:pw@…`, a pasted `.env`), and phone pushes run through the same
  `redact`. Fix: add Stripe (`[sr]k_(live|test)_…`), Google (`AIza…`), npm (`npm_…`), Hugging Face (`hf_…`), PEM
  private key blocks, `scheme://user:pass@` in a URL, and a `NAME=value` rule for names with SECRET, TOKEN, PASSWORD,
  PASSWD or API_KEY. Test: `test/share.test.ts`, one sample of each masked; the plain-words case stays as it is.
- [ ] **2. `src/daemon/policy.ts:9`: a managed policy is checked only as a tab is made.** Security, S. An
  organization deploys "approvals required"; a tab made before it in bypass permissions (or of an agent now turned off)
  starts again as it was at every restore, wake and Enter, for good. Fix: call `policyAgent` with the tab's preset,
  perm, profile args and cmd at the top of `spawnTab` (`core.ts:1443`), which `restoreNow`, wake and Enter all go
  through; a refusal leaves the tab ended, its screen saying why. Test: `test/api.test.ts` (`LAKI_POLICY`): a bypass
  tab, then a policy with `bypass: false` and a daemon restart (as `test/restart.test.ts` does it): the tab doesn't
  start and says why; a tab in the default mode does.
- [ ] **3. `src/daemon/files.ts:203`: Revert's Undo lives in memory only.** Data loss, M. Revert discards work and
  Undo is its only way back, but Update when idle restarts the daemon by itself, and after any restart the reverted
  hunk or file is gone from the app (a loose git object at best). Fix: keep each workspace's 20 undos in
  `<data>/undos/<ws>.json` (0600; an entry's patch capped at a few MB, a bigger one in memory as now), read at the first
  undo, removed with the workspace. Test: `test/hunk.test.ts`: revert a hunk, restart the daemon, Undo brings it back.
- [ ] **4. `src/daemon/core.ts:2613`: archiving a cloud workspace skips the uncommitted check.** Data loss, S. The
  check is skipped because a stopped codespace keeps its files, but GitHub deletes a stopped codespace after its
  retention period (30 days by default, less if you set it), with its uncommitted changes and unpushed commits. Fix:
  with `ifClean`, run `git status --porcelain` and count the commits not on the remote (`@{u}..`, else
  `origin/<branch>..`) over its ssh before `cs.stop`, and return `{ dirty }` as a worktree's archive does, so the app
  asks; the archive's toast names the retention. Test: `test/ssh.test.ts` (its ssh is this machine, gh the fake): a
  codespace workspace with a changed file, and one with an unpushed commit, both come back dirty; a clean one stops.
- [ ] **5. `src/daemon/share.ts:201`: a subagent's lines make an answer's usage count twice.** Correctness, S. The
  cost meter and today's spend are money on screen; an answer is a line per block, and a sidechain line between two
  of them means the earlier one isn't taken back. Fix: remember the last usage per message id (a small map, the last
  50 ids), and take that one back, not only the previous line's. Test: `test/meter.test.ts`: a fake transcript with
  message A's first block, a sidechain line, A's second block: A's tokens and cost counted once.
- [ ] **6. `src/daemon/policy.ts:61`: the policy reads a command's first word only.** Correctness (a policy check
  stepped around), S. A command profile or tab of `env FOO=1 claude --dangerously-skip-permissions` or
  `npx @anthropic-ai/claude-code …` passes "approvals required" and the agent list. Fix: before taking the first word,
  skip `env` (and its options), `NAME=value` words and launchers (npx, bunx, `pnpm dlx`, exec, command, nice, time),
  and read the agents' npm package names as the agents. Test: `test/units-more.test.ts`: `policyAgent('custom', …)`
  refuses each of those under `bypass: false` and under `agents: ["codex"]`.
- [ ] **7. `src/shared/conn.ts:57` (and `src/daemon/main.ts:798`): daemon.log rotates only as a daemon starts.**
  Performance, S. The daemon outlives the app and its updates, so one up for months grows its log without bound
  (main.ts' refused-WebSocket counting shows the volume was already a worry). Fix: in main.ts' hourly tick (beside
  `storageTidy`), past 10 MB copy it to `daemon.log.1` and truncate it to 0: the starter opened it with `'a'`
  (O_APPEND), so the next writes land at the new end. Test: a unit test of that function on a temp file past the limit:
  `.1` has the old bytes, the file is empty, the next append lands at offset 0.
- [ ] **8. `src/daemon/remote.ts:169`: tailscale takes port 443's root.** Correctness, S. Remote access or a tunnel
  through tailscale replaces a serve you had on 443, and stopping it runs `serve --https=443 off`, so yours is gone for
  good, not only while it runs. Fix: read `tailscale serve status --json` first; when 443 has a handler that isn't
  Laki's, refuse with a line that says so (or use 8443, which serve and funnel both take). Test: a fake `tailscale` in
  the rig's `$HOME/bin` (as `test/cloudflared` is) whose status shows 443 in use: the start refuses, `off` never runs.
- [ ] **9. `src/shared/tools.ts:627` (and `tools.ts:701`, `src/renderer/src/App.tsx:2172`): a shell's command is
  typed after a fixed 1.5 s.** Correctness, S. Laki AI's `laki_shell`, `laki_run_action`'s shell actions and a shell
  action from the app all wait 1.5 s for a new shell's prompt; a login shell with oh-my-zsh or nvm takes longer, and the
  line goes in early: garbled, lost, or run before its env is set. Fix: one option on `send` that waits for the
  prompt (core's `whenPrompt`, as `restoreNow` uses it, or `bringBack`'s quiet-output wait), 10 s at most; the three
  callers use it instead of their timers. Test: a shell tab whose rc sleeps 3 s before its prompt: the command shows
  once, after the prompt.
- [ ] **10. `src/daemon/files.ts:316`: a file Revert's Undo doesn't put mode bits back.** Correctness, S. Undo writes
  the content back, but a file it creates again (a new script reverted, then undone) or one whose mode the revert
  changed comes back without its `+x`, and the next run fails with permission denied. Fix: keep the file's mode in the
  Undo entry and chmod it after writing. Test: `test/hunk.test.ts`'s fileUndo case with a `chmod +x` file: after Undo,
  it's 0755 again.

## The ledger

By area, each sorted by risk (security, data loss, correctness, performance, polish), then by file. Columns: where,
risk, the limit as the code has it, the way up, the proposal.

### Daemon core, auth and policy (30)

| where | risk | limit | upgrade path | proposal |
|---|---|---|---|---|
| `src/daemon/core.ts:3472` | security | who's calling is told by process ancestry: a process that left its tab's tree (setsid and a double fork) reads as you and may call the user-only methods | per-tab tokens (issue: agent-vs-user boundary) | issue (#1) |
| `src/daemon/core.ts:3497` | security | the tty fallback: setsid (no terminal) still escapes it | per-tab tokens (same issue) | issue (#1) |
| `src/daemon/main.ts:115` | security | any process of the user (any agent) can read daemon.json's token | a Keychain item or per-tab tokens (same issue) | issue (#1) |
| `src/daemon/main.ts:151` | security | artifact pages keep https: scripts and 'unsafe-inline': a report can load a CDN script and carry its words out in a picture's URL | none while it keeps its sandbox and its own origin (written down) | fine as it is |
| `src/daemon/main.ts:159` | security | /img's private-address check is by name: a DNS name pointing into the LAN still goes (TLS verification stops a read; it can probe) | resolve, then check the address, before the fetch | fine as it is |
| `src/daemon/main.ts:547` | security | a process that leaves its tab's tree and terminal (setsid, launchctl submit, open x.command, a tmux server) counts as you | per-tab tokens and a user of its own (same issue) | issue (#1) |
| `src/daemon/main.ts:590` | security | an agent with a shell can kill the daemon by daemon.json's pid | per-tab tokens, a user of its own (same issue) | issue (#1) |
| `src/daemon/main.ts:716` | security | a hook's key is in the agent's env, which your other processes can read | per-tab users (same issue) | issue (#1) |
| `src/daemon/policy.ts:9` | security | a managed policy is checked only as tabs are made: a tab made before it (bypass permissions, an agent now banned) starts again as it was at every restore, wake and Enter | call policyAgent in spawnTab (restore, wake and Enter all go through it); the tab shows why it won't start | **fix now** (top 10, #2) |
| `src/daemon/main.ts:54` | data loss | the single-instance lock: two starters that both read the same stale lock can both remove it and both run: two daemons saving one state.json | after linking, read the lock again a beat later and exit if it isn't ours; exit later too if it stops naming us | issue (#3) |
| `src/daemon/policy.ts:61` | correctness | a command tab's first word only: `env X=1 claude --dangerously-skip-permissions` or `npx claude …` slips past the policy | skip env, NAME=value words and common launchers (npx, bunx, exec, command, nice) before the first word | **fix now** (top 10, #6) |
| `src/daemon/session.ts:24` | correctness | OSC 8 links kept through xterm's private `_serializeBufferByRange` and cell internals | none: test/snapshot.test.ts fails when they move; recheck on xterm upgrades | fine as it is |
| `src/daemon/main.ts:798` | performance | daemon.log still rotates only as a daemon starts | as conn.ts:57 | **fix now** (top 10, #7) |
| `src/daemon/notes.ts:58` | performance | every note file read for each list | an index file if there are ever thousands | fine as it is |
| `src/shared/conn.ts:57` | performance | daemon.log rotates only as a daemon starts: one up for months grows without bound | hourly: past 10 MB, copy to .1 and truncate (its fd is O_APPEND) | **fix now** (top 10, #7) |
| `src/daemon/alerts.ts:4` | polish | alert waits in memory: a restart fails the caller; a killed caller's card stays up to ALERT_WAIT | an RPC cancel when the client goes | fine as it is |
| `src/daemon/alerts.ts:22` | polish | alert rate limit in memory, a minute's window | none needed | fine as it is |
| `src/daemon/alerts.ts:25` | polish | notices in memory, the newest 20 | none needed | fine as it is |
| `src/daemon/core.ts:52` | polish | dev-mode logs in memory: a restart or dev mode off clears them | none needed | fine as it is |
| `src/daemon/core.ts:153` | polish | 0.25-era terminal workspaces migrated by name; a renamed one stays a workspace | none: a one-time migration | fine as it is |
| `src/daemon/core.ts:374` | polish | a closed tab's done card goes only at the next show | none needed | fine as it is |
| `src/daemon/core.ts:627` | polish | stale: says .laki.json is read per workspace on every view and to cache by mtime; cfgRead already caches by mtime and size (a stat each) | update the comment | fix now |
| `src/daemon/core.ts:686` | polish | keep awake is macOS's caffeinate only | systemd-inhibit on Linux | fine as it is |
| `src/daemon/core.ts:703` | polish | when-done sleep, lock, shut down: macOS only; lock relies on "require password immediately" | none on macOS | fine as it is |
| `src/daemon/core.ts:845` | polish | a repo's checkout.workers read once per daemon | none needed | fine as it is |
| `src/daemon/main.ts:150` | polish | the artifacts viewer serves 50 MB a file at most | none needed | fine as it is |
| `src/daemon/main.ts:622` | polish | cross-workspace Always kept in memory until a restart | none: forgetting is the safe side | fine as it is |
| `src/daemon/main.ts:811` | polish | /rpc takes 16 MB, the socket 34 MB | none: the app's big ones use the socket | fine as it is |
| `src/daemon/plans.ts:7` | polish | a removed project's plans stay in `<data>/plans` | none: they're the user's documents | fine as it is |
| `src/daemon/secrets.ts:5` | polish | secret asks in memory (a restart drops one); this Mac only | none needed | fine as it is |

### Agents, hooks and turns (41)

| where | risk | limit | upgrade path | proposal |
|---|---|---|---|---|
| `src/daemon/core.ts:469` | correctness | codex's own developer_instructions found by a line regex in the daemon's $CODEX_HOME, not a preset's: one pointing elsewhere may get Laki's note over its own | read the tab's effective CODEX_HOME (preset env, account folder) | fine as it is |
| `src/daemon/core.ts:1338` | correctness | Laki's OPENCODE_CONFIG_DIR and GEMINI_CLI_SYSTEM_DEFAULTS_PATH replace one you set in your env | keep yours where the agent layers them, or say so | fine as it is |
| `src/daemon/core.ts:1525` | correctness | a dead chat on resume is told by the CLI's error text; a reworded message makes Enter retry the dead id | also count an exit within RESUME_FAIL with no screen as gone | fine as it is |
| `src/daemon/core.ts:2837` | correctness | codex's notify from another thread told apart by the screen ("esc to interrupt") | the payload's thread id when codex gives one | fine as it is |
| `src/daemon/core.ts:3207` | correctness | other agents' turns start at Enter while idle and end by notify or a quiet screen | real start hooks as agents add them | fine as it is |
| `src/daemon/core.ts:3217` | correctness | interrupts read off the screen's text | as core.ts:1525 | fine as it is |
| `src/daemon/core.ts:3264` | correctness | Auto fallback knows an account's limit only as Laki's tabs met it, not the plan's own numbers | consult usage.ts' windows when picking the next account | fine as it is |
| `src/daemon/skill.ts:22` | correctness | opencode's skill goes to ~/.config/opencode, ignoring $XDG_CONFIG_HOME | use XDG_CONFIG_HOME when set (the login env's) | fix now |
| `src/daemon/turns.ts:88` | correctness | a turn's Undo: the last turn per tab, in memory, this Mac only; its tree is a loose object git may prune after two weeks | keep the trees under a ref of Laki's | fine as it is |
| `src/daemon/core.ts:226` | performance | on an SSH host a Write's permission ask carries the whole file through the terminal | cut the payload for Write/Edit asks on hosts | fine as it is |
| `src/daemon/core.ts:3409` | performance | a ps of every process per call from a shell tab; a tmux server's agent isn't under the tab | cache ps for a second; tmux's pane pids | fine as it is |
| `src/daemon/accounts.ts:26` | polish | claude's history.jsonl can't be a link, so ↑ prompt history is per account | none: claude's own reader refuses links | fine as it is |
| `src/daemon/accounts.ts:47` | polish | two starts linking at once: the loser's symlink error is swallowed | none needed | fine as it is |
| `src/daemon/accounts.ts:168` | polish | codex's model/list: first page only, a gateway with many models shows part of them | follow the app-server's next cursor | fine as it is |
| `src/daemon/chats.ts:4` | polish | Import chats: this Mac only; a path Claude Code shortens past 200 chars isn't found; side-chat forks show again after a restart | match claude's own path hashing; keep side sessions on disk | fine as it is |
| `src/daemon/chats.ts:36` | polish | codex transcript metas cached for every file ever looked at | drop entries whose file is gone | fine as it is |
| `src/daemon/core.ts:80` | polish | agents on PATH looked for once: one installed later shows only after a daemon restart | re-scan with a one-minute TTL, or when Settings opens | fix now |
| `src/daemon/core.ts:388` | polish | memory note items cut at 2,000 chars, 40 KB in all (Linux's argument limit) | a file the agent reads, if notes outgrow it | fine as it is |
| `src/daemon/core.ts:1356` | polish | prompt values passed as LAKI_ARG_n: in the agent's and its children's env | none: the agent has the prompt anyway | fine as it is |
| `src/daemon/core.ts:1376` | polish | sandbox on an SSH host doesn't add the repo's git folder, so git commit there is refused | resolve the git common dir over ssh | fine as it is |
| `src/daemon/core.ts:1406` | polish | opencode's model in OPENCODE_CONFIG_CONTENT replaces one from settings' or the project's env | merge those too | fine as it is |
| `src/daemon/core.ts:2190` | polish | Laki AI's laki_shell and laki_run_action tabs and quickNew's workspaces aren't marked agent-made | pass agent there if they should be | fine as it is |
| `src/daemon/core.ts:2719` | polish | the restart's "background commands stopped" note: claude only; a subagent in the current turn isn't named | codex once it reports background tasks | fine as it is |
| `src/daemon/core.ts:2760` | polish | shells' programs kept only on a clean shutdown (not a crash), not on a host | save them now and then | fine as it is |
| `src/daemon/core.ts:2794` | polish | other agents are typed back as they started, a first prompt included | drop the prompt argument on a rerun | fine as it is |
| `src/daemon/core.ts:2890` | polish | Stop with background subagents pauses as running; background shells and monitors don't | none: a shell may run for good | fine as it is |
| `src/daemon/core.ts:2930` | polish | a subagent's plan told apart by agent_id (newer claudes only) | none needed | fine as it is |
| `src/daemon/core.ts:3259` | polish | limitSent keeps a closed tab's entry (a number) | delete it as the tab closes | fine as it is |
| `src/daemon/core.ts:3321` | polish | a hookless turn under 8 s ends without a notification | none needed | fine as it is |
| `src/daemon/core.ts:3387` | polish | agents known by program name: one under an alias or wrapper spins as a command | a setting of extra names | fine as it is |
| `src/daemon/core.ts:3397` | polish | an agent typed into a shell tab gets no notifications or turn timers | start it in its own tab | fine as it is |
| `src/daemon/core.ts:3428` | polish | "an agent typed here" is in memory (what it typed is dead after a restart anyway) | none needed | fine as it is |
| `src/daemon/core.ts:3438` | polish | codex prompts typed in its terminal miss the prompt history | read codex's own history file | fine as it is |
| `src/daemon/resources.ts:20` | polish | a restored tab's ports are quiet for its first minute | none needed | fine as it is |
| `src/daemon/resources.ts:226` | polish | memory by tab misses double-forked processes and main's short helpers | group by session id | fine as it is |
| `src/daemon/resources.ts:263` | polish | sleeping tabs are in memory; a restart resumes those not unused for sleepAfter | none needed | fine as it is |
| `src/daemon/skill.ts:531` | polish | the / menu lists no other plugins' commands and no built-ins | read plugins' folders | fine as it is |
| `src/daemon/turns.ts:50` | polish | a handover is the chat as said, not a summary; a host's goes in the prompt | a model's summary | fine as it is |
| `src/daemon/turns.ts:217` | polish | side chats in memory | none needed | fine as it is |
| `src/daemon/verify.ts:30` | polish | Done check is off on SSH hosts and codespaces | run its scripts over ssh | fine as it is |
| `src/shared/types.ts:45` | polish | never-asks read from flags only | none: no env var known | fine as it is |

### Files, diffs and artifacts (17)

| where | risk | limit | upgrade path | proposal |
|---|---|---|---|---|
| `src/daemon/files.ts:203` | data loss | revert's Undo (hunks, files back to the base) lives in memory only: a daemon restart (an update, Update when idle) loses the only way back to the reverted work | keep each workspace's 20 undos in `<data>/undos/<ws>.json` (patch size capped), read as first needed | **fix now** (top 10, #3) |
| `src/daemon/files.ts:316` | correctness | fileUndo's Undo puts content back, not mode bits: an executable comes back 0644 | keep the mode in the Undo record, chmod on undo | **fix now** (top 10, #10) |
| `src/daemon/files.ts:425` | correctness | Collision radar: worktrees off different merge bases compared by their own line numbers; no fetch; not on hosts | map lines through the base's diff | fine as it is |
| `src/daemon/artifacts.ts:13` | performance | every 5 s (with the port scan) a full walk of each live workspace's storage folder, no cap: a node_modules or dataset there is thousands of readdirs a tick | cap the walk (say "5,000+"), skip node_modules and .git | fix now |
| `src/daemon/core.ts:1107` | performance | storage tidy is a sync walk, hourly: a huge storage folder stalls the event loop (terminal streaming) meanwhile | walk with fs/promises, as artifacts.ts does | fix now |
| `src/daemon/files.ts:578` | performance | audio and video as whole data URLs, 25 MB each | a streaming route with Range | fine as it is |
| `src/renderer/src/panels.tsx:1852` | performance | artifact previews: the newest 60 of 2 MB or less | none needed | fine as it is |
| `src/shared/ask.ts:67` | performance | ask diffs are O(n·m); past 90,000 line pairs all out, all in | Myers' diff | fine as it is |
| `src/daemon/artifacts.ts:73` | polish | published-link hosts are a fixed regex | add hosts as agents use them | fine as it is |
| `src/daemon/artifacts.ts:120` | polish | a .url file with no URL= line (or too big) stays a file | none needed | fine as it is |
| `src/daemon/core.ts:1151` | polish | storage folders on this Mac only; a host's workspaces get none | none needed | fine as it is |
| `src/daemon/core.ts:2316` | polish | Import worktrees: this Mac's git projects, branches only (a detached one is left out) | none needed | fine as it is |
| `src/daemon/core.ts:2514` | polish | a locked worktree's git registration stays after delete (its folder is removed) | unlock, or git worktree remove -f -f | fine as it is |
| `src/daemon/files.ts:374` | polish | diff size reads new files' lines for the first 100, 1 MB each at most | none needed | fine as it is |
| `src/daemon/files.ts:379` | polish | a host's new files count, not their lines | wc over ssh | fine as it is |
| `src/daemon/files.ts:490` | polish | inside(): on an SSH host the path is checked by name, links not resolved | realpath over ssh (the agent there owns the host anyway) | fine as it is |
| `src/renderer/src/Diff.tsx:674` | polish | ⌘F in a diff matches within one line's text only | none needed | fine as it is |

### Remote, hosts, codespaces and phone (12)

| where | risk | limit | upgrade path | proposal |
|---|---|---|---|---|
| `src/daemon/core.ts:2613` | data loss | archiving a cloud workspace stops its codespace and skips the dirty check; GitHub deletes a stopped codespace after its retention (30 days by default, less if the user set it) with its uncommitted and unpushed work | before stopping, git status and unpushed commits over ssh, refused as ifClean refuses a worktree's (or push the branch); the toast names the retention | **fix now** (top 10, #4) |
| `src/daemon/hosts.ts:329` | correctness | a daemon restart (each update) restores every live cloud workspace's tabs, which starts its codespace, even one GitHub stopped for idleness: compute hours nobody asked for | restore codespace tabs dormant (a look, a key or a message wakes them) unless mid-turn | issue (#4) |
| `src/daemon/remote.ts:169` | correctness | tailscale serve or funnel takes 443's root: a serve of yours there is replaced, and stopping turns 443 off (yours isn't put back) | read `tailscale serve status --json` first; refuse (or use 8443) when 443 is taken | **fix now** (top 10, #8) |
| `src/daemon/core.ts:1082` | polish | a host's worktrees always go under ~/.laki-host | a per-host folder setting | fine as it is |
| `src/daemon/core.ts:2271` | polish | .env includes aren't copied on a host (setup can) | copy them through ssh | fine as it is |
| `src/daemon/hosts.ts:197` | polish | ssh connections paced 300 ms per host, not by handshakes in flight | count them | fine as it is |
| `src/daemon/hosts.ts:225` | polish | only $PORT is forwarded from a host | forward each port the host reports | fine as it is |
| `src/daemon/hosts.ts:257` | polish | codespaces: one machine type, no prebuilds, no .env copied, $PORT only | as people ask | fine as it is |
| `src/daemon/phone.ts:16` | polish | a turn that starts and ends within the 30 ms before a view isn't pushed | key pushes by turn, not by state | fine as it is |
| `src/daemon/phone.ts:127` | polish | ntfy shows the first 3 answer buttons | none: ntfy's limit | fine as it is |
| `src/daemon/push.ts:13` | polish | anyone who reads the ntfy topic sees the signed taps | none: answerOk already refuses taps on a public ntfy.sh topic without a token | fine as it is |
| `src/daemon/remote.ts:309` | polish | permanent tunnels share one cloudflared: a change restarts it, the others off for a second or two | cloudflared's remotely managed config | fine as it is |

### Meters, transcripts and the Reader (14)

| where | risk | limit | upgrade path | proposal |
|---|---|---|---|---|
| `src/daemon/share.ts:240` | security | shared tabs (a view-only page on the internet) and phone pushes mask secrets by shape: Stripe sk_live_/rk_live_, Google AIza…, npm_, hf_, PEM private keys, user:pass@ in a URL and NAME=value lines go through | add those shapes and a NAME=value rule for names with SECRET, TOKEN, PASSWORD or KEY | **fix now** (top 10, #1) |
| `src/daemon/meters.ts:200` | correctness | the 1M-context check ignores ANTHROPIC_MODEL in an env: the meter reads a 200k window | read the tab's env too | fine as it is |
| `src/daemon/share.ts:201` | correctness | an answer's usage: a subagent's lines between two blocks of one message make it count twice (tokens and cost overstated) | remember the last usage per message id (a small map), not only the previous line's | **fix now** (top 10, #5) |
| `src/shared/types.ts:61` | correctness | the price table is dated 2026-10, edited by hand; long-prompt rates, 1-hour cache writes, fast mode and batch left out | update with each model; fast mode's rate | fine as it is |
| `src/daemon/meters.ts:52` | performance | Reader: the newest 400 messages sent whole at each change (a 1.5 s poll while the chat grows), over remote access too | send what's new since the client's v | issue (#5) |
| `src/daemon/mcpApps.ts:7` | polish | MCP Apps: no OAuth servers, SSE-only ones, plugins' servers or ${VAR}s in a config | as people hit them | fine as it is |
| `src/daemon/meters.ts:19` | polish | a transcript past 32 MB is read from there, its start left out | none needed | fine as it is |
| `src/daemon/meters.ts:115` | polish | the Background chip is read with the meters, so none while both are off | read it on its own | fine as it is |
| `src/daemon/meters.ts:273` | polish | your status line: managed settings and padding aren't read | none needed | fine as it is |
| `src/daemon/share.ts:84` | polish | codex: its event messages only; an old codex shows tool calls only | none needed | fine as it is |
| `src/daemon/share.ts:98` | polish | background tasks: claude only; one whose end isn't written stays until the chat is read anew | none needed | fine as it is |
| `src/daemon/usage.ts:180` | polish | the usage endpoint's other windows and plan as last read | none needed | fine as it is |
| `src/renderer/src/App.tsx:2024` | polish | plan-limit warnings only while the app is open with the ring on screen | check in the daemon | fine as it is |
| `src/renderer/src/Reader.tsx:331` | polish | a long message folds by lines or length, not by its wrapped size | none needed | fine as it is |

### PRs, GitHub and tickets (16)

| where | risk | limit | upgrade path | proposal |
|---|---|---|---|---|
| `src/daemon/pr.ts:660` | correctness | review feedback to the agent is inline threads only: a Changes requested review's summary or a plain PR comment never reaches it | add review bodies (CHANGES_REQUESTED, trusted reviewers) to the query and the message | issue (#7) |
| `src/renderer/src/FullReview.tsx:170` | correctness | blame reads the worktree, which needn't be the PR's head | blame at the PR's head commit | fine as it is |
| `src/renderer/src/Diff.tsx:515` | performance | Mark viewed: one GitHub call per file | none: GitHub's API | fine as it is |
| `src/daemon/core.ts:748` | polish | when agents worked (to tell their PR comments from yours) is in memory | none needed | fine as it is |
| `src/daemon/pr.ts:64` | polish | a host's branch read at each PR scan, a minute behind | none needed | fine as it is |
| `src/daemon/pr.ts:199` | polish | GraphQL quota asked of this Mac's gh only | none needed | fine as it is |
| `src/daemon/pr.ts:360` | polish | a failed gh scan keeps the last PR, not marked stale | mark it stale after a few failures | fine as it is |
| `src/daemon/pr.ts:418` | polish | archive on merge held by a gate isn't tried again | none: yours to archive | fine as it is |
| `src/daemon/pr.ts:453` | polish | fix conflicts once per head commit | none needed | fine as it is |
| `src/daemon/pr.ts:694` | polish | prReview's comments fields need gh 2.50+ | name the version when gh refuses | fine as it is |
| `src/daemon/pr.ts:815` | polish | GitHub link cards: the whole cache goes past 200 | none needed | fine as it is |
| `src/daemon/pr.ts:851` | polish | a label with a comma can't be set here (gh splits at commas) | gh api for labels | fine as it is |
| `src/daemon/pr.ts:897` | polish | prFile: origin only; the head may be a scan (a minute) behind | none needed | fine as it is |
| `src/daemon/pr.ts:953` | polish | 3,000 files at most | none: GitHub's own cap | fine as it is |
| `src/daemon/tickets.ts:5` | polish | tickets: not on hosts or codespaces; in memory | none needed | fine as it is |
| `src/renderer/src/panels.tsx:212` | polish | a CI log line of its own starting with "▸ " is drawn as a step's name | none needed | fine as it is |

### Extensions (widgets) (24)

| where | risk | limit | upgrade path | proposal |
|---|---|---|---|---|
| `src/daemon/widgets.ts:162` | security | extension secrets in a 0600 file, not the Keychain: any process of yours (an agent) can read it | none better without a command line; part of the agent-vs-user issue | fine as it is |
| `src/daemon/widgetTools.ts:128` | security | an extension's permission ask is taken from anyone while one of its agent runs is going: a local process can ask in its name (you still answer; an Always sticks) | a per-run token in the run's laki mcp env, checked | issue (#2) |
| `src/daemon/widgets.ts:255` | correctness | git facts: with the stat scan on, an edit that keeps the counts isn't seen until the counts or HEAD move | key on the diff's hash | fine as it is |
| `src/daemon/widgetTrust.ts:103` | correctness | your own extensions' hash (and runsOf's rewrite check) covers the first 500 files: a change past them keeps its Always grants and its on | past the cap, count it as changed (as repoFiles' bad does past REPO_MAX) | fix now |
| `src/renderer/src/App.tsx:3440` | correctness | a file opener keeps one data per extension and workspace: two files' tabs show the last one run | key its data by the file | fine as it is |
| `src/daemon/widgetTrust.ts:184` | performance | two sync git ls-files per run of a repo extension | cache by the index's and the folder's mtimes | fine as it is |
| `src/cli/mcp.ts:13` | polish | no MCP `listChanged`: a new extension whose tool name collides renames a tool only at the client's next tools/list | send `notifications/tools/list_changed` when the extension tool list changes | fine as it is |
| `src/daemon/widgetEvents.ts:55` | polish | event fields past 64 KB all go (cut: true) | none needed | fine as it is |
| `src/daemon/widgets.ts:148` | polish | a branch's change to .laki/extensions isn't read until it reaches the project's folder | none: the safer side | fine as it is |
| `src/daemon/widgets.ts:185` | polish | per-workspace instances: none on an SSH host | none needed | fine as it is |
| `src/daemon/widgets.ts:989` | polish | a rename rewrites widget.json with 2-space indent | keep its own indent | fine as it is |
| `src/daemon/widgets.ts:1180` | polish | past AT_ONCE workspaces fetching, the rest wait for a later tick | a queue | fine as it is |
| `src/daemon/widgets.ts:1242` | polish | an AI source's answer without a JSON block becomes { text } | none needed | fine as it is |
| `src/daemon/widgets.ts:1498` | polish | a running fetch waited for by a 300 ms poll | a promise per run | fine as it is |
| `src/daemon/widgetTrust.ts:73` | polish | stale: says only the top level and fixtures are hashed, not a lib/; dirHash walks subfolders now (filesUnder, repoNames) | update the comment | fix now |
| `src/renderer/src/Widgets.tsx:39` | polish | sanitized widget HTML keeps `<style>` | none: it renders in a shadow root, so it styles that widget only | fine as it is |
| `src/shared/widget.ts:18` | polish | the template cache is cleared whole past 2,000 | an LRU | fine as it is |
| `src/shared/widget.ts:717` | polish | a JS page's box keeps its words after a do | the app says back | fine as it is |
| `src/shared/widget.ts:851` | polish | the size observer watches a preview's first 200 elements | none needed | fine as it is |
| `src/shared/widgetSchema.ts:355` | polish | a stream is global only | a process per workspace | fine as it is |
| `src/shared/widgetStarters.ts:331` | polish | a starter's late push starts the daemon again if Laki quit | none needed | fine as it is |
| `src/shared/widgetUi.ts:874` | polish | a countdown's words as of the render | none needed | fine as it is |
| `src/shared/widgetUi.ts:1269` | polish | filter chips see the drawn rows only | none needed | fine as it is |
| `src/shared/widgetUi.ts:1277` | polish | rotate jumps from word to word, no slide | none needed | fine as it is |

### Workflows and schedules (18)

| where | risk | limit | upgrade path | proposal |
|---|---|---|---|---|
| `src/daemon/workflow.ts:1359` | correctness | a run's cost and its budget count its AI calls and decisions only, not its agents' turns (most of the spend) | add each run tab's meter cost since the run started | issue (#8) |
| `src/daemon/schedule.ts:347` | performance | Start fresh opens an agent tab each run and closes none: an hourly or daily task piles up tabs (claude processes until they sleep) | close the last run's tab when it's idle and you never typed in it | issue (#6) |
| `src/daemon/workflow.ts:1592` | performance | workflow files read again every 10 s, not at each event | none needed | fine as it is |
| `src/shared/workflow.ts:773` | performance | lastJson is O(n²) at worst on a 20k answer | none needed | fine as it is |
| `src/daemon/schedule.ts:86` | polish | past 500 reminders the oldest fired ones go, then the oldest (an unfired one too) | refuse a new one past the cap instead | fine as it is |
| `src/daemon/schedule.ts:151` | polish | missed runs (the Mac asleep) never catch up | a "run on wake" switch | fine as it is |
| `src/daemon/schedule.ts:237` | polish | a missing base branch fails the run, not the save | none needed | fine as it is |
| `src/daemon/workflow.ts:6` | polish | runs only while the daemon is up; run commands run on this Mac | none needed | fine as it is |
| `src/daemon/workflow.ts:59` | polish | an SSH host's repo has no project workflows | read them over ssh | fine as it is |
| `src/daemon/workflow.ts:83` | polish | skipped counts in memory; the index's count moves on open | none needed | fine as it is |
| `src/daemon/workflow.ts:658` | polish | js: branches run in node:vm, which is no sandbox | none: only in a workflow you saved or allowed, which can run commands anyway | fine as it is |
| `src/daemon/workflow.ts:1178` | polish | a wait block's failed-CI logs: up to 3 of 30 s, so the fail way can be 90 s late | fetch them in parallel | fine as it is |
| `src/daemon/workflow.ts:1296` | polish | working time: a status change between looks counts as the later one; a sleep mid-run counts | none needed | fine as it is |
| `src/daemon/workflow.ts:1484` | polish | a resume that fails after RESUMED takes the block's error way | none needed | fine as it is |
| `src/daemon/workflow.ts:1561` | polish | no switch lets agents' events start a workflow that runs commands | a head key if anyone wants it | fine as it is |
| `src/daemon/workflow.ts:1571` | polish | heard events in memory | none needed | fine as it is |
| `src/shared/workflow.ts:154` | polish | a Start's inputs split at every comma: no default holds one | a quote-aware split | fine as it is |
| `src/shared/workflow.ts:601` | polish | no js: tests in "only when" | none: deliberate (it runs before trust) | fine as it is |

### Laki AI, its tools and voice (18)

| where | risk | limit | upgrade path | proposal |
|---|---|---|---|---|
| `src/daemon/ai.ts:466` | correctness | OpenRouter backend gets only the last 20 messages, without tool results: a long chat forgets | a summary of older turns as one message | fine as it is |
| `src/renderer/src/App.tsx:2172` | correctness | a shell action's command sent after a fixed 1.5 s: a slow login shell gets it early | as shared/tools.ts:627 | **fix now** (top 10, #9) |
| `src/renderer/src/voice.ts:148` | correctness | a lost Fn keyup (let go over a native menu) records on up to 5 minutes, then inserts what it heard | release on the next key or pointer event that shows Fn up | fix now |
| `src/shared/tools.ts:627` | correctness | laki_shell types its command after a fixed 1.5 s: a slow login shell (oh-my-zsh) gets it early, garbled or lost | a send option that waits for the prompt (core's whenPrompt, bringBack's quiet wait) | **fix now** (top 10, #9) |
| `src/shared/tools.ts:701` | correctness | laki_run_action's shell actions: the same fixed 1.5 s | as shared/tools.ts:627 | **fix now** (top 10, #9) |
| `src/daemon/ai.ts:1011` | performance | ai-calls.jsonl is appended forever and read whole at every aiState (each AI page load and poll) | trim to the last 12 months as the daemon starts, or keep running totals | fix now |
| `src/daemon/ai.ts:27` | polish | earlier AI chats past 100 are deleted as new ones are kept | say so in Settings › AI, or cap by age | fine as it is |
| `src/daemon/ai.ts:151` | polish | speech-to-text retries wait fixed times, not Retry-After | read Retry-After when OpenRouter sends one | fine as it is |
| `src/daemon/ai.ts:182` | polish | messages queued while Laki AI answers are lost on a daemon restart | keep the queue in the thread's file | fine as it is |
| `src/daemon/ai.ts:258` | polish | past chats' rows cached in memory (a gone file drops out) | none needed | fine as it is |
| `src/daemon/ai.ts:503` | polish | Stop acts between tools: one under way (a wsNew) finishes first | pass the abort signal into runTool | fine as it is |
| `src/daemon/ai.ts:569` | polish | an extension's ask on OpenRouter gets no onCall | wire it if extensions may use OpenRouter | fine as it is |
| `src/renderer/src/Ai.tsx:508` | polish | the last 40 pasted images kept as data URLs | none needed | fine as it is |
| `src/renderer/src/App.tsx:802` | polish | Send later's retries live in the window: a reload drops the ask | a daemon timer | fine as it is |
| `src/renderer/src/voice.ts:5` | polish | the bubbles' Say it keeps macOS dictation in cloud mode too | none needed | fine as it is |
| `src/renderer/src/voice.ts:16` | polish | Send as you stop: cloud only | none needed | fine as it is |
| `src/shared/tools.ts:648` | polish | laki_send's busy check is the shell scan's (only while the app is open) | none: a local shell's command waits for your Yes anyway | fine as it is |
| `src/shared/tools.ts:655` | polish | a fixed wait for a command's first output | wait for output to settle | fine as it is |

### Devices, Preview and Browsers (14)

| where | risk | limit | upgrade path | proposal |
|---|---|---|---|---|
| `src/daemon/device.ts:133` | performance | simulator: a frame per call (~5 a second), input 0.3-0.6 s a call | a stream (idb or axe video-stream, scrcpy) | fine as it is |
| `src/renderer/src/SidePanel.tsx:611` | performance | the simulator tab: a few frames a second, a third of a second a tap | a stream with live touches | fine as it is |
| `src/cli/main.ts:535` | polish | `laki screen <op>`: a workspace named like a device op (shot, tap, windows…) can only be named by its id | look for a workspace by that name first, or a `--ws` flag | fine as it is |
| `src/daemon/device.ts:6` | polish | the first booted simulator only; an app's frontmost window only | --udid; a window pick | fine as it is |
| `src/daemon/device.ts:312` | polish | Android typing: a literal %s arrives as a space | none: adb's escape | fine as it is |
| `src/main/index.ts:101` | polish | Google sign-in's Firefox user agent: navigator.userAgentData still says Chromium | override the client hints too | fine as it is |
| `src/main/index.ts:154` | polish | a Browsers page's right click has no spelling suggestions | add them | fine as it is |
| `src/main/index.ts:599` | polish | agent browser: a click's changes looked for 1 s more | wait for network idle | fine as it is |
| `src/main/index.ts:1430` | polish | whole-page screenshots cut at 16,384 px | stitch several | fine as it is |
| `src/renderer/src/Browser.tsx:6` | polish | ⌘ keys go to the page (only ⌘W and ⌘T are forwarded) | forward more through before-input-event | fine as it is |
| `src/renderer/src/SidePanel.tsx:894` | polish | Preview: ⌘ keys go to the page; a size is the viewport's only (no touch, no phone UA) | none needed | fine as it is |
| `src/renderer/src/SidePanel.tsx:1088` | polish | the element picker's selector isn't always unique; frames and shadow roots aren't entered | none needed | fine as it is |
| `src/renderer/src/text.ts:235` | polish | Preview's address: index.html typed bare reads as a site | none needed | fine as it is |
| `src/shared/types.ts:978` | polish | pageChanges counts lines as a multiset: a reordered list says nothing | none needed | fine as it is |

### Electron main (13)

| where | risk | limit | upgrade path | proposal |
|---|---|---|---|---|
| `src/main/index.ts:429` | polish | the newest 50 notifications kept | none needed | fine as it is |
| `src/main/index.ts:445` | polish | 20 cards on screen at most | none needed | fine as it is |
| `src/main/index.ts:628` | polish | Glass sets the theme app-wide: pages that follow prefers-color-scheme follow it | none needed | fine as it is |
| `src/main/index.ts:634` | polish | a picked Dock icon isn't Finder's or a pinned tile's while Laki is closed | none: the bundle's signature | fine as it is |
| `src/main/index.ts:817` | polish | the bubbles' top and bottom row: code kept, never reached | delete it if it stays unused | fine as it is |
| `src/main/index.ts:902` | polish | an auto-hiding menu bar: the island shows over full-screen apps too | none needed | fine as it is |
| `src/main/index.ts:1249` | polish | the bubbles' spot not kept on a write error | none needed | fine as it is |
| `src/main/index.ts:1505` | polish | copying a file off macOS copies its path | none needed | fine as it is |
| `src/main/index.ts:1532` | polish | Toggle Sidebar has one title in the menu | none needed | fine as it is |
| `src/main/update.ts:5` | polish | no Linux self-update, no beta channel | none without a new dependency | fine as it is |
| `src/renderer/src/dock.ts:3` | polish | Finder keeps build/icon.icns | none needed | fine as it is |
| `src/shared/island.ts:8` | polish | the notch's width assumed (200 pt) | none needed | fine as it is |
| `src/shared/island.ts:13` | polish | full screen told by the screen, not the front window | none needed | fine as it is |

### Renderer UI (35)

| where | risk | limit | upgrade path | proposal |
|---|---|---|---|---|
| `src/renderer/src/text.ts:222` | correctness | settings import checks top-level kinds only: a nested value of the wrong shape comes in | check the nested keys that matter (presets, accounts) | fine as it is |
| `src/renderer/src/Bird.tsx:24` | performance | one screen call per card every 2.5 s | one batched method | fine as it is |
| `src/renderer/src/App.tsx:61` | polish | Laki AI's glow measured once; a resize leaves it | none needed | fine as it is |
| `src/renderer/src/App.tsx:685` | polish | radar hides: the newest 200, none pruned | none needed | fine as it is |
| `src/renderer/src/App.tsx:900` | polish | a bubble's card shows a project's emoji, not an icon by name | draw the icon | fine as it is |
| `src/renderer/src/App.tsx:1565` | polish | Undo of a closed browser page brings its address back, not its pin, color, group or name | keep the record for the undo | fine as it is |
| `src/renderer/src/App.tsx:1881` | polish | achievements written whole: two windows earning at once can lose one | a daemon method | fine as it is |
| `src/renderer/src/App.tsx:3351` | polish | a phone's terminal font size is fixed | none needed | fine as it is |
| `src/renderer/src/diagram.tsx:366` | polish | the calendar wireframe: 30 days from a Monday | a real month grid | fine as it is |
| `src/renderer/src/diagram.tsx:506` | polish | the OTP wireframe: always 6 boxes | none needed | fine as it is |
| `src/renderer/src/diagram.tsx:673` | polish | the diagram clipboard is in memory, not the system's | none needed | fine as it is |
| `src/renderer/src/highlight.ts:101` | polish | an empty match is stepped over | none: the right handling | fine as it is |
| `src/renderer/src/MarkdownView.tsx:139` | polish | drawn diagrams: the newest 200 kept | none needed | fine as it is |
| `src/renderer/src/PromptInput.tsx:93` | polish | a template's agent variables go in as written | none needed | fine as it is |
| `src/renderer/src/PromptInput.tsx:202` | polish | prompt history's filter reads a prompt's first 120 characters | none needed | fine as it is |
| `src/renderer/src/qr.ts:3` | polish | QR: byte mode and level M only | none needed | fine as it is |
| `src/renderer/src/SidePanel.tsx:1245` | polish | an action's tip: 600 characters | none needed | fine as it is |
| `src/renderer/src/SidePanel.tsx:1259` | polish | a CSV shows 2,000 rows | virtualise it | fine as it is |
| `src/renderer/src/SpecEditor.tsx:68` | polish | a redrawn diagram's old PNG stays in files/ | delete the old one on save | fine as it is |
| `src/renderer/src/SpecEditor.tsx:142` | polish | only images show inline in a spec | none needed | fine as it is |
| `src/renderer/src/specmd.ts:176` | polish | a diagram in README.md comes back as its text | none needed | fine as it is |
| `src/renderer/src/styles.css:618` | polish | without CSS anchor positioning the tab bar has no line beside the tab | none needed | fine as it is |
| `src/renderer/src/styles.css:1846` | polish | no ⌘± on My Desk and a workflow's canvas | none needed | fine as it is |
| `src/renderer/src/styles.css:3134` | polish | Motion doesn't reach the bubbles' window | its own setting if asked | fine as it is |
| `src/renderer/src/Term.tsx:32` | polish | picture links: a wide character before shifts the cells; a wrapped path isn't one | xterm's link provider with cell widths | fine as it is |
| `src/renderer/src/Term.tsx:35` | polish | a site's path in plain text (example.com/a.md) reads as a file | none needed | fine as it is |
| `src/renderer/src/Term.tsx:124` | polish | the scroll button: xterm's scrollback only | none needed | fine as it is |
| `src/renderer/src/Term.tsx:139` | polish | ⌥-drag's block selection is lost | none needed | fine as it is |
| `src/renderer/src/Term.tsx:203` | polish | double-click trims trailing punctuation, a leading one stays | none needed | fine as it is |
| `src/renderer/src/Term.tsx:274` | polish | ⌘⏎ sends ⌃J: a TUI that reads ⌃J as ↓ (fzf) gets ↓ | none needed | fine as it is |
| `src/renderer/src/text.ts:685` | polish | fuzzy file match is greedy | none needed | fine as it is |
| `src/renderer/src/themes.ts:1248` | polish | Glass: the selected tab's tint matches only a mostly solid terminal | none needed | fine as it is |
| `src/renderer/src/ui.tsx:507` | polish | drag scrolls a list only while the pointer moves | an interval while at the edge | fine as it is |
| `src/shared/icons.ts:386` | polish | the bubbles' and the screenshot editor's icons stay Laki's | none needed | fine as it is |
| `src/shared/markdown.ts:4` | polish | GitHub's common Markdown subset (reference links, footnotes as text) | add one when a README needs it | fine as it is |

## Issues to file

Eight issues cover the 13 notes marked *issue*. Each body is ready to paste.

### 1. Agents can pass as you: per-tab tokens instead of process ancestry

Notes: `src/daemon/main.ts:115`, `main.ts:547`, `main.ts:590`, `main.ts:716`, `src/daemon/core.ts:3472`,
`core.ts:3497` (and, resting on the same line, `src/daemon/widgets.ts:162`, `src/daemon/widgetTools.ts:128`). Size L.

Laki tells an agent's call from yours by the calling process: the socket's other end (lsof), up its parents to a tab's
PTY, then its terminal. Everything else is shared with every process of yours, agents included: `daemon.json`'s token,
the hook keys in the agents' env, the daemon's pid. It bites when an agent, or one steered by a prompt it read, runs
`laki` from a process that left its tab: `setsid` with a double fork, `launchctl submit`, `open x.command`, a tmux
server. That process has no terminal and launchd for a parent, so Laki reads it as you, and it can call what agents are
refused (`AGENT_NO`: change settings, trust a repo's workflow or extension, read your prompt history, send into another
workspace without the ask), or kill the daemon by its pid. The fix: each tab gets a token of its own in its env
(`LAKI_TAB_TOKEN`), and a call carrying it is that tab's whatever its process tree; the main token leaves the file
every process can read (the app gets it from main over IPC; the CLI outside Laki from the Keychain, or a 0600 file in a
folder the agents' sandboxes deny); a local call with neither is refused. Process ancestry stays as a second check.
`daemon.json`, `conn.ts`' `rpc`, the CLI, `laki hook`, `laki mcp` and remote access all change, so a short design
note first.

### 2. An extension's permission asks: a token per run

Note: `src/daemon/widgetTools.ts:128`. Size S-M.

An extension's AI run starts `laki mcp` with `LAKI_PERM_EXT=<id>`, and while any agent run of that extension is going,
`widgetPermission` takes an ask from any caller that names it. It bites when another local process (an agent in a tab)
asks during a run: you get a card that looks like the extension's own, and a tap on Always lets that tool run unasked
in the extension's runs from then on. The fix: mint a random token per agent run (`agentRun`), give it to the run's
MCP server through its env in a 0600 config file (not the command line, which `ps` shows), and require it in
`widgetPermission`; an ask without the live run's token is refused and logged. Test in
`test/widget-tools.test.ts`.

### 3. Two daemons can start from one stale lock

Note: `src/daemon/main.ts:54`. Data loss, size S.

`takeLock` links a pid file to `daemon.lock`; when that fails it reads the pid, and if that process is gone it unlinks
the lock and tries again. Two starters that read the same dead pid can each unlink it, the second removing the first's
fresh lock, and both run. It bites after a crash (the lock left behind) when the app and a CLI call start a daemon at
the same moment: two daemons then save one `state.json`, the last write wins, and workspaces, tabs or settings changed
in the other are lost; `daemon.json` names only one of them. The fix: after a successful link, wait a few ms
(`Atomics.wait`), read the lock again and exit if it doesn't hold our pid; and in main.ts' 2-second tick, exit (before
any save) if the lock stops naming us. A real flock needs a native module, which "no new dependencies" rules out.
Test: two daemons started against one stale lock in `test/api.test.ts`; one exits, one stays.

### 4. A restart wakes every cloud workspace's codespace

Note: `src/daemon/hosts.ts:329`. Size S.

`restoreAll` brings back every live workspace's tabs, and a cloud workspace's tab connects through `csUp`, which starts
a stopped codespace. It bites because GitHub stops an idle codespace after 30 minutes by default: each Laki update or
restart starts every such codespace again and resumes its agents, billed until the next idle stop, without anyone
looking at them. The fix: at `restoreAll`, mark a codespace workspace's tabs dormant (as `sleepAfter` does) unless the
tab was mid-turn or had a queue as Laki stopped; a look, a key or a message wakes it, which already starts the
codespace. Test in `test/ssh.test.ts` with the fake gh: a restart doesn't start a stopped codespace; opening its tab does.

### 5. The Reader sends its newest 400 messages whole at every change

Note: `src/daemon/meters.ts:52`. Size M.

`chatRead` answers with the newest 400 messages whenever `v` moved, and the Reader asks every 1.5 s. It bites during a
long turn, which writes several lines a second: each ask ships all 400 again, hundreds of KB a second per open Reader,
over cloudflared to a phone with remote access. The fix: the client sends the `v` and the last index it has, the daemon
answers with what came after it (and the last message again, which may still grow), and the whole list only when it's
read fresh. Test in `test/reader.test.ts`: a second `chatRead` with the last `v` gets only the new lines.

### 6. Start fresh piles up a tab per scheduled run

Note: `src/daemon/schedule.ts:347`. Size S-M.

A scheduled task with Start fresh opens a new agent tab in its workspace for each run and never closes one. It bites
for an hourly or daily task: within a week, dozens of tabs, each a claude process until `sleepAfter` puts it to sleep,
all of them in `state.json`, the tab bar and every restore. The fix: before the next run's tab opens, close the last
run's (its `r.tab`) if it's idle, has nothing queued, and you never typed into it or sent to it (`keysAt`, your
prompts); else leave it, as now. Test in `test/schedule.test.ts`: two runs leave one tab; a tab you typed into stays.

### 7. PR feedback misses review summaries and PR comments

Note: `src/daemon/pr.ts:660`. Size M.

Fix review sends the agent a PR's unresolved inline threads only. It bites when a reviewer requests changes in the
review's own text ("split this up", "add tests"), or says it in a plain PR comment: the agent never hears it, and the PR
sits in Changes requested while nothing was sent. The fix: add each trusted reviewer's latest review with state
CHANGES_REQUESTED and a body (and, under the same trust rule, PR comments since the last push) to the GraphQL query,
put them in the message above the threads, and key what was sent by review id as threads are. Test in
`test/pr.test.ts` with the fake gh.

### 8. A workflow's cost budget doesn't count its agents

Note: `src/daemon/workflow.ts:1359`. Size M.

A run's cost, and the cost budget that stops it, add up its AI calls and decisions; the turns of the agents it starts,
nearly all of its spend, aren't in it. It bites for a workflow with a $5 budget that loops an agent through fix CI: it
goes on well past $5, and its stats say a few cents. The fix: at each `sample`, add the meter cost (meters.ts, per chat)
of the run's tabs since the run started, or since each tab joined it; a dry run stays as it is. Test in
`test/workflow-runs.test.ts` with fake transcripts that carry usage.
