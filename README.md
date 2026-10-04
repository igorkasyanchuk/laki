# Laki

A macOS app for running coding agents (Claude Code, Codex, or any command) side by side, each in its own
git worktree. You get a sidebar of projects and workspaces, tabs per workspace, real terminals you can split
into panes, and live agent status (running, waiting for you, finished). It also has a follow-up queue, a
side panel (files, changes, review), a Run button, dev servers, listening ports, PRs and ship. Agents keep running when you quit the app;
*Laki › Quit Laki Completely* stops them too (they resume next time).

Electron + a terminal-host daemon (node-pty + @xterm/headless) + React + xterm.js, the same shape as Superset.

What Laki is and where it's going: [requirements](requirements/README.md). How the code works, for agents
changing it: [AGENTS.md](AGENTS.md).

## Features

- **Workspaces**: one git worktree and branch per task (or the repo or a plain folder itself), with setup and
  teardown scripts, env, a `$PORT` of its own, and a name you can change.
- **Agents**: Claude Code, Codex or any command, started from presets (args, env). Live status per tab and
  workspace; notifications; a follow-up queue; resume after a restart; usage limits wait and continue.
- **Terminals**: real PTYs in tmux-style tabs and panes (drag to split), kept by a daemon while the app is
  closed. ⌘F finds with every match in yellow; copy on select; font, size, line height, weight, cursor
  and zoom, with a live preview.
- **New workspace prompt**: type, dictate (macOS dictation) or paste/drop screenshots; the agent gets the text
  and the images' paths. Prompt templates wrap it (`{{prompt}}`).
- **Plan limits**: a ring in the status bar fills to the most-used limit of your Claude and Codex plans; click
  it for each one (5-hour, weekly, per model) and when it resets.
- **PRs**: the workspace's PR and its CI in the status bar; switches that send failing CI or new review
  comments to the agent on their own; an info panel with the PR, its checks and what the agents said last.
- **Side panel** (⌥⌘B): the workspace's files (search, preview, new file or folder, changed files marked),
  its changes against the base branch, and its PR's checks and review comments. ⌘P finds a file by name.
- **Git**: ship (commit, push, open a PR), fork a workspace with its chat, archive and restore.
- **Scripts and ports**: setup, teardown and run scripts per project (any number of lines); ▷ Run starts the
  run script in its tab, ■ stops it; listening ports you click to open, or expose to the world (a public
  trycloudflare.com link and its QR code, optionally only for some email addresses).
- **Look**: 36 themes, including Warp-style gradients and eighteen that also change shapes, borders and type;
  glass (a see-through window, as see-through as you set, with a color glow); Inter and JetBrains Mono built
  in; tab and workspace colors.
- **Remote access**: the whole app in a browser on another computer or your phone, through a Cloudflare
  tunnel that lets in one email address, for 1 to 24 hours; a QR code to open it.
- **Keys everywhere**: ⌘ shortcuts, a ⌘K palette, and a letter for every menu item.

## Install

You need:

- macOS on Apple silicon
- Node 22.6+ (23 recommended) and npm
- git

Optional: `gh` (logged in, for PRs and ship), `claude` and/or `codex` on your PATH.

```bash
cd ~/projects/laki
npm install            # if node_modules/electron/dist is missing: node node_modules/electron/install.js
npm run pack
```

The build produces `dist/mac-arm64/Laki.app` (unsigned). Open it from there, or copy it to /Applications:

```bash
open "dist/mac-arm64/Laki.app"
```

To put the CLI on your PATH as `laki`:

```bash
npm link
```

## First run

1. Open the app. It starts its background daemon if one isn't running.
2. Add a project: **⌘O**, the folder icon at the top of the sidebar, or drag a folder from Finder onto the
   window. It can be a git repository or any other folder.
3. The new-workspace page opens. Pick an agent (claude, codex, shell, or a custom command) and,
   optionally, a first prompt.
   - For a git repository, also pick a base branch. The workspace gets a worktree in
     `~/.laki/worktrees/<project>/<id>` on branch `laki/<id>`, its setup command runs, then the
     agent starts. *Local* works in the repo itself instead.
   - A folder without git always works in the folder itself; it has no branches, diff, PRs or ship.

## Using it

