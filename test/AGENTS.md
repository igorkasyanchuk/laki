# AGENTS.md: test/

What this folder's files are. Read the root [AGENTS.md](../AGENTS.md) first: the commands, the architecture, the invariants, the conventions.

## Notes

  - `test/helpers.ts` `fresh()` gives each test a temp `LAKI_HOME` and `HOME`, its own daemon (the build's, `out/main`:
    npm test, test:one and test:changed build first; a build older than src, or `LAKI_TEST_SRC=1`, runs it from source), and the
    fakes in `test/fakes` first on PATH: `claude`, `codex`, `gh`, `open` (records what it would open), `caffeinate` (records its starts and stops), a shell `tsh`,
    `ssh` (every host is this machine) and `da-probe` (counts terminal query replies). No network.
    About 200 ms a rig: its repo made once per test process (per `.laki.json`) and copied, node's compile cache one per
    test process (`NODE_COMPILE_CACHE`), the daemon's pty host started as it loads (`daemon/ptyEarly.ts`); `LAKI_TEST_PROFILE=1`
    prints its parts (repo, the daemon's token, its first ping).
  - The fakes echo their arguments and prompts; tests lean on that. `FAKE_SCRIPT=<file>` (only `scripts/demo.ts` sets it,
    for the README's stills) makes claude and codex talk like the real ones instead (`test/fakes/script.cjs`: per
    workspace, tool lines and a summary); the hooks and menus stay the same. No test may depend on it (`test/agents.test.ts`).
  - `test/cloudflared` is a fake that's off PATH: a test links it into `$HOME/bin` (first on PATH) to install it.
  - Never let a test touch the real `~/.laki` (or `~/.laki-electron`), `~/.claude` or `~/.codex`. The rig also
    sets `LAKI_PAGE` to a folder of the test's own, so remote access never serves the build.
  - The rig's daemon has `LAKI_TEST_PARENT`, the test's pid: it shuts down once that process is gone (main.ts, every
    2 s), so a test run killed midway leaves no daemon running (`test/restart.test.ts`).
  - Waits: `until(f, what, ms)` polls (a pass returns at once), `seen(app, e => …)` waits for a daemon event on a
    connected window; both limits are multiplied by `SLOW`: `LAKI_TEST_SLOW=2`, else from the load as the file
    starts (1 to 3); `sleep` is as written. A timeout says what it waited for and the multiplier.
  - A file's tests run one after another, the files 4 at a time, the longest first (scripts/test-order.ts): keep a
    file under a minute of a full run (test:report's medians; `ai`, `agents`, `workflow-runs`, `pr`, `restart` and
    `worktrees` about one), else split it by topic as `daemon` was (`agents`, `presets`, `restart`, `worktrees`), and
    `api` (`api-remote`, `api-workspaces`) and `cli` (`cli-tools`), or it's the run's tail.
- **Trying the UI in a browser**:
  1. `npm run demo -- /tmp/laki-x` builds a temp world (a repo, 3 workspaces, fake agents; `LAKI_DEMO_MANY=30`: 30) and a daemon
     that accepts the dev origin. It prints a URL with the port and token in the hash. To try Expose to the
     world, `ln -s $PWD/test/cloudflared /tmp/laki-x/bin/`.
  2. `npm run dev:web` serves the renderer on :5199; open that URL.
  3. Afterwards stop it: `LAKI_HOME=/tmp/laki-x/data node out/main/cli.js stop`, then stop vite.
- `npm run test:ui` (`scripts/ui-smoke.ts`): first a short launch of its own on an empty data folder (no state.json, no
  project; its daemon the app's own, `test/fakes` first on PATH; main's `LAKI_SMOKE_FIRST`, `firstRun`): the Welcome
  screen, then *Try it on a sample repo* lands on New workspace with the sample's task (`first-*.png`). Then a demo world of its own, the built app (`out/`) in Electron with
  `--laki-smoke=<dir>` (main's `uiSmoke`, smoke.ts): Projects, Reader, the Review tab, New workspace, Settings, Board, Schedule,
  AI, Workflows and ⌘K, each opened (its laki:// link, a click, a key), a selector of its own waited for, failed by
  ui.tsx' Boundary (`.boom`) or a console error; a screenshot each. Then the flows (E3), each done as you would (a right
  click, a menu's item, a dialog's button) and waited for: archive with an uncommitted file (the dialog names it), Undo
  from the toast; the Review tab's Revert this file, Undo; F1's rewind to a kept turn and its undo; Merge on a green PR
  from ⌘K (the fake gh's log has it). It spawns Electron's binary, not `.bin/electron` (a node script: a version
  manager's node shim can't find node under the temp HOME). Its window shows on your screen for half a minute.
- Sleeps in tests: `until`/`seen`/`viewed` (a view sent with a tab's status: changed()'s 30 ms passed) where there's a
  condition. A sleep stays where a test proves nothing more happens (once per head, not its own event, dropped past a
  limit), where it waits out a timer of the code (answer's hold, the SIGKILL check), or makes a race on purpose.
  A code timer a test waits out has an env knob, set per test with `fresh(t, { env })`, the sleep a little past it:
  `LAKI_QUIET_MS`, `LAKI_ANSWER_HOLD_MS`, `LAKI_CODEX_LATER_MS`, `LAKI_FALLBACK_MS` (core.ts), `LAKI_KILL_AFTER_MS`
  (resources.ts), `LAKI_SWEEP_MS`, `LAKI_PARENT_MS`, `LAKI_LOOP_REPORT_MS` (main.ts), `LAKI_PR_SOON_MS`, `LAKI_PR_SCAN_MS`, `LAKI_PORT_SCAN_MS`,
  `LAKI_FLOW_RESUME_MS`, `LAKI_RUN_ENDED_MS`, `LAKI_PUSH_WAIT_MS`, `LAKI_CLIENT_LOG_MS`, `LAKI_WIDGET_LOG_MS`,
  `LAKI_REPO_WATCH_MS`, `LAKI_DISK_LOW_MS` (resources.ts' diskLowTick), `LAKI_MCP_AUTH_MS` (mcpAuth.ts), `LAKI_HINT_MS` (the CLI's "Approve this terminal"), `LAKI_TG_GAP_MS`, `LAKI_TG_PAIR_MS`, `LAKI_TG_LIMITS` (telegram.ts). A sleep over a second says why.
  `LAKI_TEST_SLEEPS=<file>`: each sleep's place and ms appended to it (the whole run's: 90 s in 213 calls, from 226 in 246).

## Files

| file | what |
|---|---|
| `test/` | fakes for every agent (`claude`, `codex`, `agy`, `grok`, `opencode`); `daemon` (and by topic: `agents` (each agent's hooks), `presets` (how agents start), `restart`, `worktrees`), `api` (errors, edge cases, daemon start; `api-remote`: tunnels, remote access; `api-workspaces`: workspaces and projects), `shells` (shell tabs, Terminals and Browsers), `pr` (PR feedback), `pr-background` (the scans' GitHub quota, a merged or idle workspace archived), `gitlab` (MRs through `fakes/glab`), `cli`, `cli-tools` (laki mcp, wait, doctor, events, completion), `cli-agents` (the CLI from an agent's tab), `agent-gates` (what an agent's call may not do: removes ask, its own workspace's files and tabs, no merge, the user's settings, Recording mode), `workflow`, `workflow-runs`, `workflow-agents`, `workflow-events`, `workflow-pause` (Pause after this block, Resume), `workflow-blocks` (parallel blocks, a workflow run as a block), `workflow-simulate` (W7: a simulated run, its answers, a replay), `remotes` (a fork's GitHub remotes: issues and PRs of each), `e2e`, `snapshot`, `limits`, `layout`, `qr`, `highlight`, `template` (text.ts; theme ids and looks), `ask` (waiting menus), `markdown`, `contrast` (every theme's text, hints and button labels: WCAG ratios), `actions` (Run ▾'s), `usage` (plan limits, a fake server), `schedule` (`when.ts`, scheduled tasks), `links` (laki:// links), `push` (phone pushes), `fun` (memes, a fake server), `telegram` (Settings › Telegram against a fake Bot API), `ssh` (projects over SSH, `fakes/ssh`), `widget` (templates, widgets, the two that come with Laki), `resources` (memory by tab, sleep and wake), `ai` (Laki AI's backends, key, log), `plans` (specs and brainstorms, their MCP tools), `help` (laki_help's guide search), `meter` (context and usage from fake transcripts, prices), `statusline` (Claude's status line kept, yours run after, its context and limits), `keys` (Settings › Keys' resolution, matching, clashes, ⌘K commands), `perm-mode` (a running claude's permission mode), `turn-alerts` (a long turn, Continue after an API error), `glyph-fx` (a status mark's one-shot effect), `goals` (a goal Laki runs for gemini: reached, failed at its turns, paused by yours), `radar` (Collision radar), `check` (Done check, the Proof card), `plan` (the agent's plan, live), `next-step` (One next step), `reader` (Reader view, its chips, MCP Apps, laki-ui), `fallback` (Auto fallback at a plan limit, a model too new for the installed claude), `alerts` (laki alert: the card, its choices, closed), `program` (OSC 7501), `browser-budget` (hidden pages over a memory budget), `turn-history` (kept turns: across a restart, a turn's diff, rewind and its undo, a workspace from a turn, refs gone with the workspace; Since I reviewed), `review-notes` (the full review's comments kept in the daemon), `docs` (the numbers the docs state, checked against the code), `upgrade` (a new app on an old daemon), `ptyhost` (the pty host's protocol, versions, a daemon killed and started again), `a11y` (every `<button>` in the renderer has a name: text, `aria-label`, `title` or an `<img alt>`), `css` (no restyle of the whole window: no `*` under a `:has()`, BlockNote's suggested edits out), `acp` (an ACP agent tab with `fakes/acp-agent`), `clients` (trusted clients: a detached process with a client token, its scopes, Recording mode, laki mcp's tools, revoke), `client-gates` (which methods a client's scopes allow, over every method: no daemon), `sheet` (Excel workbooks as tables), `env-keys` (secret env values in the Keychain through `fakes/keychain-security`, an old state.json migrated), `walk` (the Review tab's Walk through: hunks, the answer's check, the fold, `reviewSteps` with a fake OpenRouter: helpers.ts `openrouter`, ai.test.ts' too), `view-share` (the renderer's structural sharing), `ai-credits` (OpenRouter's credits and spend in Usage), `schedule-copy` (a scheduled task's Duplicate), `loop` and `loop-daemon` (an agent failing the same command), `osc52` (a program's copy to the clipboard), `swipe` (rows' swipes), `tool-days` (what agents call), `safe` (safe mode after young deaths), `load-order` (every daemon module imported first, each in a process of its own: none reads another's const or let as it loads), and edge cases for branch coverage: `units-more` (pure functions), `cli-more` (CLI, MCP, HTTP), `services-more` (usage, memes, widgets), `core-a` and `core-b` (core.ts by halves; their own `ssh`, `ps`, `lsof`, `cloudflared` stand-ins in the rig's `$HOME/bin`) tests; `helpers.ts`; `flows.ts` (the workflows' tests' shared files); `fakes/`; `cloudflared` |
