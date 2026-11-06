# SSH hosts, tunnels and remote access: how they work

### SSH hosts

A project with `host` (`projectAdd` `host:path`, `REMOTE` in `shared/types.ts`: a `~/.ssh/config` name or
`user@host`; `hostProjectAdd`) is a folder on that machine; its workspaces copy `host`. `hosts.ts`' SSH hosts section:

- One connection per host (`hostUp`, `connect`): a ControlMaster the daemon spawns (`-M -N`, socket at
  `<data>/ssh/<hash>`, `BatchMode`: keys or agent, no prompts; a failure stands 10 s), then `$HOME` and the login
  shell's PATH there, then `hostFiles` (heredocs over `sh -s`) puts `~/.laki-host/<mac>/` (`mac()`: the hostname when
  first asked, kept in `<data>/ssh/mac`, since macOS's changes with the network): the `hook` script
  and the agents' hook files (`hookFiles`, as here, their command `<dir>/hook <state>`). Its `exit` drops it: the next
  use connects again. `stopHosts` at shutdown.
- `exec(at, cmd, args)` / `git(at, …)`: here, or `ssh host 'export PATH=…; cd <path> && exec <cmd>'` through the
  master. Every git and gh call takes an `At` (a project or workspace). `sshIn` sends a script or a file on stdin
  (never on a command line: `ps` there shows those). Both go 8 at a time per host (`slot`): sshd takes 10 sessions
  per connection (MaxSessions).
- A tab (`spawnTab` → `hostTab`): its PTY here runs a `/bin/sh` that waits for `<run>/<key>.go` (or prints
  `<key>.err`), then `ssh -tt … 'exec sh ~/.laki-host/<mac>/run/<key>.sh'` on a connection of its own (`TAB_SSH`:
  not the master's sessions; `spaced`: 300 ms apart per host, sshd's MaxStartups drops handshakes past 10). Meanwhile the daemon puts that script
  there: `rm -f "$0"`, `LAKI_TTY=$(tty)`, the folder, `lakiEnv` exported (with `LAKI_HOOK`, a key per start), then
  `exec "$SHELL" -lic <cmd>`. A shell that loses its connection (255) stays; Enter starts it again, like an agent.
- Hooks: the host's `hook` prints `OSC 7717 ; <key> ; <state> ; <base64 JSON> BEL` to `$LAKI_TTY`; the Session's
  headless terminal (`onHook`) hands it to `hook()` when the key is this start's (`running` sends `{}`: PreToolUse's
  payload holds whole files). Nothing listens on the host, and nothing there reaches the daemon.
- `forward`: each live workspace's `$PORT` (`ssh -O forward -L port:localhost:port`) when the host connects and in
  `wsNew`/`wsRestore`; cancelled in `teardown`.
- `.laki.json` there: `hostCfg` (null: none), the project's folder's, read by `readHostCfg`/`readHostCfgs` (project add, `wsNew`, `wsRestore`,
  a tab's start when not read yet, each PR scan: `hostSync`, which also follows the branch); `projectConfig` reads the
  cache. `wsArchive` needs the host up (teardown there would fail quietly); `diff` gets new files' diffs in one call.
- `toHost` copies the images a prompt or `send` names (`<data>/images/…`) to the host and rewrites their paths, and
  attached files by their folder (`<data>/files/<id>/`: the one file in it to the same name there, only the folder
  rewritten, so a quoted name with spaces stays whole) (`textFor`, `typeInto` takes a promise). `files`, `fileRead` (`hostFileRead`: base64), `fileNew`, `diff`, stats run
  there; `openIn` opens `vscode|cursor|windsurf://vscode-remote/ssh-remote+<host><path>`, other apps refuse.
- Not there (ponytail): `copyIncludes`, port scans (`scanPorts` sees none), new files' lines in `stat`, a local
  workspace's branch sync, the agent skill. Tested with `test/fakes/ssh` (every host is this machine; `nohost`
  refuses) in `test/ssh.test.ts`.
