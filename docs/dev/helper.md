# Off the app's binary: Laki Hook, then the rest

Electron's `runAsNode` fuse is on (package.json `build.electronFuses`): the daemon, the CLI, hooks, `laki mcp`, widget
scripts and `--headless` all run as `ELECTRON_RUN_AS_NODE=1 Laki.app/Contents/MacOS/Laki …`. With it on, any local
program can run its own JavaScript in Laki's signed binary and inherit Laki's privacy grants (Screen Recording,
Accessibility, the microphone, Keychain items allowed to Laki): SECURITY.md's known limits. The fuse can go off only once
nothing of Laki's needs the app binary to run as node. This moves them, one at a time, each step reversible.

## Step 1 (done): `laki hook` on Laki Hook

- `scripts/after-pack.cjs` `hookHelper` (macOS, before signing): `Contents/Frameworks/Laki Hook.app`, a copy of
  `Laki Helper.app` (Electron's helper: the same framework, so it runs as node too), its executable renamed `Laki Hook Helper` (Electron takes itself for a helper, its framework four folders up, only
  by a name ending in ` Helper`; `Laki Hook` alone looked beside itself and trapped as ICU started),
  `CFBundleIdentifier` `<appId>.hook` (`dev.laki.app.hook`), `LSUIElement`, no `NS…UsageDescription` keys.
  electron-builder signs it with the rest (ad hoc, or the Developer ID and hardened runtime in a release).
- `src/shared/helper.ts` `helperBin(execPath, exists)` (`hookRunner` then) (pure, `test/units-more.test.ts`): the bundle's Laki Hook when
  it's there, else the daemon's own binary (an older build, Linux, node from source). core.ts' `hookArgv` starts with it,
  so every hook command an agent's settings get (`claude-settings.json`, codex's `-c notify`, the others') runs on it.
- `scripts/pack-smoke.sh` checks the hook command names Laki Hook, its bundle id isn't the app's, and prints the
  median start of `hook ping` on each binary (before: Laki, after: Laki Hook).
- Back out: drop `hookHelper`'s call in after-pack.cjs; `hookRunner` then finds none.

What it gains now: a hook process is Laki Hook to macOS (its own bundle id: the privacy grants given to Laki aren't its
by bundle). It doesn't close the hole yet: Laki's own binary still runs as node for anyone.

## What still runs through `ELECTRON_RUN_AS_NODE` on the app's binary

| what | started by | where |
|---|---|---|
| the daemon | the app (`conn.ts` `ensureDaemon`, env from main's `start`) | `out/main/daemon.js` |
| the pty host | the daemon (`ptyHost.ts` `up`: `process.execPath`) | `out/main/ptyhost.js` |
| widget scripts | the daemon (`widgets.ts` runs, `cliArgv`) | an extension's `.js` |
| `--headless` | you (`Laki --headless`: main runs `serve` through it) | `out/main/cli.js serve` |
| Laki AI's tools | `laki mcp` above | |

## The order to move them

1. **Hooks** (done): the most started, the least needed (no grants, no window).
2. **The CLI and `laki mcp`** (done): core.ts' `cliArgv` starts with `helperBin` (helper.ts, `hookRunner` before), so the
   launcher on PATH (`cliInstall`), the skills' `laki` and their MCP command, Laki AI's `laki mcp` (`ai.ts` `mcpWith`)
   and an extension's `$LAKI_CLI` run on the helper; `hookArgv` is `cliArgv`'s binary. `laki open` finds the outer app
   (`appOf`), not the helper it runs in. Launchers written before update on their own (`refreshSkills`; Settings ›
   General's launcher says it's outdated).
3. **Widget scripts and the pty host**: spawned by the daemon with `process.execPath`; once the daemon itself runs on
   the helper, they follow by inheriting it.
4. **The daemon**: `ensureDaemon`'s spawn from the app names the helper; the daemon's Screen Recording use (laki screen's
   simulator shots, `device.ts`) moves to the app (an IPC) or asks for its own grant.
5. **`--headless`**: main spawns the helper with `serve` instead of re-running itself as node.
6. **The fuse off** (`runAsNode: false`), the helper built with it on (the helper's own Electron framework copy, or a
   plain node binary in the bundle: its size against a framework copy decides), `pack-smoke.sh` checking that
   `ELECTRON_RUN_AS_NODE=1 Laki.app/Contents/MacOS/Laki -e 1` no longer runs.
