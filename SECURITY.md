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
0600) and Origin and Host allow-lists. The app's pages load from `app://laki`, a scheme Laki serves from its own
bundle, so their Content Security Policy runs only the app's own scripts, never a file an agent wrote. An agent in a tab can read that token too, so it says nothing of who calls: the
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

### Workflows: text from outside in an agent's prompt

A workflow's agent block or AI call that uses text from outside Laki (an issue's title or body from GitHub, a webhook's
JSON, an extension's or an agent's event, the agent's own words in Laki's events, a command's output, a CI log) gets
it fenced under a line saying whose it is and that it's data, never instructions; a single plain word (a number, a
branch, a URL) stays inline. A command gets the same values through its environment, never as code. The editor says
when such text goes to an agent that acts without asking.

### Scheduled tasks on events

A task on a GitHub event (CI failing, a PR, an issue, a push) gets the event's title in its prompt only fenced, under a
line saying it's the outsider's text and data, never inline; its URL, number and branch only when they're plain
(letters, digits, `/:.#-` and the like). A fork's PR, or a CI run of one, starts nothing: its run is held until you
click *Run it* (an agent can't). At least 30 minutes between a task's runs and 10 a day, by default.

### Remote access: devices and PINs

At a stable address (Tailscale, or My domain on your named tunnel) a page that opens remote access's link (and its PIN)
is paired: the daemon sets a device token of its own (32 random bytes) in an `HttpOnly`, `Secure`, `SameSite=Strict`
cookie on that origin, keeps only its SHA-256 hash (with a name from the user agent, when it was added and last seen,
until when: 30 days unless you pick 1 to 90), and lets in a socket or a call that brings it from that origin only (the
Origin check as ever). A link opens once; *Add a device* makes another, good for 10 minutes. Revoke drops a device's
connections at once; a stop keeps the devices (nothing connects while it's off), *Forget devices* clears them. A new
device is told on the Mac. A quick tunnel's page keeps one tab's token instead (its address changes each start). The
page's token and the device tokens are never in the view, a log or `state.json` in clear.

Wrong PINs no longer stop remote access by default (*After wrong PINs* › *Wait*; *Stop* is as before, so anyone with
the link could end it for you): after the tries (2 unless you pick 1 to 10), no PIN is taken for 1 minute, then 5,
then 30 each time, counted per start. Each wrong PIN and each wait is logged and told on the Mac with the address the
tunnel reports (`CF-Connecting-IP`, Tailscale's login: shown, never trusted). 20 wrong PINs in a day stop it anyway: at 2
tries per wait and waits of 1, 5, 30, 30… minutes that's under 100 guesses a day without the cap, and with it at most 20
a start out of 10^6 PINs (1 in 50,000), and only the Mac starts it again (a new PIN). Paired devices aren't affected.

A paired device can add a passkey (on by default; Settings › Remote access › *Unlock with a passkey*), offered only in
the 10 minutes after it pairs. Then every page it opens is locked until Face ID, Touch ID or the device's code signs a
fresh challenge (32 random bytes, used once, 60 seconds), and again after 15 idle minutes (or only on open): a locked
page gets no state, no events and no calls but the unlock's, and its cookie alone is refused on `/rpc` (423). So a
stolen cookie, or a phone left unlocked with Laki open, no longer means access. The daemon checks the WebAuthn answer
with node:crypto: ES256 only, user verification required, the challenge, the page's origin, the site's hash, a
signature by the kept public key, and a sign counter that never goes back. Registration takes the public key the
browser reports (attestation *none*) rather than the authenticator's signed statement: what makes it trusted is that
only a device that just paired (with the link and PIN) can register one, on Laki's own page. *Use PIN instead* stays
unless you turn off *Allow the PIN instead*; a wrong one counts as on the link's page. The passkey is the device's;
Laki keeps only its public key, never in the view.

### Remote access: end to end

The tunnel's provider (Cloudflare, Tailscale) ends TLS, so without more it could read and log everything the phone and
the Mac say. Remote access's socket and its `/rpc` are sealed between the page and the daemon (S14, `src/daemon/e2e.ts`,
`src/renderer/src/e2e.ts`): each connection's key is HKDF-SHA-256 of a secret with a salt the daemon sends as it opens;
each frame is AES-256-GCM with its own counter (a repeated or lower one closes the socket; a `/rpc` salt seen in the last
10 minutes is refused). The secret is the link's `#k=` (a browser never sends the hash), or for a paired device a key
of its own the daemon gives it inside its first sealed socket, which the page keeps in IndexedDB as a key it can't read
back, and the daemon keeps wrapped with the device's cookie (state.json has neither the cookie nor the key in clear). A
page from before this, or a call in clear, is refused with *open a new link*. The passkey unlock and Answer only apply
to what's opened, as before. Still in clear through the tunnel: the page's files, `/pin` (the link's token and the PIN:
neither seals anything) and `/push`.

### Remote access: answer only

*Answer only* (Settings › Remote access, for a link's page and each device as it pairs; Devices › *Answer only* for
each one) lets a phone read everything Laki shows, answer asks, message an agent, start a new agent on a profile and
set reminders, and nothing else: no typing in a terminal, no message to a shell, no merge, ship, archive or delete, no
command, no mode that never asks, no settings. It's an allowlist the daemon checks on every call (a method no one has
classified is refused; the daemon won't start with one), set on the Mac only. Laki AI asked from such a phone acts with
the phone's rights, not the Mac's. A message to an agent can't start with `!` (the agents' shell mode). The agent
itself still works in its own mode: what you ask it to do, and the asks you allow from the phone, it does as it would on
the Mac. *Full* is as before: everything but what never goes over remote access. That list is classified too: every
method is marked as a phone's or not (the daemon won't start with one nobody placed), and a phone at Full can't change
accounts, reset settings, send a test push, clone a repository, change an extension's files or move Laki's clock.

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

