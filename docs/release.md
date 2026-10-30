# Releasing Laki

A build here (`npm run pack`, `npm run dmg`) is ad-hoc signed (`mac.identity: "-"`; unsigned, a download reads as "damaged"), not notarized, one architecture per build; its Update is a link to the release's page, since only a signed app replaces itself (see the guide's limits).

`npm run release` runs these steps for every platform, signed and notarized with your Developer ID, and uploads a
draft to the public releases repo: [manual-release.md](manual-release.md).

1. Start from a clean `main`: `git status` shows nothing to commit.
2. Bump `version` in `package.json` (About shows it). Bump `API` in `src/shared/types.ts` if the renderer now relies
   on a new daemon method or behavior (AGENTS.md, API).
3. Check:
   ```bash
   npm ci
   npm run typecheck
   npm test
   ```
   Run `npm test` twice: a test that fails once and passes alone is a flake to look at, not to ship past.
4. Build:
   ```bash
   npm run pack       # this Mac's architecture: dist/mac-arm64/Laki.app (Intel: dist/mac)
   npm run pack:x64   # the Intel app from an Apple silicon Mac: dist/mac/Laki.app
   ```
   A disk image to hand out: `npm run dmg` bumps the minor version (`npm version minor`, no tag), builds, and writes
   `dist/release/Laki-<version>-arm64.dmg` (its own folder: a running `dist/mac-arm64/Laki.app` and its daemon stay
   as they are). Each run is a new minor version, and `docs/release-notes.md`'s `## Next` becomes it (Settings ›
   Release notes): add a line there for each user-visible change before.
5. Run `scripts/pack-smoke.sh` once before a release: it runs the packaged app's daemon, CLI and hooks on Electron's
   node with fake agents, in a temp home, and takes a window screenshot. Quit Laki.app first (the daemon can stay): macOS keeps
   the app's data folder under the real home, so a running one holds the single-instance lock and the smoke's window quits. For the Intel build:
   `APP=$PWD/dist/mac/Laki.app scripts/pack-smoke.sh` (under Rosetta).
6. Open the app once by hand: a project, a workspace with an agent, a turn's notification, Settings.
7. Commit (`Release x.y.z`), tag `vx.y.z`.

Users' daemons outlive app updates: an older one gets a yellow bar at the top, *Restart Laki's daemon*. Their
`state.json` carries over; `state.json.bak` is the last one that loaded.
