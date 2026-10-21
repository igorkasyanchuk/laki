# Security

## Supported versions

The latest release only: the dmg (and AppImage) on
[igorkasyanchuk/laki-releases](https://github.com/igorkasyanchuk/laki-releases). No backports.

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
0600) and Origin and Host allow-lists.

In scope:

- web pages and the network reaching the daemon or the app;
- repos, PRs, forks, issues and their text that you open in Laki;
- text an agent reads turning into actions beyond what you approved (another workspace, an extension, a schedule);
- remote access, tunnels (Expose to the world) and shared tabs.

Out of scope:

- malware already running as your user: it can read `daemon.json`. Laki shouldn't hand it new privacy grants
  (camera, screen, Accessibility), though;
- an agent doing what its own permission mode allows;
- a repo's `.laki.json` and extensions after you trust them.

## Known limits

- Any program running as your user can read the daemon's token (`ponytail:` in `src/daemon/main.ts`).
- The app is ad-hoc signed, not notarized: macOS asks you to allow it once (Privacy & Security › Open Anyway).
- Electron's cookie encryption fuse is off: turned on, the Keychain prompt keeps the window from reaching the daemon.
- Remote access with no email or PIN (*anyone with the link*) is only as safe as the link: 24 hours at most, and the
  link works once.

## No telemetry

Laki sends no analytics and no crash reports. With nothing set up, it calls:

- Anthropic (`api.anthropic.com`) and OpenAI (`chatgpt.com`): your Claude and Codex plan limits, with the agents' own
  sign-in (Settings › Appearance turns each off);
- GitHub, through your `gh`: PRs, checks, reviews;
- GitHub's avatars (`avatars.githubusercontent.com`): PR authors' pictures (Settings › Appearance › GitHub pictures).

Everything else only when you set it up or click it: Laki AI and Voice (OpenRouter), phone pushes (your webhook),
Cloudflare or Tailscale (remote access, tunnels, shared tabs), memes (Reddit), a video (YouTube), an extension's own
fetches.
