# Security

## Supported versions

The latest release only: the dmg on
[igorkasyanchuk/laki-releases](https://github.com/igorkasyanchuk/laki-releases) (or `brew install --cask
igorkasyanchuk/laki/laki`). No backports. Builds from source (Intel, Linux) are best effort.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: on
[igorkasyanchuk/laki](https://github.com/igorkasyanchuk/laki), **Security › Report a vulnerability**.
Please don't open a public issue.

Laki is a one-person project: there's no bounty, and no promise of a reply or of a fix by a date.

What helps a report:

- the Laki version (Laki › About Laki) and macOS or Linux version;
- what an attacker needs (a web page you visit, a repo or PR you open, a link, the same Mac user…);
- steps to reproduce, or a proof of concept;
- what they get (read a file, run a command, reach the daemon, a privacy grant…).

## Threat model

Laki runs on one person's computer. Its daemon listens on 127.0.0.1 only, behind a 256-bit token (`daemon.json`,
0600) and Origin and Host allow-lists. An agent in a tab can read that token too, so it says nothing of who calls: the
daemon tells an agent's calls from yours by the calling process (the tab whose process tree or terminal it runs in:
lsof and ps, /proc on Linux), whatever Origin it sends. Only two callers in no tab are you: the app (its window and its
own calls carry a second token the daemon hands the app alone, never written to disk) and a process with a terminal of
its own that isn't a Laki tab's (your Terminal, an editor's, an ssh session). Anything else in no tab (an agent's
process that left its tab with `setsid`, a launchd job) is refused what's yours, as a call the daemon can't place is (it
fails closed). Extensions an agent
makes, restores or links stay off until you look at what they run, and go off again as their files change.

In scope:

- web pages and the network reaching the daemon or the app;
- repos, PRs, forks, issues and their text that you open in Laki;
- text an agent reads turning into actions beyond what you approved (another workspace, an extension, a schedule);
- remote access, tunnels (Expose to the world) and shared tabs.

Out of scope:

- malware already running as your user: it can read `daemon.json`. Laki shouldn't hand it new privacy grants
  (camera, screen, Accessibility), though;
- an agent doing what its own permission mode allows;
- a repo's `.laki.json`, workflows and extensions after you trust (allow) them.

### Auto-answer rules

A project's auto-answer rules (Settings › the project, or *Always allow in this project* on an ask's card) answer a
matching permission ask Allow for every agent there, the way your click would. Only you can add or change them: an
agent's call and remote access's page are refused, and a managed policy's `"allowRules": false` turns them off. A Bash
rule matches a command that starts with its words (or fits its `*`); a file rule (Edit, Write, MultiEdit, Read) a path
glob inside the worktree. A fixed list wins over any rule: a command that deletes, force pushes, rewrites history, runs
as root or pipes the web into a shell, one chained with `;`, `&&`, `|`, a redirect or a substitution, a path outside
the worktree, a question, a plan to approve, a secret and an ask cut short are always asked. Each answer is in
`daemon.log` with its rule. A rule is only as narrow as you write it: `npm test` lets an agent run whatever the
project's test script is, which the agent can edit.

## Known limits

- Any program running as your user can read daemon.json's token (`ponytail:` in `src/daemon/main.ts`). A process an
  agent starts that leaves its tab's tree and its terminal (`setsid`, `launchctl submit`) is refused what asks who calls;
  one that then gives itself a terminal of its own (`script`, `expect`, a tmux server it starts, `open x.command`)
  still counts as yours. A double fork keeps the tab's terminal, so it's the tab's. A user per agent would close that.
- The app's token goes to a daemon's starter on a pipe, or to a running daemon's app after a check that it's Laki's
  own window process on the daemon's binary (LaunchServices says it finished launching): a native addon loaded into
  Electron run as node could pass that check (the runAsNode fuse below).
- `laki` from a launchd or cron job, or `laki mcp` run by another app, has no terminal: what asks who calls is refused.
- Gates (an extension's `gate`) are a team rule, not a sandbox: they hold Laki's ship, merge and archive, but an
  agent with a shell can still run `gh pr merge` or `git push` itself. Its permission mode is what stops that.
- An agent's `laki send` reaches agents, or a terminal of its own workspace; what runs in that terminal then counts as
  the agent's until you type there yourself.
- A repo's extension isn't trusted as its `node_modules/` (its installed packages) or what widget.json's `state`
  names: code it runs from there can change without turning it off.
- An agent can still change most settings (Global memory, PR prompts, actions, Laki AI's; not env, profiles, the
  phone webhook, extension folders, what Open in editor runs, *When everything is done*, the Done check, Recording
  mode and what it hides, *Guess my next prompt*, keep awake, how long storage files, archived workspaces and pasted
  images are kept, memory's compaction, updates, the background picture, or reset the interface, nor a project's
  scripts, env, trust or memory list), and ask Laki AI,
  which then acts with that agent's rights, in a chat of that tab's own (never yours: it can't read, open or delete your chats), but not in an extension's page chat.
  The view an agent or the remote page reads has no remote access link or PIN, phone webhook or env values. It can't import worktrees either (a delete removes their
  folder); an imported one's folder is removed only by `git worktree remove`, which checks it's that repo's.
- A tab's state (its hooks: a turn's start and end, a tool call) is taken with that tab's own key (`LAKI_HOOK`, new each
  start), or from a process of that tab or of none. The key is in the agent's environment, which another process of
  yours can read: it keeps an agent from reporting another tab's turns by name, not a determined one.
- An extension that's on stays on when Laki AI rewrites it only from its own page chat (the extension's *Edit* chat,
  which an agent can't ask in). Changed anywhere else (Laki AI's other chats, an agent, an MCP client), it turns off,
  and loses network access, once what it runs changes.
- Releases (since 0.25.0) are signed with a Developer ID, with the hardened runtime, and notarized. A build from
  source (`npm run pack`) is ad-hoc signed: macOS asks you to allow it once (Privacy & Security › Open Anyway; the
  guide's [Install](docs/guide.md#install)).
- Electron's cookie encryption fuse is off: turned on, the Keychain prompt keeps the window from reaching the daemon.
- Electron's `runAsNode` fuse is on (the daemon, the CLI, hooks and MCP run as Electron's node): any program running as
  you can run its own JavaScript inside Laki's signed binary (`ELECTRON_RUN_AS_NODE=1`) and borrow the privacy grants
  you gave Laki (Screen Recording, Accessibility, the microphone, Keychain items allowed to Laki). The `--inspect` and
  `NODE_OPTIONS` fuses are off and Chromium's debugging switches are refused, but that one stays until the planned fix:
  the daemon, CLI and hooks on a helper binary of their own, with the app's binary's fuse off.
- A public tunnel (Expose to the world, *anyone with the link*) comes back after Laki restarts or updates, at a new
  address, until its time runs out or you stop it. A permanent tunnel (your own domain) has no lock of Laki's: protect
  it with Cloudflare Access, as Settings › Tunnels says.
- Remote access with no email or PIN (*anyone with the link*) is only as safe as the link: 24 hours at most, and the
  link works once.
- An extension's https picture comes through the daemon from a public site, judged by its name: a name that resolves
  to this Mac or your network still goes (`ponytail:` in `src/daemon/main.ts`).

## No telemetry

Laki sends no analytics and no crash reports. With nothing set up, it calls:

- Nothing for plan limits: they come from what Claude Code (its status line) and Codex (its session files) report
  themselves. Anthropic (`api.anthropic.com`), OpenAI (`chatgpt.com`) and Google are asked, with the agent's own sign-in,
  only once you turn that agent's *Ask … for plan limits* on (Settings › Appearance): undocumented endpoints;
- GitHub, through your `gh`: PRs, checks, reviews;
- GitHub's avatars (`avatars.githubusercontent.com`): PR authors' pictures (Settings › Appearance › GitHub pictures);
- GitHub's API (`api.github.com`), every 4 hours: whether a newer release is out (Settings › General › Updates turns
  it off). It sends what any web request does (your IP address, and Laki's version as its user agent), nothing
  else.

Everything else only when you set it up or click it: Laki AI and Voice (OpenRouter), phone pushes (your webhook),
Cloudflare or Tailscale (remote access, tunnels, shared tabs), memes (Reddit), a video (YouTube), an extension's own
fetches. One more is on by default: with Laki AI able to answer (an OpenRouter key, or Claude or Codex as its
backend), each project's memories learned by agents (never yours) go to that model every 7 days, or as the list fills,
to be compacted (Settings › Global memory › *On its own*; turn it off there, or Laki AI off in Settings › AI).
