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
0600) and Origin and Host allow-lists. An agent in a tab can read that token too, so the daemon tells an agent's calls
from yours by the calling process (the tab whose process tree it runs in: lsof and ps, /proc on Linux), whatever
Origin it sends, the app's included; a local call it can't place is refused (it fails closed). Extensions an agent
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

## Known limits

- Any program running as your user can read the daemon's token (`ponytail:` in `src/daemon/main.ts`), and a process
  an agent starts that leaves both its tab's process tree and its terminal (`setsid`, `launchctl submit`,
  `open x.command`, a tmux server) counts as yours: per-tab tokens would close that. A double fork keeps the tab's
  terminal, so it's the tab's.
- Gates (an extension's `gate`) are a team rule, not a sandbox: they hold Laki's ship, merge and archive, but an
  agent with a shell can still run `gh pr merge` or `git push` itself. Its permission mode is what stops that.
- An agent's `laki send` reaches agents, or a terminal of its own workspace; what runs in that terminal then counts as
  the agent's until you type there yourself.
- A repo's extension isn't trusted as its `node_modules/` (its installed packages) or what widget.json's `state`
  names: code it runs from there can change without turning it off.
- An agent can still change most settings (Global memory, PR prompts, actions, Laki AI's; not env, profiles, the
  phone webhook or extension folders, nor a project's scripts, env, trust or memory list), and ask Laki AI, which acts
  as you.
- Releases are signed with a Developer ID and notarized. A build from source is ad-hoc signed: macOS asks you to
  allow it once (Privacy & Security › Open Anyway).
- Electron's cookie encryption fuse is off: turned on, the Keychain prompt keeps the window from reaching the daemon.
- A public tunnel (Expose to the world, *anyone with the link*) comes back after Laki restarts or updates, at a new
  address, until its time runs out or you stop it. A permanent tunnel (your own domain) has no lock of Laki's: protect
  it with Cloudflare Access, as Settings › Tunnels says.
- Remote access with no email or PIN (*anyone with the link*) is only as safe as the link: 24 hours at most, and the
  link works once.
- An extension's https picture comes through the daemon from a public site, judged by its name: a name that resolves
  to this Mac or your network still goes (`ponytail:` in `src/daemon/main.ts`).

## No telemetry

Laki sends no analytics and no crash reports. With nothing set up, it calls:

- Anthropic (`api.anthropic.com`) and OpenAI (`chatgpt.com`): your Claude and Codex plan limits, with the agents' own
  sign-in (Settings › Appearance turns each off);
- GitHub, through your `gh`: PRs, checks, reviews;
- GitHub's avatars (`avatars.githubusercontent.com`): PR authors' pictures (Settings › Appearance › GitHub pictures);
- GitHub's API (`api.github.com`), every 4 hours: whether a newer release is out (Settings › General › Updates turns
  it off). It sends what any web request does (your IP address, and Laki's version as its user agent), nothing
  else.

Everything else only when you set it up or click it: Laki AI and Voice (OpenRouter), phone pushes (your webhook),
Cloudflare or Tailscale (remote access, tunnels, shared tabs), memes (Reddit), a video (YouTube), an extension's own
fetches. A saved OpenRouter key or a Laki AI backend alone sends no memories: compacting agents' learned ones in the
background (Settings › Global memory › *On its own*) runs only once you turn it on.
