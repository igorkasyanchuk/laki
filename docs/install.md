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
- the agents you use, on the PATH your login shell gives: `claude`, `codex`, `gemini`, `grok`, `opencode`;
- optional: `gh`, signed in (`gh auth login`), for pull requests, checks and reviews; `cloudflared` or Tailscale for
  Expose to the world and remote access.

The `laki` command for any shell: Settings › General › Developer › *Install the laki command*.

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

## Linux and Windows (WSL 2), a preview

`npm run pack:linux` builds `dist/linux/Laki-<version>-<arch>.AppImage` in Docker and tests it there (`ARCH=x64` for
Intel/AMD). [The guide](guide.md#linux-and-windows-through-wsl) says how to run it; on a server with no screen,
[headless](headless.md).

## If something's off

- Laki keeps its data, logs included, in `~/.laki` (`daemon.log`).
- An agent Laki can't find isn't on the PATH your login shell gives: `$SHELL -lic 'which claude'`.
- After an update, a yellow bar offers to restart Laki's daemon on the new version (your agents keep running until
  then).