**Sidebar:** projects and their workspaces, one line each (status, name). The selected workspace's PR is in the status bar.
- ＋ on a project creates a new workspace in it.
- ⋯ on a project opens its menu:
  - *New workspace*;
  - *Settings…* (see Project settings below);
  - *Remove project*;
  - its archived workspaces, which you click to restore.
- Drag the sidebar's right edge to resize it; double-click the edge to reset. ⌘B (or the sidebar icon) hides
  and shows it.
- ⋯ (or a right click) also opens the project in any editor, Finder or terminal app you have.
- Right click a workspace for a color, *Rename…* (the name it shows; its folder and branch keep the id),
  *Info*, *Open in*, fork, archive and delete.
- Drag projects, and workspaces within a project, to reorder them.

**Tabs and panes**, tmux style: a tab holds one terminal or several, split side by side or stacked.
- ＋ in the tab bar opens a new tab: shell (⌘T), one of your agent presets (claude, codex, …) or a command.
- Splitting:
  - Drag a tab onto a pane's edge: it moves into that tab, on that side.
  - *Split right* / *Split down* (⋯ menu or ⌘K) open a new shell next to the active pane.
- Drag a pane's header to move the pane within its tab, or onto the tab bar to give it a tab of its own.
- Drag the dividers to resize.
- × on a pane closes that terminal; × on a tab closes all of its terminals. Both stop the process.
- ⌘1…⌘9 switch tabs. Double click a tab to rename it.
- A tab closes by itself when its shell exits, or its agent ends cleanly (exit code 0). An agent that failed
  stays open to read, and ⏎ starts it again.
