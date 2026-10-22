# Releasing every platform from your Mac

One command builds Laki for macOS (Apple silicon and Intel) and Linux (arm64 and x64), tests and smoke-tests each
build, and uploads them as a draft release on the public releases repo,
[igorkasyanchuk/laki-releases](https://github.com/igorkasyanchuk/laki-releases) (`build.publish` in `package.json`).
Nothing goes live until you publish the draft. It costs nothing but the Apple Developer Program. People download it
from [the latest release](https://github.com/igorkasyanchuk/laki-releases/releases/latest), or with Homebrew:
`brew install --cask igorkasyanchuk/laki/laki` (the tap, [igorkasyanchuk/homebrew-laki](https://github.com/igorkasyanchuk/homebrew-laki),
follows each publish).

Each time, after Once below (`## Next` written in the notes, Laki.app quit, Docker running, from the main checkout on a
clean, up-to-date `main`):

```bash
npm run release                          # the next minor version: 0.24.0 → 0.25.0, as a draft
scripts/release.sh publish 0.25.0        # after reading the draft: it goes live, and the Homebrew tap with it
git push                                 # the release commit
```

[docs/release.md](release.md) is the checklist behind it; `npm run dmg` still makes a quick local dmg, ad-hoc, uploaded
nowhere.

## What a release holds

| file | for |
|---|---|
| `Laki-<v>-arm64.dmg`, `Laki-<v>-x64.dmg` | downloads for Apple silicon and Intel Macs |
| `Laki-<v>-arm64.zip`, `Laki-<v>-x64.zip`, `latest-mac.yml` | the macOS updater's feed (Squirrel.Mac takes the zip) |
| `Laki-<v>-arm64.AppImage`, `Laki-<v>-x86_64.AppImage` | Linux downloads, and their own updates |
| `latest-linux.yml`, `latest-linux-arm64.yml` | the Linux updater's feed |
| `*.blockmap` | differential updates: only the changed blocks download |
| `SHA256SUMS.txt` | checksums of everything above |

The app doesn't check for updates yet; the feeds are there so the first version that does finds them.

## Once

1. **A Developer ID.** Join the [Apple Developer Program](https://developer.apple.com/programs/enroll/) ($99 a year;
   as yourself, approved in a day or two; as a company, a [D-U-N-S number](https://developer.apple.com/enroll/duns-lookup/)
   first, a week or more. Pick once: an update must be signed by the same team), then in Xcode › Settings › Accounts ›
   *Manage Certificates…* › + › *Developer ID Application*, or on the
   [certificates page](https://developer.apple.com/account/resources/certificates/list) (G2 Sub-CA) with a request from
   Keychain Access › Certificate Assistant. Only the account holder can make one. Not *Developer ID Installer* (a
   `.pkg`'s) nor *Apple Distribution* (the Mac App Store's). It goes into your login Keychain; check with
   `security find-identity -v -p codesigning`: `Developer ID Application: <name> (<team id>)`. Laki's is
   `Igor Kasyanchuk (VV2UN2324U)`. Listed only without `-v`, as not trusted: Apple's *Developer ID - G2* intermediate is
   missing ([apple.com/certificateauthority](https://www.apple.com/certificateauthority/)).

   Back it up: Keychain Access › My Certificates, its right click › *Export*, a `.p12` with a password, into a password
   manager (not a synced folder). It holds the private key; without it, another Mac can't sign as you. Check one:
   `openssl pkcs12 -in laki.p12 -info -noout -legacy` shows a `Certificate bag` and a `Shrouded Keybag` (OpenSSL 3 needs
   `-legacy` for the Keychain's RC2; a wrong password says `Mac verify error`).
2. **Notarization credentials**, kept in the Keychain as the profile `laki-notary`. With your Apple ID, at once: an
   app-specific password from [account.apple.com](https://account.apple.com) › Sign-In and Security ›
   App-Specific Passwords, then
   ```bash
   xcrun notarytool store-credentials laki-notary --apple-id <your Apple ID> --team-id VV2UN2324U
   ```
   (it asks for the password: none in the shell's history). Or with an App Store Connect API key, once the account
   holder's *Request Access* under [Users and Access › Integrations](https://appstoreconnect.apple.com/access/integrations/api)
   is granted: Team Keys › +, Developer access, the `.p8` (it downloads once):
   ```bash
   xcrun notarytool store-credentials laki-notary --key ~/keys/AuthKey_ABC123.p8 --key-id ABC123 --issuer <issuer-id>
   ```
   Check with `xcrun notarytool history --keychain-profile laki-notary` (*No submission history* is fine).
   Another profile name: `APPLE_KEYCHAIN_PROFILE=<name> npm run release`.
3. **The releases repo**, public (an updater can't read a private repo's releases without a token inside the app; the
   source stays private): [igorkasyanchuk/laki-releases](https://github.com/igorkasyanchuk/laki-releases), made. Its
   README is what visitors read: the download link (`/releases/latest`) and what Laki needs. Another one:
   `gh repo create <owner>/<repo> --public --add-readme`, and `build.publish` in `package.json`.
4. **The Homebrew tap**, public, the releases repo's owner's `homebrew-laki` (`TAP` in the script; Homebrew reads
   `<owner>/laki` as `github.com/<owner>/homebrew-laki`): [igorkasyanchuk/homebrew-laki](https://github.com/igorkasyanchuk/homebrew-laki),
   made, a README only until the first publish writes `Casks/laki.rb`.
5. **Tools**: an Apple silicon Mac (it builds Intel too, and runs it under Rosetta); `gh auth login`; Docker Desktop running (the Linux builds); Rosetta for the Intel smoke test
   (`softwareupdate --install-rosetta --agree-to-license`).

No Developer ID yet? `npm run release -- --adhoc` signs as `npm run dmg` does: the release works, but a download
opens only through System Settings › Privacy & Security › *Open Anyway*, and it can never update itself.

## The first signed one

Rehearse it: `npm run release -- --no-upload --skip=mac-x64,linux-arm64,linux-x64` signs, notarizes and smoke-tests the
Apple silicon app into `dist/release/<v>`, then puts the version back (no repo needed). A new team's first notarization
can take hours. Send the dmg to another Mac (AirDrop or a download, so it's quarantined) and open it: a plain
double-click, no warning. The hardened runtime is new to these, so try each: the daemon and CLI, a terminal, an agent's
hooks and notifications, the mic (dictation, Voice), screenshots (Screen Recording), `laki://` links, *Install the laki
command*.

The Developer ID gives the app a new identity: macOS asks once more for the mic and Screen Recording. Say so in that
version's notes.

## Each release

1. Write what changed under `## Next` in [docs/release-notes.md](release-notes.md). The script refuses to run without
   it: it becomes the version's heading, the GitHub release's text and Settings › Release notes.
2. Quit Laki.app (⌘Q). Its daemon and your agents keep running; the smoke test opens the packaged app, and a running
   Laki holds the single-instance lock.
3. Start Docker Desktop (the Linux builds; or `--skip=linux-arm64,linux-x64`). Run it from the main checkout on a
   clean, up-to-date `main`:
   ```bash
   npm run release                         # minor
   npm run release -- patch                # or major, or a version: 1.0.0
   npm run release -- 0.19.0-beta.1        # a pre-release: marked so on GitHub, never "latest"
   ```
4. Read the draft it links to. Download a dmg in a browser and open it: a notarized build opens with a plain
   double-click.
5. Publish it, then push `main` (the release commit is on it):
   ```bash
   scripts/release.sh publish 0.18.0       # pushes the tag v0.18.0, the draft goes live, the tap's cask follows
   git push
   ```
   `brew update && brew upgrade --cask laki` (or `brew install --cask igorkasyanchuk/laki/laki`) then gets it.

A full run takes 30 to 60 minutes; Linux x64, emulated on Apple silicon, is the slow part. Leave `package.json`,
`package-lock.json` and the release notes alone meanwhile: a run that fails puts all three back as they were.

## What it does

1. **Preflight**: a clean tree on `main`, not behind `origin`; `## Next` in the notes; `gh` signed in and the
   releases repo public; Docker running; Laki.app quit; Rosetta; the Developer ID in the Keychain and the notary
   profile answering. It stops here, before anything changes, if one is missing.
2. **Checks**: `npm ci`, `npm run typecheck`, `npm test`.
3. **Version**: `npm version <bump>` and `scripts/notes.ts` (`## Next` becomes `## <v> · <date>`). If anything fails
   from here until the commit, `package.json`, `package-lock.json` and the notes are put back.
4. **macOS**: node-pty's Intel binary beside this Mac's (as `pack:x64`), `electron-vite build`, then one
   `electron-builder --mac dmg zip --arm64 --x64` into `dist/release/<v>`. With the Developer ID: hardened runtime,
   [build/entitlements.mac.plist](../build/entitlements.mac.plist), notarized, the ticket stapled to each app.
5. **Verify**: `codesign --verify --deep --strict`; signed, also `spctl -a` (Gatekeeper's "Notarized Developer ID")
   and `stapler validate`.
6. **Smoke tests**: [scripts/pack-smoke.sh](../scripts/pack-smoke.sh) against each app, the Intel one under Rosetta.
7. **Linux**: [scripts/linux.sh](../scripts/linux.sh) for arm64 and x64: an AppImage, its smoke test under Xvfb, and
   the test suite on this Mac's own architecture.
8. **Commit and tag**: `Release <v>` (only `package.json`, `package-lock.json`, the notes) and the tag `v<v>`, here only.
9. **Upload**: `SHA256SUMS.txt`, then a draft `v<v>` on the releases repo with the files above and this version's notes.
10. **Publish** (`scripts/release.sh publish`, yours to run): the tag, the release live, then the tap: `Casks/laki.rb`
    written through GitHub's API from the release's `SHA256SUMS.txt`, both Macs or, with `--skip=mac-x64`, Apple
    silicon only (`depends_on arch: :arm64`). A pre-release leaves the tap be. `zap` leaves `~/.laki`: worktrees with
    work not committed live there.

## Options

| | |
|---|---|
| `--no-upload` | build and check everything into `dist/release/<v>`, then put the version back: no commit, tag or upload. A rehearsal |
| `--skip=mac-x64,linux-x64` | leave platforms out (`mac-arm64`, `mac-x64`, `linux-arm64`, `linux-x64`) |
| `--adhoc` | no Developer ID: ad-hoc signed, not notarized |
| `--any-branch` | release from a branch other than `main` |
| `scripts/release.sh upload <v>` | upload `dist/release/<v>` to its draft again (`--clobber`), e.g. after a failed upload |
| `scripts/release.sh publish <v>` | push the tag `v<v>`; the draft goes live and, unless it's a pre-release, *latest* and the tap's cask |
| `scripts/release.sh tap <v>` | the tap's cask to a published `v<v>` again, e.g. after a failed bump |
| `scripts/release.sh cask <v> <SHA256SUMS.txt>` | print the cask it would write (`test/release.test.ts`) |

## When something fails

- **Before the commit** (checks, a build, a smoke test): the version and notes are back as they were. Fix it, run again.
- **The upload**: the commit, the tag and the builds are kept. `scripts/release.sh upload <v>`.
- **The tap**: the release is live anyway. `scripts/release.sh tap <v>`.
- **Notarization rejected**: `xcrun notarytool history --keychain-profile laki-notary`, then
  `xcrun notarytool log <id> --keychain-profile laki-notary` says which file and why.
- **A draft you don't want**: `gh release delete v<v> -R igorkasyanchuk/laki-releases --yes`, then `git tag -d v<v>`
  and, if the release commit is the last one and not pushed, `git reset --hard HEAD~1`.
- **A bad published release**: don't delete or replace it; release a patch (`npm run release -- patch`). An older
  build must never follow a newer one: a newer daemon may already have written `state.json`.

## Not yet

- The app checking for updates (electron-updater reading the feeds above), and its daemon restarting itself once
  agents are idle.
- Homebrew's own `homebrew/cask` (`brew install --cask laki`): it takes notable apps only
  ([Acceptable Casks](https://docs.brew.sh/Acceptable-Casks)); the tap until then.
- Windows.
