#!/bin/bash
# npm run dmg (docs/release.md): the checks, the dependency audit, the version (minor +1) and its notes, the unpacked app
# built and smoke-tested (scripts/pack-smoke.sh: its daemon, CLI and hooks inside the bundle, a window), and only then
# the dmg, from that same app (--prepackaged): what was tested is what ships. A failed step stops it: exit non-zero,
# package.json, package-lock.json and the release notes as they were, no partial dmg, no smoke daemon left running.
# LAKI_SKIP_AUDIT=1 and LAKI_SKIP_SMOKE=1 skip those, loudly. macOS only (the Linux build: npm run pack:linux).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
loud() { printf '\n\033[1;31m!!! %s\033[0m\n\n' "$*"; }
OUT=dist/release
APP=$ROOT/$OUT/$([ "$(uname -m)" = arm64 ] && echo mac-arm64 || echo mac)/Laki.app
V=
DONE=0

npm run check
if [ "${LAKI_SKIP_AUDIT:-}" = 1 ]; then loud "LAKI_SKIP_AUDIT=1: the dependency audit is SKIPPED"; else npm run audit:deps; fi
echo "The oldest security shortcuts (npm run debt -- --old):" # never fails the build
npm run -s debt -- --old 2> /dev/null | grep '  security  ' | head -3 || true
T=$(mktemp -d "${TMPDIR:-/tmp}/laki-dmg.XXXXXX")
H=$T/smoke # pack-smoke's own HOME and LAKI_HOME (never ~/.laki)

# what the version and the notes were: put back unless the dmg is made (an edit to them meanwhile too, as release.sh does)
cp package.json package-lock.json docs/release-notes.md "$T/"
undo() {
  local code=$?
  set +e # errexit would stop the trap at its first failing command (a pkill that finds no terminal), before the files are put back
  if [ -f "$H/data/daemon.json" ]; then # a smoke that failed before its own trap ran: its daemon, by the pid it wrote
    pid=$(node -p "require('$H/data/daemon.json').pid" 2> /dev/null || true)
    # only the bundle's own daemon (a stale file's pid may be another process's now)
    if [ -n "$pid" ] && ps -o command= -p "$pid" 2> /dev/null | grep -qF "$APP/Contents/Resources/app/out/main/daemon.js"; then kill "$pid" 2> /dev/null || true; fi
  fi
  for p in $(lsof -t "$H/data/pty.sock" 2> /dev/null); do pkill -P "$p" 2> /dev/null; kill "$p" 2> /dev/null; done # its pty host, its terminals with it
  if [ $DONE = 0 ]; then
    cp "$T/package.json" "$T/package-lock.json" . && cp "$T/release-notes.md" docs/
    [ -n "$V" ] && rm -f "$OUT/Laki-$V-"*.dmg "$OUT/Laki-$V-"*.dmg.blockmap
    echo "No dmg: the version and the release notes are as they were."
  fi
  rm -rf "$T"
  exit $code
}
trap undo EXIT

npm version minor --no-git-tag-version > /dev/null
V=$(node -p "require('./package.json').version")
node --experimental-strip-types --no-warnings scripts/notes.ts
echo "Laki $V"
npx electron-vite build
npm run size
npx electron-builder --mac --dir --publish never "-c.directories.output=$OUT"

if [ "${LAKI_SKIP_SMOKE:-}" = 1 ]; then
  loud "LAKI_SKIP_SMOKE=1: the packaged app is NOT smoke-tested: its daemon may not start"
elif [ -t 1 ]; then
  APP=$APP bash scripts/pack-smoke.sh "$H"
else
  # from a tool's shell, the daemon's "who's calling" check wants a terminal: script gives it one, its output in a log
  LOG=$T/smoke.log
  script -q "$LOG" bash -c 'APP="$1" bash scripts/pack-smoke.sh "$2"; echo $? > "$3"' _ "$APP" "$H" "$T/smoke.status" < /dev/null > /dev/null || true
  if [ "$(cat "$T/smoke.status" 2> /dev/null)" != 0 ]; then
    tail -40 "$LOG"
    loud "the packaged app's smoke test failed: no dmg"
    exit 1
  fi
  tail -5 "$LOG"
fi

npx electron-builder --mac dmg --prepackaged "$APP" --publish never "-c.directories.output=$OUT"
DONE=1
ls -la "$OUT/Laki-$V-"*.dmg
