# Install & build

## The app

macOS 13 or later on Apple silicon. Download the `arm64` dmg from
[the latest release](https://github.com/igorkasyanchuk/laki-releases/releases/latest) and drag Laki to Applications.
It's signed and notarized: a double-click opens it, and it updates itself (Settings › General › Updates). An Intel Mac
builds it (below). Or with Homebrew:

```bash
brew install --cask igorkasyanchuk/laki/laki    # Laki.app in /Applications
brew upgrade --cask laki                        # a new version (or Settings › General › Updates)
```

What it needs:

- git;
- the agents you use, on the PATH your login shell gives: `claude`, `codex`, `agy` (Antigravity: `curl -fsSL https://antigravity.google/cli/install.sh | bash`), `grok`, `opencode`, `pi`;
- optional: `gh`, signed in (`gh auth login`), for pull requests, checks and reviews; `cloudflared` or Tailscale for
  Expose to the world and remote access.

The `laki` command for any shell: Settings › General › Developer › *Install the laki command*.

## Uninstall

Dragging Laki to the Trash leaves its pieces behind. Settings › General › Developer › *Uninstall Laki…* lists each one
and removes them in one click: the `laki` command on your PATH, the agent skills in each agent's folder
(`~/.claude/skills/laki`…), and the background daemon with the terminals it kept. Tick *Also delete the worktrees*
for the worktrees Laki made (their uncommitted changes go too) and *Also delete my data* for `~/.laki` (projects,
notes, settings, kept chats, artifacts; Laki AI's keys, the Telegram bot's token and your secret env values in the Keychain). Your repos always stay, and a second Laki on
this Mac (a dev build with its own data folder) keeps its own command and skills. A row that fails says why, with its
command to copy. Then Laki offers to move itself to the Trash. From a terminal:

```bash
laki uninstall                         # the list; on a terminal it asks first
laki uninstall --yes --data            # everything, your data too
brew uninstall --cask laki             # then, for a Homebrew install
```

If you added Laki as an MCP server to an agent (`claude mcp add … laki`), remove it there: `claude mcp remove laki`.

## Build it yourself

Node 22.12+ and git. A build of your own is ad-hoc signed, so macOS asks once: System Settings › Privacy & Security ›
*Open Anyway*.

```bash
git clone https://github.com/igorkasyanchuk/laki && cd laki
npm install && npm run pack
open dist/mac-arm64/Laki.app      # Intel: dist/mac; or copy it to /Applications
npm link                          # optional: the laki CLI
```

`npm run pack:x64` builds the Intel app on an Apple silicon Mac. Working on Laki: [CONTRIBUTING.md](../CONTRIBUTING.md)
(build, test, the demo world, the rules) and [AGENTS.md](../AGENTS.md) (how the code works).

## Linux

An AppImage for x64 and arm64: Ubuntu 22.04 or later, Debian 12, Fedora 40 (each run in Docker before a release),
with a desktop. Download `Laki-<version>-x86_64.AppImage` (or `-arm64`) from
[the latest release](https://github.com/igorkasyanchuk/laki-releases/releases/latest), keep it in a folder you own,
and start it:

```bash
mkdir -p ~/Applications && mv ~/Downloads/Laki-*.AppImage ~/Applications/Laki.AppImage
chmod +x ~/Applications/Laki.AppImage && ~/Applications/Laki.AppImage
```

No libfuse2 to install: its starter is static (with no FUSE at all, `--appimage-extract-and-run`). On Ubuntu 24.04,
`sudo apt install libnss3 libasound2t64 xdg-utils` if they're missing. It updates itself (Settings › General ›
Updates): *Update to x.y* downloads the release's AppImage beside yours, checks it against the release's
`SHA256SUMS.txt`, and *Restart to update* puts it in under the same name, the one before kept as
`Laki.AppImage.previous` for *Go back*. In a folder you can't write (`/opt`), *Download* opens the release page and you
replace it. [The guide](guide.md#linux-and-windows-through-wsl) has the rest; on a server with no screen,
[headless](headless.md). `npm run pack:linux` builds it yourself in Docker (`ARCH=x64` for Intel/AMD).

### Chromium's sandbox on Ubuntu 23.10 and later

Ubuntu 23.10 and later let only programs with an AppArmor profile make the user namespaces Chromium's sandbox needs.
Without one, the AppImage starts Laki with `--no-sandbox`: it works, but its pages run without that sandbox, and
Settings › General › Updates says so. One profile for your AppImage's path turns it on (once: an update keeps the
path and the name):

```bash
f=$(readlink -f ~/Applications/Laki.AppImage)   # where yours is
sudo tee /etc/apparmor.d/laki > /dev/null <<EOF
abi <abi/4.0>,
include <tunables/global>

profile laki "$f" flags=(default_allow) {
  userns,
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/laki
```

Then start Laki again; Settings no longer says the sandbox is off. The profile lets that one file (and what it starts)
make user namespaces, nothing else; it trusts whatever is at that path, so keep it in a folder only you write. To take
it away: `sudo apparmor_parser -R /etc/apparmor.d/laki && sudo rm /etc/apparmor.d/laki`.

## Windows (WSL 2), a preview

The Linux AppImage in WSL 2's Ubuntu, WSLg showing the window: [the guide](guide.md#linux-and-windows-through-wsl).

## If something's off

- Laki keeps its data, logs included, in `~/.laki` (`daemon.log`).
- An agent Laki can't find isn't on the PATH your login shell gives: `$SHELL -lic 'which claude'`.
- After an update, a yellow bar offers to restart Laki's daemon on the new version (your agents keep running until
  then).
- An update went wrong for you? Settings › General › Updates' *Go back to <version>* puts the version you had before
  back (the Mac app keeps one copy of it when an update downloads, with 1 GB free): it checks that copy's signature and
  developer, restarts Laki as it and skips the newer one until you offer it again; the yellow bar then restarts the daemon
  to match. Your data stays; if it's in a newer format than that version reads, Settings says so first.