- Each workspace remembers its tabs and splits.
- Right click a tab (or a pane's header) for *Rename*, a color, *Split right/down*, *Move to its own tab*,
  *Restart* (an ended agent or dev server), *Close* and *Close other tabs*. Claude tabs are orange and codex
  tabs teal unless you pick another color (or none).

**Menus:** every item has a key, shown on its right: press it while the menu is open (e.g. right click a
workspace, then D deletes it, R renames it). ↑↓ and ⏎ work too, and 0–8 pick a color.

**Find:** ⌘F searches the active pane's terminal and its scrollback; every match is yellow.
- ⏎ goes to the next match, ⇧⏎ to the previous.
- *Aa* matches case and *.\** turns on regex. Esc closes the search.

**Tab bar icons** (right side; hover for a tooltip):
- info (⌘I): the workspace info panel (below);
- editor: opens the workspace in Cursor, Zed, VS Code, Windsurf, Sublime Text, JetBrains IDEs, Xcode, Finder,
  Terminal, iTerm, Warp or Ghostty (the ones installed). ⌘E opens the default, which is the last editor picked;
- panel (⌥⌘B): the side panel (below); ⌘D opens it on *Changes*;
- ship: commit, push and open a PR, in a *ship* tab;
- search: the command palette (⌘K);
- ⋯: split right/down, fork, archive, delete;
- ▷ Run ▾: the project's run script in a *dev* tab, ■ Stop while it runs (^C). ▾ restarts it, shows its tab,
  opens `localhost:$PORT` or edits the script. With no run script, Run opens the project's scripts.
  ▾ also lists your actions (Settings → *Actions*, and the project's), worked out as it opens:
  - *Agent actions*: a prompt for Claude Code or Codex, listed while the workspace runs that agent. It goes to
    the focused tab if it's that agent, else its first tab, now or (while it works) when its turn ends.
  - *Terminal actions*: a command, typed into the focused shell, else the workspace's first, else a new one.

**Status bar** (bottom): branch ← base, `$PORT` (green while something listens on it) and the other
listening ports (click one to open it in the browser), the PR (click to open it), its CI (`✓ 4/4`,
`✗ 1 failing`, `… 2 running`; click for the checks), the *fix CI* and *review* switches (see PRs below), and
the workspace's path, short (`~/…/app/fix-login`; hover for all of it) with a button that copies the whole path.

**Expose to the world** (the globe next to `$PORT` and each listening port): publishes the port at a random
`https://….trycloudflare.com` link through Cloudflare Quick Tunnels, with no Cloudflare account. It needs
`cloudflared` on your PATH (`brew install cloudflared`; the popup says so when it's missing).
- *Who can open it*: *Anyone with the link* (the default: public, no sign-in), or *Only these emails*:
  addresses, or a whole domain: `*@gmail.com` (`@gmail.com` or just `gmail.com` say the same). The popup lists
  who gets in and flags what isn't an address or a domain. A project can set its own default (Settings › the
  project › *Expose to the world*, or `expose` in `.laki.json`): the popup opens with it each time. Cloudflare then emails each visitor a one-time code, and only those
  addresses get in (cloudflared 2026.9.3 or newer: `--allowed-mail`). The list is kept for next time; with
  none yet, it's git's `user.email`.
- Once it's up: a QR code to open it on your phone, the link (copy, open), and *Stop*. The globe lights up,
  and the info panel (⌘I) shows the public link too.
- It runs in the daemon until you stop it, delete or archive the workspace, or stop the daemon; closing the
  app leaves it on. A port with a tunnel stays in the status bar after its server stops.

**Remote access** (Settings › *Remote access*): Laki in a browser on another computer or your phone, with
its terminals and agents, as if you sat at this Mac. Whoever gets in has a shell here as you, so it lets in one
email address only.
- Set the email (kept in the app's settings for next time), pick how long (1, 2, 4, 8 or 24 hours) and click
  *Start remote access*. It needs `cloudflared` 2026.9.3 or newer (`brew install cloudflared`), like *Expose
  to the world*.
- cloudflared publishes the daemon at a random `https://….trycloudflare.com` link; the daemon serves the app's
  page there. Cloudflare asks for that email and sends it a one-time code, and the link also carries a key of
  its own (after `#`, so it never reaches a server).
- Once it's up: a QR code to scan with your phone, the link (copy, open), when it ends, and *Stop remote
  access*. The status bar says *Remote until 18:30* while it runs; click it to get back here.
- It stops on its own when the time is up, when you stop it, or with the daemon. Each start makes a new key, so
  an old link never works again.

**Plan limits** (the ring at the start of the status bar): green, yellow past 70%, red past 90%, filled to
the most-used limit of the agents' plans. Click it for each agent's windows: Claude's 5-hour session, the week,
the week per model and extra usage; Codex's 5-hour and weekly windows. Each shows when it resets. The daemon
reads them the way Superset and CodexBar do: with the sign-in the agent already keeps on this Mac (Claude
Code's Keychain item or `~/.claude/.credentials.json`; Codex's `~/.codex/auth.json`), from the endpoint the
agent's own `/usage` screen asks, at most every 5 minutes. It never refreshes a token: an expired one says so
until the agent's next run renews it. Settings › General turns each agent off (then nothing is read).

**Side panel** (⌥⌘B, the panel icon; drag its edge to resize; one panel at a time with the info panel):
- *Files*: the workspace's files (git's, ignored ones left out; a plain folder's, without `node_modules` and
  the like). Search filters by path. New file and new folder go in the selected folder; a new file opens in
  your editor. A click on a file previews it next to the terminal (text with line numbers, code in color up
  to 50 KB, or an image),
  with *Open in editor*; a double-click opens it in the editor. Changed files are colored (modified, new, deleted) and their
  folders get a dot. Refresh, collapse all.
- *Changes*: the files changed against the base branch (committed, uncommitted and new) with +/−; click one
  for its diff, with links to preview the file or open it in the editor.
- *Review*: the PR with its checks, the *fix CI* / *review* switches and the send buttons, and the open
  review threads (from reviewers with write access and bots: what the agent would get). Click a thread's
  file to preview it at that line.

**Find files** (*Find files…*, first in ⌘K; or ⌘P): type parts of a path (`crt` finds `src/cart.ts`); names match
before folders. ↑↓ and Enter preview the file; ⌘W closes the preview.

**Info panel** (ⓘ or ⌘I): the workspace's name, branch, path and `$PORT`; each public link (Expose to the
world: open, copy, and who can open it); its PR's title, author, state,
review decision, size, checks (each links to its run) and description; buttons that send the failing CI or
the open review comments to the agent now; and what each agent said last.

**PRs.** Laki finds the PR of each workspace's branch with `gh` (logged in) every minute.
- *fix CI*: when CI fails on a new commit, the failing checks and the end of their GitHub Actions logs go to
  the workspace's agent (when it's idle), asking it to fix, commit and push. Once per commit; after 3 tries
  in a row it stops and tells you.
- *review*: new review comments from others (unresolved inline threads) go to the agent, asking it to
  address them and push. Its own replies don't start another round.

