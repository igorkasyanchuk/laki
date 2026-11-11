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
and Settings say so. An agent's `tunnelStart` with `host` is refused (main.ts `agentNo`; `tunnelStart` in `FROM`); S7: any other of an
agent's asks you in the app first (main.ts `exposeAsk`, *Expose localhost:<port> to the world?*), unless the project
has an `expose`, which `exposeRule` holds every caller to (only those addresses and domains, a bare domain as `*@` it;
never anyone with the link); a
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
never the daemon's; only `POST /hook/<name>` (404 else, `/rpc` too), `BODY_MAX` 1 MB (413), `RATE` 60 signed ones a minute per hook (an outsider's unsigned ones don't count)
(429 with Retry-After). Each request's check (`signed`, `timingSafeEqual`): `github` `X-Hub-Signature-256`
(`sha256=` + HMAC-SHA256 of the raw body), `linear` `Linear-Signature` (its hex), `key` `X-Laki-Key`; a failure 401,
logged once a minute per hook (`told`). Then `webhook` `{ name, event, body, project? }`, 202. `hookAdd` (a name,
`NAME`; a kind; a project) writes its secret to `<data>/hooks/<name>` (0600, never state.json) and returns it once;
`hookSecret` reads it again, `hookRm` drops both, `hookList` the hooks with their local and public URLs. `hookExpose`:
remote.ts' `hookPublish`, a quick cloudflared tunnel to that port (`cloudflare`) or `tailscale funnel` (`tailscale`,
funnel), its `url`, `down` when it went. All four but `hookList` refused from an agent (`AGENT_NO`), and over remote access
(`REMOTE_NO`). Settings › Tunnels › Webhooks (SettingsConnect.tsx `WebhooksSection`).
ponytail: funnel takes port 443's root, as remote access over tailscale does.

### Remote access

