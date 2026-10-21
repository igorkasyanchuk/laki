# Laki without its window: a headless server

Laki's daemon holds everything: projects, workspaces, the agents' terminals. The app is one of its clients; a browser
is another. Headless, the daemon runs on a machine with no screen (a Linux server, a Mac mini in a cupboard) and you
use Laki in a browser, from your laptop or phone, through **remote access**.

## Run it

On Linux, the AppImage (`npm run pack:linux` builds it: [the guide's Linux part](guide.md#linux-and-windows-through-wsl)):

```bash
chmod +x Laki-*-x86_64.AppImage
./Laki-*-x86_64.AppImage --headless --tailscale
```

It needs no display, no X server and no `--no-sandbox`: `--headless` runs Laki's command line through the AppImage's
own Node, before any window. It prints the link:

```
laki: remote access
https://box.tail1234.ts.net/?token=4f1c… (it works once, in one tab)
your tailnet's devices only
until stopped
```

On a Mac, the same through the app: `/Applications/Laki.app/Contents/MacOS/Laki --headless --tailscale`. From a clone
of the repo (Node 22.6+): `npm ci && npm run build`, then `node bin/laki.js serve --tailscale`.

It runs until stopped (Ctrl-C, `laki stop`, your service manager). `laki remote` prints the link again; each start
makes a new one (the old one stops working).

## How you get in

Pick one:

| | Who reaches it | Needs |
|---|---|---|
| `--tailscale` | devices in your tailnet, with the link | Tailscale on the server, connected (`tailscale up`); HTTPS on for the tailnet |
| `--tailscale --pin` | the same, plus a 6-digit PIN (printed on a terminal; in a service's log, `laki remote` shows it) | the same |
| `--tailscale --funnel` | anyone on the internet with the link and the PIN (Tailscale Funnel; a PIN always) | the same, and Funnel on for the tailnet (its policy's `funnel` attribute) |
| `--cloudflare --mail you@example.com` | that email only, after a one-time code from Cloudflare | `cloudflared` 2026.9.3+ |
| `--cloudflare --pin` | anyone with the link and the PIN (2 wrong PINs stop it) | `cloudflared` |

`--hours n` (1, 2, 4, 8, 12, 24, 48 or 72) stops it after that long; the default is until stopped. `--cloudflare --open`
(anyone with the link) needs `--hours`, 24 at most.

The link opens once, in one tab: the page swaps its key for one of its own, and the link is dead after. For another
device, start it again (`laki remote stop`, then `laki serve`; a service restarts it).

### Tailscale

`--tailscale` runs `tailscale serve` in the foreground: Laki is at `https://<machine>.<tailnet>.ts.net`, for your
tailnet only; `--funnel` runs `tailscale funnel` instead, the same address on the public internet, and always with a
PIN. Open the link on another device: a Mac can't open its own Tailscale address (macOS keeps it to itself, never
through Tailscale), so a tailnet with no other device online can't use it (Laki says so). The first visit waits a
few seconds for the HTTPS certificate. Once per tailnet and machine:

1. In Tailscale's admin console › DNS: MagicDNS and HTTPS Certificates on.
2. On Linux, let your user run `tailscale serve` without sudo: `sudo tailscale set --operator=$USER`.

On the Mac, the Tailscale app's own command is used when `tailscale` isn't on your PATH. While Laki runs, it takes
port 443 of `tailscale serve` (another serve of yours there is replaced, and gone when Laki stops, or as it starts
again after a crash). The app's Settings › Remote access has the same choice: *Sign in with* › *Tailscale*, with
*Funnel* and *Ask for a PIN as well*.

### Cloudflare

`--cloudflare` publishes the daemon at a random `trycloudflare.com` address through `cloudflared` (a Quick Tunnel, no
Cloudflare account needed). Install `cloudflared` from Cloudflare's packages.

## Keep it secure

Whoever gets in has a shell on that machine as the user Laki runs as: their files, keys and agents.

- The daemon listens on 127.0.0.1 only. Nothing reaches it but the tunnel (cloudflared or tailscale serve) on the same
  machine, and the tunnel needs the link's token, which is random, new at each start, good once and dead once stopped.
- From the browser, Laki won't start remote access again, install its command, change the phone pushes, presets, env
  or extension folders, sign in accounts, turn an extension on or shut down: do those on the machine itself.
- Prefer `--tailscale` (only your devices) or `--cloudflare --mail` (only your email). `--cloudflare --pin` is the
  link and a PIN, nothing else.
- Run it as an ordinary user of its own, never root. Its data is in `~/.laki` (0700).
- Treat the link like a password: not in chats, tickets or screenshots. `laki remote stop` (or a restart) kills it.
- Laki asks before opening without any sign-in (Settings' typed *confirm*; the command line's `--cloudflare --open`):
  don't, on a server.

## As a service (systemd)

`/etc/systemd/system/laki.service`, for a user `laki` with the AppImage in its home:

```ini
[Unit]
Description=Laki (headless)
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
User=laki
WorkingDirectory=/home/laki
Environment=APPIMAGE_EXTRACT_AND_RUN=1
Environment=PATH=/home/laki/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/laki/Laki.AppImage --headless --tailscale
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now laki
journalctl -u laki -f      # the link, as each start prints it
sudo -u laki laki remote   # or ask for it (with the laki command installed: Settings › General › Developer, or npm link)
```

`APPIMAGE_EXTRACT_AND_RUN=1` runs the AppImage without FUSE. `PATH` is where the agents (`claude`, `codex`…), `gh` and
`tailscale` are: a service doesn't read your shell's profile. Sign the agents and `gh` in once as that user
(`sudo -iu laki`, then `claude`, `gh auth login`). Remote access ending (Tailscale or cloudflared gone) stops Laki, and
`Restart=always` starts it again.

## What's different without the app

No notifications, Dock count, menu bar or floating bubbles (they're the app's); phone pushes (Settings › Phone pushes)
still work, as the daemon sends them. The agent browser (`laki browser`) needs the app's window, so it doesn't work
headless. Everything else is in the browser: projects, workspaces, agents, diffs, PRs, Settings.