**New workspace** (a page, like Settings; Esc closes it): pick the project, base branch, name and agent, then
the prompt:
- paste a screenshot (⌘V), drop image files on it, or pick them with the image icon; each shows as a
  thumbnail, and its path goes after your text;
- the mic starts macOS dictation (or press Fn twice). *mic & language…* opens System Settings → Keyboard →
  Dictation, where you pick the microphone and the languages;
- *Template* (under the prompt, once you have one in Settings → *Prompt templates*): the prompt goes in its
  `{{prompt}}`; the box below shows what the agent will get;
- ⌘⏎ creates it.

**⌘K palette:** jump to any workspace or tab, or run any action.

**Status**

| glyph | meaning |
|---|---|
| spinner | running |
| ◆ | waiting for you (permission prompt) |
| ● | finished while you weren't looking; clears when you look |
| ○ | idle |
| ◷ | usage limit (it types `continue` after the reset) |
| ✓ / ✖ | process ended (ok / failed) |

A workspace shows its most urgent tab. A terminal that waits or finishes while off screen sends a macOS
notification (Settings › General turns them off); click it to jump there. Follow-ups queued with `laki send --when-idle` show as `+n`.

### Keys

| key | |
|---|---|
| ⌘O | open a project folder (or drop one on the window), then a new workspace in it |
| ⌘N | new workspace |
| ⌘T / ⌘W | new shell tab / close tab (or the file preview, when one is open) |
| ⌘1…⌘9 | tabs |
| Esc | close a dialog or menu |
| ⌘↑ / ⌘↓ | previous / next workspace |
| ⌘K | palette |
| ⌘P | find a file in the workspace |
| ⌘D | changes (the side panel) |
| ⌥⌘B | side panel: files, changes, review |
| ⌘I | workspace info |
| ⌘F | find in the terminal |
| ⌘E | open in the editor |
| ⌘B | hide / show the sidebar |
| ⌘, | settings |
| ⌘/ | help: keys, status glyphs, the main CLI commands (also the ? at the top of the sidebar) |
| ⌘+ / ⌘− / ⌘0 | terminal font bigger / smaller / default |

## Settings

