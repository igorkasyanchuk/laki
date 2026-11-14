# Off the app's binary: Laki Node

Electron's `runAsNode` fuse is off on the app's binary (package.json `build.electronFuses`): `ELECTRON_RUN_AS_NODE=1
Laki.app/Contents/MacOS/Laki x.js` no longer runs `x.js` (main's first lines say so and quit, before any window or
daemon), so no local program can run its JavaScript in Laki's signed binary to borrow Laki's privacy grants (Screen
Recording, Accessibility, the microphone, Keychain items allowed to Laki). What Laki itself runs as node runs on
**Laki Node**, a binary of its own inside the bundle:

- `scripts/after-pack.cjs` `nodeHelper` (macOS, before electron-builder's fuses and signing):
  `Contents/Frameworks/Laki Node.app`, the app's own stub as `Contents/MacOS/Laki Node` (named so, not `… Helper`, it
  finds its framework beside it, in its own `Contents/Frameworks`), with a copy of Electron's framework whose
  `runAsNode` fuse is on (its other fuses the app's: `nodeFuses`, `@electron/fuses` through electron-builder's
  `generateFuseConfig`). Only what node needs of the framework: its binary, `icudtl.dat`, V8's snapshot, `libffmpeg`
  (linked) and Squirrel's three frameworks (linked); not Chromium's pages, locales or GPU libraries. About 210 MB on
  disk: the framework's binary alone is 197 MB, the price of the fuse. `CFBundleIdentifier` `<appId>.node`
  (`dev.laki.app.node`), `LSUIElement`, no `NS…UsageDescription` keys; electron-builder signs it with the rest (ad hoc,
  or the Developer ID and hardened runtime in a release).
- Linux: `nodeHelperLinux`, `<exe>-node` (`laki-node`) beside the app's binary, a copy with the fuse on (its
  resources are beside it too).
- `src/shared/helper.ts` (pure, `test/units-more.test.ts`): `helperBin(execPath, exists)` the build's Laki Node when
  it's there (from the app's binary or the helper's own), else the binary given (node from source, an older build);
  `appOf` the outer bundle (`laki open`); `appBinOk` the app's own window binary for S1's token (`appPeer`).
- `scripts/pack-smoke.sh` checks the app's binary runs no JavaScript as node and Laki Node does, the hook command and
  the daemon on Laki Node, its bundle id isn't the app's, `codesign --verify --deep --strict`, and prints the median
  start of `hook ping`.
- Privacy grants the daemon uses (laki screen's simulator shots, `device.ts`) stay the app's when the app starts it:
  macOS asks the responsible process, the app that started it, not the binary. Laki Node started by anything else has
  none of Laki's. So main never runs Laki Node for a caller that asked for node (its child would be Laki's to macOS).
- After the update: launchers on PATH and the skills' are written again as the daemon starts (`cliRefresh`,
  `refreshSkills`); an MCP command you added to an agent by hand points at the app's binary and stops working: add it
  again (Settings › Agents & profiles shows it). A codex tab started before the update keeps its old notify command
  (Laki Hook's path, gone) until it starts again.
- Back out: `runAsNode: true` in package.json; with Laki Node missing (`nodeHelper`'s call dropped) `helperBin` gives
  the app's binary again.

How it got here, one revertible commit each: hooks on Laki Hook (a copy of Electron's helper sharing the app's
framework, so it couldn't outlive the fuse); the CLI and `laki mcp`; the daemon, the pty host and `--headless`; then
Laki Node with its own framework and the fuse off.

## What runs as node, and where it starts

Each one sets `ELECTRON_RUN_AS_NODE=1` (core.ts `cliEnv`, or the env given) on `helperBin`'s binary, or inherits the
daemon's `process.execPath`, which is that binary.

| what | spawned at | runs |
|---|---|---|
| the daemon | `src/shared/conn.ts:146` `ensureDaemon` (the app's main: `src/main/index.ts:646` `start`'s env; the CLI's autostart) | `out/main/daemon.js` |
| the pty host | `src/daemon/ptyHost.ts:164` `up`, the daemon's `process.execPath` | `out/main/ptyhost.js` |
| the CLI | `src/daemon/core.ts:285` `cliArgv`: the launcher on PATH (`cliText`, `LAKI_CLI` :425), the skills' (`skill.ts:47`), an extension's `$LAKI_CLI` (`widgets.ts:1012`) | `out/main/cli.js` |
| `laki mcp` | `cliArgv` too: the skills' MCP command (`skill.ts:36`), Laki AI's (`ai.ts:870` `mcpWith`) | `out/main/cli.js mcp` |
| hooks | `core.ts:291` `hookArgv` | `out/main/hook.js` |
| widget scripts | `widgets.ts:1204` runs, `widgetEvents.ts:341` streams: the daemon's `process.execPath` | an extension's `.js` |
| `--headless` | `src/main/index.ts:415`: main spawns `serve` | `out/main/cli.js serve` |
