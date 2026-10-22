#!/bin/bash
# A release from this Mac to every platform (docs/manual-release.md): the checks, a new version, macOS arm64 and x64
# (signed and notarized with the Developer ID in the Keychain), Linux arm64 and x64 AppImages (Docker), each one
# smoke-tested, then a draft release on the public releases repo (package.json's build.publish). Nothing goes live
# until `publish`.
#   scripts/release.sh [minor|patch|major|<x.y.z>] [--no-upload] [--adhoc] [--skip=mac-x64,linux-x64,…] [--any-branch]
#   scripts/release.sh upload <x.y.z>     upload dist/release/<x.y.z> to its draft (again, after a failed upload)
#   scripts/release.sh publish <x.y.z>    push the tag, and the draft goes live, then the Homebrew tap follows it
#   scripts/release.sh tap <x.y.z>        the tap's cask to a published release (again, after a failed bump)
#   scripts/release.sh cask <x.y.z> <SHA256SUMS.txt>   print that cask
set -eo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
REPO=$(node -p "const p = [].concat(require('./package.json').build.publish)[0]; p.owner + '/' + p.repo")
TAP=${REPO%%/*}/homebrew-laki # brew install --cask <owner>/laki/laki
PROFILE=${APPLE_KEYCHAIN_PROFILE:-laki-notary}
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
# v<v> on the releases repo: draft, published or none; anything else gh says stops the script (in $(…) too: an
# assignment's status is the substitution's), so a failed look never reads as "none" and makes a second draft
rel() {
  local o
  if o=$(gh release view "v$1" -R "$REPO" --json isDraft -q .isDraft 2>&1); then
    [ "$o" = true ] && echo draft || echo published
  elif [[ $o == *"not found"* ]]; then
    echo none
  else
    die "gh release view v$1 -R $REPO: $o"
  fi
}

# what a release holds, besides SHA256SUMS.txt: the downloads and the updaters' feeds (latest-mac.yml…)
files() { (cd "dist/release/$1" && shopt -s nullglob && printf '%s\n' Laki-"$1"-*.dmg Laki-"$1"-*.zip Laki-"$1"-*.AppImage \
  *.blockmap *-mac.yml *-linux*.yml); }

upload() {
  local v=$1 dir=dist/release/$1 f notes
  [ -d "$dir" ] || die "no $dir: build it first"
  f=$(files "$v")
  [ -n "$f" ] || die "nothing to upload in $dir"
  (cd "$dir" && shasum -a 256 $f > SHA256SUMS.txt)
  f="$f SHA256SUMS.txt"
  notes=$(mktemp) # this version's section of docs/release-notes.md (scripts/notes.ts stamped it "## <v> · <date>")
  awk -v h="## $v" 'index($0, h " ") == 1 || $0 == h { on = 1; next } on && /^## / { exit } on' docs/release-notes.md > "$notes"
  [ -s "$notes" ] || echo "Laki $v" > "$notes"
  local s
  s=$(rel "$v")
  case $s in
    draft)
      # ponytail: --clobber replaces files of the same name; one an earlier upload had and this one doesn't stays
      (cd "$dir" && gh release upload "v$v" -R "$REPO" --clobber $f)
      gh release edit "v$v" -R "$REPO" --notes-file "$notes"
      ;;
    published) rm -f "$notes"; die "v$v is already published on $REPO" ;;
    none)
      # gh says "not found" when the tag lookup 404s and the draft lookup fails: look at the list once more
      local tags
      tags=$(gh release list -R "$REPO" --json tagName -q '.[].tagName') # no pipe into grep -q: pipefail and SIGPIPE
      case $'\n'$tags$'\n' in *$'\n'"v$v"$'\n'*) die "v$v is on $REPO but gh couldn't read it: try again" ;; esac
      local pre=
      case $v in *-*) pre=--prerelease ;; esac
      (cd "$dir" && gh release create "v$v" -R "$REPO" --draft $pre --title "Laki $v" --notes-file "$notes" $f)
      ;;
  esac
  rm -f "$notes"
  echo "Draft: $(gh release view "v$v" -R "$REPO" --json url -q .url)"
}

publish() {
  local v=$1 s
  s=$(rel "$v")
  [ "$s" = draft ] || die "no draft v$v on $REPO (it's $s)"
  git rev-parse -q --verify "refs/tags/v$v" > /dev/null || die "no tag v$v here: scripts/release.sh makes it"
  git push origin "refs/tags/v$v"
  case $v in
    *-*) gh release edit "v$v" -R "$REPO" --draft=false ;;
    *) gh release edit "v$v" -R "$REPO" --draft=false --latest ;;
  esac
  echo "Live: $(gh release view "v$v" -R "$REPO" --json url -q .url)"
  echo "Push $(git branch --show-current) when you're ready: the release commit is on it."
  tap "$v"
}

# the tap's Casks/laki.rb for version $1 from its SHA256SUMS.txt ($2): both Macs, or Apple silicon only (--skip=mac-x64).
# zap leaves ~/.laki: worktrees with work not committed live there
cask() {
  local v=$1 arm x64 arch sha dmg dep
  arm=$(awk -v f="Laki-$v-arm64.dmg" '$2 == f { print $1 }' "$2")
  x64=$(awk -v f="Laki-$v-x64.dmg" '$2 == f { print $1 }' "$2")
  [ -n "$arm" ] || return 1
  if [ -n "$x64" ]; then
    arch=$'  arch arm: "arm64", intel: "x64"\n\n' dmg='#{arch}' dep=
    sha="sha256 arm:   \"$arm\",
         intel: \"$x64\""
  else
    arch= sha="sha256 \"$arm\"" dmg=arm64 dep=$'  depends_on arch: :arm64\n'
  fi
  cat << EOF
cask "laki" do
${arch}  version "$v"
  $sha

  url "https://github.com/$REPO/releases/download/v#{version}/Laki-#{version}-$dmg.dmg"
  name "Laki"
  desc "Runs coding agents side by side, each task in its own git worktree"
  homepage "https://github.com/$REPO"

${dep}  depends_on :macos

  app "Laki.app"

  zap trash: [
    "~/Library/Application Support/Laki",
    "~/Library/Preferences/dev.laki.app.plist",
    "~/Library/Saved Application State/dev.laki.app.savedState",
  ]
end
EOF
}

# a published release into the tap: its cask written through GitHub's API (no clone); a pre-release leaves it be
tap() {
  local v=$1 sums file sha
  case $v in *-*) echo "v$v is a pre-release: the tap stays as it is"; return ;; esac
  [ "$(rel "$v")" = published ] || die "v$v isn't published on $REPO: the tap stays as it is"
  sums=$(mktemp) file=$(mktemp)
  gh release download "v$v" -R "$REPO" -p SHA256SUMS.txt -O "$sums" --clobber
  cask "$v" "$sums" > "$file" || die "no Laki-$v-arm64.dmg in v$v's SHA256SUMS.txt: the tap stays as it is"
  sha=$(gh api "repos/$TAP/contents/Casks/laki.rb" -q .sha 2> /dev/null) || sha= # none yet: the first one
  gh api -X PUT "repos/$TAP/contents/Casks/laki.rb" -f message="laki $v" -f content="$(base64 < "$file")" \
    ${sha:+-f "sha=$sha"} > /dev/null || die "$TAP's cask wasn't written: scripts/release.sh tap $v"
  rm -f "$sums" "$file"
  echo "Tap: brew install --cask ${TAP%%/*}/laki/laki ($v)"
}

case $1 in
  upload | publish | tap) [ -n "$2" ] || die "usage: scripts/release.sh $1 <version>"; "$1" "${2#v}"; exit ;;
  cask) [ -f "$3" ] || die "usage: scripts/release.sh cask <version> <SHA256SUMS.txt>"; cask "${2#v}" "$3" || die "no Laki-${2#v}-arm64.dmg in $3"; exit ;;
esac

BUMP=minor UPLOAD=1 ADHOC=0 SKIP= ANY=0
for a in "$@"; do
  case $a in
    --no-upload) UPLOAD=0 ;;
    --adhoc) ADHOC=1 ;;
    --any-branch) ANY=1 ;;
    --skip=*) SKIP=${a#--skip=} ;;
    -h | --help) sed -n '2,8p' "$0"; exit ;;
    -*) die "unknown option $a (--help)" ;;
    *) BUMP=$a ;;
  esac
done
case $BUMP in # npm version's words or a version; anything else is a typo, caught before the checks' minutes
  major | minor | patch | premajor | preminor | prepatch | prerelease | [0-9]*.[0-9]*.[0-9]*) ;;
  *) die "not a version or a bump: $BUMP (--help)" ;;
esac
want() { case ",$SKIP," in *",$1,"*) return 1 ;; esac; }
for s in ${SKIP//,/ }; do case $s in mac-arm64 | mac-x64 | linux-arm64 | linux-x64) ;; *) die "--skip: no $s (mac-arm64, mac-x64, linux-arm64, linux-x64)" ;; esac; done
want mac-arm64 || want mac-x64 || want linux-arm64 || want linux-x64 || die "--skip leaves nothing to build"

say "Preflight"
# ponytail: Apple silicon only. An Intel Mac has only node-pty's x64 binary and can't run the arm64 smoke test
[ "$(uname)" = Darwin ] && [ "$(uname -m)" = arm64 ] || die "release from an Apple silicon Mac"
[ -z "$(git status --porcelain)" ] || die "commit first: the release commit takes only the version and the notes"
BRANCH=$(git branch --show-current)
[ "$BRANCH" = main ] || [ $ANY = 1 ] || die "on ${BRANCH:-a detached HEAD}: release from main (or --any-branch)"
git fetch -q origin
[ "$(git rev-list --count 'HEAD..@{upstream}' 2> /dev/null || echo 0)" = 0 ] || die "$BRANCH is behind its upstream: pull first"
grep -qx '## Next' docs/release-notes.md || die "docs/release-notes.md has no '## Next': add this release's lines under it"
if [ $UPLOAD = 1 ]; then
  gh auth status > /dev/null 2>&1 || die "gh isn't signed in: gh auth login"
  [ "$(gh repo view "$REPO" --json visibility -q .visibility 2> /dev/null)" = PUBLIC ] ||
    die "$REPO must exist and be public: gh repo create $REPO --public --add-readme"
fi
if want linux-arm64 || want linux-x64; then
  docker info > /dev/null 2>&1 || die "start Docker for the Linux builds (or --skip=linux-arm64,linux-x64)"
fi
if want mac-arm64 || want mac-x64; then # the smoke test opens the packaged app, and Laki.app holds the single-instance lock
  [ "$(osascript -e 'application id "dev.laki.app" is running' 2> /dev/null)" != true ] ||
    die "quit Laki.app first (⌘Q: its daemon and agents keep running)"
fi
if want mac-x64; then
  arch -x86_64 /usr/bin/true 2> /dev/null || die "the Intel smoke test needs Rosetta: softwareupdate --install-rosetta (or --skip=mac-x64)"
fi
SIGN=()
if [ $ADHOC = 1 ]; then # package.json's identity "-": what `npm run dmg` makes; nothing to notarize with
  unset APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER APPLE_KEYCHAIN_PROFILE
  echo "Ad-hoc: a download opens only through System Settings › Privacy & Security › Open Anyway, and can't auto-update."
else
  ID=$(security find-identity -v -p codesigning | sed -n 's/.*"Developer ID Application: \(.*\)"$/\1/p')
  ID=${ID%%$'\n'*} # the first one; not `| head -1`: with pipefail, its early exit can SIGPIPE the pipeline
  [ -n "$ID" ] || die "no Developer ID Application certificate in the Keychain (docs/manual-release.md › Once), or --adhoc"
  xcrun notarytool history --keychain-profile "$PROFILE" > /dev/null 2>&1 ||
    die "no working notary credentials '$PROFILE': xcrun notarytool store-credentials $PROFILE … (docs/manual-release.md › Once)"
  export APPLE_KEYCHAIN_PROFILE=$PROFILE
  SIGN=("-c.mac.identity=$ID" -c.mac.hardenedRuntime=true
    -c.mac.entitlements=build/entitlements.mac.plist -c.mac.entitlementsInherit=build/entitlements.mac.plist)
  echo "Signing as: Developer ID Application: $ID; notarizing with '$PROFILE'"
fi
echo "Releases: $REPO$([ $UPLOAD = 1 ] || echo ' (not this time: --no-upload)')"

say "Checks"
npm ci --no-audit --no-fund
npm run typecheck
npm test

say "Version"
BUMPED=0 DONE=0
undo() { # a run that didn't get to its commit puts the version and the notes back (edits to them meanwhile too)
  [ $BUMPED = 1 ] && [ $DONE = 0 ] || return 0
  git checkout -- package.json package-lock.json docs/release-notes.md
  echo "Version and release notes put back."
}
trap undo EXIT
npm version "$BUMP" --no-git-tag-version > /dev/null
BUMPED=1
node --experimental-strip-types --no-warnings scripts/notes.ts
V=$(node -p "require('./package.json').version")
echo "Laki $V"
! git rev-parse -q --verify "refs/tags/v$V" > /dev/null || die "the tag v$V exists already"
if [ $UPLOAD = 1 ]; then
  s=$(rel "$V")
  [ "$s" = none ] || die "$REPO has a v$V already ($s)"
fi
OUT=dist/release/$V
rm -rf "$OUT" && mkdir -p "$OUT"

MAC=()
want mac-arm64 && MAC+=(--arm64)
want mac-x64 && MAC+=(--x64)
if [ ${#MAC[@]} -gt 0 ]; then
  say "macOS: ${MAC[*]}"
  if want mac-x64; then # node-pty's Intel binary next to this Mac's (npm installs only the host's), as pack:x64 does
    npm i --no-save --force --no-audit --no-fund "@lydell/node-pty-darwin-x64@$(node -p "require('./node_modules/@lydell/node-pty/package.json').version")"
  fi
  npm run build
  npx electron-builder --mac dmg zip "${MAC[@]}" "${SIGN[@]}" --publish never "-c.directories.output=$OUT"
  for app in "$OUT"/mac*/Laki.app; do
    codesign --verify --deep --strict "$app"
    if [ $ADHOC = 0 ]; then
      spctl -a -t exec -vv "$app" # "source=Notarized Developer ID"
      xcrun stapler validate "$app"
    fi
  done
  T=${TMPDIR:-/tmp}
  if want mac-arm64; then say "Smoke test: macOS arm64"; APP=$ROOT/$OUT/mac-arm64/Laki.app bash scripts/pack-smoke.sh "$T/laki-smoke-arm64"; fi
  if want mac-x64; then say "Smoke test: macOS x64"; APP=$ROOT/$OUT/mac/Laki.app bash scripts/pack-smoke.sh "$T/laki-smoke-x64"; fi
fi

for a in arm64 x64; do
  want "linux-$a" || continue
  say "Linux $a (Docker: the AppImage, its smoke test$([ $a = arm64 ] && echo ', the tests: native here'))"
  rm -f dist/linux/*.yml # each run leaves its own feed: latest-linux.yml (x64), latest-linux-arm64.yml
  ARCH=$a TESTS=$([ $a = arm64 ] && echo 1 || echo 0) bash scripts/linux.sh
  cp "dist/linux/Laki-$V-$([ $a = x64 ] && echo x86_64 || echo arm64).AppImage" dist/linux/*-linux*.yml "$OUT/"
done

say "Release files"
(cd "$OUT" && ls -lh $(files "$V"))
if [ $UPLOAD = 0 ]; then
  echo "Built in $OUT. --no-upload: no commit, no tag, nothing uploaded."
  exit 0
fi

say "Commit and tag"
git commit -qm "Release $V" -- package.json package-lock.json docs/release-notes.md
git tag -a "v$V" -m "Laki $V"
DONE=1

say "Upload"
echo "(If it fails, the builds stay in $OUT: scripts/release.sh upload $V)"
upload "$V"
cat << EOF

Laki $V is a draft on $REPO. Read it and try a download, then:
  scripts/release.sh publish $V
EOF
