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

## What runs as node, and where it starts

Each one sets `ELECTRON_RUN_AS_NODE=1` (core.ts `cliEnv`, or the env given) on `helperBin`'s binary, or inherits the
daemon's `process.execPath`, which is that binary.

| what | spawned at | runs |
|---|---|---|
| the daemon | `src/shared/conn.ts:146` `ensureDaemon` (the app's main: `src/main/index.ts:637` `start`'s env; the CLI's autostart) | `out/main/daemon.js` |
| the pty host | `src/daemon/ptyHost.ts:164` `up`, the daemon's `process.execPath` | `out/main/ptyhost.js` |
| the CLI | `src/daemon/core.ts:285` `cliArgv`: the launcher on PATH (`cliText`, `LAKI_CLI` :425), the skills' (`skill.ts:47`), an extension's `$LAKI_CLI` (`widgets.ts:1012`) | `out/main/cli.js` |
| `laki mcp` | `cliArgv` too: the skills' MCP command (`skill.ts:36`), Laki AI's (`ai.ts:870` `mcpWith`) | `out/main/cli.js mcp` |
| hooks | `core.ts:291` `hookArgv` | `out/main/hook.js` |
| widget scripts | `widgets.ts:1204` runs, `widgetEvents.ts:341` streams: the daemon's `process.execPath` | an extension's `.js` |
| `--headless` | `src/main/index.ts:406`: main spawns `serve` | `out/main/cli.js serve` |

## The order to move them

1. **Hooks** (done): the most started, the least needed (no grants, no window).
2. **The CLI and `laki mcp`** (done): core.ts' `cliArgv` starts with `helperBin` (helper.ts, `hookRunner` before), so the
   launcher on PATH (`cliInstall`), the skills' `laki` and their MCP command, Laki AI's `laki mcp` (`ai.ts` `mcpWith`)
   and an extension's `$LAKI_CLI` run on the helper; `hookArgv` is `cliArgv`'s binary. `laki open` finds the outer app
   (`appOf`), not the helper it runs in. Launchers written before update on their own (`refreshSkills`; Settings ›
   General's launcher says it's outdated).
3. **The daemon, the pty host and widget scripts** (done): `ensureDaemon` (conn.ts) spawns `helperBin`'s binary, the
   app's main and the CLI alike; the daemon spawns the pty host and extensions' scripts with `process.execPath`, so
   they follow it. The app's token (S1, core.ts `appPeer`) still goes only to the app's own window process: `appBinOk`
   takes the outer bundle's `Contents/MacOS` binary whether the daemon runs on it or on the helper. Privacy grants the
   daemon uses (laki screen's simulator shots, `device.ts`) stay the app's: macOS asks the responsible process, the
   app that started it, not the binary.
4. **`--headless`** (done): main spawns `helperBin`'s binary with `serve` instead of re-running itself as node.
6. **The fuse off** (`runAsNode: false`), the helper built with it on (the helper's own Electron framework copy, or a
   plain node binary in the bundle: its size against a framework copy decides), `pack-smoke.sh` checking that
   `ELECTRON_RUN_AS_NODE=1 Laki.app/Contents/MacOS/Laki -e 1` no longer runs.