- Remote access end to end stops a tunnel's provider from reading and logging what's said, not from changing it: the
  page's own code is still served through the tunnel, so a provider that rewrites that script could read what the page
  sees. A paired device's page that came from a link before S14 has no key of its own: Add a device again.
- Any program running as your user can read daemon.json's token (`ponytail:` in `src/daemon/main.ts`). A process an
  agent starts that leaves its tab's tree and its terminal (`setsid`, `launchctl submit`) is refused what asks who calls;
  one that then gives itself a terminal of its own (`script`, `expect`, a tmux server it starts, `open x.command`)
  is no longer yours by that alone: a terminal Laki hasn't seen is held until you pick *Allow this terminal* in Laki's
  window (once per terminal, until its shell exits; the card names the terminal and what started it), and refused when
  no window is open or you say Deny. The terminal that started the daemon is allowed from the start. What's left: you
  can allow the wrong one (an agent's pty looks like a terminal you just opened: Deny when you ran nothing there), and
  with no window open (headless) only the starting terminal works. A double fork keeps the tab's terminal, so it's the
  tab's. A user per agent would close that.
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
- Electron's `runAsNode` fuse is off on Laki's own binary: no program can run its JavaScript inside it
  (`ELECTRON_RUN_AS_NODE=1`) to borrow the privacy grants you gave Laki. The daemon, the CLI, hooks and MCP run on Laki
  Node, a binary of its own in the bundle (its own bundle id, no privacy usage strings) that does run as node: anything
  started on it directly gets none of Laki's grants, but the Keychain items Laki Node itself may read (none today) and
  what the daemon does for the app (started by the app, it is Laki's to macOS) are its. The `--inspect` and
  `NODE_OPTIONS` fuses are off on both, and Chromium's debugging switches are refused. On Linux (a preview) there are
  no per-binary grants; `laki-node` beside `laki` is the same split.
- A public tunnel (Expose to the world, *anyone with the link*) comes back after Laki restarts or updates, at a new
  address, until its time runs out or you stop it. A permanent tunnel (your own domain) has no lock of Laki's: protect
  it with Cloudflare Access, as Settings › Tunnels says.
- Remote access with no email or PIN (*anyone with the link*) is only as safe as the link: 24 hours at most, and the
  link works once. Remote access comes back after Laki restarts or its tunnel drops, until its time runs out or you
  stop it; a quick tunnel's at a new address, with a new link.
- My domain (remote access on your named tunnel) has only Laki's PIN unless you add a Cloudflare Access policy for its
  hostname in Cloudflare's dashboard: cloudflared can't set one.
- An extension's https picture comes through the daemon from a public site, judged by its name: a name that resolves
  to this Mac or your network still goes (`ponytail:` in `src/daemon/main.ts`).

## No telemetry

Laki sends no analytics and no crash reports. [docs/trust.md](docs/trust.md) lists every host it connects to, what
stays on your Mac and how to verify the build. With nothing set up, it calls:

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