`remote.ts` `remoteStart`: the same `cloudflare()` as a tunnel, in front of the daemon itself
(`http://127.0.0.1:<daemon port>`), with one `--allowed-mail` (`ONE_MAIL`: an address, never a
`*@domain`; kept as `settings.remoteMail`), or none only with `open: true` and no mail (Settings asks for *confirm*
typed, in a red box; `view.remote.open`, a red status bar badge: the token is then the only lock), for `REMOTE_HOURS` (1, 2, 4, 8, 12, 24, 48, 72, or 0: forever, no `until`; open: 24 at most, never 0). Each start makes a
link key (`token`) and the page's token (`access`, `remoteToken`); `remoteView` (`view.remote`) gives the link, `<url>/#t=<token>` (S11: in the hash, which a browser never sends, so
no proxy or Cloudflare log has it; Cloudflare's email sign-in sends the browser back without it, and the page then says
to open the link again, which still works: only `/pin` uses it), which the renderer (`api.ts`: no port) reads on the page's own origin, takes out of the address bar
(`pageToken`: `replaceState`; Cloudflare's sign-in page, an earlier history entry, still holds the link) and swaps once
(`pinNeed`: `POST /pin` `{ token }`, `remotePin` gives `{ need: false, token: access }` and sets `used`, the view's and
Settings' *Opened*) for the token it connects with, kept in the tab's `sessionStorage` `laki.token` for reconnects: the
link is dead after (L3). While it runs, `main.ts`
takes the tunnel's URL as an Origin, and that token only with it (a client with no Origin needs the daemon's own);
S11: its WebSocket carries no token in the URL: the upgrade goes through, and its first message must be
`{ auth: <token> }` within 5 s, else the socket closes (4401) with nothing sent (the app and the CLI keep `?token=`);
`remoteStop` drops both, so an old link is dead. A client from that Origin (`Conn.remote`, the `/rpc` call's) is
refused `REMOTE_NO` (`remoteStart`, `cliInstall`, `cliRemove`, `shutdown`, `aiKey`, `skillSet`, `accountAdd`,
`accountLogin`), `widgetSet` with `on: true`, `net: true` or a `source`, and `settingsSet` changing a `REMOTE_KEYS`
setting (`remote*`, `webhook`, `widgetDirs`, `widgetDev`, `presets`, `env`, `tunnel`; sent back unchanged is fine: Settings saves
them all) (M4); S11: also `tunnelStart`, `scheduleSet`, `shareStart` with `hours` 0 (its default) and `projectSet` changing a
script (`SCRIPT_KEYS`: setup, teardown, run, test, lint, format, deploy, ticket, check, actions, env; a config replaces the
whole, so one left out counts as changed). A shell tab still opens from the phone: it's the user, signed in.
Webhooks (inbound.ts, S11): a signed delivery sent again runs nothing (409): GitHub's `X-GitHub-Delivery` and Linear's
signature remembered 10 minutes (`replayed`), Linear's `webhookTimestamp` within them. `pin` (Settings' *Sign in with* › PIN, `settings.remoteAuth`): no
`--allowed-mail`; a 6-digit `pin` (`randomInt`, shown in Settings): the link's token (`POST /pin`, `remotePin`, main.ts:
from the tunnel's origin) then says `need`, and `{ token, pin }` gives `access` (and `used`: a right PIN, once); a wrong PIN counts `left` down from `settings.remoteTries` (1-10, `REMOTE_TRIES` 2), the
last stops it and broadcasts `remote` (App: a toast and a notification). The page (`api.ts`) asks `/pin` before its
first connect (`pinNeed`), and App's splash shows `PinForm` (`api.pin`: the access token kept as the tab's token; one solid card, `.pin-*`: Laki's mark, a lock in a ring filling a sixth per digit, green with a check once it's right; *Unlock* always a button, short of six digits it says so). The page (`api.ts` `whyNot`), when its socket won't open twice: a
`fetch` of itself that redirects is Cloudflare's sign-in run out (a reload signs in again, once per 30 s), a 401/403 from
`/rpc` is a dead link, no answer or a 5xx is the Mac out of reach; App shows it on the splash and in the status bar
(the `problem` event). Retries back off to 10 s. `page` serves the HTML `no-store`, so a tab brought back or Back
goes through the sign-in instead of loading from the cache with every other request turned away. It ends for good by
`remoteStop` (you, Resources' Stop, a wrong PIN's stop) or at `until` (`remoteTick`, every 15 s): `state.remote` goes.

My domain (D1, `remoteStart`'s `host`, Settings' *Address* › *My domain*: `remoteAuth: 'domain'`, `remoteHost`): a word
(`''`: `laki`) under `settings.tunnel`'s domain (`hostOf`), its DNS record by `routeDns` at each start, then on the
permanent tunnels' connector (`connect`: its ingress gets `hostname: <host>` → `http://127.0.0.1:<daemon port>`
beside Expose's, `far`; a record of another named tunnel's leaves it out, `down` says so). Always with a PIN: cloudflared
alone can't make a Cloudflare Access application (that's the dashboard's or the API's: Zero Trust › Access controls ›
Applications › Self-hosted), so Laki's PIN is the lock and Settings says how to add Access for the email too. Its
origin is `https://<host>`, the same every start; `remoteOrigin` is it while it runs, as a quick one's. A tunnel can't
take its host (`namedStart`'s `taken`) and the other way round. `remoteUp` waits for the connector (`up`, its `key`
having the host). Resources' *Permanent tunnels* stop (`stopTunnels(undefined, true)`) stops it too.

