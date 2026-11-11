# Trust: what Laki keeps, what it sends, and who makes it

Laki has no account, no sign-up and no telemetry. It runs the coding agents you already have, signed in as you are,
on your computer. This page says what stays there, every place Laki itself connects to (built from the code, and
checked against it by `test/trust.test.ts`), how to check the build you run, and who maintains it.

## What stays on your machine

| What | Where |
|---|---|
| Your code | Your repositories and the worktrees Laki makes for them (`~/.laki/worktrees/<project>/…`, or the folder you pick in Settings or the project's). Laki uploads none of it; `git push` and `gh` send what you ship |
| Laki's state: projects, workspaces, tabs, settings, workflows' runs, the queue | The data folder, `~/.laki` (`$LAKI_HOME` when set; `~/.laki-electron` from older installs): `state.json`, `daemon.json` (the daemon's port and token, 0600) |
| Terminals' scrollback, kept turns, pasted images, notes, specs, prompts | The data folder: `turns/`, `images/`, `notes/`, `plans/`, `prompts.json`, `files/`, `storage/` |
| Your workflows, extensions and their data | The data folder: `workflows/` (with `workflow-history/`, `workflow-trash/`), `widgets/`, `widget-data/`; a project's own in its repo's `.laki/` |
| Agents' transcripts | Where each agent writes them (`~/.claude/projects/…`, `~/.codex/sessions/…`): Laki reads them for the context and cost meters and the Reader, never copies them elsewhere |
| Today's and each day's token use and cost | The data folder: `usage-today.json`, `usage-days.json` |
| Laki AI's chats and its call log | The data folder: `ai-chats/`, `ai-chat.json`, `ai-calls.jsonl` |
| Secrets you give Laki (the OpenRouter key, `laki secret` answers, extensions' secrets) | 0600 files in the data folder (`ai-key`, `widget-secrets.json`, a secret's own file) |
| Logs | The data folder: `daemon.log`, `ptyhost.log`, `script-logs/` |
| The window's place and the Dock icon | Electron's own folder (`~/Library/Application Support/Laki`) |

Laki never writes `~/.claude/settings.json` or `~/.codex/*`: agents get Laki's settings through command-line flags.
The daemon listens on 127.0.0.1 only, behind its token and an Origin check ([SECURITY.md](../SECURITY.md)).

## Every network destination

What Laki itself connects to. The agents you run (Claude Code, Codex, Gemini CLI, Grok, OpenCode) talk to their own
providers on their own; Laki starts them and reads their screens, it doesn't relay their traffic.

### With nothing set up

| Host | What is sent | When | How to turn it off |
|---|---|---|---|
| `api.github.com` | A request for the latest release of `igorkasyanchuk/laki-releases`: your IP address and Laki's user agent, nothing else | At launch, then every 4 hours | Settings › General › Updates |
| `github.com` (and the release asset it redirects to) | The update's download: what any download sends | Only when you install an update (a signed Mac: Squirrel downloads it) | Don't install it; Updates off |
| `avatars.githubusercontent.com` | A GitHub login in the URL, to draw a PR author's picture | When a PR panel or a widget shows one | Settings › Appearance › GitHub pictures |
| GitHub, through your `gh` | What `gh` sends, as you: PRs, checks, reviews, issues, codespaces of the repos you add | While a workspace has a branch on GitHub (the PR scans), and as you act | Don't sign `gh` in, or use projects without a GitHub remote |
| Your git remotes, through `git` | `git fetch` and `git push`, as you | New worktrees fetch their base; Ship pushes | Projects without a remote |

### Only when you set it up or click it

| Host | What is sent | When | How to turn it off |
|---|---|---|---|
| `openrouter.ai` | Laki AI's chat, an AI call or decision block's prompt, Voice's recording, a project's agent-learned memories for compaction, the last answer for *Guess my next prompt* | Once you add an OpenRouter key (Settings › AI), as each of those runs | Remove the key; Laki AI off; each feature's own switch (Voice, *On its own* compaction, *Guess my next prompt*) |
| `api.anthropic.com` | Claude Code's own sign-in token, asking for your plan's limits (an undocumented endpoint) | At most every 7.5 minutes, only with *Ask api.anthropic.com for Claude Code's plan limits* on (Settings › Appearance) | That switch (off unless you turn it on) |
| `chatgpt.com` | Codex's own sign-in token, asking for your plan's limits (an undocumented endpoint); `api.openai.com` is only a claim name read from that token, never contacted | At most every 5 minutes, only with *Ask chatgpt.com for Codex's plan limits* on | That switch |
| `oauth2.googleapis.com`, `cloudcode-pa.googleapis.com` | Gemini CLI's own sign-in (its token renewed, then its quota asked) | At most every 5 minutes, only with *Ask Google for Gemini CLI's plan limits* on | That switch |
| Your phone push URL: `ntfy.sh` (or your own ntfy server), `api.telegram.org`, `hooks.slack.com`, any JSON webhook | A push's title, its workspace's name, the question and its choices (secrets masked); ntfy and Telegram are also read for your answer taps | When an agent or a workflow needs you, a run ends, a reminder is due (Settings › Phone pushes) | Clear the webhook |
| Your phone's push service: `fcm.googleapis.com` (Chrome), `web.push.apple.com` (Safari), `updates.push.services.mozilla.com` (Firefox), `*.notify.windows.com` (Edge) | A notification encrypted on your Mac for that phone alone (RFC 8291): the service sees its size and time, not its words | Only with Phone pushes set to *This phone (Web Push)*, for paired phones that turned notifications on | Phone pushes' format, or the phone's own notification settings |
| Cloudflare (`cloudflared`: `*.trycloudflare.com` quick tunnels, or your named tunnel) | Remote access's page and its traffic, a tunnel to a dev server, a shared tab's view | Only while remote access, a tunnel or a share runs | Stop it (it ends on its own when its time is up) |
| Tailscale (`tailscale serve` or `funnel`) | The same, on your tailnet (`tailscale.com` is only the install link) | Only while remote access over Tailscale runs | Stop it |
| `www.reddit.com`, `meme-api.com` | A request for r/memes, r/ProgrammerHumor or r/wholesomememes' hot posts; then the picture's own host | Only when you click for a meme | Don't click it |
| `www.youtube-nocookie.com` | The video you add to the sidebar, with `https://dev.laki.app/` as its Referer (YouTube's rule for apps: Laki sends nothing to that name) | Only while that video shows | Remove the video |
| `duckduckgo.com` | Words you type into a Browsers page's address bar that aren't an address | Only then | Type an address |
| `accounts.google.com` | Google's sign-in in a Browsers page (Laki sends it a Firefox user agent so it works); its *continue* page opens in your browser | Only when a page you open signs in with Google | Don't sign in there |
| `fonts.googleapis.com`, `fonts.gstatic.com` | A spec's prototype page (agent-written HTML in a sandbox) may load Google Fonts | Only when you open such a prototype | Don't open it |
| Any https site | An extension's own source URL, a JS extension's page with *Network access*, a workflow's webhook block, an MCP server's App page (from your Claude config), an extension's https picture (through the daemon), and every page you or an agent open in the Preview, a Browsers page or the agent browser | Only when you turn that extension on, give it network access, run that workflow, or open that page | Turn the extension off or its network access off, edit the workflow |
| Your SSH hosts, codespaces | Your ssh connection, as you | Only for projects on an SSH host or a cloud workspace | Don't add them |
| GitLab, through your `glab` | What `glab` sends, as you | Only for projects whose origin is on GitLab | Don't sign `glab` in |

### In the code, but never contacted by Laki

These appear in Laki's source as links you click, text shown to you, samples or examples:

- Links that open in your browser when you click them: `laki.sh` (About), `github.com` (the repo, issues, PRs),
  `raw.githubusercontent.com` (the widget schema's address for editors), `tailscale.com` (its download page),
  `docs.claude.com`, `claude.ai`, `opencode.ai` (an agent's install command and docs, shown for you to run),
  `www.youtube.com`, `youtu.be` (forms of a video's address), `openfontlicense.org` (the fonts' licence).
- `dev.laki.app`: only a name in the Referer header YouTube's embed asks of apps; nothing is sent to it.
- Push formats' placeholders in Settings: `ntfy.sh`, `api.telegram.org`, `hooks.slack.com`, `example.com`.
- The UI kit's and starters' sample data: `linear.app`, `vercel.com`, `sentry.io`, `picsum.photos`,
  `opengraph.githubassets.com`, `status.example.com`, `staging.example.com`, `dash.example.com`, `api.example.com`,
  `api.acme.com`, `shop-git-fix.vercel.app`.

## No account, no telemetry

Laki has no account and no server of its own: nothing to sign up for, no license key, nothing that stops working if
laki.sh goes away. It sends no analytics, no usage pings and no crash reports.

To check it yourself:

- The lists above are the whole of it, and `test/trust.test.ts` fails when an https host in `src/` isn't on this page.
- `package.json`'s `dependencies` are four packages (node-pty, xterm's headless and serialize addons, ws), none of
  them an analytics or crash-reporting library; the renderer's are in `devDependencies` and bundled.
- Watch it: a firewall that asks per connection (Little Snitch, LuLu) shows every host the app and its daemon reach.

## Verify the build

Releases (0.25.0 and later) on [igorkasyanchuk/laki-releases](https://github.com/igorkasyanchuk/laki-releases) are
signed with a Developer ID, built with the hardened runtime, and notarized by Apple. To check the app you have:

```bash
codesign --verify --deep --strict --verbose=2 /Applications/Laki.app
```

```bash
spctl --assess --type execute --verbose=4 /Applications/Laki.app   # "source=Notarized Developer ID"
```

```bash
codesign -dv --verbose=4 /Applications/Laki.app 2>&1 | grep -E 'Authority|TeamIdentifier'
```

```bash
npx @electron/fuses read --app /Applications/Laki.app
```

The fuses: `--inspect` and `NODE_OPTIONS` are off, and Chromium's remote-debugging switches make it quit. Their limit,
said plainly: the `runAsNode` fuse stays on, because the daemon, the CLI, hooks and the MCP server run as Electron's
node. So any program running as you can run its own JavaScript inside Laki's signed binary and borrow the privacy
grants you gave Laki (Screen Recording, Accessibility, the microphone). The planned fix is a helper binary of their own
for those, with the app's fuse off ([SECURITY.md › Known limits](../SECURITY.md#known-limits)). A build from source
(`npm run pack`) is ad-hoc signed and not notarized: macOS asks you to allow it once.

## Who maintains Laki

- **Maintainer**: Igor Kasyanchuk, on his own: a one-person project, MIT licensed ([LICENSE](../LICENSE)).
- **Releases**: often, several a week (48 from 0.1.0 on Oct 5, 2026 to 0.48.0 on Nov 11, 2026). Each one's notes are
  in [docs/release-notes.md](release-notes.md) and Settings › Release notes.
- **Channels**: the dmg on [GitHub Releases](https://github.com/igorkasyanchuk/laki-releases/releases), Homebrew
  (`brew install --cask igorkasyanchuk/laki/laki`), and the app's own update (Settings › General › Updates). Only the
  latest release is supported.
- **Security reports**: privately, through GitHub's vulnerability reporting, as [SECURITY.md](../SECURITY.md) says; no
  bounty, and no promise of a reply by a date.

### Roadmap

Where Laki is going next (the maintainer's call; it moves as releases do):

- **A tighter binary**: the daemon, CLI and hooks on a helper binary of their own, so the app's `runAsNode` fuse can
  be turned off.
- **The phone as an app**: remote access's page installable on a phone's home screen, with notifications that answer
  an agent.
- **Linux out of preview**: the AppImage tested and supported as macOS is.