- `-F <data>/ssh/config` (`codespace.ts` `sshF`: once the file is there, on `sshOpts`, the master's spawn and a tab's
  ssh line): `<data>/ssh/codespaces/*` first (ssh takes an option's first value: a `Host *` of yours never wins over a
  codespace's own; they name only `laki-cs-*`), then `Include ~/.ssh/config`, `/etc/ssh/ssh_config` (-F reads neither),
  so plain hosts read as before.
- Cloud workspaces (`settings.cloud`, on unless false; `hosts.ts`' cloud section, `daemon/codespace.ts`: gh on this Mac): a
  workspace of a local GitHub project (`origin`, `ghRepo`) with a host of its own, `codespace` its codespace's name ('' while
  made), `csState` (gh's word; `Creating`, `Failed` with `csError`). `wsNew` `codespace` (a machine type, '': the repo's
  first; `cloudCheck`: the setting (`false`: off), not an agent's (`from`: GitHub bills it), not a host's or a folder's, not Local, a
  PR or a race) asks `machines` (`gh api repos/<o/r>/codespaces/machines`: the scope, the repo and the type, at once;
  each one's `cpus`, `memory`, `storage` and `perHour` at `CORE_HOUR`, GitHub's price read by hand; `csMachines`, the
  new-workspace page's *In a codespace* picker, asked as the page opens with it picked: `SCOPE` shown with a Copy of
  its fix; offered only for a project the view marks `github`, core.ts' `onGitHub` reading `.git/config`'s origin;
  doctor's `ghCodespace`, the token's scopes by `gh auth status`: Get started's optional line), then answers with the workspace (`cloudNew`: host
  `laki-cs-<id>`, path `<CS_ROOT>/<repo>`, `/workspaces` unless `LAKI_CS_ROOT`, tests'; branch `laki/<id>` off the base),
  while `csMake` (`making`) runs `gh codespace create -R -b -m --default-permissions`, waits for Available (`until`),
  writes its Host entry (`gh codespace ssh --config`, its `Host` line renamed: `sshEntry`) and makes the branch there (a
  one-off ssh, with the folders of what `.worktreeinclude` names: `includes`, each a file up to 1 MB in the repo, copied
  by `gh codespace cp -e` before it's Available, so before setup; each one in its Logs), then connects. `connect` waits for it (`csUp`: made or its `csError`; a stopped one started:
  `gh api -X POST user/codespaces/<name>/start`, then `until`), so its tabs wait in `hostTab` and print why it failed.
  `away` (made, stopped or not connected: `live`) keeps scans off it (PRs, `stat`, `wsPeek`): none wakes it.
  `csRefresh` (`gh codespace list`, with each `scanPRs` and as its master exits) keeps `csState` current. Archive:
  `gh codespace stop` (no `ifClean`: its files stay; no teardown script), Restore: `hostUp` (starts it), Delete:
  `gh codespace delete --force` first (a failure keeps the workspace), `dropWs`' `csGone` for the rest
  (`archivedTidy`, a project removed); `load` marks one left `Creating` `Failed`. `SCOPE`: gh without the codespace
  scope says `gh auth refresh -s codespace`. Tested with `test/fakes/gh`'s `codespace` (its create clones the
  project into `$LAKI_CS_ROOT/<repo>`, a state file each) and `fakes/ssh` in `test/ssh.test.ts`.

### Tunnels

Expose to the world (`remote.ts` `tunnelStart`): `cloudflared tunnel --no-autoupdate --url http://localhost:<port>
[--allowed-mail=<m>…]`, a Cloudflare Quick Tunnel (`--no-autoupdate`: cloudflared's own updater restarts it, every
`cloudflare()`'s); the URL is the first `https://<name>.trycloudflare.com` in its
output that isn't `login.`. No emails: public, anyone with the link (the popup's default). Emails need
cloudflared 2026.9.3+ (`MAIL_VERSION`) and are kept in `settings.tunnelMails`. Tunnels run in the daemon (`tunnels`, in `WorkspaceView.tunnels`) and are kept in `state.tunnels`
(`keep`: ws, port, mails, until, host and `via`, the last url): stopped by `tunnelStop`, past `until` (`hours`: `SHARE_HOURS`, unset
8, 0 none; `tunnelTick`, every 15 s) and a workspace's teardown, gone from state then; shutdown (`tunnelsDown`) stops their
cloudflareds and keeps them, and `tunnelsBack` (main.ts, after `reapChildren`) starts each again whose workspace is live
and whose time hasn't passed. One that ends on its own, or can't start (not its first start: that error is
`tunnelStart`'s), is `again`: `down` (why, in the view: the popup's *Reconnecting*, the globe dimmed) and `AGAIN` later
(2, 5, 15, 30 s, then each minute) started again; a quick one's new URL broadcasts `tunnel` (`was`: the one before;
App's toast, *Copy it*). ponytail: no health check of a cloudflared that stays up but reaches nothing; it reconnects
its own edge connections.
Permanent ones (`host`; `settings.tunnel` `{ name, domain }`, Settings › Tunnels' `TunnelsSection`, `tunnelCheck`; the
popup's *Address* when `cloudflared`'s `named` is there): a locally managed named tunnel of yours (`cloudflared tunnel
login`'s `~/.cloudflared/cert.pem`, `tunnel create`'s `<id>.json`), `hostOf` (one label, `LABEL`, under the domain:
Cloudflare's universal certificate covers one level), `routeDns` (`tunnel route dns <name> <host>` once, never
`--overwrite-dns`: a record that's another's is refused), then `connect`: one cloudflared for all of them, `tunnel
--no-autoupdate --config <data>/cloudflared/ingress.yml run <name>` (an ingress rule per hostname, then 404), up at
`Registered tunnel connection`, started again as the list changes (the `key`) or when it ends (`connDown`, `AGAIN`);
`url` is `https://<host>` and stays. A tunnel's `via` is the named tunnel its record goes to: after another name in
Settings, `connect` leaves the others out, `down` (*stop it, remove that record…*). A random start on a port a permanent
one has is refused, as the other way round; the hostname is checked free again after `routeDns`. Who gets in is Cloudflare Access's (your dashboard): Laki sets none, and the popup
and Settings say so. An agent's `tunnelStart` with `host` is refused (main.ts `agentNo`; `tunnelStart` in `FROM`); a
remote client can't change `settings.tunnel` (`REMOTE_KEYS`). Resources' *Permanent tunnels* row stops them all
(`tunnel:named`). Tested in `test/tunnel.test.ts` (the fake `test/cloudflared`'s `tunnel list`, `route dns`, `run`).
Every `publisher` child (cloudflared, tailscale serve or funnel) is in `<data>/children.json` (pid, `ps -o lstart=`, its
binary, tailscale's `off` args) while it runs; `reapChildren`, as a daemon starts, SIGTERMs those still running with the
same start time and command (a crash or a kill -9 left them) and turns a tailscale one off (L14). One per workspace and port.

Shared tabs (`remote.ts` `shareStart`, `daemon/share.ts`; the app's *Share live view…*, *Shared live view* once on): a tab as a view-only page at `<tunnel>/s/<uuid>`. The pages
have their own `node:http` server on 127.0.0.1 (`shareServe`: `/s/<id>`, `.md` (`?download`), `.json?v=`; anything
else 404), so the one tunnel (`cloudflare`, no mails, Resources' `share`) never reaches the daemon's API; both start
with the first share and stop with the last (`stopShares`: a tab, a workspace's teardown, a closed tab, Resources,
shutdown). In memory only (`shares`), like tunnels; the view's `TabView.share` is `{url, until}` (`shareLink`):
`hours` (`SHARE_HOURS`) sets `until`; `shareTick` (every 15 s) and a reader's next ask stop one past it. `shareRead`
(at most every 1.5 s, on a request): claude's or codex's transcript (`tailOf`, the meters' too: `transcriptOf`, the tab's
account's folder, else the agent's own, a chat looked for every 10 s at most (2 minutes once it's been missing a minute; a turn's end looks at once), a new one at once; read on from `pos`, whole lines, `SHARE_READ` at
most; none on a host; into `said` by `chatOf`), else `screen` (5000 lines); a change bumps
`v`. `shareMd` (Copy, Download), `shareBody`/`sharePage` (`shared/markdown.ts`' tree, every string escaped, links
http(s)/mailto only, a picture as its link; a CSP with a nonce, no inline styles, `img-src data:`); what was said goes
through `redact` first (L9: `SECRETS`' token shapes as ••••); the page asks `.json?v=` every 2.5 s and swaps `main`
(a LIVE badge, ENDED or OFFLINE when it can't; chat bubbles, the prompts on the right; `#latest`, *New below*,
when something comes under where the reader is; a footer). Its `sub`: *Live · view-only · updates as it goes*.
Tested in `test/share.test.ts`.

### Webhooks

`inbound.ts`' server (`hookServe`, once `settings.inHooks` has one; `hookStop` at shutdown): `127.0.0.1`, a random port,
never the daemon's; only `POST /hook/<name>` (404 else, `/rpc` too), `BODY_MAX` 1 MB (413), `RATE` 60 a minute per hook
(429 with Retry-After). Each request's check (`signed`, `timingSafeEqual`): `github` `X-Hub-Signature-256`
(`sha256=` + HMAC-SHA256 of the raw body), `linear` `Linear-Signature` (its hex), `key` `X-Laki-Key`; a failure 401,
logged once a minute per hook (`told`). Then `webhook` `{ name, event, body, project? }`, 202. `hookAdd` (a name,
`NAME`; a kind; a project) writes its secret to `<data>/hooks/<name>` (0600, never state.json) and returns it once;
`hookSecret` reads it again, `hookRm` drops both, `hookList` the hooks with their local and public URLs. `hookExpose`:
remote.ts' `hookPublish`, a quick cloudflared tunnel to that port (`cloudflare`) or `tailscale funnel` (`tailscale`,
funnel), its `url`, `down` when it went. All four but `hookList` refused from an agent (`AGENT_NO`), `hookSecret` and
`hookExpose` over remote access (`REMOTE_NO`). Settings › Tunnels › Webhooks (SettingsConnect.tsx `WebhooksSection`).
ponytail: funnel takes port 443's root, as remote access over tailscale does.

### Remote access

`remote.ts` `remoteStart`: the same `cloudflare()` as a tunnel, in front of the daemon itself
(`http://127.0.0.1:<daemon port>`), with one `--allowed-mail` (`ONE_MAIL`: an address, never a
`*@domain`; kept as `settings.remoteMail`), or none only with `open: true` and no mail (Settings asks for *confirm*
typed, in a red box; `view.remote.open`, a red status bar badge: the token is then the only lock), for `REMOTE_HOURS` (1, 2, 4, 8, 12, 24, 48, 72, or 0: forever, no `until`; open: 24 at most, never 0). Each start makes a
link key (`token`) and the page's token (`access`, `remoteToken`); `remoteView` (`view.remote`) gives the link, `<url>/?token=<token>` (a query: Cloudflare's email sign-in drops a
hash), which the renderer (`api.ts`: no port) reads on the page's own origin, takes out of the address bar
(`pageToken`: `replaceState`; Cloudflare's sign-in page, an earlier history entry, still holds the link) and swaps once
(`pinNeed`: `POST /pin` `{ token }`, `remotePin` gives `{ need: false, token: access }` and sets `used`, the view's and
Settings' *Opened*) for the token it connects with, kept in the tab's `sessionStorage` `laki.token` for reconnects: the
link is dead after (L3). While it runs, `main.ts`
takes the tunnel's URL as an Origin, and that token only with it (a client with no Origin needs the daemon's own);
`remoteStop` drops both, so an old link is dead. A client from that Origin (`Conn.remote`, the `/rpc` call's) is
refused `REMOTE_NO` (`remoteStart`, `cliInstall`, `cliRemove`, `shutdown`, `aiKey`, `skillSet`, `accountAdd`,
`accountLogin`), `widgetSet` with `on: true`, `net: true` or a `source`, and `settingsSet` changing a `REMOTE_KEYS`
setting (`remote*`, `webhook`, `widgetDirs`, `widgetDev`, `presets`, `env`, `tunnel`; sent back unchanged is fine: Settings saves
them all) (M4). `pin` (Settings' *Sign in with* › PIN, `settings.remoteAuth`): no
`--allowed-mail`; a 6-digit `pin` (`randomInt`, shown in Settings): the link's token (`POST /pin`, `remotePin`, main.ts:
from the tunnel's origin) then says `need`, and `{ token, pin }` gives `access` (and `used`: a right PIN, once); a wrong PIN counts `left` down from `settings.remoteTries` (1-10, `REMOTE_TRIES` 2), the
last stops it and broadcasts `remote` (App: a toast and a notification). The page (`api.ts`) asks `/pin` before its
first connect (`pinNeed`), and App's splash shows `PinForm` (`api.pin`: the access token kept as the tab's token; one solid card, `.pin-*`: Laki's mark, a lock in a ring filling a sixth per digit, green with a check once it's right; *Unlock* always a button, short of six digits it says so). The page (`api.ts` `whyNot`), when its socket won't open twice: a
`fetch` of itself that redirects is Cloudflare's sign-in run out (a reload signs in again, once per 30 s), a 401/403 from
`/rpc` is a dead link, no answer or a 5xx is the Mac out of reach; App shows it on the splash and in the status bar
(the `problem` event). Retries back off to 10 s. `page` serves the HTML `no-store`, so a tab brought back or Back
goes through the sign-in instead of loading from the cache with every other request turned away. It ends by
`remoteStop`, at `until` (`remoteTick`, every 15 s), when cloudflared exits, or at shutdown.

`main.ts` `page`: any GET serves a file of the built renderer (`out/renderer`: the folder with `assets`, never the dev
`src/renderer`; or `LAKI_PAGE`) whatever the
Origin: the files hold no secrets. Paths that leave the folder, or don't decode, are 404. The CSP's
`connect-src 'self'` lets the page reach its own daemon over `wss://`.

Through Tailscale (`via: 'tailscale'`, Settings' *Sign in with* › *Tailscale*, `remoteAuth`; `remoteTsPin`, `remoteFunnel`): `tailscale serve
--https=443 http://127.0.0.1:<port>` (`funnel`: `tailscale funnel`, the internet, refused without `pin`) in the foreground (`publisher`, the same child-process shape as `cloudflare()`:
its URL, `TAILNET_URL`, from its output; stopping it unpublishes), after `tsReady` (`tailscaleBin`: PATH, else the
Mac app's `TAILSCALE_APP`; `status --json` Running; its online `Peer`s as the view's `peers`: 0 is Settings' warning, since a Mac can't reach its own tailnet address). No email; `open` never; a PIN if asked. The origin and token
checks are as for cloudflared.

Headless (`docs/headless.md`): the CLI's `serve` imports the daemon into its own process (or uses one running), then
`remoteStart` (`--tailscale [--pin]`, `--cloudflare --mail|--pin|--open`, `--hours`), prints `remoteText`, and stops
the daemon when remote access ends (a service's `Restart=always` starts it again, a new link: `laki remote`). Main's
`--headless` (first thing in `src/main/index.ts`: `spawnSync` of `cli.js serve` with `ELECTRON_RUN_AS_NODE`, before
Chromium touches a display) makes `Laki.AppImage --headless …` work with no X server and no `--no-sandbox` (tried in
Docker: `scripts/linux.sh`'s image without Xvfb). It passes `LAKI_HEADLESS_PARENT`: `serve` stops when its parent goes
(a kill of that pid alone), remote access with it.