Started again (D2): its cloudflared or tailscale ending on its own (`publisher`'s `ended`) is `remoteAgain`: `was`,
`down`, AGAIN's delays then a minute each, `remoteUp` again; My domain's connector restarts itself (`connDown` sets
`down`). `remoteAt`: the same address goes on as it was (the page's token, `access`, still good: `api.ts` retries and
reconnects); a new one (a quick tunnel's) gets a new link key, PIN and `used: false` (the old page's origin is gone),
`was` in the view (`moved`) and a `remote` event. `access` is the hash (sha256) of the page's token, never the token:
`remotePin`'s `use` makes it, `accessOk` compares (main.ts' `tokenOk`). `keepRemote` writes `state.remote`
(`SavedRemote`: mail, open, pin, via, funnel, host, named, until, `access` once used, the last url; no token or PIN) at
each start, use and return; `remoteBack` (main.ts, after `reapChildren`, before `tunnelsBack`) starts it again unless
`until` passed or a managed policy turned it off, with a new link key and PIN (the old key went with the daemon), so a
stable address's page reconnects with its token. `remoteDown` (shutdown) stops the process and keeps `state.remote`.
The timer's `remoteTick` (no `now`) notes a gap over a minute (the Mac slept): `awake` fetches the cloudflared address
(a 5xx or no answer: started again: a quick one's `remoteAgain`, My domain's `connDown`); not Tailscale's, which this
Mac can't reach.

Trusted devices (D3, at a stable address: `stable`, Tailscale or My domain): `remotePin`'s `use` there is `pair`: a
device token (`hex`, 32 bytes) in the `Set-Cookie` main.ts' `/pin` sends (`__Host-laki-device`, `Path=/`, `Max-Age` its
days, `HttpOnly; Secure; SameSite=Strict`), `state.remoteDevices` (`SavedDevice`: `id`, `name` from the user agent:
`deviceName`, `hash`, `addedAt`, `seenAt`, `until`: `settings.remoteDeviceDays`, 1-90, 30), the view's `remoteDevices`
without the hash, a `remote` event (*A new device joined*). `deviceOf(cookie)` (main.ts' `/rpc` when the bearer isn't the
page's token, and the far WebSocket's first message: any `auth` then, the page sends `device`) finds it while remote
access runs at a stable address and it hasn't expired, `seenAt` a minute apart; the Conn keeps its `device` (the
activity log's). `/pin` with a valid cookie says `{ device: true }` before any key or lock, so a new tab gets in
(`api.ts`: `pinNeed` first, even with no key; `DEVICE` kept as the tab's token). `remotePair` (Add a device): a new link
key, `keyUntil` 10 minutes, a new PIN; refused for a quick tunnel. `remoteDeviceRm` (`id` or `all`) and `devicesTidy`
(`remoteTick`: past `until`) call main.ts' `onGone`, which closes those devices' sockets (`devSocks`, 4401). Both RPCs
are FROM, AGENT_NO and REMOTE_NO. A quick tunnel keeps one tab's token (`access`, its hash).

PIN waits (D5, `settings.remoteWrong`: `wait`, unset too, or `stop`): the tries used (`left` 0), `lockUntil` is `LOCKS`
(1, 5, 30 minutes) by `locks` this start, and `left` comes back when it passes (`remoteTick` or the next ask); during
it `/pin` says `{ need, left: 0, wait }` and any PIN is refused. `wrong`: today's wrong PINs' times, `DAY_CAP` (20)
stops it (final). Each wrong PIN and each wait: a log line and a `remote` event with the time and main.ts' `ip`
(`CF-Connecting-IP` or `X-Forwarded-For`, Tailscale's `Tailscale-User-Login`; shown, never decided on). The view's
`locked`, `wrong`. `stop`: the last wrong PIN stops it as before.

The phone as an app (M4, a PWA). Design: remote access's token and origin end with each start, so the installed app
holds neither. What it keeps is the trusted device's cookie (D3, `HttpOnly`, the origin's own): its start URL `/`
opens with no link token, `api.ts`' `pinNeed` asks `/pin`, the cookie says `device`, and it connects; a new start (new
link key, PIN and page token) changes nothing for it while the device is paired, and a revoked or expired one gets the
PIN form, as a new tab does. So only a stable origin can hold an installed app: Tailscale's or My domain's (`stable`); a
quick tunnel's is new each start, and an app installed there would open a dead address. `pwaOn()` (remote.ts): remote
access running at a stable address. main.ts' `PWA` routes, closed (404) unless `pwaOn()` (the icons: while remote
access runs at all): `GET /manifest.webmanifest` (name Laki, `display: standalone`, `start_url` and `scope` `/`, the
Laki theme's `bg` and `accent`; the icons `src/renderer/public/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`,
copied to `out/renderer` by the build), `GET /sw.js` (`swJs`, versioned by the page's build: caches `/assets/` and the
icons only, network first; never `/rpc`, `/pin`, `/push`, `/tap`, the socket or the page itself (`no-store`, and it
holds no token anyway); a navigation with no network gets an inline *Offline: your Mac is not reachable* page with
Try again). The renderer's `pwa.ts` (the remote page only: http(s), no `bridge`) adds the manifest link and Apple's
meta tags, registers the worker when the manifest answers, and `PwaBar` (App, on a phone) says *Add Laki to your Home
Screen* (Android's install prompt when the browser offers one) or, when the manifest is closed (a quick tunnel), *Add to
Home Screen works with a stable address*; installed (`display-mode: standalone`), *Notifications* subscribes.
Web Push (push.ts, `format: 'webpush'`, Settings › Phone pushes › *This phone (Web Push)*, no URL): VAPID keys made on
this Mac (`vapid.json`, 0600, P-256: `vapidNew`); `POST /push` from the page's origin with a paired device's cookie
gives the public key (`{}`), keeps `{ sub }` on that device (`SavedDevice.push`: endpoint, p256dh, auth; the view says
`notify` only) or drops it (`{ off: true }`); only a browser vendor's push service takes one (`PUSH_HOSTS`: FCM,
Mozilla's, Apple's, Microsoft's; https). `pushTo` sends each paired, unexpired device's (`webPush.devices`, phone.ts)
`webPushRequest`: the payload (title, body, tag, at most 2 actions: the first and last choice) encrypted per RFC 8291
(`aes128gcm`: an ECDH P-256 key of its own, HKDF with the subscription's auth secret, AES-128-GCM, one record),
`Authorization: vapid t=<ES256 JWT, aud the endpoint's origin, 12 h>, k=<public key>`, `TTL` a day; a 404 or 410 drops
that subscription (`webPush.gone`). No relay of Laki's: the bytes go to the vendor's service and only the device can
read them. Actions: each is the tap ntfy's buttons send, `nonce:n:<tapSig>` (phone.ts' `awaiting`, `tapKey`); the
worker's `notificationclick` posts it to `POST /tap` (the page's origin, a paired device's cookie, the signature
checked: `tapOf`), and phone.ts' `takeTap` answers it exactly as a polled ntfy or Telegram tap. Nothing to poll, so
`listen` doesn't for webpush. A click elsewhere on the notification opens the app (its `url`, an https one: that page).

