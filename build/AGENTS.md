# AGENTS.md: build/

What this folder's files are. Read the root [AGENTS.md](../AGENTS.md) first: the commands, the architecture, the invariants, the conventions.

## Notes

- Fuses (`build.electronFuses`, electron-builder's `@electron/fuses`): `runAsNode`, `--inspect` and `NODE_OPTIONS` off,
  and main quits on Chromium's `--remote-debugging-*` switches and on `ELECTRON_RUN_AS_NODE` (an old launcher: it says
  so). What runs as node (the daemon, the CLI, hooks, MCP, the pty host, widget scripts, `--headless`) runs on Laki Node,
  `Contents/Frameworks/Laki Node.app` (Linux: `laki-node`), the app's stub with its own copy of Electron's framework,
  fuse on (`scripts/after-pack.cjs` `nodeHelper`; `src/shared/helper.ts` `helperBin`; ~210 MB: docs/dev/helper.md). The
  asar ones stay off (asar is off). Cookie encryption
  stays off: Chromium's cookie store then waits on the Keychain's *Laki Safe Storage*, the window never reaches the daemon
  until it's answered (pack-smoke's temp home: never), and an ad-hoc signature asks again after each update.
  `npx electron-fuses read --app dist/mac-arm64/Laki.app` shows them.
- The app icon is `build/icon.icns`, rendered from the mark `src/renderer/src/icon.svg` (also the splash and the
  browser tab's icon) by `swift scripts/icon.swift`: change the SVG, then run it. macOS 26's own (V15): `build/Laki.icon`, an Icon Composer document (`icon.json`: the tile's gradient as its
  fill and a darker one for dark; `Assets/` the caret and the sun, copies of `build/icon/mark.svg` and `highlight.svg`;
  `build/icon/background.svg` the tile, on the 1024 canvas), compiled by `scripts/after-pack.cjs` (electron-builder's
  `afterPack`) with Xcode 26's `actool` into `Contents/Resources/Assets.car` and `CFBundleIconName`; the `.icns` stays
  `CFBundleIconFile` (macOS 15 and earlier). No Xcode 26: the `.icns` alone, said in one line. Look at one appearance:
  Icon Composer's `ictool build/Laki.icon --export-image --platform macOS --rendition Dark …` (Default, Dark,
  TintedLight, TintedDark, ClearLight, ClearDark).

## Files

| file | what |
|---|---|
| `build/icon.icns` | the app icon (electron-builder), rendered from `src/renderer/src/icon.svg` by `scripts/icon.swift` |