⌘, or the gear at the top of the sidebar opens the settings page. Changes save as you make them, into
`state.json`. The page grows and shrinks with the terminal font size; on/off options are switches.
- *General*: the agent new workspaces start with, the branch prefix for new worktrees (default `laki/`),
  *macOS notifications* (on by default; also *Turn macOS notifications off/on* in ⌘K), *plan limits* for
  Claude Code and for Codex (the status bar's ring; on by default), and environment
  variables for every session (a project's or preset's env wins over them).
- *Appearance*: the interface font (Inter by default, SF Pro, or a few more), *Glass* (a see-through
  window: the desktop shows through, blurred; sliders for how see-through the window, the sidebar and the
  terminals are, and *Glow*: the theme's colors lit from two corners behind it), and the theme: Midnight (default), Dawn (light), Synthwave, Forest, Ember, Fjord, Graphite,
  Velvet, Nightfall, Paper (light), Mist (light), and the Warp-style gradients Cyber Wave, Koi, Pink City, Leafy,
  Aurora, Sunset and Snowy (light); and eighteen ✦ themes that change more than colors: Phosphor (a CRT: mono,
  dashed, glowing, scanlines), Neon Arcade (pills and glow), Brutalist (light: thick black lines, hard
  shadows), Bubblegum (light: round and soft), Blueprint (a drafting grid, mono capitals), Cyberpunk (clipped
  corners, hazard stripes, yellow tabs), Art Deco (gold double rules, serif capitals, a sunburst), Classic
  (light: a 1995 desktop with grey bevels and navy title bars), Notebook (light: ruled paper, a red margin,
  a highlighter, sketched buttons), Aqua (light: glossy gel pill buttons, pinstripes, a blue jelly selection and
  scrollbars, glowing focus rings), Clay (light: soft UI, everything raised out of one color or pressed into it),
  Pocket (light: a handheld's green LCD, pixel-stepped corners, a ▶ cursor on the selection, a crimson A button)
  Starship (a ship's console: flat pastel pills, rounded elbows framing the popups, a segmented column down
  the sidebar), Gazette (light: a broadsheet's serif type, double rules, a red drop cap, a masthead on the popups),
  Holo (iridescent foil: popups edged in a moving rainbow, prism lines), Bauhaus (light: Futura, primary color
  blocks, a circle, square and triangle by the headings), Chalkboard (chalk on a green board, the selection circled
  by hand, popups in a wooden frame) and Brass (steampunk: brass plates with rivets, copper pipes along the edges).
  Terminals take its 16 colors.
- *Terminal*: font (JetBrains Mono by default; the monospace fonts you have, or any other by name), font size (also ⌘+ / ⌘− / ⌘0),
  line height, letter spacing, font weight, minimum contrast (text lightens or darkens to stay readable),
  cursor style (block, bar, underline) and blinking, and copy selected text to the clipboard (on by default),
  with a live preview. Ligatures aren't drawn: xterm.js needs an add-on for them that isn't bundled.
- *Open in*: the default app for ⌘E, or a custom command that gets the folder as `$1` (e.g. `idea "$1"`).
- *Agent presets*: how agents start. A preset is Claude Code or Codex with extra arguments (e.g.
  `--model opus --permission-mode acceptEdits`), or any command, plus environment variables. Each one is in
  the new-tab menu and the new-workspace page. Edit `claude` and `codex` to change how every new one
  starts; a tab started from a preset uses its current settings when it restarts or resumes.
- *Prompt templates*: prompts you reuse. `{{prompt}}` is what you type when you use one, `{{project}}` and
  `{{base}}` the workspace's project and base branch; a template without `{{prompt}}` gets the prompt after
  it. *Add template* starts from an example.
- *Actions*: Run ▾'s shortcuts, each a name, who it's for (Claude Code, Codex or a terminal) and the prompt
  or command, e.g. `execute code review 2 times with --fix` for Claude, `execute $code-review and fix
  findings` for Codex, `bundle exec rails db:migrate` for a terminal.
- *Agent skill*: installs a skill for Claude Code and Codex in your home folder (`~/.claude/skills/laki`,
  `~/.codex/skills/laki`), so every session knows Laki: what it is, and how to drive it with its CLI (list
  projects and workspaces, start a workspace with an agent and a prompt, message agents, read their screens).
  It holds the app's path: update it after moving the app. *Remove* takes only its own files.
- *Remote access*: the email it lets in, how long, start and stop, the QR code and link (above).
- *Projects*: each project's settings (below).

Selecting text in a terminal copies it. A tab whose agent you stop with Esc goes back to idle, and so does one
whose turn ends without a word (a resumed chat's recap): quiet for a few seconds, no "esc to interrupt".

## Project settings

Settings → *Projects*, or ⋯ on a project then *Settings…* (Run ▾ → *Edit the run script…* opens its Run
tab). Saved as you type:
- Name.
- *Scripts*, one tab each, any number of lines; *Import* fills one from a script file:
  - *Setup*: runs in each new worktree, e.g. `npm install`; agent and dev tabs wait for it.
    `$LAKI_PROJECT_PATH` is the repo itself, e.g. `cp "$LAKI_PROJECT_PATH/.env" .env`.
  - *Teardown*: runs when a workspace is deleted or archived.
  - *Run*: what ▷ Run starts, e.g. `npm run dev -- --port $PORT`.
- *Env*: `KEY=value` lines for every tab of the project's workspaces, and its setup and teardown.
- *Expose to the world*: who can open its tunnels, as addresses and `*@domains` (e.g. `me@x.dev, *@team.com`).
  The popup starts from it every time: *Only these emails*, filled in. Empty: *Anyone with the link*.
- *Actions*: Run ▾'s for this project, after the global ones; one with a global one's name and kind replaces
  it here (e.g. its own *Migrate*). Saved in the app only, not in `.laki.json`.

These are saved in the app. A field left empty falls back to a `.laki.json` in the repo, which a team can
commit. The page shows that file's values as placeholders:

```json
{ "setup": "npm install", "teardown": "docker compose down", "run": "npm run dev -- --port $PORT", "expose": "*@team.com", "env": { "NODE_ENV": "development" } }
```

Env from the app and from `.laki.json` merge, key by key (the app's wins), then a preset's env goes on top.

Every workspace gets its own `$PORT` (3100, 3110, …).

## CLI

```bash
laki project add ~/code/app
laki new app --prompt "fix the login redirect"          # worktree + claude with that prompt
laki new app --preset codex --base develop --name dark
laki ls [--json]
laki send fix-the-login --when-idle "now add tests"     # queued; typed in when the turn ends
laki screen fix-the-login/claude
laki diff fix-the-login | run fix-the-login | ship fix-the-login -m "Fix redirect"
laki archive fix-the-login | restore … | fork … | rm …
laki open                                               # the app
laki stop                                               # stop the daemon (agents resume when it starts again)
laki daemon                                             # run the daemon in the foreground
```

### Recipes

Everything the app does, a script (or an agent with the skill) can do. `jq` ships with macOS.

```bash
# three agents on three tasks, at once
for t in "fix the login redirect" "add dark mode" "speed up the tests"; do
  laki new app --prompt "$t"
done

# who needs you: the tabs waiting for an answer
laki ls --json | jq -r '.tabs[] | select(.status == "waiting") | "\(.workspace)/\(.name)"'

# follow-ups, typed in one at a time as the agent's turns end
laki send fix-login --when-idle "now add tests and run them"
laki send fix-login --when-idle "then update the README"

# the same message to every idle Claude
laki ls --json | jq -r '.tabs[] | select(.preset == "claude" and .status == "idle") | "\(.workspace)/\(.name)"' |
  while read -r t; do laki send "$t" "rebase on main and fix any conflicts"; done

# watch an agent from another terminal
while sleep 5; do clear; laki screen fix-login --lines 30; done

# start the dev server and open it
laki run fix-login
open "http://localhost:$(laki ls --json | jq '.workspaces[] | select(.id == "fix-login") | .port')"

# a tab that runs the tests on every change
laki tab fix-login --cmd "npm test -- --watch"

# try another approach without losing this one: a new branch with the same chat
laki fork fix-login

# review, then wrap up
laki diff fix-login | less
laki ship fix-login -m "Fix the login redirect"
laki archive fix-login
```

## Data

Data lives in `~/.laki`; set `LAKI_HOME` to use another folder. A Mac that ran Laki when it was called Laki
Electron keeps using `~/.laki-electron` (as long as there's no `~/.laki`): its worktrees are in there, and the
agents find their conversations by those paths. It holds:
- `state.json`: projects, workspaces, tabs and chat ids;
- `daemon.json`: the daemon's port and token (0600);
- `daemon.log`;
- `claude-settings.json`: the hooks Claude gets through `--settings`;
- `worktrees/` and `run/`.

`~/.claude` and `~/.codex` are left alone, except the skill folders *Settings → Agent skill* writes when you click Install.

## Updating

After pulling or changing the code, rebuild (`npm run pack`) and reopen the app. The running daemon stays the
old build until it restarts. When the app relies on something that daemon lacks, the status bar says *daemon
older than the app · restart*: click it, then again to confirm. Or run `laki stop` and open the app. Agents
come back resumed (`claude --resume`, `codex resume`); shells and dev servers start fresh.

Coming from Laki Electron (the app's old name): build, quit *Laki Electron*, and open `dist/mac-arm64/Laki.app`.
It finds the same daemon and data, and says the daemon is older: restart it there. Then delete the old app. The
CLI is `laki` now (`npm link` again); the skill is `laki` (*Settings → Agent skill*: install it, and remove an
old `laki-electron` folder from `~/.claude/skills` and `~/.codex/skills` if you had one).

## Troubleshooting

- **The app shows "connecting to the daemon…"**: check `~/.laki/daemon.log`. To restart the daemon, run `laki stop`, then reopen the app.
- **An agent isn't found**: commands run through your login shell (`$SHELL -lic`), so `claude` and `codex` must be on the PATH your `~/.zshrc` sets.
- **No PR badge**: run `gh auth status`. PRs are checked once a minute.

## Known limits

- **Build**: unsigned, arm64 only, no auto-update. The app is ~290 MB and uses ~500 MB of memory.
- **Startup**: when the daemon starts, every tab of every workspace starts (agents resume). After a reboot that can mean many agents at once.
- **Daemon**: if it dies, its terminals end. Agents come back resumed; shells start fresh.
- **Codex** has no prompt hook, so "running" is a guess (Enter in an idle codex tab).
- **Snapshots** keep 5,000 lines of scrollback.
- **Fork** copies commits only; uncommitted changes stay behind.