The link to the phone (D4, `settings.remotePush`, off unless true; REMOTE_KEYS': not from a phone or an agent):
phone.ts `phoneRemote` pushes through the phone webhook (`pushOn`) when remote access starts (`remoteStart`: the link,
and *its PIN is on your Mac* with one), moves to a new address (`remoteAt` moved: the new link), stops on its own
(`remoteStop(why)`: its time is up, wrong PINs, My domain's tunnel stopped; never your Stop) or pairs a new device
(`pair`). Never when anyone with the link gets in (`open`): the webhook's host sees the link, so the page must ask for
more (a PIN, an email, the tailnet); never the PIN. A push's `url` is what a tap opens: ntfy's `Click` header,
Telegram's button, Slack's `<url|Open it>`, JSON's `url`, Web Push's payload (the worker opens it). Settings › Remote
access shows the switch only with a webhook and not open, and names whose server sees the link (`hookOf`; ntfy.sh is
a third party).

`main.ts` `page`: any GET serves a file of the built renderer (`out/renderer`: the folder with `assets`, never the dev
`src/renderer`; or `LAKI_PAGE`) whatever the
Origin: the files hold no secrets. Paths that leave the folder, or don't decode, are 404. The CSP's
`connect-src 'self'` lets the page reach its own daemon over `wss://`.

Through Tailscale (`via: 'tailscale'`, Settings' *Address* › *Tailscale*, `remoteAuth`; `remoteTsPin`, `remoteFunnel`): `tailscale serve
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
